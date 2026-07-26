// Join page — what a participant sees when they open the box's address.
//
// Identity is claimed here, once, by typing a name. That name labels every
// utterance that arrives on this browser's stream, which is why the meeting
// never has to guess who spoke: a participant's phone hears that participant
// and nobody else. Diarizing a mixed room signal is the hard, error-prone way
// to answer the same question, and it is a documented non-goal.

import { useEffect, useState } from 'react'
import * as api from '../api'

const NAME_KEY = 'meety-participant-name'

export function JoinPage({ navigate }: { navigate: (path: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A meeting is either running or it is not; one per appliance.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const { session } = await api.getCurrentSession()
        if (!cancelled) {
          setSessionId(session?.id ?? null)
          setChecking(false)
        }
      } catch {
        if (!cancelled) {
          setError('cannot reach the meeting box')
          setChecking(false)
        }
      }
    }
    void check()
    const t = setInterval(() => void check(), 4000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const join = async () => {
    if (!sessionId || !name.trim()) return
    setJoining(true)
    setError(null)
    try {
      const src = await api.registerSource(sessionId, name.trim(), 'browser')
      localStorage.setItem(NAME_KEY, name.trim())
      navigate(`/session/${sessionId}?source=${src.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not join')
      setJoining(false)
    }
  }

  const secure = window.isSecureContext

  return (
    <div className="join">
      <div className="join-card">
        <h1>Meety</h1>
        <p className="join-sub">AI meeting facilitation that never leaves the room</p>

        {checking ? (
          <p className="join-status">Looking for a meeting…</p>
        ) : sessionId ? (
          <>
            <p className="join-status live">
              <span className="dot good" aria-hidden /> A meeting is in progress
            </p>

            <label htmlFor="join-name">Your name</label>
            <input
              id="join-name"
              value={name}
              placeholder="e.g. Jeremy"
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join()
              }}
            />
            <p className="join-hint">
              This labels everything you say. Your device hears only you, so the
              transcript can name you without guessing.
            </p>

            <button
              type="button"
              className="join-btn"
              disabled={!name.trim() || joining}
              onClick={() => void join()}
            >
              {joining ? 'Joining…' : 'Join and share audio'}
            </button>

            {!secure && (
              <p className="join-warn">
                This page is not on a secure origin, so your browser will not allow
                microphone access. Open the <strong>https://</strong> address instead
                and accept the certificate warning once.
              </p>
            )}
          </>
        ) : (
          <p className="join-status">
            No meeting is running right now.
            <br />
            <span className="dim">This page updates on its own when one starts.</span>
          </p>
        )}

        {error && <p className="join-error">{error}</p>}
      </div>
    </div>
  )
}
