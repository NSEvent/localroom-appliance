// Mic capture per technical-spec "Audio Capture Plan" (plan-review D22):
// one getUserMedia stream for the session, then a FRESH MediaRecorder per
// 5 s chunk — start, stop after 5 s, POST the complete standalone blob to
// /audio, start the next recorder. NEVER start(timeslice): it produces
// headerless WebM fragments after the first chunk that ffmpeg rejects.
//
// Three visible states (ui-spec §10): off (no stream held) / recording /
// paused (stream held, no recorder running). Host console only in P0.

import { useCallback, useEffect, useRef, useState } from 'react'
import { postAudioChunk } from './api'

export type MicState = 'off' | 'recording' | 'paused'

const CHUNK_MS = 5000

/** webm/opus → webm → mp4 (Safari) — first supported wins (D22). */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  if (typeof MediaRecorder === 'undefined') return undefined
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export function useMicCapture(sessionId: string): {
  micState: MicState
  micError: string | null
  /** off → recording; recording/paused → off (releases the stream). */
  toggleMic: () => void
  /** recording ↔ paused (stream stays held). */
  togglePause: () => void
} {
  const [micState, setMicState] = useState<MicState>('off')
  const [micError, setMicError] = useState<string | null>(null)

  // Capture plumbing lives in refs: the chunk loop must see current values
  // without re-render races.
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false) // chunk loop should keep going
  const chunkIndexRef = useRef(0)
  const captureStartRef = useRef(0) // Date.now() at first chunk start

  const stopCurrentRecorder = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec && rec.state !== 'inactive') rec.stop() // onstop uploads the blob
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /** One chunk: fresh MediaRecorder, 5 s, stop, upload, next (D22). */
  const startChunk = useCallback(() => {
    const stream = streamRef.current
    if (!stream || !runningRef.current) return
    const mimeType = pickMimeType()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (e) {
      setMicError(`MediaRecorder failed: ${e}`)
      return
    }
    const parts: Blob[] = []
    const chunkStart = Date.now()
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data)
    }
    rec.onstop = () => {
      const durationMs = Date.now() - chunkStart
      const blob = new Blob(parts, { type: rec.mimeType || mimeType })
      if (blob.size > 0) {
        postAudioChunk(sessionId, blob, {
          chunkIndex: chunkIndexRef.current++,
          startedAtMs: chunkStart - captureStartRef.current,
          durationMs,
        }).catch((e) => {
          // Transcribed utterances arrive over the WS; upload errors only
          // surface here. Keep recording — one lost chunk is not a session.
          console.error('audio chunk upload failed', e)
          setMicError(String(e).slice(0, 200))
        })
      }
      // The complete blob is uploaded; start the NEXT fresh recorder.
      if (runningRef.current) startChunk()
    }
    rec.start() // no timeslice — ever (D22)
    recorderRef.current = rec
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (rec.state !== 'inactive') rec.stop()
    }, CHUNK_MS)
  }, [sessionId])

  const toggleMic = useCallback(() => {
    if (micState === 'off') {
      setMicError(null)
      navigator.mediaDevices
        .getUserMedia({ audio: true }) // echoCancellation etc. default ON
        .then((stream) => {
          streamRef.current = stream
          runningRef.current = true
          captureStartRef.current = Date.now()
          chunkIndexRef.current = 0
          setMicState('recording')
          startChunk()
        })
        .catch((e) => setMicError(`mic access failed: ${e?.message ?? e}`))
    } else {
      runningRef.current = false
      stopCurrentRecorder() // final partial chunk still uploads via onstop
      releaseStream()
      setMicState('off')
    }
  }, [micState, releaseStream, startChunk, stopCurrentRecorder])

  const togglePause = useCallback(() => {
    if (micState === 'recording') {
      runningRef.current = false
      stopCurrentRecorder()
      setMicState('paused')
    } else if (micState === 'paused') {
      runningRef.current = true
      setMicState('recording')
      startChunk()
    }
  }, [micState, startChunk, stopCurrentRecorder])

  // Unmount: stop cleanly and release the stream.
  useEffect(
    () => () => {
      runningRef.current = false
      stopCurrentRecorder()
      releaseStream()
    },
    [releaseStream, stopCurrentRecorder],
  )

  return { micState, micError, toggleMic, togglePause }
}
