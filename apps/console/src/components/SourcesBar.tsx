// Participant strip: who is streaming, and what to call them.
//
// Renaming here is retroactive — the server rewrites `speaker` on every
// utterance already carrying that source_id. That is the point of the split
// between a durable source_id and a mutable label: someone can start talking
// before anyone has sorted out who they are, and the back-transcript corrects
// itself when they are named.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import type { AudioSource } from '../types'

const POLL_MS = 3000

function Chip({ src, sessionId, isMe, onRenamed }: {
  src: AudioSource
  sessionId: string
  isMe: boolean
  onRenamed: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(src.name)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const name = draft.trim()
    if (!name || name === src.name) {
      setEditing(false)
      setDraft(src.name)
      return
    }
    setSaving(true)
    try {
      const res = await api.renameSource(sessionId, src.id, name)
      // Say how much history moved — a silent rename looks like it only
      // applied going forward.
      setNote(res.relabelled ? `${res.relabelled} relabelled` : null)
      setTimeout(() => setNote(null), 2500)
      onRenamed()
      setEditing(false)
    } catch {
      setDraft(src.name)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // last_seen updates on every CHUNK, not on every finished sentence.
  // Stitching can hold text for up to 12s, so keying the dot off utterances
  // would leave a talking participant looking idle.
  const live = src.last_seen !== null &&
    Date.now() / 1000 - src.last_seen < 12

  return (
    <span className={`src-chip ${src.kind} ${live ? 'live' : ''}`}>
      <span className="src-dot" aria-hidden />
      {editing ? (
        <input
          ref={inputRef}
          className="src-input"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setDraft(src.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="src-name"
          onClick={() => {
            setDraft(src.name)
            setEditing(true)
          }}
          title="Rename — relabels everything they have already said"
        >
          {src.name}
          {isMe && <span className="src-me"> (you)</span>}
        </button>
      )}
      <span className="src-count">{src.utterances}</span>
      {src.buffering && <span className="src-buf" title="mid-sentence">…</span>}
      {note && <span className="src-note">{note}</span>}
    </span>
  )
}

export function SourcesBar() {
  const { sessionId, sourceId } = useStore()
  const [sources, setSources] = useState<AudioSource[]>([])

  const load = useCallback(async () => {
    try {
      const { sources: s } = await api.listSources(sessionId)
      setSources(s)
    } catch {
      /* transient — next poll retries */
    }
  }, [sessionId])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [load])

  if (sources.length === 0) return null

  return (
    <div className="src-bar">
      <span className="src-label">Speakers</span>
      {sources.map((s) => (
        <Chip
          key={s.id}
          src={s}
          sessionId={sessionId}
          isMe={s.id === sourceId}
          onRenamed={() => void load()}
        />
      ))}
    </div>
  )
}
