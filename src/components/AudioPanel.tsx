// Appliance audio: device picker + live input-level meter.
//
// The room mic is plugged into the APPLIANCE, not the viewer's laptop, so
// this panel talks to /api/audio/* — the appliance's own ALSA devices —
// rather than enumerating browser inputs. Browser-side capture (mic.ts,
// D22) is a remote-viewer path and is disabled by default when the console
// is being viewed from the appliance itself.
//
// The meter polls short captures. Capture is EXCLUSIVE on this hardware, so
// polling stops while a session is recording and whenever the device reports
// busy — otherwise the meter would steal the mic from the meeting.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import type { AudioDevice, AudioLevel } from '../types'
import { Panel } from './common'

const POLL_MS = 1200

/** dBFS → 0..1 across a meter floor of -60 dB. */
function meterFraction(dbfs: number | null | undefined): number {
  if (dbfs === null || dbfs === undefined) return 0
  const floor = -60
  if (dbfs <= floor) return 0
  return Math.min(1, (dbfs - floor) / -floor)
}

function LevelBar({ level }: { level: AudioLevel | null }) {
  const peak = meterFraction(level?.peak_dbfs)
  const rms = meterFraction(level?.rms_dbfs)
  const state = level?.clipping ? 'clip' : level?.silent ? 'silent' : 'ok'
  return (
    <div className="meter" role="meter" aria-label="input level">
      <div className={`meter-track ${state}`}>
        <div className="meter-rms" style={{ width: `${rms * 100}%` }} />
        <div className="meter-peak" style={{ left: `${peak * 100}%` }} />
        {/* -12 dBFS: a healthy speaking peak sits around here. */}
        <div className="meter-target" style={{ left: `${meterFraction(-12) * 100}%` }} />
      </div>
      <div className="meter-scale">
        <span>-60</span><span>-30</span><span>-12</span><span>0 dBFS</span>
      </div>
    </div>
  )
}

export function AudioPanel() {
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

  // Poll levels only while monitoring. One request in flight at a time: a
  // backed-up queue would hold the exclusive capture device.
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
          // Something else grabbed the mic — stop rather than fight it.
          if (!l.ok && l.busy) setMonitoring(false)
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

  const busyHolders = level?.holders ?? []

  return (
    <Panel title="Audio input" stamp={null} className="audio-panel">
      <div className="audio-row">
        <label htmlFor="audio-device">Device</label>
        <select
          id="audio-device"
          value={selected ?? ''}
          onChange={(e) => {
            setSelected(e.target.value)
            setLevel(null)
          }}
          disabled={devices.length === 0}
        >
          {devices.length === 0 && <option value="">no capture device found</option>}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.id})
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-outline" onClick={() => void loadDevices()}>
          Rescan
        </button>
      </div>

      <div className="audio-row">
        <button
          type="button"
          className={`btn ${monitoring ? 'btn-solid' : 'btn-outline'}`}
          onClick={() => setMonitoring((m) => !m)}
          disabled={!selected}
        >
          {monitoring ? 'Stop meter' : 'Test level'}
        </button>
        <span className="audio-readout">
          {level?.ok ? (
            <>
              peak {level.peak_dbfs ?? '–'} dBFS · rms {level.rms_dbfs ?? '–'} dBFS
              {level.clipping && <strong className="clip-warn"> · CLIPPING</strong>}
              {level.silent && <span className="silent-warn"> · silent</span>}
            </>
          ) : monitoring ? (
            'sampling…'
          ) : (
            'meter idle'
          )}
        </span>
      </div>

      <LevelBar level={level} />

      {level && !level.ok && level.error && (
        <div className="audio-error">
          {level.error}
          {busyHolders.length > 0 && (
            <> — held by {busyHolders.map((h) => `${h.comm}(${h.pid})`).join(', ')}</>
          )}
        </div>
      )}
      {error && <div className="audio-error">{error}</div>}

      <p className="audio-note">
        {isAppliance ? (
          <>
            This console is running <strong>on the appliance</strong>, so the room mic is
            captured here — browser recording is off by default. Speak at your normal
            distance; a healthy peak lands near the −12 dBFS mark.
          </>
        ) : (
          <>
            Viewing remotely. This meter reads the <strong>appliance&rsquo;s</strong> mic,
            not yours.
          </>
        )}
      </p>
      <p className="audio-note dim">
        Capture is exclusive on this hardware: the meter pauses while a session records,
        and one stray recorder will block both.
      </p>
    </Panel>
  )
}
