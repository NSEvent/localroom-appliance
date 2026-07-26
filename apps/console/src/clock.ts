// THE one virtual clock (DEMO_SCRIPT.md). This is the only file in the console
// permitted to read the wall clock or run a timer — scripts/console-clock-check.js
// fails the build if `Date.now`, `new Date(`, or `setInterval` appears anywhere
// else under apps/console/src. Everything visible that counts — LIVE mm:ss,
// "updated N ago", inference age, UNANSWERED — subscribes here.
//
// Why the ban matters: a single stray Date.now() in one panel makes that panel
// keep counting while the rest of the screen is frozen, and a judge watching a
// paused console sees one number crawl. Pause has to be a property of the clock,
// not a flag each component remembers to honour.
//
// Two modes behind one interface:
//   live — meetingMs is wall time since session.started_at; real WS events.
//   demo — meetingMs advances by rAF deltas × TIME_SCALE, only while playing;
//          scripted beats, Space pause, ←/→ boundary jumps, scrub-safe replay.
//
// Render budget: one rAF loop for the whole app, evaluated at most every 100 ms,
// and subscribers are notified only when a displayed SECOND changes — so a
// counter re-renders at most once per second regardless of frame rate.

import { useEffect, useSyncExternalStore } from 'react'
import {
  BEATS,
  DEMO_EVENTS,
  DEMO_START_MEETING_MS,
  DEMO_TIME_SCALE,
  type Beat,
} from './beats.ts'
import {
  advanceDemoMs,
  applyPlan,
  beatIndexAt,
  beatTarget,
  displaySecond,
  liveMeetingMs,
  nowMsFor,
  parseStampMs,
  resolveInitial,
  resolveReplay,
  sortSchedule,
  type ScheduledLike,
} from './clock-core.ts'

export type ClockMode = 'live' | 'demo'

/** At most 10 evaluations per second no matter the display refresh rate. The
 * per-frame work below this threshold is one subtraction and one compare. */
const EVAL_INTERVAL_MS = 100

/** A backgrounded tab stops firing rAF; without this clamp the first frame
 * after it returns would teleport demo time by however long it was hidden. */
const MAX_FRAME_DELTA_MS = 250

// ------------------------------------------------------------------- state

let mode: ClockMode = 'live'
let playing = true
let startedAtMs: number | null = null
let demoMeetingMs = DEMO_START_MEETING_MS

const schedule = sortSchedule(DEMO_EVENTS)
const beats = sortSchedule(BEATS)

/** Replay ledger — which scheduled events the consumer has already applied. */
const appliedIds = new Set<string>()
let lastAppliedMeetingMs = DEMO_START_MEETING_MS
let applier: ((fresh: ScheduledLike[], reset: boolean) => void) | null = null

/** Cached, second-granular snapshots. useSyncExternalStore requires a snapshot
 * that is stable between notifications, and stability is exactly what gives us
 * the 1 Hz render budget: React bails out when Object.is says nothing moved. */
let tickNowMs = 0
let tickMeetingMs = 0

interface ControlSnapshot {
  mode: ClockMode
  playing: boolean
  beatIndex: number
  beat: Beat | null
  beatCount: number
}
let controlSnapshot: ControlSnapshot = {
  mode: 'live',
  playing: true,
  beatIndex: -1,
  beat: null,
  beatCount: beats.length,
}

const tickListeners = new Set<() => void>()
const controlListeners = new Set<() => void>()

// ---------------------------------------------------------- the rAF driver

let rafId = 0
let lastFrameTs = 0
let lastEvalTs = 0

function frame(ts: number): void {
  if (lastFrameTs !== 0) {
    const delta = Math.min(ts - lastFrameTs, MAX_FRAME_DELTA_MS)
    demoMeetingMs = advanceDemoMs(
      demoMeetingMs,
      delta,
      DEMO_TIME_SCALE,
      playing && mode === 'demo',
    )
  }
  lastFrameTs = ts
  if (ts - lastEvalTs >= EVAL_INTERVAL_MS) {
    lastEvalTs = ts
    evaluate()
  }
  rafId = requestAnimationFrame(frame)
}

function ensureRunning(): void {
  if (rafId !== 0) return
  lastFrameTs = 0
  lastEvalTs = 0
  evaluate()
  rafId = requestAnimationFrame(frame)
}

function stopIfIdle(): void {
  if (tickListeners.size > 0 || controlListeners.size > 0) return
  if (rafId === 0) return
  cancelAnimationFrame(rafId)
  rafId = 0
}

/** Recompute, run anything the playhead just crossed, and notify only if a
 * displayed second actually moved. */
function evaluate(): void {
  const wall = Date.now()
  const meeting = mode === 'live' ? liveMeetingMs(startedAtMs, wall) : demoMeetingMs
  const now = nowMsFor(mode, meeting, startedAtMs, wall)

  runDueEvents(meeting)

  const meetingSecond = displaySecond(meeting)
  const nowSecond = displaySecond(now)
  if (meetingSecond === displaySecond(tickMeetingMs) && nowSecond === displaySecond(tickNowMs)) {
    return
  }
  // Snap the published value to its second so every subscriber that reads it
  // this tick derives from the identical instant.
  tickMeetingMs = meetingSecond * 1000
  tickNowMs = nowSecond * 1000
  for (const listener of tickListeners) listener()
}

function runDueEvents(meeting: number): void {
  if (mode !== 'demo') return
  if (meeting === lastAppliedMeetingMs) return
  const plan = resolveReplay(schedule, lastAppliedMeetingMs, meeting)
  lastAppliedMeetingMs = meeting
  if (!plan.reset && plan.apply.length === 0) return
  const fresh = applyPlan(appliedIds, plan)
  if (plan.reset || fresh.length > 0) applier?.(fresh, plan.reset)
}

