// End-meeting review (session.status === "ended") — CHECKPOINT C. Same
// console, reflowed: transcript collapses, meeting record and follow-up
// expand, alerts show the final resolved/unresolved split. Editing the email
// sets host_edited and permanently stops re-rendering.

import { useEffect, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import { mmss } from '../time'
import { Empty, Panel } from './common'
import { EmailBody } from './BottomStrip'

export function EndReview() {
  const { session, sessionId, lastStateAt } = useStore()
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)

  const email = session?.follow_up_email

  useEffect(() => {
    if (email && !editing) {
      setSubject(email.subject)
      setBody(email.body)
    }
  }, [email, editing])

  if (!session || !email) return null

  const decisions = session.decisions.filter((d) => d.status !== 'superseded')
  const actions = session.action_items.filter((a) => a.status !== 'dropped')
  const answered = session.open_questions.filter((q) => q.status === 'answered')
  const stillOpen = session.open_questions.filter((q) => q.status === 'open')
  const resolvedAlerts = session.alerts.filter((a) => a.status === 'resolved')
  const unresolvedAlerts = session.alerts.filter((a) => a.status === 'active')

  const saveEmail = () => {
    setEditing(false)
    api
      .patchEmail(sessionId, { subject, body })
      .catch((e) => console.error('email save failed', e))
  }

  const copyEmail = () => {
    navigator.clipboard
      .writeText(`Subject: ${subject}\n\n${body}`)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="end-main">
      <div className="col">
        <Panel
          title="Final record"
          stamp={lastStateAt}
          extra={
            <span className="count">
              {decisions.length} decisions · {actions.length} actions · {answered.length} answered ·{' '}
              {stillOpen.length} still open
            </span>
          }
        >
          {decisions.length === 0 && actions.length === 0 && (
            <Empty>Nothing was recorded this session.</Empty>
          )}
          {decisions.map((d) => (
            <div key={d.id} className="card">
              <div className="card-head">
                <span className={`chip ${d.status === 'decided' ? 'green' : 'teal'}`}>
                  {d.status === 'decided' ? '✓ DECIDED' : 'PROPOSED'}
                </span>
                <span className="card-title">{d.text}</span>
                {d.confidence != null && (
                  <span className="confidence">{Math.round(d.confidence * 100)}%</span>
                )}
              </div>
            </div>
          ))}
          {actions.map((a) => (
            <div key={a.id} className="card">
              <div className="card-head">
                <span className={`chip ${a.status === 'done' ? 'green' : 'teal'}`}>
                  {a.status === 'done' ? '✓ DONE' : 'OPEN'}
                </span>
                <span className="card-title">{a.task}</span>
                <span className="card-meta">
                  {a.owner ?? <span className="chip amber">⚠ OWNER?</span>}
                  {a.host_locked && <span className="lock"> 🔒</span>}
                  {a.deadline ? ` · ${a.deadline}` : ''}
                </span>
              </div>
            </div>
          ))}
          {stillOpen.map((q) => (
            <div key={q.id} className="card">
              <div className="card-head">
                <span className="chip amber">STILL OPEN</span>
                <span className="card-title">{q.text}</span>
              </div>
            </div>
          ))}
        </Panel>

        <div className="end-split">
          <section className="panel ok">
            <div className="panel-body">
              <h4>✓ Resolved in-meeting ({resolvedAlerts.length})</h4>
              {resolvedAlerts.length === 0 ? (
                <Empty>No alerts were resolved.</Empty>
              ) : (
                <ul>
                  {resolvedAlerts.map((a) => (
                    <li key={a.id}>{a.text}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="panel bad">
            <div className="panel-body">
              <h4>⚠ Unresolved at close ({unresolvedAlerts.length})</h4>
              {unresolvedAlerts.length === 0 ? (
                <Empty>Everything was resolved before close.</Empty>
              ) : (
                <ul>
                  {unresolvedAlerts.map((a) => (
                    <li key={a.id}>{a.text}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        <section className="panel transcript-collapsed">
          <div className="panel-body">
            <strong>Transcript</strong>
            <span className="count">{session.utterances.length} utterances · collapsed</span>
            <button
              type="button"
              className="email-toggle"
              onClick={() => setTranscriptOpen((v) => !v)}
            >
              {transcriptOpen ? 'Collapse ▴' : 'Expand ▾'}
            </button>
          </div>
          {transcriptOpen && (
            <div className="panel-body" style={{ maxHeight: '30vh' }}>
              {session.utterances.map((u) => (
                <div key={u.id} className="utt">
                  <div className="utt-head">
                    <span className="utt-time">{mmss(u.ts_start)}</span>
                    <span className="utt-speaker">{u.speaker}</span>
                    <span className="utt-src">{u.source}</span>
                  </div>
                  <div className="utt-text">{u.text}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Panel
        title="Follow-up email"
        stamp={email.rendered_at}
        extra={email.host_edited ? <span className="manual-tag">MANUAL</span> : undefined}
      >
        {editing ? (
          <div className="email-editor">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body" />
            <div className="email-actions">
              <button type="button" className="btn btn-teal" onClick={saveEmail}>
                Save (stops re-rendering)
              </button>
              <button type="button" className="btn btn-teal-outline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="email-subject">{email.subject}</div>
            <EmailBody body={email.body} />
            <div className="email-actions">
              <button type="button" className="btn btn-teal-outline" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="btn btn-teal-outline" onClick={copyEmail}>
                {copied ? 'Copied ✓' : 'Copy email'}
              </button>
              <a className="btn btn-teal" href={api.exportUrl(sessionId)} download>
                Export Markdown
              </a>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
