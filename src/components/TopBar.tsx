// Top bar: wordmark, session identity + status chip, agenda strip, runtime
// status panel (the judges' local-AI proof, D27), Closing Sweep.

import { useState } from 'react'
import * as api from '../api'
import { useMicCapture } from '../mic'
import { useStore } from '../store'

/** Per-window mic toggle, ui-spec §10 P0: three visible states —
 * off (no stream held) / recording (red dot pulse) / paused. Host console
 * only; capture is 5 s stop/restart MediaRecorder chunks (D22). */
function MicToggle({ disabled }: { disabled: boolean }) {
  const { sessionId, health } = useStore()
  const { micState, micError, toggleMic, togglePause } = useMicCapture(sessionId)
  // The room mic is wired to the appliance. When the console is being viewed
  // FROM the appliance, browser capture is off by default — it would fight
  // the appliance for the exclusive capture device and add nothing.
  const onAppliance = health?.capture.clientIsAppliance ?? false
  if (onAppliance) {
    return (
      <div className="mic-controls appliance" title="Capture runs on the appliance">
        <span className="mic-appliance-note">
          <span className="mic-dot appliance" aria-hidden /> Appliance mic
        </span>
      </div>
    )
  }
  return (
    <div className="mic-controls" title={micError ?? undefined}>
      <button
        type="button"
        className={`btn btn-outline mic-btn ${micState}`}
        onClick={toggleMic}
        disabled={disabled}
        aria-pressed={micState !== 'off'}
      >
        <span className="mic-dot" aria-hidden />
        {micState === 'off' ? 'Mic Off' : micState === 'recording' ? 'Recording' : 'Mic Paused'}
      </button>
      {micState !== 'off' && (
        <button type="button" className="btn btn-outline mic-pause" onClick={togglePause}>
          {micState === 'recording' ? 'Pause' : 'Resume'}
        </button>
      )}
      {micError && <span className="mic-error">mic error</span>}
    </div>
  )
}

function RuntimeStatus() {
  const { health, healthError } = useStore()
  const degraded = health?.degraded ?? false
  const asr = health?.asr
  const llm = health?.llm
  return (
    <div className="runtime" title="Runtime status — everything runs on this machine">
      {degraded && <span className="degraded">degraded — last good state kept</span>}
      {healthError && <span className="degraded">status unavailable</span>}
      {health && (
        <>
          <span>
            {health.mode || 'mode ?'}
            {asr?.model ? ` · ${asr.provider ? `${asr.provider} ` : ''}${asr.model}` : ''}
          </span>
          <span className="sep">|</span>
          <span className="model">
            {llm?.model ?? 'operator model ?'}
            {llm?.tok_per_s ? ` · ${Math.round(llm.tok_per_s)} tok/s` : ''}
          </span>
          {health.gpu && (
            <>
              <span className="sep">|</span>
              <span>{health.gpu}</span>
            </>
          )}
        </>
      )}
      <span className="nocloud">No cloud APIs</span>
    </div>
  )
}

export function TopBar() {
  const { session, sessionId } = useStore()
  const [sweeping, setSweeping] = useState(false)
  const meta = session?.session
  const status = meta?.status ?? 'created'

  const sweep = async () => {
    setSweeping(true)
    try {
      await api.closingSweep(sessionId)
    } catch (e) {
      console.error('closing sweep failed', e)
    } finally {
      setSweeping(false)
    }
  }

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="meety">Meety</span> Local
      </div>
      <div>
        <div className="session-title">{meta?.title ?? '…'}</div>
        {meta?.goal && (
          <div className="session-goal" title={meta.goal}>
            Goal: {meta.goal}
          </div>
        )}
      </div>
      <span className={`status-chip ${status}`}>
        <span className="dot" />
        {status.toUpperCase()}
      </span>
      <nav className="agenda-strip" aria-label="Agenda">
        {session?.agenda.map((a) => (
          <span key={a.id} className={`agenda-chip ${a.status}`} title={`${a.title} (${a.status})`}>
            {a.title}
          </span>
        ))}
      </nav>
      <RuntimeStatus />
      <MicToggle disabled={status === 'ended'} />
      <button
        type="button"
        className="btn btn-outline"
        onClick={sweep}
        disabled={sweeping || status === 'ended'}
      >
        {sweeping ? 'Sweeping…' : 'Closing Sweep'}
      </button>
    </header>
  )
}
