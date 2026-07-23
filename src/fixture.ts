// Bundled Brightline demo fixture: transcript.json plus the segment / HOLD /
// checkpoint structure from meetings/demo-vendor-contract/script.md. Drives
// the presenter-controls playback view and prefills the host-setup form.

import transcript from './data/transcript.json'

export interface FixtureUtterance {
  id: string
  speaker: string
  text: string
  ts_start: number
  ts_end: number
}

export const UTTERANCES: FixtureUtterance[] = transcript.utterances

// ---- host-setup defaults (script.md header) ----

export const DEMO_DEFAULTS = {
  title: 'Vendor Contract Review',
  goal:
    'Decide whether to approve the revised Brightline contract terms and assign owners for all remaining follow-up before end of week.',
  participants: [
    { name: 'Alex', role: 'Host / Operations' },
    { name: 'Dana', role: 'Legal' },
    { name: 'Priya', role: 'Finance' },
    { name: 'Morgan', role: 'Vendor Owner' },
  ],
  contextDir: 'meetings/demo-vendor-contract',
}

// ---- segments (script.md): 1 = utt_001–005, 2 = utt_006–016, 3 = utt_017–020 ----

export interface Segment {
  n: 1 | 2 | 3
  label: string
  /** count of utterances posted when the segment is complete */
  end: number
}

export const SEGMENTS: Segment[] = [
  { n: 1, label: 'Segment 1 · utt_001–005', end: 5 },
  { n: 2, label: 'Segment 2 · utt_006–016', end: 16 },
  { n: 3, label: 'Segment 3 · utt_017–020', end: 20 },
]

export function segmentFor(posted: number): Segment {
  return SEGMENTS.find((s) => posted < s.end) ?? SEGMENTS[SEGMENTS.length - 1]
}

// ---- pause boundaries: the driver stops at each HOLD / CHECKPOINT ----

export interface Boundary {
  /** utterance count at which playback pauses (utt_NNN with NNN === at is the last posted) */
  at: number
  kind: 'HOLD' | 'CHECKPOINT'
  name: string
  cue: string
}

export const BOUNDARIES: Boundary[] = [
  {
    at: 4,
    kind: 'HOLD',
    name: 'HOLD after utt_004',
    cue: 'TRIGGER: unowned + urgent. Narrate the transcript 15–20 s; do not point at the unowned_action alert sooner than 25 s. Then advance — Dana takes it and the alert resolves live.',
  },
  {
    at: 5,
    kind: 'CHECKPOINT',
    name: 'CHECKPOINT A',
    cue: 'Verify against expected-state.md Checkpoint A: unowned_action fired after utt_004 and cleared after utt_005. Then advance into Segment 2.',
  },
  {
    at: 8,
    kind: 'HOLD',
    name: 'HOLD after utt_008',
    cue: 'TRIGGER: vague deadline ("soon"). Narrate 15–20 s; wait ≥25 s before pointing at the WHEN? chip / undated_action alert. Then advance.',
  },
  {
    at: 15,
    kind: 'HOLD',
    name: 'HOLD after utt_015 — MONEY SHOT',
    cue: 'MONEY SHOT: urgent Brightline reply, no owner. The high-severity unowned_action alert is the demo. Narrate 15–20 s; do not point sooner than 25 s. Then advance (Alex punts — item stays unowned).',
  },
  {
    at: 16,
    kind: 'CHECKPOINT',
    name: 'CHECKPOINT B',
    cue: 'On-stage: type "What is still unresolved?" in the Q&A and narrate while tokens stream; then click Closing Sweep — expect unowned Brightline message (high), vague forecast deadline, open counsel question. Then advance into Segment 3.',
  },
  {
    at: 20,
    kind: 'CHECKPOINT',
    name: 'CHECKPOINT C — end',
    cue: 'All utterances posted. End the meeting → final review → Export Markdown. Compare against expected-state.md Checkpoint C.',
  },
]

/** Seed-to-checkpoint targets (crash recovery <10 s). */
export const CHECKPOINT_SEEDS = [
  { label: 'A · after utt_005', count: 5 },
  { label: 'B · after utt_016', count: 16 },
  { label: 'C · after utt_020', count: 20 },
] as const

export function nextBoundary(posted: number): Boundary | null {
  return BOUNDARIES.find((b) => b.at > posted) ?? null
}

/** The cue to show for the current position (the boundary we are sitting on,
 * or the next one coming up). */
export function cueFor(posted: number): { title: string; text: string } {
  const here = BOUNDARIES.find((b) => b.at === posted)
  if (here) return { title: `${here.name} — you are here`, text: here.cue }
  const next = nextBoundary(posted)
  if (!next) {
    return {
      title: 'Script complete',
      text: 'All 20 utterances posted. End the meeting and walk the final review.',
    }
  }
  const remaining = next.at - posted
  return {
    title: `Next stop: ${next.name} (${remaining} utterance${remaining === 1 ? '' : 's'} away)`,
    text: next.cue,
  }
}
