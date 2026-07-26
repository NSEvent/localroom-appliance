// The demo beat table and its timing constants.
//
// STATUS: the beat *positions* below are a PLACEHOLDER. The authoritative
// table lives in design_handoff_meeting_console/DEMO_SCRIPT.md, which is not
// in this repo yet. Everything that consumes this file — clock.ts, the ←/→
// handler, the replay ledger — treats it as opaque data, so landing the real
// table is a data edit here and nothing else. The constants that DEMO_SCRIPT.md
// does pin down (start, resolution, TIME_SCALE) are already exact.
//
// Runtime-import-free on purpose (only `import type`, which erases): that lets
// node load this module directly in test/console-clock.test.js.

import type { ScheduledLike } from './clock-core.ts'

/** Demo runs at 2× so a 10-minute meeting window fits a 5-minute slot. */
export const DEMO_TIME_SCALE = 2

/** The meeting is already 37:52 old when the demo opens — the console is
 * joining a meeting in progress, not starting one. */
export const DEMO_START_MEETING_MS = (37 * 60 + 52) * 1000

/** The owner gap resolves at 47:52 — exactly 10:00 of meeting time later,
 * which is 5:00 of real time at TIME_SCALE 2. */
export const DEMO_RESOLUTION_MEETING_MS = (47 * 60 + 52) * 1000

/** Wall-clock length of a full scripted run. Derived, never hand-typed, so it
 * cannot drift out of agreement with the two constants above. */
export const DEMO_REAL_RUNTIME_MS =
  (DEMO_RESOLUTION_MEETING_MS - DEMO_START_MEETING_MS) / DEMO_TIME_SCALE

export interface Beat extends ScheduledLike {
  id: string
  label: string
  atMeetingMs: number
  /** One line for the presenter HUD — what this beat is for. */
  cue: string
}

/** PLACEHOLDER positions — evenly spaced across the designed window so ←/→ is
 * exercisable today. Replace wholesale from DEMO_SCRIPT.md's beat table. */
export const BEATS: Beat[] = [
  {
    id: 'beat-open',
    label: 'Open · meeting in progress',
    atMeetingMs: DEMO_START_MEETING_MS,
    cue: 'Console is already tracking a live meeting. Nothing to explain yet.',
  },
  {
    id: 'beat-decision',
    label: 'Decision lands',
    atMeetingMs: DEMO_START_MEETING_MS + 120_000,
    cue: 'The two-step cancellation decision is captured with its evidence quote.',
  },
  {
    id: 'beat-action',
    label: 'Action item · owner gap opens',
    atMeetingMs: DEMO_START_MEETING_MS + 240_000,
    cue: 'An action item is captured with nobody named on it.',
  },
  {
    id: 'beat-money-shot',
    label: 'MONEY SHOT · owner gap alert',
    atMeetingMs: DEMO_START_MEETING_MS + 360_000,
    cue: 'Hold here. High-severity owner alert. Assign Jordan and let the room watch it clear.',
  },
  {
    id: 'beat-policy',
    label: 'Policy question · parking lot',
    atMeetingMs: DEMO_START_MEETING_MS + 480_000,
    cue: 'Legal question stays open; the multi-page alternative goes to the parking lot.',
  },
  {
    id: 'beat-resolution',
    label: 'CLOSING SWEEP · resolution',
    atMeetingMs: DEMO_RESOLUTION_MEETING_MS,
    cue: 'Run Closing Sweep. The open Legal question must still be visible.',
  },
]

/** Events the scrub replays into console state (transcript rows, alerts,
 * ledger lines).
 *
 * DEFERRED: populating this is the other half of the DEMO_SCRIPT.md landing —
 * the beat *content*, versus the beat *positions* above. The replay machinery
 * that consumes it (resolveReplay / applyPlan in clock-core.ts) is built and
 * unit-tested against synthetic schedules; wiring real content in requires no
 * change outside this array and the applier registered in clock.ts. */
export const DEMO_EVENTS: ScheduledLike[] = []