function publishControl(): void {
  const beatIndex = beatIndexAt(beats, mode === 'demo' ? demoMeetingMs : meetingMs())
  controlSnapshot = {
    mode,
    playing,
    beatIndex,
    beat: beatIndex >= 0 ? beats[beatIndex] : null,
    beatCount: beats.length,
  }
  for (const listener of controlListeners) listener()
}

// -------------------------------------------------------------- public API

/** Exact current instant on the clock's axis. Use for STAMPING an event (the
 * store records when state arrived); use the hooks for DISPLAYING a counter. */
export function nowMs(): number {
  const wall = Date.now()
  const meeting = mode === 'live' ? liveMeetingMs(startedAtMs, wall) : demoMeetingMs
  return nowMsFor(mode, meeting, startedAtMs, wall)
}

/** Exact ms since the meeting began. */
export function meetingMs(): number {
  if (mode === 'demo') return demoMeetingMs
  return liveMeetingMs(startedAtMs, Date.now())
}

export function getMode(): ClockMode {
  return mode
}

export function isDemo(): boolean {
  return mode === 'demo'
}

/** Anchor live mode to the session's start. Safe to call on every state
 * update — an unchanged anchor is a no-op, so it never jolts the counters. */
export function configureLive(startedAt: string | number | null): void {
  const parsed = parseStampMs(startedAt)
  if (mode === 'demo') return
  if (parsed === startedAtMs) return
  startedAtMs = parsed
  evaluate()
  publishControl()
}

/** Opt in to demo mode. Deliberately explicit and one-way for a session: live
 * mode must never be able to wander into scripted scaffolding by accident. */
export function enterDemoMode(): void {
  if (mode === 'demo') return
  mode = 'demo'
  playing = true
  demoMeetingMs = DEMO_START_MEETING_MS
  lastAppliedMeetingMs = DEMO_START_MEETING_MS
  appliedIds.clear()
  // Land cold on the start mark via the inclusive plan, so anything the script
  // places exactly at 37:52 is present in the opening frame.
  const plan = resolveInitial(schedule, DEMO_START_MEETING_MS)
  applier?.(applyPlan(appliedIds, plan), true)
  evaluate()
  publishControl()
}

/** Register the sink that turns scheduled events into console state. Called
 * once by the demo driver; a no-op in live mode. */
export function setReplayApplier(
  fn: ((fresh: ScheduledLike[], reset: boolean) => void) | null,
): void {
  applier = fn
}

export function setPlaying(next: boolean): void {
  if (playing === next) return
  playing = next
  // Re-anchor so the paused-for-90-seconds gap is not credited to demo time.
  lastFrameTs = 0
  evaluate()
  publishControl()
}

export function togglePlay(): void {
  setPlaying(!playing)
}

export function isPlaying(): boolean {
  return playing
}

/** Move the playhead. Backward jumps hand the applier a reset so it rebuilds
 * derived state from zero rather than trying to undo effects. */
export function seekMeetingMs(target: number): void {
  if (mode !== 'demo') return
  const clamped = Math.max(0, target)
  if (clamped === demoMeetingMs) return
  const plan = resolveReplay(schedule, lastAppliedMeetingMs, clamped)
  demoMeetingMs = clamped
  lastAppliedMeetingMs = clamped
  const fresh = applyPlan(appliedIds, plan)
  if (plan.reset || fresh.length > 0) applier?.(fresh, plan.reset)
  lastFrameTs = 0
  evaluate()
  publishControl()
}

/** ←/→. Boundaries are strict (see beatTarget) so the two keys are exact
 * inverses and a nervous presenter can mash them without drifting. */
export function jumpBeat(direction: 1 | -1): Beat | null {
  if (mode !== 'demo') return null
  const target = beatTarget(beats, demoMeetingMs, direction)
  if (!target) return null
  seekMeetingMs(target.atMeetingMs)
  return target
}

/** A wall-clock timer that pause does NOT freeze — for network polling only,
 * never for a displayed counter. It lives here so the ban on setInterval stays
 * absolute everywhere else, and so the exception is named rather than implied. */
export function everyWallMs(ms: number, callback: () => void): () => void {
  const id = setInterval(callback, ms)
  return () => clearInterval(id)
}

// ----------------------------------------------------------------- React

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener)
  ensureRunning()
  return () => {
    tickListeners.delete(listener)
    stopIfIdle()
  }
}

function subscribeControl(listener: () => void): () => void {
  controlListeners.add(listener)
  ensureRunning()
  return () => {
    controlListeners.delete(listener)
    stopIfIdle()
  }
}

/** Current instant, second-granular. Re-renders at most once per second, and
 * never while paused. */
export function useNowMs(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => tickNowMs,
    () => tickNowMs,
  )
}

/** ms since the meeting began, second-granular — the LIVE mm:ss source. */
export function useMeetingMs(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => tickMeetingMs,
    () => tickMeetingMs,
  )
}

/** Mode / play state / current beat. Updates immediately on a key press
 * instead of waiting for the next second boundary. */
export function useClockControl(): ControlSnapshot {
  return useSyncExternalStore(
    subscribeControl,
    () => controlSnapshot,
    () => controlSnapshot,
  )
}

/** Presenter keyboard: Space toggles pause, ←/→ jump beat boundaries.
 * Ignored while the operator is typing — Space belongs to the Q&A box. */
export function usePresenterKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        jumpBeat(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        jumpBeat(-1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
