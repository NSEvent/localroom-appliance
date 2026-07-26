// Bottom strip: meeting_summary, Q&A input + streaming answer card with
// grounding chips, parking-lot count, follow-up email preview (OWNER NEEDED
// highlighted), Export Markdown.

import { Fragment, useState, type ReactNode } from 'react'
import * as api from '../api'
import { emit } from '../bus'
import { useStore } from '../store'
import type { QaEntry } from '../types'

/** Render email body with "OWNER NEEDED" lines highlighted (D9). */
export function EmailBody({ body }: { body: string }) {
  const parts = body.split('OWNER NEEDED')
  const out: ReactNode[] = []
  parts.forEach((p, i) => {
    out.push(<Fragment key={`t${i}`}>{p}</Fragment>)
    if (i < parts.length - 1) {
      out.push(
        <span key={`h${i}`} className="owner-needed">
          OWNER NEEDED
        </span>,
      )
    }
  })
  return <div className="email-body">{out}</div>
}

function QaSources({ qa }: { qa: QaEntry }) {
  if (qa.source_utterance_ids.length === 0 && qa.source_files.length === 0) return null
  return (
    <div className="qa-sources">
      {qa.source_utterance_ids.map((id) => (
        <button
          key={id}
          type="button"
          className="qa-chip utt"
          onClick={() => emit('jump-utterance', id)}
          title={`Jump transcript to ${id}`}
        >
          {id}
        </button>
      ))}
      {qa.source_files.map((f) => (
        <span key={f} className="qa-chip file">
          {f}
        </span>
      ))}
    </div>
  )
}

function QaCard({
  qa,
  streamText,
  onRetry,
}: {
  qa: QaEntry
  streamText: string | null
  onRetry: () => void
}) {
  return (
    <div>
      <div className="qa-question">Q: {qa.question}</div>
      {qa.status === 'pending' && (
        <div className="qa-answer">
          {streamText ?? ''}
          <span className="qa-cursor" />
        </div>
      )}
      {qa.status === 'answered' && <div className="qa-answer">{qa.answer}</div>}
      {qa.status === 'failed' && (
        <div className="qa-answer">
          <span className="qa-failed">The operator could not answer this one. </span>
          <button type="button" className="btn btn-teal-outline" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {qa.status === 'answered' && <QaSources qa={qa} />}
    </div>
  )
}

export function BottomStrip() {
  const { session, sessionId, qaStream } = useStore()
  const [question, setQuestion] = useState('')
  const [qaOpen, setQaOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  const qa = session?.qa ?? []
  const latest = qa.length > 0 ? qa[qa.length - 1] : null
  const history = qa.slice(0, -1)

  const ask = (q: string) => {
    if (!q.trim()) return
    setQaOpen(true)
    // asked_by defaults to the host on the shared screen
    api.postQa(sessionId, q.trim(), 'host').catch((e) => console.error('qa failed', e))
  }

  const email = session?.follow_up_email
  const summary = session?.meeting_summary ?? ''
  const parked = session?.parking_lot.length ?? 0

  return (
    <footer className="bottom-strip">
      <div className="summary">
        <strong>Summary:</strong>{' '}
        {summary || <em>the operator keeps a 1–3 sentence summary here as the meeting runs.</em>}
      </div>

      <div className="qa">
        {qaOpen && latest && (
          <div className="qa-pop">
            <QaCard
              qa={latest}
              streamText={
                qaStream && (qaStream.qaId === latest.id || qaStream.qaId === null)
                  ? qaStream.text
                  : null
              }
              onRetry={() => ask(latest.question)}
            />
            {history.length > 0 && (
              <>
                <button
                  type="button"
                  className="qa-history-toggle"
                  onClick={() => setHistoryOpen((v) => !v)}
                >
                  {historyOpen ? '▴ hide' : `▾ previous questions (${history.length})`}
                </button>
                {historyOpen && (
                  <div className="qa-history">
                    {[...history].reverse().map((h) => (
                      <QaCard key={h.id} qa={h} streamText={null} onRetry={() => ask(h.question)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <form
          className="qa-inputrow"
          onSubmit={(e) => {
            e.preventDefault()
            ask(question)
            setQuestion('')
          }}
        >
          <input
            placeholder='Ask the meeting… e.g. "what is still unresolved?"'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => latest && setQaOpen(true)}
          />
          <button type="submit" className="btn btn-primary">
            Ask
          </button>
          {latest && (
            <button
              type="button"
              className="email-toggle"
              onClick={() => setQaOpen((v) => !v)}
              aria-label="Toggle answers"
            >
              {qaOpen ? '▾' : '▴'}
            </button>
          )}
        </form>
      </div>

      <span className="parking-count">
        Parking lot · <strong>{parked}</strong>
      </span>

      <button type="button" className="email-toggle" onClick={() => setEmailOpen((v) => !v)}>
        {emailOpen ? 'Hide email' : 'Preview email'}
      </button>
      {emailOpen && email && (
        <div className="email-pop">
          <div className="email-subject">
            {email.subject} {email.host_edited && <span className="manual-tag">MANUAL</span>}
          </div>
          <EmailBody body={email.body} />
        </div>
      )}

      <a className="btn btn-teal" href={api.exportUrl(sessionId)} download>
        Export Markdown
      </a>
    </footer>
  )
}
