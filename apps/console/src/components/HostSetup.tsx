// Host setup (route "/"): Chuck + wordmark, title/goal/participants/context
// form prefilled with the Brightline demo defaults; Start → POST /api/sessions
// → navigate to /session/{id}. The only screen where Chuck appears.

import { useState, type FormEvent } from 'react'
import * as api from '../api'
import { DEMO_DEFAULTS } from '../fixture'

interface Props {
  navigate: (path: string) => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
}

export function HostSetup({ navigate, theme, setTheme }: Props) {
  const [title, setTitle] = useState(DEMO_DEFAULTS.title)
  const [goal, setGoal] = useState(DEMO_DEFAULTS.goal)
  const [participants, setParticipants] = useState(DEMO_DEFAULTS.participants)
  const [contextDir, setContextDir] = useState(DEMO_DEFAULTS.contextDir)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addParticipant = () => {
    const name = newName.trim()
    if (!name) return
    setParticipants([...participants, { name, role: newRole.trim() || '' }])
    setNewName('')
    setNewRole('')
  }

  const start = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await api.createSession({
        title: title.trim(),
        goal: goal.trim(),
        participants: participants.map((p) => ({ name: p.name, role: p.role || null })),
        context_dir: contextDir.trim() || null,
      })
      navigate(`/session/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <img src="/chuck-logo.png" alt="Chuck, the Meety mascot" />
          <div className="wordmark">
            <span className="meety">Meety</span> Local
          </div>
          <span className="tagline">local-only · no cloud APIs</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
        <form className="setup-form" onSubmit={start}>
          <div className="field">
            <label htmlFor="f-title">Meeting title</label>
            <input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="f-goal">Goal</label>
            <textarea
              id="f-goal"
              value={goal}
              rows={2}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Participants</label>
            <div className="participants">
              {participants.map((p, i) => (
                <span key={`${p.name}-${i}`} className="participant-chip">
                  <strong>{p.name}</strong>
                  {p.role && <span className="role">· {p.role}</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setParticipants(participants.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <span className="participant-add">
                <input
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addParticipant()
                    }
                  }}
                />
                <input
                  placeholder="Role (optional)"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addParticipant()
                    }
                  }}
                />
                <button type="button" className="btn btn-teal-outline" onClick={addParticipant}>
                  Add
                </button>
              </span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-ctx">Context folder</label>
            <input
              id="f-ctx"
              className="mono"
              value={contextDir}
              onChange={(e) => setContextDir(e.target.value)}
            />
            <div className="hint">
              Markdown inlined at start (8,000-token cap). Missing folder = empty context, never an
              error.
            </div>
          </div>
          <div className="setup-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Starting…' : 'Start session'}
            </button>
            {error && <span className="setup-error">Could not start: {error}</span>}
          </div>
        </form>
      </div>
    </div>
  )
}
