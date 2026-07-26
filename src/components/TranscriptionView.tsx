// Transcription view — the default session screen for now.
//
// Deliberately narrow: audio settings across the top, the live transcript
// filling everything below. No meeting record, no alerts, nothing competing
// for width. This is the screen you watch to answer "is the mic working and
// is STT keeping up", which is the question that matters while the pipeline
// is being validated.
//
// The full demo console is one tab away and unchanged — this simplification
// is a default, not a deletion.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import { mmss } from '../time'
import type { AudioDevice, AudioLevel } from '../types'

const POLL_MS = 1200

/** dBFS → 0..1 across a meter floor of -60 dB. */
function meterFraction(dbfs: number | null | undefined): number {
  if (dbfs === null || dbfs === undefined) return 0
  const floor = -60
  if (dbfs <= floor) return 0
  return Math.min(1, (dbfs - floor) / -floor)
}

function AudioBar() {
  const { health } = useStore()
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [level, setLevel] = useState<AudioLevel | null>(null)
  const [monitoring, setMonitoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const isAppliance = health?.capture.clientIsAppliance ?? false

  const loadDevices = useCallback(async () => {
    try {
      const d = await api.getAudioDevices()
      setDevices(d.devices)
      setSelected((cur) => cur ?? d.selected ?? d.devices[0]?.id ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not list devices')
    }
  }, [])

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  // One request in flight at a time — capture is exclusive on this hardware,
  // so a backed-up queue would hold the device away from the session.
  useEffect(() => {
    if (!monitoring) return
    let stop = false
    const tick = async () => {
      if (stop || inFlight.current) return
      inFlight.current = true
      try {
        const l = await api.getAudioLevel(selected, 0.5)
        if (!stop) {
          setLevel(l)
          if (!l.ok && l.busy) setMonitoring(false) // someone else took the mic
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : 'level check failed')
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
  }, [monitoring, selected])

  const peak = meterFraction(level?.peak_dbfs)
  const rms = meterFraction(level?.rms_dbfs)
  const meterState = level?.clipping ? 'clip' : level?.silent ? 'silent' : 'ok'

  return (
    <div className="audio-bar">
      <div className="audio-bar-controls">
        <label htmlFor="audio-device">Mic</label>
        <select
          id="audio-device"
          value={selected ?? ''}
          onChange={(e) => {
            setSelected(e.target.value)
            setLevel(null)
          }}
          disabled={devices.length === 0}
        >
          {devices.length === 0 && <option value="">no capture device</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`btn ${monitoring ? 'btn-solid' : 'btn-outline'}`}
          onClick={() => setMonitoring((m) => !m)}
          disabled={!selected}
        >
          {monitoring ? 'Stop meter' : 'Test level'}
        </button>

        <div className="meter inline" role="meter" aria-label="input level">
          <div className={`meter-track ${meterState}`}>
            <div className="meter-rms" style={{ width: `${rms * 100}%` }} />
            <div className="meter-peak" style={{ left: `${peak * 100}%` }} />
            <div className="meter-target" style={{ left: `${meterFraction(-12) * 100}%` }} />
          </div>
        </div>

        <span className="audio-readout">
          {level?.ok ? (
            <>
              {level.peak_dbfs ?? '–'} dBFS
              {level.clipping && <strong className="clip-warn"> CLIP</strong>}
              {level.silent && <span className="silent-warn"> silent</span>}
            </>
          ) : monitoring ? (
            'sampling…'
          ) : (
            'idle'
          )}
        </span>

        <span className={`capture-chip ${isAppliance ? 'appliance' : 'remote'}`}>
          {isAppliance ? 'appliance capture' : 'remote viewer'}
        </span>
      </div>

      {level && !level.ok && level.error && (
        <div className="audio-error">
          {level.error}
          {(level.holders?.length ?? 0) > 0 && (
            <> — held by {level.holders!.map((h) => `${h.comm}(${h.pid})`).join(', ')}</>
          )}
        </div>
      )}
      {error && <div className="audio-error">{error}</div>}
    </div>
  )
}

/** Live stream: newest at the bottom, autoscroll pinned unless scrolled up. */
function LiveTranscript() {
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

  const asrLabel = health?.asr.model ?? health?.asr.provider ?? 'unknown'
  const asrReady = health?.asr.status !== 'down'

  return (
    <div className="live-transcript">
      <div className="live-head">
        <h2>Live transcript</h2>
        <span className="live-meta">
          <span className={`dot ${asrReady ? 'good' : 'bad'}`} aria-hidden /> {asrLabel}
          {' · '}
          {count} {count === 1 ? 'utterance' : 'utterances'}
        </span>
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

      <div className="live-body" ref={bodyRef} onScroll={onScroll}>
        {count === 0 ? (
          <div className="live-empty">
            <p>Waiting for speech.</p>
            <p className="dim">
              Silence produces no line — that is expected, not a failure. Lines appear
              only when the recognizer finds words.
            </p>
          </div>
        ) : (
          utterances.map((u) => (
            <div key={u.id} className="live-line">
              <span className="live-ts">{mmss(u.ts_start)}</span>
              <span className={`live-src ${u.source}`}>{u.source}</span>
              <span className="live-text">{u.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function TranscriptionView() {
  return (
    <div className="transcription-view">
      <AudioBar />
      <LiveTranscript />
    </div>
  )
}
