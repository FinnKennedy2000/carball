// The server's half of accounts: verify a token a client claims, and write
// finished matches. Both are optional — with no credentials configured the room
// runs exactly as it did before, everyone a guest.
//
// Names of signed-in players come from the database, never from the client, so a
// client cannot claim to be someone else by editing its join message.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_KEY

// Verifying a user token needs only the anon key; writing results bypasses RLS
// and needs the service key. They are configured independently on purpose.
const auth = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null
const admin =
  url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null

export const authEnabled = Boolean(auth)
export const statsEnabled = Boolean(admin)

/**
 * Resolve an access token to { userId, username }, or null for a guest.
 * Never throws: a bad token, an outage, or no configuration all mean "guest".
 */
export async function identify(token) {
  if (!auth || typeof token !== 'string' || token.length === 0) return null
  try {
    const { data, error } = await auth.auth.getUser(token)
    if (error || !data.user) return null

    const { data: profile } = await auth
      .from('profiles')
      .select('username')
      .eq('id', data.user.id)
      .maybeSingle()

    return {
      userId: data.user.id,
      username: profile?.username ?? data.user.email?.split('@')[0] ?? 'player',
    }
  } catch (err) {
    console.warn('token check failed, treating as guest:', err.message)
    return null
  }
}

/**
 * Rows for one finished match. Pure so it can be tested without a database.
 * Guests have no userId and are simply absent from the result.
 */
export function matchRows(matchId, score, players) {
  const [blue, orange] = score
  const drawn = blue === orange
  const winner = drawn ? null : blue > orange ? 0 : 1

  return players
    .filter((p) => p.userId)
    .map((p) => ({
      match_id: matchId,
      user_id: p.userId,
      team: p.team,
      goals: p.goals ?? 0,
      won: !drawn && p.team === winner,
      drawn,
    }))
}

/** Fire and forget: a stats outage must never disturb a match in progress. */
export async function recordMatch(matchId, score, players) {
  if (!admin) return
  const rows = matchRows(matchId, score, players)
  if (rows.length === 0) return

  const { error } = await admin.from('match_players').insert(rows)
  if (error) console.warn('could not record match:', error.message)
}
