// Transcription view — the session screen while the pipeline is being proven.
//
// One control row, then the transcript. Nothing else. The question this screen
// answers is "is the mic working and is STT keeping up", and every element that
// does not help answer it has been left out.
//
// Capture runs on the APPLIANCE: the box records its own mic in fixed chunks
// and feeds them through the same ingest path a browser upload takes. The
// browser here is a viewer, so there is no getUserMedia and no mic permission
// prompt. The meter reads the capture loop's own levels while it is running —
// the ALSA device is exclusive, so a second opener would just fail.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import { mmss } from '../time'
import type { AudioDevice, AudioLevel, CaptureStatus } from '../types'

const POLL_MS = 1000

/** dBFS → 0..1 across a meter floor of -60 dB. */
function meterFraction(dbfs: number | null | undefined): number {
  if (dbfs === null || dbfs === undefined) return 0
  if (dbfs <= -60) return 0
  return Math.min(1, (dbfs + 60) / 60)
}

function ControlRow() {
  const { sessionId } = useStore()
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [capture, setCapture] = useState<CaptureStatus | null>(null)
  const [level, setLevel] = useState<AudioLevel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  const recording = capture?.running ?? false

  useEffect(() => {
    void (async () => {
      try {
        const [d, c] = await Promise.all([
          api.getAudioDevices(),
          api.getCaptureStatus(sessionId),
        ])
        setDevices(d.devices)
        setSelected((cur) => cur ?? d.selected ?? d.devices[0]?.id ?? null)
        setCapture(c)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not read audio state')
      }
    })()
  }, [sessionId])

  // Poll only while recording: the meter then reads the capture loop's levels
  // rather than opening the exclusive device a second time.
  useEffect(() => {
    if (!recording) {
      setLevel(null)
      return
    }
    let stop = false
    const tick = async () => {
      if (stop || inFlight.current) return
      inFlight.current = true
      try {
        const [l, c] = await Promise.all([
          api.getAudioLevel(selected, 0.5),
          api.getCaptureStatus(sessionId),
        ])
        if (!stop) {
          setLevel(l)
          setCapture(c)
        }
      } catch {
        /* transient — the next tick retries */
      } finally {
        inFlight.current = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), POLL_MS)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [recording, selected, sessionId])

  const toggle = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      setCapture(recording ? await api.stopCapture(sessionId)
                           : await api.startCapture(sessionId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'capture failed')
    } finally {
      setPending(false)
    }
  }, [recording, sessionId])

  const peak = meterFraction(level?.peak_dbfs)
  const rms = meterFraction(level?.rms_dbfs)
  const meterState = level?.clipping ? 'clip' : level?.silent ? 'silent' : 'ok'

  return (
    <div className="ctl">
      <button
        type="button"
        className={`rec-btn ${recording ? 'on' : ''}`}
        onClick={() => void toggle()}
        disabled={pending || !selected}
        aria-pressed={recording}
      >
        <span className="rec-dot" aria-hidden />
        {pending ? '…' : recording ? 'Stop' : 'Record'}
      </button>

      <select
        value={selected ?? ''}
        onChange={(e) => setSelected(e.target.value)}
        disabled={recording || devices.length === 0}
        aria-label="capture device"
      >
        {devices.length === 0 && <option value="">no capture device</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>

      <div className="meter" role="meter" aria-label="input level">
        <div className={`meter-track ${meterState}`}>
          <div className="meter-rms" style={{ width: `${rms * 100}%` }} />
          <div className="meter-peak" style={{ left: `${peak * 100}%` }} />
          <div className="meter-target" style={{ left: `${meterFraction(-12) * 100}%` }} />
        </div>
      </div>

      <span className="ctl-readout">
        {recording
          ? `${level?.peak_dbfs ?? '–'} dBFS · ${capture?.chunks ?? 0} chunks`
          : 'not recording'}
        {level?.clipping && <strong className="clip-warn"> CLIP</strong>}
      </span>

      {(error || capture?.last_error) && (
        <span className="ctl-error">{error ?? capture?.last_error}</span>
      )}
    </div>
  )
}

export function TranscriptionView() {
  const { session, health } = useStore()
  const bodyRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)

  const utterances = session?.utterances ?? []
  const count = utterances.length

  useEffect(() => {
    if (pinnedRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [count])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    pinnedRef.current = atBottom
    setPinned(atBottom)
  }

  const asrOk = health?.asr.status !== 'down'

  return (
    <div className="tv">
      <ControlRow />

      <div className="tv-body" ref={bodyRef} onScroll={onScroll}>
        {count === 0 ? (
          <div className="tv-empty">
            <p>No speech yet.</p>
            <p className="dim">
              Press Record. Silence produces no line — that is expected, not a failure.
            </p>
          </div>
        ) : (
          utterances.map((u) => (
            <div key={u.id} className="tv-line">
              <span className="tv-ts">{mmss(u.ts_start)}</span>
              <span
                className={`tv-who ${u.source_kind === 'room' ? 'room' : 'person'}`}
                title={u.source_kind === 'room'
                  ? 'room mic — not attributed to one person'
                  : 'from this participant\u2019s own device'}
              >
                {u.speaker}
              </span>
              <span className="tv-text">{u.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="tv-foot">
        <span className={`dot ${asrOk ? 'good' : 'bad'}`} aria-hidden />
        {health?.asr.model ?? 'ASR'} · {count} {count === 1 ? 'line' : 'lines'}
        {!pinned && (
          <button
            type="button"
            className="btn btn-outline jump-latest"
            onClick={() => {
              pinnedRef.current = true
              setPinned(true)
              if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
            }}
          >
            Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}
