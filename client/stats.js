// Reporting a finished match. Each player writes their own row, holding their
// own access token, rather than the host writing everyone's.
//
// This is not a preference, it is the best available shape: the host is another
// player's browser, so if it reported the whole table it could inflate its own
// record or wreck someone else's. Writing per-player means the worst anyone can
// do is lie about themselves. That is still a downgrade from the old server,
// which was the only writer and could be trusted; there is no way back to that
// guarantee without somewhere trusted to run code. The API route verifies the
// token and ignores any user id in the body, so the row can only ever be yours.

import { accessToken } from './auth.js'

/**
 * Write this player's row for a finished match. Never throws and never blocks
 * play: a stats outage should cost a leaderboard entry, nothing more.
 */
export async function reportMyMatch({ matchId, score, team, goals }) {
  const token = await accessToken()
  if (!token) return // guests have no career to record

  try {
    const res = await fetch('/api/record-match', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId, score, team, goals }),
    })
    if (!res.ok) console.warn('could not record match:', res.status, await res.text())
  } catch (err) {
    console.warn('could not record match:', err.message)
  }
}
