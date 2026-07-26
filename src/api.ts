// Thin typed client for meety-api (state-contract §11). Every endpoint the
// frontend touches lives in this one file so a backend mismatch is a
// one-file fix. Same-origin in production (meety-api serves dist/); the Vite
// dev server proxies /api → 127.0.0.1:8000.

import type {
  AudioDevices,
  AudioLevel,
  Health,
  SessionState,
  Utterance,
} from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

// ---- sessions ----

export interface CreateSessionBody {
  title: string
  goal: string
  participants: { name: string; role: string | null }[]
  context_dir: string | null
}

/** POST /api/sessions → session id, tolerant of several response shapes. */
export async function createSession(body: CreateSessionBody): Promise<string> {
  const data = await request<Record<string, unknown>>('/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const id =
    (typeof data?.id === 'string' && data.id) ||
    (typeof data?.session_id === 'string' && data.session_id) ||
    (typeof (data?.session as Record<string, unknown> | undefined)?.id === 'string' &&
      (data.session as Record<string, unknown>).id)
  if (!id || typeof id !== 'string') {
    throw new Error(`createSession: no session id in response ${JSON.stringify(data).slice(0, 200)}`)
  }
  return id
}

export function getState(sessionId: string): Promise<SessionState> {
  return request<SessionState>(`/sessions/${sessionId}/state`)
}

// ---- host actions ----

export function patchEntity(
  sessionId: string,
  entityId: string,
  fields: Record<string, string | null>,
): Promise<unknown> {
  return request(`/sessions/${sessionId}/entities/${entityId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function dismissAlert(sessionId: string, alertId: string): Promise<unknown> {
  return request(`/sessions/${sessionId}/alerts/${alertId}/dismiss`, { method: 'POST' })
}

export function dismissNudge(sessionId: string): Promise<unknown> {
  return request(`/sessions/${sessionId}/nudge/dismiss`, { method: 'POST' })
}

export function postQa(
  sessionId: string,
  question: string,
  askedBy: string,
): Promise<unknown> {
  return request(`/sessions/${sessionId}/qa`, {
    method: 'POST',
    body: JSON.stringify({ question, asked_by: askedBy }),
  })
}

export function closingSweep(sessionId: string): Promise<unknown> {
  return request(`/sessions/${sessionId}/closing-sweep`, { method: 'POST' })
}

/** End the meeting (meety_api: POST .../end). */
export function endSession(sessionId: string): Promise<unknown> {
  return request(`/sessions/${sessionId}/end`, { method: 'POST' })
}

/** Host-edited follow-up email: PATCH the pseudo-entity `follow_up_email`
 * (sets host_edited, permanently stops re-rendering). */
export function patchEmail(
  sessionId: string,
  fields: { subject?: string; body?: string },
): Promise<unknown> {
  return patchEntity(sessionId, 'follow_up_email', fields)
}

// ---- playback driver (presenter controls) ----

/** POST fixture utterances (batch body per meety_api's UtterancesBody) to the
 * scripted-playback ingestion endpoint. */
export function postUtterances(
  sessionId: string,
  utts: Pick<Utterance, 'id' | 'speaker' | 'text' | 'ts_start' | 'ts_end'>[],
): Promise<unknown> {
  return request(`/sessions/${sessionId}/utterances`, {
    method: 'POST',
    body: JSON.stringify({ utterances: utts }),
  })
}

// ---- audio (mic path, D22) ----

/** POST one complete standalone audio blob to /audio (multipart). The
 * transcribed utterance also arrives via the WS `utterance.created` path. */
export async function postAudioChunk(
  sessionId: string,
  blob: Blob,
  meta: { chunkIndex: number; startedAtMs: number; durationMs: number },
): Promise<{ utterance: Utterance | null }> {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', blob, `chunk-${meta.chunkIndex}.${ext}`)
  form.append('chunk_index', String(meta.chunkIndex))
  form.append('started_at_ms', String(meta.startedAtMs))
  form.append('duration_ms', String(meta.durationMs))
  const res = await fetch(`${BASE}/sessions/${sessionId}/audio`, {
    method: 'POST',
    body: form, // browser sets the multipart boundary
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`POST /audio → ${res.status} ${body.slice(0, 300)}`)
  }
  return (await res.json()) as { utterance: Utterance | null }
}

// ---- export / events / health ----

export function exportUrl(sessionId: string): string {
  return `${BASE}/sessions/${sessionId}/export.md`
}

export function wsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}${BASE}/sessions/${sessionId}/events`
}

/** GET the aggregated health endpoint (meety_api shape: status/mode +
 * asr{provider,ready} + operator{model,ready,degraded,last_tok_s} +
 * gpu{available,name}), normalized to a tolerant Health. */
export async function getHealth(): Promise<Health> {
  const raw = await request<Record<string, unknown>>('/health')
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

  const asr = obj(raw.asr)
  const op = { ...obj(raw.llm), ...obj(raw.operator) }
  const gpu = obj(raw.gpu)
  const cap = obj(raw.capture)
  const status = str(raw.status) ?? ''
  const degraded =
    raw.degraded === true ||
    op.degraded === true ||
    status === 'degraded' ||
    str(op.status) === 'degraded'
  return {
    ok: !degraded && status !== 'down' && status !== 'error',
    degraded,
    mode: str(raw.mode) ?? '',
    asr: {
      status: str(asr.status) ?? (asr.ready === false ? 'down' : asr.ready === true ? 'ok' : undefined),
      provider: str(asr.provider),
      model: str(asr.model),
    },
    llm: {
      status: str(op.status),
      model: str(op.model) ?? str(raw.model),
      tok_per_s: num(op.last_tok_s) ?? num(op.tok_per_s),
    },
    gpu: str(raw.gpu) ?? str(gpu.name) ?? '',
    capture: {
      clientIsAppliance: cap.client_is_appliance === true,
      browserCaptureDefault: str(cap.browser_capture_default) ?? 'on',
      applianceDevice: str(cap.appliance_device) ?? null,
    },
    raw,
  }
}

// ---- appliance audio (device picker + level meter) ----

/** Capture devices on the APPLIANCE, not the browser host. */
export async function getAudioDevices(): Promise<AudioDevices> {
  return request<AudioDevices>('/audio/devices')
}

/** One short appliance capture -> peak/RMS/dBFS for the level meter. */
export async function getAudioLevel(
  device?: string | null,
  seconds = 0.5,
): Promise<AudioLevel> {
  const q = new URLSearchParams()
  if (device) q.set('device', device)
  q.set('seconds', String(seconds))
  return request<AudioLevel>(`/audio/level?${q.toString()}`)
}
