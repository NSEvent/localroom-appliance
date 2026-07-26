import { useEffect, useState } from 'react'

/** mm:ss from a ts_start in seconds. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function ago(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Re-render every second; returns current ms. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** "updated 0:12 ago" — the D15 anti-"is it frozen?" affordance, bottom-right
 * of every panel. `stamp` is ms since epoch, or an ISO string, or null. */
export function UpdatedAgo({ stamp }: { stamp: number | string | null }) {
  const now = useNow()
  if (stamp == null) return <div className="panel-foot" />
  const ms = typeof stamp === 'string' ? Date.parse(stamp) : stamp
  if (Number.isNaN(ms)) return <div className="panel-foot" />
  return <div className="panel-foot">updated {ago(ms, now)} ago</div>
}

/** Latest ISO updated_at/created_at across a list of entities, as ms. */
export function latestStamp(
  items: { updated_at?: string; created_at?: string }[],
  fallback: number | null,
): number | null {
  let max = -Infinity
  for (const it of items) {
    const iso = it.updated_at ?? it.created_at
    if (!iso) continue
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms) && ms > max) max = ms
  }
  return max === -Infinity ? fallback : max
}
