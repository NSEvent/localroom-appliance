// Meeting record (center column): Decisions / Actions / Questions card
// stacks. Derived amber OWNER?/WHEN? chips (owner/deadline == null — never
// stored statuses), evidence popovers (anti-hallucination proof), inline
// click-to-edit owner/deadline → PATCH → lock icon (D8), 300 ms flash keyed
// on updated_at.

import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { emit, on } from '../bus'
import { useStore } from '../store'
import { latestStamp } from '../time'
import type { ActionItem, Decision, OpenQuestion } from '../types'
import { Empty, Panel, Skeletons, useFlashOnChange } from './common'

// ---- evidence popover: hover shows the quote, click jumps the transcript ----

function Evidence({ quote, uttIds }: { quote: string; uttIds: string[] }) {
  const first = uttIds[0]
  if (!quote && !first) return null
  return (
    <span
      className="evidence"
      onClick={() => first && emit('jump-utterance', first)}
      role={first ? 'button' : undefined}
    >
      evidence{first ? ` → ${first}` : ''}
      <span className="evidence-pop">
        “{quote || '(no quote)'}”
        {first && <span className="pop-hint">click to jump the transcript to {first}</span>}
      </span>
    </span>
  )
}

// ---- inline click-to-edit (owner / deadline) ----

