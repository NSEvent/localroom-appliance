// Presenter controls (?presenter=1) — the playback driver. Runs in a second
// window on the Dell; never shown on the projector. Posts the bundled
// transcript.json utterances unmodified to the playback endpoint, pausing at
// every HOLD / CHECKPOINT from script.md. Seed-to-checkpoint = mid-demo crash
// recovery in <10 s. Plain, utilitarian.

import { useRef, useState } from 'react'
import * as api from '../api'
import {
  CHECKPOINT_SEEDS,
  cueFor,
  nextBoundary,
  segmentFor,
  UTTERANCES,
} from '../fixture'
import { useStore } from '../store'
import { mmss } from '../time'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function PresenterControls() {
  const store = useStore()
  const { session, sessionId, wsStatus } = store
  const posted = session?.utterances.length ?? 0
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const localRef = useRef(0)

  const effectivePosted = Math.max(posted, localRef.current)
  const total = UTTERANCES.length
  const segment = segmentFor(effectivePosted)
  const cue = cueFor(effectivePosted)
  const boundary = nextBoundary(effectivePosted)
  const lastUtt = effectivePosted > 0 ? UTTERANCES[Math.min(effectivePosted, total) - 1] : null

  /** Post fixture utterances up to `target` count, one POST per utterance,
   * `paceMs` apart (script.md: ~1 utterance / 3 s within a segment). */
  const runTo = async (target: number, paceMs: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    cancelRef.current = false
    let i = Math.max(posted, localRef.current)
    try {
      while (i < target && i < total && !cancelRef.current) {
        const u = UTTERANCES[i]
        await api.postUtterances(sessionId, [u])
        i += 1
        localRef.current = i
        if (paceMs > 0 && i < target) await sleep(paceMs)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Seed to a checkpoint: every missing utterance in ONE batch POST —
   * mid-demo crash recovery in <10 s. */
  const seed = async (count: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const from = Math.max(posted, localRef.current)
    try {
      if (from < count) {
        await api.postUtterances(sessionId, UTTERANCES.slice(from, count))
        localRef.current = count
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const postNext = () => runTo(effectivePosted + 1, 0)
  const advanceToBoundary = () => boundary && runTo(boundary.at, 3000)
  const hold = () => {
    cancelRef.current = true
  }

  const doSweep = () => {
    setError(null)
    api.closingSweep(sessionId).catch((e) => setError(String(e)))
  }
  const doEnd = () => {
    setError(null)
    api.endSession(sessionId).catch((e) => setError(String(e)))
  }

  return (
    <div className="presenter">
      <div className="presenter-head">
        <div className="wordmark">
          <span className="meety">Meety</span> Local
        </div>
        <span className="presenter-tag">PRESENTER — NOT ON PROJECTOR</span>
        <span className="presenter-pos">
          {segment.label.split(' · ')[0]} · {effectivePosted}/{total} posted
        </span>
      </div>

      <div className="presenter-card">
        <div className="label">NOW PLAYING</div>
        <div className="now-playing">
          {lastUtt ? (
            <>
              {lastUtt.speaker}: “{lastUtt.text}”
            </>
          ) : (
            'Nothing posted yet — advance to start Segment 1.'
          )}
        </div>
        <div className="progress">
          <div style={{ width: `${(effectivePosted / total) * 100}%` }} />
        </div>
        <div className="presenter-foot" style={{ marginTop: '0.4rem' }}>
          <span>{lastUtt ? mmss(lastUtt.ts_start) : '0:00'}</span>
          <span>
            next stop:{' '}
            {boundary ? `${boundary.name} (after ${boundary.at}/${total})` : 'end of script'}
          </span>
        </div>
      </div>

      <div className="presenter-card cue">
        <div className="label">NEXT BEAT — CUE</div>
        <div className="cue-text">
          <strong>{cue.title}.</strong> {cue.text}
        </div>
      </div>

      <div className="presenter-bigrow">
        <button
          type="button"
          className="btn btn-primary"
          onClick={busy ? undefined : boundary ? advanceToBoundary : undefined}
          disabled={busy || !boundary}
        >
          {busy ? 'PLAYING…' : 'ADVANCE ▸'}
        </button>
        <button type="button" className="btn btn-outline" onClick={hold} disabled={!busy}>
          HOLD ⏸
        </button>
      </div>

      <div className="presenter-card">
        <div className="label">STEP</div>
        <button
          type="button"
          className="btn btn-teal-outline"
          onClick={postNext}
          disabled={busy || effectivePosted >= total}
        >
          Post next utterance ({effectivePosted < total ? UTTERANCES[effectivePosted].id : 'done'})
        </button>
      </div>

      <div className="presenter-card">
        <div className="label">SEED TO CHECKPOINT — CRASH RECOVERY &lt; 10 s</div>
        <div className="seed-row">
          {CHECKPOINT_SEEDS.map((c) => (
            <button
              key={c.label}
              type="button"
              className="btn"
              onClick={() => seed(c.count)}
              disabled={busy || effectivePosted >= c.count}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="presenter-endrow">
        <button type="button" className="btn btn-outline" onClick={doSweep} disabled={busy}>
          Closing Sweep
        </button>
        <button type="button" className="btn btn-teal" onClick={doEnd} disabled={busy}>
          End Meeting
        </button>
      </div>

      {error && <div className="presenter-error">driver error: {error}</div>}

      <div className="presenter-foot">
        <span>playback: script · fixture bundled</span>
        <span>
          ws {wsStatus} · state v{session?.state_version ?? '—'}
        </span>
      </div>
    </div>
  )
}
