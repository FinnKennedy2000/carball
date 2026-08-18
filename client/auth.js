// Supabase auth, entirely client-side. Signing in stays optional — with no
// session you play as a guest with a typed-in name — but Supabase itself is no
// longer optional, because Realtime is now the game's transport too. With
// nothing configured, `enabled` is false and there is no multiplayer at all.
//
// The access token is never put on a room channel: the host is another player's
// browser, and a token there would hand them the session. It only ever goes to
// Supabase itself, or to our own /api/record-match over HTTPS.

import { createClient } from '@supabase/supabase-js'

// Either naming works. The NEXT_PUBLIC_ pair is what the Supabase Vercel
// integration writes into the project by itself, so linking the two accounts is
// enough and nothing has to be copied by hand; the VITE_ pair is what a local
// .env uses and takes precedence when both are present. envPrefix in
// vite.config.js is what lets a NEXT_PUBLIC_ name reach the bundle at all.
// Vite defines import.meta.env; plain Node does not, and the test imports this
// module for the pure parts. Without the fallback the import itself throws.
const env = import.meta.env ?? {}
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export const enabled = Boolean(url && anonKey)

// Exported because net.js runs the game's Realtime channel on the same client —
// one connection to Supabase, shared, rather than a second socket per tab.
export const supabase = enabled ? createClient(url, anonKey) : null

/** Calls back with { user, profile } or null, now and on every auth change. */
export function watchSession(onChange) {
  if (!enabled) {
    onChange(null)
    return
  }
  supabase.auth.onAuthStateChange(async (_event, session) => {
    onChange(session ? await withProfile(session.user) : null)
  })
  // onAuthStateChange fires with the restored session on subscribe, but ask
  // once as well so a cold load without a session still resolves.
  supabase.auth.getSession().then(async ({ data }) => {
    if (!data.session) onChange(null)
  })
}

async function withProfile(user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (error) console.warn('could not load profile:', error.message)
  return { user, username: data?.username ?? user.email?.split('@')[0] ?? 'player' }
}

export async function signUp(email, password, username) {
  // The trigger on auth.users turns this metadata into a profile row.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  })
  if (error) throw new Error(error.message)
  // Projects with email confirmation on return no session until the link is
  // clicked; the caller tells the player to go and check their inbox.
  const { data } = await supabase.auth.getSession()
  return { needsConfirmation: !data.session }
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

/**
 * Change the signed-in player's name. The rules live in the database — unique,
 * two to sixteen characters — so this does not restate them; it turns the
 * constraint that fired into something worth reading.
 *
 * Unlike stats() and leaderboard(), which degrade quietly because a missing
 * leaderboard costs nothing, this throws: a rename that silently did not happen
 * is a lie told to the player's face.
 */
export async function rename(username) {
  const wanted = username.trim()
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user?.id
  if (!id) throw new Error('Sign in first')

  // Checked here as well as by the database, so the common mistake is answered
  // without a round trip. The database remains the one that decides.
  if (wanted.length < 2 || wanted.length > 16) throw new Error('Two to sixteen characters')

  const { error } = await supabase.from('profiles').update({ username: wanted }).eq('id', id)
  if (error) throw new Error(renameProblem(error))
  return wanted
}

/**
 * A Postgres error from a rename, as something a player can act on. Exported
 * for the test: it is the part of a rename that is worth checking without a
 * database in front of it.
 */
export function renameProblem(error) {
  // A clash is refused rather than suffixed the way sign-up does it: you asked
  // for a particular name, and quietly handing you a different one is worse
  // than being told it is taken.
  if (error.code === '23505') return 'That name is taken'
  if (error.code === '23514') return 'Two to sixteen characters'
  return error.message
}

export async function signOut() {
  await supabase.auth.signOut()
}

/** The token the game server verifies, or null when playing as a guest. */
export async function accessToken() {
  if (!enabled) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** One player's career row, or zeroes if they have not finished a match yet. */
export async function stats(username) {
  const empty = { goals: 0, wins: 0, matches: 0 }
  if (!enabled) return empty
  const { data, error } = await supabase
    .from('leaderboard')
    .select('goals, wins, matches')
    .eq('username', username)
    .maybeSingle()
  if (error) {
    console.warn('could not load stats:', error.message)
    return empty
  }
  return data ?? empty
}

export async function leaderboard(limit = 5) {
  if (!enabled) return []
  const { data, error } = await supabase
    .from('leaderboard')
    .select('username, goals, wins, matches')
    .order('goals', { ascending: false })
    .order('wins', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('could not load leaderboard:', error.message)
    return []
  }
  return data
}
