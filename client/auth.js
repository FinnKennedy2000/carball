// Supabase auth, entirely client-side. The game does not depend on it: with no
// credentials configured `enabled` is false, every call is a no-op, and play
// continues as a guest. Accounts only add a stable name and career stats.
//
// The access token is handed to the game server on join; the server verifies it
// rather than trusting any name the client claims.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const enabled = Boolean(url && anonKey)

const supabase = enabled ? createClient(url, anonKey) : null

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

export async function signOut() {
  await supabase.auth.signOut()
}

/** The token the game server verifies, or null when playing as a guest. */
export async function accessToken() {
  if (!enabled) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
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