function EditableField({
  value,
  placeholder,
  locked,
  onSave,
}: {
  value: string | null
  placeholder: string
  locked: boolean
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    const commit = () => {
      setEditing(false)
      const v = draft.trim()
      if (v && v !== (value ?? '')) onSave(v)
    }
    return (
      <input
        className="inline-edit"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  if (locked && value) return <span>{value}</span>
  return (
    <button
      type="button"
      className="editable"
      onClick={() => {
        setDraft(value ?? '')
        setEditing(true)
      }}
    >
      {value ?? placeholder}
    </button>
  )
}

// ---- cards ----

function useEntityCardClasses(id: string, updatedAt: string | undefined, jumpId: string | null) {
  const flash = useFlashOnChange(updatedAt)
  return `card ${flash ? 'flash' : ''} ${jumpId === id ? 'jump-flash' : ''}`
}

function DecisionCard({ d, jumpId }: { d: Decision; jumpId: string | null }) {
  const cls = useEntityCardClasses(d.id, d.updated_at, jumpId)
  const chip =
    d.status === 'decided' ? (
      <span className="chip green">✓ DECIDED</span>
    ) : d.status === 'superseded' ? (
      <span className="chip gray">⤳ SUPERSEDED</span>
    ) : (
      <span className="chip teal">PROPOSED</span>
    )
  return (
    <div className={cls} data-entity={d.id}>
      <div className="card-head">
        <span className="card-title">{d.text}</span>
        {d.host_locked && <span className="lock" title="Host-locked — the operator can no longer touch this">🔒</span>}
        {chip}
      </div>
      <div className="card-meta">
        {d.confidence != null && (
          <>
            <span className="confidence">{Math.round(d.confidence * 100)}%</span>
            <span className="dotsep">·</span>
          </>
        )}
        <Evidence quote={d.evidence_quote} uttIds={d.evidence_utterance_ids} />
      </div>
    </div>
  )
}

function ActionCard({
  a,
  jumpId,
  sessionId,
}: {
  a: ActionItem
  jumpId: string | null
  sessionId: string
}) {
  const cls = useEntityCardClasses(a.id, a.updated_at, jumpId)
  const needsOwner = a.owner == null && a.status === 'open'
  const needsDeadline = a.deadline == null && a.status === 'open'
  const save = (field: 'owner' | 'deadline') => (v: string) => {
    api.patchEntity(sessionId, a.id, { [field]: v }).catch((e) => console.error('patch failed', e))
  }
  return (
    <div className={`${cls} ${needsOwner ? 'needs-attention' : ''}`} data-entity={a.id}>
      <div className="card-head">
        <span className="card-title">{a.task}</span>
        {a.host_locked && <span className="lock" title="Host-locked — the operator can no longer touch this">🔒</span>}
        {needsOwner && <span className="chip amber">⚠ OWNER?</span>}
        {needsDeadline && <span className="chip amber">⚠ WHEN?</span>}
        {a.status === 'done' ? (
          <span className="chip green">✓ DONE</span>
        ) : a.status === 'dropped' ? (
          <span className="chip gray">DROPPED</span>
        ) : (
          <span className="chip teal">OPEN</span>
        )}
      </div>
      <div className="card-meta">
        <span>
          owner:{' '}
          <EditableField
            value={a.owner}
            placeholder="click to assign"
            locked={a.host_locked}
            onSave={save('owner')}
          />
        </span>
        <span className="dotsep">·</span>
        <span>
          deadline:{' '}
          <EditableField
            value={a.deadline}
            placeholder="click to set"
            locked={a.host_locked}
            onSave={save('deadline')}
          />
        </span>
        <span className="dotsep">·</span>
        <Evidence quote={a.evidence_quote} uttIds={a.evidence_utterance_ids} />
      </div>
    </div>
  )
}

function QuestionCard({ q, jumpId }: { q: OpenQuestion; jumpId: string | null }) {
  const cls = useEntityCardClasses(q.id, undefined, jumpId)
  const chip =
    q.status === 'answered' ? (
      <span className="chip green">✓ ANSWERED</span>
    ) : q.status === 'parked' ? (
      <span className="chip gray">PARKED</span>
    ) : (
      <span className="chip teal">OPEN</span>
    )
  return (
    <div className={cls} data-entity={q.id}>
      <div className="card-head">
        <span className="card-title">{q.text}</span>
        {q.host_locked && <span className="lock">🔒</span>}
        {chip}
      </div>
      {q.answer && <div className="card-meta">answer: {q.answer}</div>}
    </div>
  )
}

// ---- the column ----

export function MeetingRecord() {
  const { session, sessionId, loading, lastStateAt } = useStore()
  const colRef = useRef<HTMLDivElement>(null)
  const [jumpId, setJumpId] = useState<string | null>(null)

  // Alert click → scroll to and flash the related card.
  useEffect(
    () =>
      on('jump-entity', (id) => {
        const el = colRef.current?.querySelector(`[data-entity="${id}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setJumpId(id)
        setTimeout(() => setJumpId((cur) => (cur === id ? null : cur)), 1600)
      }),
    [],
  )

  const decisions = session?.decisions ?? []
  const actions = session?.action_items ?? []
  const questions = session?.open_questions ?? []

  return (
    <div className="col" ref={colRef}>
      <Panel
        title="Decisions"
        count={decisions.length}
        stamp={latestStamp(decisions, lastStateAt)}
      >
        {loading && <Skeletons n={2} />}
        {!loading && decisions.length === 0 && (
          <Empty>No decisions yet — they appear when the group agrees on something.</Empty>
        )}
        {decisions.map((d) => (
          <DecisionCard key={d.id} d={d} jumpId={jumpId} />
        ))}
      </Panel>
      <Panel title="Actions" count={actions.length} stamp={latestStamp(actions, lastStateAt)}>
        {loading && <Skeletons n={2} />}
        {!loading && actions.length === 0 && (
          <Empty>No action items yet — commitments land here with owners and deadlines.</Empty>
        )}
        {actions.map((a) => (
          <ActionCard key={a.id} a={a} jumpId={jumpId} sessionId={sessionId} />
        ))}
      </Panel>
      <Panel title="Questions" count={questions.length} stamp={lastStateAt}>
        {loading && <Skeletons n={1} />}
        {!loading && questions.length === 0 && (
          <Empty>No open questions yet — unresolved threads are tracked here.</Empty>
        )}
        {questions.map((q) => (
          <QuestionCard key={q.id} q={q} jumpId={jumpId} />
        ))}
      </Panel>
    </div>
  )
}
