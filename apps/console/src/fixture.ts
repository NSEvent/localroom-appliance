import transcript from './data/transcript.json'

export interface FixtureUtterance {
  id: string
  speaker: string
  text: string
  ts_start: number
  ts_end: number
}

export const UTTERANCES: FixtureUtterance[] = transcript.utterances

export const DEMO_DEFAULTS = {
  title: 'Project Iliad Cancellation Review',
  goal: 'Leave with a decision, a named owner, and no sensitive data outside the room.',
  participants: [
    { name: 'Maya', role: 'Product' },
    { name: 'Jordan', role: 'Legal' },
  ],
  contextDir: 'data/corpus',
}

export interface Segment {
  n: number
  label: string
  end: number
}

export const SEGMENTS: Segment[] = [
  { n: 1, label: 'Decision + owner gap · moments 1–3', end: 3 },
  { n: 2, label: 'Policy question + parking lot · moments 4–5', end: 5 },
]

export function segmentFor(posted: number): Segment {
  return SEGMENTS.find((segment) => posted < segment.end) ?? SEGMENTS.at(-1)!
}

export interface Boundary {
  at: number
  kind: 'HOLD' | 'CHECKPOINT'
  name: string
  cue: string
}

export const BOUNDARIES: Boundary[] = [
  {
    at: 3,
    kind: 'HOLD',
    name: 'MONEY SHOT · owner gap',
    cue: 'Pause on the high-severity owner alert. Assign Jordan in the console and show the alert resolving across the room.',
  },
  {
    at: 5,
    kind: 'CHECKPOINT',
    name: 'CLOSING SWEEP',
    cue: 'Ask what is unresolved, run Closing Sweep, then export the local brief. The open Legal question must remain visible.',
  },
]

export function nextBoundary(posted: number): Boundary | null {
  return BOUNDARIES.find((boundary) => boundary.at > posted) ?? null
}

export const CHECKPOINT_SEEDS = [
  { label: 'Owner gap · after moment 3', count: 3 },
  { label: 'Full judge flow · all 5 moments', count: 5 },
] as const

export function cueFor(posted: number): { title: string; text: string } {
  const here = BOUNDARIES.find((boundary) => boundary.at === posted)
  if (here) return { title: `${here.name} — you are here`, text: here.cue }
  const next = nextBoundary(posted)
  if (!next) {
    return {
      title: 'Judge flow complete',
      text: 'Run Closing Sweep, resolve the last gap, and export the private meeting record.',
    }
  }
  const remaining = next.at - posted
  return {
    title: `Next stop: ${next.name} (${remaining} moment${remaining === 1 ? '' : 's'} away)`,
    text: next.cue,
  }
}
