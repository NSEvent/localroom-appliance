// The pure half of the one virtual clock (DEMO_SCRIPT.md: "There is exactly
// ONE virtual clock"). Every function here is a total function of its
// arguments — no wall-clock reads, no DOM, no React, no module state. That is
// what makes it testable under `node --test` (test/console-clock.test.js) and
// what keeps the wall-clock ban in scripts/console-clock-check.js down to a
// single exempt file: src/clock.ts, which owns all the impurity.
//
// Two axes, one source:
//   meetingMs — ms since the meeting began; what "LIVE 37:52" renders from.
//   nowMs     — the current instant on the clock's own epoch axis; what every
//               "N ago" delta subtracts from. Live mode anchors it to wall
//               time, demo mode to a fixed synthetic epoch, so `ago()` is
//               mode-agnostic and pause freezes it in both.

/** Fixed synthetic epoch for demo mode: 2026-07-26T16:00:00Z. Arbitrary but
 * constant, so a scripted run stamps identical values on every replay. */
export const DEMO_EPOCH_BASE = 1785081600000

/** Beat/event shapes are structural on purpose: beats.ts owns the real types,
 * and this module stays import-free so node can strip and load it alone. */
export interface ScheduledLike {
  id: string
  atMeetingMs: number
}

// ---------------------------------------------------------------- time math

/** Live mode: meeting time is wall time since the session started. Before the
 * session has a started_at, the meeting has not begun — clamp to zero. */
export function liveMeetingMs(startedAtMs: number | null, wallNowMs: number): number {
  if (startedAtMs === null || Number.isNaN(startedAtMs)) return 0
  return Math.max(0, wallNowMs - startedAtMs)
}

/** Demo mode: meeting time advances by real frame deltas × TIME_SCALE, and
 * ONLY while playing. Pause is therefore not a separate code path — it is the
 * absence of advancement, which is why it freezes every derived counter at
 * once instead of each one deciding for itself. */
export function advanceDemoMs(
  meetingMs: number,
  frameDeltaMs: number,
  timeScale: number,
  playing: boolean,
): number {
  if (!playing) return meetingMs
  if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0) return meetingMs
  return meetingMs + frameDeltaMs * timeScale
}

/** The instant every "N ago" delta measures against. */
export function nowMsFor(
  mode: 'live' | 'demo',
  meetingMs: number,
  startedAtMs: number | null,
  wallNowMs: number,
): number {
  if (mode === 'live') return wallNowMs
  void startedAtMs
  return DEMO_EPOCH_BASE + meetingMs
}

/** The 1 Hz gate. Counters render seconds, so a frame that does not change
 * this integer cannot change any visible glyph and must not notify. */
export function displaySecond(ms: number): number {
  return Math.floor(ms / 1000)
}

// ------------------------------------------------------------ display forms

/** mm:ss from a count of seconds. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** mm:ss of the gap between two instants on the clock's axis. Both arguments
 * must come from the same clock — mixing a wall stamp into demo time is the
 * desync this module exists to prevent. */
export function agoLabel(fromMs: number, nowMs: number): string {
  return mmss(Math.floor((nowMs - fromMs) / 1000))
}

/** ISO-8601 (or epoch ms) to epoch ms, or null. Date.parse is a pure string
 * conversion, not a clock read — it is deliberately not on the ban list. */
export function parseStampMs(stamp: number | string | null | undefined): number | null {
  if (stamp === null || stamp === undefined) return null
  const ms = typeof stamp === 'string' ? Date.parse(stamp) : stamp
  return Number.isNaN(ms) ? null : ms
}

// ------------------------------------------------------------------- beats

/** Beats sorted by meeting time, ties broken by id so a jump is deterministic
 * regardless of how the table was authored. */
export function sortSchedule<T extends ScheduledLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.atMeetingMs - b.atMeetingMs || a.id.localeCompare(b.id))
}

/** Index of the beat currently in effect: the last one whose boundary has
 * passed. -1 before the first beat. */
export function beatIndexAt<T extends ScheduledLike>(
  beats: readonly T[],
  meetingMs: number,
): number {
  let idx = -1
  for (let i = 0; i < beats.length; i += 1) {
    if (beats[i].atMeetingMs <= meetingMs) idx = i
    else break
  }
  return idx
}

/** The beat ←/→ should land on, or null at either end.
 *
 * Boundaries are STRICT: → is the first boundary after the playhead, ← the
 * last one before it. Strictness makes ← and → exact inverses, which is what
 * lets the scrub-stress test assert that scrubbing back and forth returns the
 * schedule to a byte-identical applied set. "Snap to the current beat's start
 * first" would be friendlier for re-running a beat but would make repeated
 * presses non-uniform, and non-uniform is what desyncs a live demo. */
export function beatTarget<T extends ScheduledLike>(
  beats: readonly T[],
  meetingMs: number,
  direction: 1 | -1,
): T | null {
  if (direction === 1) {
    for (const beat of beats) if (beat.atMeetingMs > meetingMs) return beat
    return null
  }
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (beats[i].atMeetingMs < meetingMs) return beats[i]
  }
  return null
}

// ------------------------------------------------------------ scrub replay

export interface ReplayPlan<T extends ScheduledLike> {
  /** True when the consumer must tear its derived state back to zero before
   * applying. Set on any backward jump — replaying from empty is the only
   * strategy that cannot double-count, because it never has to reason about
   * which effects a rewind should undo. */
  reset: boolean
  apply: T[]
}

/** What to hand the consumer when the playhead moves from → to.
 *
 * Forward: only the events newly crossed.
 * Backward: reset, then every event up to the new position.
 *
 * Either way the applier de-dupes by id, so an interrupted or repeated scrub
 * converges on the same state as a clean one. */
export function resolveReplay<T extends ScheduledLike>(
  schedule: readonly T[],
  fromMeetingMs: number,
  toMeetingMs: number,
): ReplayPlan<T> {
  if (toMeetingMs < fromMeetingMs) return resolveInitial(schedule, toMeetingMs)
  return {
    reset: false,
    apply: sortSchedule(schedule).filter(
      (e) => e.atMeetingMs > fromMeetingMs && e.atMeetingMs <= toMeetingMs,
    ),
  }
}

/** The plan for landing cold at a position: reset, then everything up to and
 * INCLUDING it. Forward playback uses a half-open interval so no event fires
 * twice, which means an event sitting exactly on the demo's start mark would
 * never fire at all if entering demo mode did not go through this. */
export function resolveInitial<T extends ScheduledLike>(
  schedule: readonly T[],
  atMeetingMs: number,
): ReplayPlan<T> {
  return {
    reset: true,
    apply: sortSchedule(schedule).filter((e) => e.atMeetingMs <= atMeetingMs),
  }
}

/** Fold a plan into the applied-id ledger and return only what is genuinely
 * new. `applied` is mutated. The return value is what the consumer should act
 * on — an event already in the ledger produces no second ledger line, alert,
 * or transcript row no matter how many times it is scrubbed across. */
export function applyPlan<T extends ScheduledLike>(applied: Set<string>, plan: ReplayPlan<T>): T[] {
  if (plan.reset) applied.clear()
  const fresh: T[] = []
  for (const event of plan.apply) {
    if (applied.has(event.id)) continue
    applied.add(event.id)
    fresh.push(event)
  }
  return fresh
}
