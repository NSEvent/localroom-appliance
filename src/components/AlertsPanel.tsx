// Alerts (right column) — the money-shot real estate. Active cards with
// severity icon + color + text (never color alone), suggested_prompt in
// quotes, source tag, confirm-to-dismiss. Resolved alerts collapse into a
// muted "resolved (n)" stack with a one-time green sweep; they never just
// vanish. Click scrolls to the related record card.

import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { emit } from '../bus'
import { useStore } from '../store'
import type { Alert, AlertSeverity } from '../types'
import { Empty, Panel, Skeletons } from './common'

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  high: '⚠️',
  warn: '⚠',
  info: 'ℹ',
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, warn: 1, info: 2 }

function alertNum(id: string): number {
  const n = Number(id.split('_')[1])
  return Number.isNaN(n) ? 0 : n
}

function AlertCard({ alert, sessionId }: { alert: Alert; sessionId: string }) {
  const [confirming, setConfirming] = useState(false)
  // Agent-sourced alerts get brand magenta; severity keeps red/amber/blue, so
  // provenance and urgency read as two independent axes (tokens.css: alert red
  // is never brand magenta). Judge-legible from across the table.
  const isAgent = alert.source === 'hermes'

  const dismiss = () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    // Dismissals are final (D8) — this was the confirming second tap.
    api.dismissAlert(sessionId, alert.id).catch((e) => console.error('dismiss failed', e))
  }

  const jump = () => alert.related_id && emit('jump-entity', alert.related_id)

  return (
    <div className={`alert-card ${alert.severity}${isAgent ? ' agent' : ''}`}>
      <div className="alert-head">
        <span aria-hidden>{SEVERITY_ICON[alert.severity]}</span>
        <span>
          {alert.severity.toUpperCase()} · {alert.type.replace(/_/g, ' ').toUpperCase()}
        </span>
        {isAgent && (
          <span className="agent-badge" title="Raised by the Hermes agent, not a deterministic rule">
            <span aria-hidden>◆</span> HERMES
          </span>
        )}
      </div>
      <div className="alert-text" onClick={jump} title={alert.related_id ? `Jump to ${alert.related_id}` : undefined}>
        {alert.text}
      </div>
      {alert.suggested_prompt && <div className="alert-prompt">“{alert.suggested_prompt}”</div>}
      <div className="alert-foot">
        <span className={`alert-src${isAgent ? ' agent' : ''}`}>{alert.source}</span>
        {alert.related_id && (
          <button type="button" className="chip brand" onClick={jump}>
            Jump to card →
          </button>
        )}
        <button
          type="button"
          className={`alert-dismiss ${confirming ? 'confirm' : ''}`}
          onClick={dismiss}
        >
          {confirming ? 'Dismiss forever?' : 'Dismiss ✕'}
        </button>
      </div>
    </div>
  )
}

export function AlertsPanel() {
  const { session, sessionId, loading, lastStateAt } = useStore()
  const alerts = session?.alerts ?? []

  const active = alerts
    .filter((a) => a.status === 'active')
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || alertNum(b.id) - alertNum(a.id))
  const resolved = alerts.filter((a) => a.status === 'resolved')

  const [expanded, setExpanded] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const prevResolved = useRef<number | null>(null)
  const hasData = session != null

  // fire→resolve IS the demo: run the green sweep once when the count grows
  // (but not on the initial state load).
  useEffect(() => {
    if (!hasData) return
    const prev = prevResolved.current
    prevResolved.current = resolved.length
    if (prev !== null && resolved.length > prev) {
      setSweeping(true)
      const t = setTimeout(() => setSweeping(false), 1300)
      return () => clearTimeout(t)
    }
  }, [resolved.length, hasData])

  return (
    <Panel title="Alerts" count={active.length || undefined} stamp={lastStateAt}>
      {loading && <Skeletons n={2} />}
      {!loading && active.length === 0 && resolved.length === 0 && (
        <Empty>No alerts — nothing needs the room's attention.</Empty>
      )}
      {active.map((a) => (
        <AlertCard key={a.id} alert={a} sessionId={sessionId} />
      ))}
      {resolved.length > 0 && (
        <>
          <button
            type="button"
            className={`resolved-stack ${sweeping ? 'sweep' : ''}`}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="check">✓</span>
            resolved ({resolved.length})
            <span style={{ marginLeft: 'auto' }}>{expanded ? '▴' : '▾'}</span>
          </button>
          {expanded && (
            <div className="resolved-list">
              {resolved.map((a) => (
                <div
                  key={a.id}
                  className="resolved-item"
                  onClick={() => a.related_id && emit('jump-entity', a.related_id)}
                >
                  <span className="check">✓</span>
                  {a.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export function NudgeBanner() {
  const { session, sessionId } = useStore()
  const nudge = session?.facilitator_nudge
  if (!nudge || nudge.status !== 'active') return null
  return (
    <div className="nudge" title={nudge.reason}>
      <div className="nudge-head">
        <span>💬 FACILITATOR NUDGE</span>
        <button
          type="button"
          className="x"
          aria-label="Dismiss nudge"
          onClick={() => api.dismissNudge(sessionId).catch((e) => console.error(e))}
        >
          ✕
        </button>
      </div>
      <div className="nudge-text">{nudge.text}</div>
    </div>
  )
}
