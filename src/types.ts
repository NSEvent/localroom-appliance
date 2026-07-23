// SessionState v1 — typed verbatim from docs/state-contract.md §2.
// Every top-level key is always present; timestamps are ISO-8601 UTC strings.

export type SessionStatus = 'created' | 'live' | 'closing' | 'ended'

export interface SessionMeta {
  id: string
  title: string
  goal: string
  status: SessionStatus
  started_at: string | null
  ended_at: string | null
  context_dir: string | null
}

export interface Participant {
  id: string
  name: string
  role: string | null
}

export type AgendaStatus = 'pending' | 'active' | 'done'

export interface AgendaItem {
  id: string
  order: number
  title: string
  status: AgendaStatus
}

export type UtteranceSource = 'mic' | 'script'

export interface Utterance {
  id: string
  speaker: string
  text: string
  ts_start: number
  ts_end: number
  is_final: boolean
  source: UtteranceSource
}

export type DecisionStatus = 'proposed' | 'decided' | 'superseded'

export interface Decision {
  id: string
  text: string
  status: DecisionStatus
  confidence: number | null
  evidence_quote: string
  evidence_utterance_ids: string[]
  host_locked: boolean
  created_at: string
  updated_at: string
}

export type ActionItemStatus = 'open' | 'done' | 'dropped'

export interface ActionItem {
  id: string
  task: string
  owner: string | null
  deadline: string | null // verbatim, e.g. "Friday"; no ISO normalization in P0
  status: ActionItemStatus // needs_owner / needs_deadline are DERIVED, never stored
  evidence_quote: string
  evidence_utterance_ids: string[]
  host_locked: boolean
  created_at: string
  updated_at: string
}

export type OpenQuestionStatus = 'open' | 'answered' | 'parked'

export interface OpenQuestion {
  id: string
  text: string
  status: OpenQuestionStatus
  answer: string | null
  host_locked: boolean
}

export interface ParkingLotItem {
  id: string
  text: string
  raised_by: string | null
  host_locked: boolean
}

export type AlertType =
  | 'unowned_action'
  | 'undated_action'
  | 'open_question_at_close'
  | 'unresolved_decision'
  | 'off_agenda'

export type AlertSeverity = 'info' | 'warn' | 'high'
export type AlertStatus = 'active' | 'resolved' | 'dismissed'

export interface Alert {
  id: string
  type: AlertType
  severity: AlertSeverity
  text: string
  suggested_prompt: string | null
  related_id: string | null
  source: 'rule' | 'operator'
  dedupe_key: string
  status: AlertStatus
}

export interface FacilitatorNudge {
  id: string
  text: string
  reason: string
  created_at: string
  status: 'active' | 'dismissed' | 'expired'
}

export type QaStatus = 'pending' | 'answered' | 'failed'

export interface QaEntry {
  id: string
  question: string
  asked_by: string | null
  answer: string | null
  source_utterance_ids: string[]
  source_files: string[]
  status: QaStatus
  created_at: string
}

export interface FollowUpEmail {
  subject: string
  body: string
  rendered_at: string
  host_edited: boolean
}

export interface SessionState {
  schema_version: 1
  state_version: number
  session: SessionMeta
  context_files: Record<string, string>
  participants: Participant[]
  agenda: AgendaItem[]
  utterances: Utterance[]
  decisions: Decision[]
  action_items: ActionItem[]
  open_questions: OpenQuestion[]
  parking_lot: ParkingLotItem[]
  alerts: Alert[]
  facilitator_nudge: FacilitatorNudge | null
  qa: QaEntry[]
  meeting_summary: string
  follow_up_email: FollowUpEmail
}

// ---- WS events (state-contract §8) ----

export type WsEvent =
  | { type: 'utterance.created'; utterance: Utterance }
  | { type: 'state.updated'; state: SessionState }
  | { type: 'qa.answered'; qa: QaEntry }
  | { type: 'session.ended' }
  // Q&A answers "additionally stream tokens into the panel while generating"
  // (D4); the event name is not pinned in the contract, so accept a tolerant
  // token-event shape alongside qa.answered.
  | { type: 'qa.token'; qa_id?: string; id?: string; token?: string; text?: string }

// ---- Aggregated health (state-contract §11: api + asr + llm, models, GPU, mode).
// Exact JSON shape is not pinned by the contract; this is a tolerant reading
// normalized in api.ts so a backend mismatch is a one-file fix. ----

export interface HealthComponent {
  status?: string
  provider?: string
  model?: string
  tok_per_s?: number
}

export interface Health {
  ok: boolean
  degraded: boolean
  mode: string // "mock" | "gpu"
  asr: HealthComponent
  llm: HealthComponent
  gpu: string
  raw: unknown
}
