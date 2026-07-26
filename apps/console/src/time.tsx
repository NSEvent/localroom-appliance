// Display helpers over the one virtual clock. This file used to own a
// `useNow()` built on `setInterval(() => setNow(Date.now()), 1000)` — a second
// clock, per mounted panel, that no pause could reach. Everything time-shaped
// now derives from src/clock.ts; see the ban enforced by
// scripts/console-clock-check.js.

import { mmss, parseStampMs } from './clock-core.ts'
import { useNowMs } from './clock.ts'

export { mmss }
export { useMeetingMs, useNowMs } from './clock.ts'

/** "updated 0:12 ago" — the D15 anti-"is it frozen?" affordance, bottom-right
 * of every panel. `stamp` is ms on the clock's axis, or an ISO string, or null.
 *
 * Reads the clock rather than wall time, so a paused demo freezes this number
 * in the same frame as every other counter on screen. */
export function UpdatedAgo({ stamp }: { stamp: number | string | null }) {
  const now = useNowMs()
  const ms = parseStampMs(stamp)
  if (ms === null) return <div className="panel-foot" />
  return <div className="panel-foot">updated {mmss(Math.floor((now - ms) / 1000))} ago</div>
}

/** Latest ISO updated_at/created_at across a list of entities, as ms. */
export function latestStamp(
  items: { updated_at?: string; created_at?: string }[],
  fallback: number | null,
): number | null {
  let max = -Infinity
  for (const it of items) {
    const ms = parseStampMs(it.updated_at ?? it.created_at ?? null)
    if (ms !== null && ms > max) max = ms
  }
  return max === -Infinity ? fallback : max
}
