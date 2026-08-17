// The only server-side code left. It exists because writing match_players
// bypasses RLS and so needs the service key, which must never reach a browser.
// This is request/response work, so a Vercel function is the right shape for it
// — unlike the simulation, which is why that lives in the host's browser.
//
// The caller's identity comes from their verified access token, never from the
// body. A player can misreport their own goals; they cannot write a row for
// anybody else.

import { createClient } from '@supabase/supabase-js'

// The second name in each pair is what the Supabase Vercel integration writes,
// so a linked project needs nothing set by hand. SUPABASE_SECRET_KEY is that
// integration's name for the service role key.
// NEXT_PUBLIC_SUPABASE_URL is not a leftover: the integration writes the URL
// under that name only, with no unprefixed SUPABASE_URL alongside the keys.
// A project URL is public anyway — it is in the browser bundle.
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY

const auth = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null
const admin =
  url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  // Unconfigured is not an error: the game is playable without stats, so say so
  // quietly rather than failing a match that has already finished. Which piece
  // is missing goes to the log rather than the response — the caller cannot act
  // on it and does not need to know how the deployment is configured.
  if (!auth || !admin) {
    console.warn('stats disabled, missing:', missingConfig().join(', '))
    return res.status(200).json({ recorded: false, reason: 'stats disabled' })
  }

  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '').trim()
  if (!token) return res.status(401).json({ error: 'sign in to record a match' })

  const { data, error } = await auth.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ error: 'not a valid session' })

  const row = buildRow(data.user.id, req.body)
  if (!row) return res.status(400).json({ error: 'malformed result' })

  const { error: writeError } = await admin.from('match_players').insert(row)
  if (writeError) {
    console.warn('could not record match:', writeError.message)
    return res.status(500).json({ error: 'could not record match' })
  }
  return res.status(200).json({ recorded: true })
}

/** Names only, never values: enough to fix the deployment, safe in a log. */
function missingConfig() {
  const missing = []
  if (!url) missing.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) missing.push('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY')
  if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY or SUPABASE_SECRET_KEY')
  return missing
}

/**
 * Turn a claimed result into a row, or null if it is not one. Exported so the
 * validation can be tested without a database or a request.
 */
export function buildRow(userId, body) {
  if (!body || typeof body !== 'object') return null

  const { matchId, score, team, goals } = body
  if (typeof matchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(matchId)) return null
  if (!Array.isArray(score) || score.length !== 2) return null
  if (!score.every((n) => Number.isInteger(n) && n >= 0 && n <= 999)) return null
  if (team !== 0 && team !== 1) return null
  if (!Number.isInteger(goals) || goals < 0 || goals > score[team]) return null

  const [blue, orange] = score
  const drawn = blue === orange
  const winner = drawn ? null : blue > orange ? 0 : 1

  return {
    match_id: matchId,
    user_id: userId,
    team,
    goals,
    won: !drawn && team === winner,
    drawn,
  }
}
