// Transcript (left column): low-latency utterance stream with autoscroll
// (pause on scroll-up), speaker + mm:ss + source badge, and the
// "operator analyzing N utterances…" shimmer (D15) while a state.updated is
// pending after utterance.created.

import { useEffect, useRef, useState } from 'react'
import { on } from '../bus'
import { useStore } from '../store'
import { mmss } from '../time'
import { Empty, Panel, Skeletons } from './common'

export function TranscriptPanel() {
  const { session, loading, pendingUtterances, lastUtteranceAt, health } = useStore()
  const bodyRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  const [jumpId, setJumpId] = useState<string | null>(null)

  const utterances = session?.utterances ?? []
  const count = utterances.length

  // Autoscroll pinned to bottom; scrolling up pauses it (standard chat behavior).
  useEffect(() => {
    if (pinnedRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [count, pendingUtterances])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    pinnedRef.current = atBottom
    setPinned(atBottom)
  }

  // Evidence / Q&A chips jump the transcript to an utterance.
  useEffect(
    () =>
      on('jump-utterance', (id) => {
        pinnedRef.current = false
        setPinned(false)
        const el = bodyRef.current?.querySelector(`[data-utt="${id}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setJumpId(id)
        setTimeout(() => setJumpId((cur) => (cur === id ? null : cur)), 1600)
      }),
    [],
  )

  const asrDown =
    health != null &&
    health.asr.status != null &&
    !['ok', 'ready', 'up', 'healthy'].includes(health.asr.status)

  return (
    <Panel
      title="Transcript"
      count={count || undefined}
      stamp={lastUtteranceAt}
      className="transcript"
      bodyRef={bodyRef}
      onBodyScroll={onScroll}
    >
      {loading && <Skeletons n={4} />}
        {!loading && asrDown && (
          <div className="mic-paused">mic paused — scripted input available</div>
        )}
        {!loading && count === 0 && (
          <Empty>No speech yet — utterances appear as soon as the room starts talking.</Empty>
        )}
        {utterances.map((u) => (
          <div key={u.id} data-utt={u.id} className={`utt ${jumpId === u.id ? 'jump-flash' : ''}`}>
            <div className="utt-head">
              <span className="utt-time">{mmss(u.ts_start)}</span>
              <span className="utt-speaker">{u.speaker}</span>
              <span className="utt-src">{u.source}</span>
            </div>
            <div className="utt-text">{u.text}</div>
          </div>
        ))}
        {pendingUtterances > 0 && (
          <div className="shimmer-line">
            operator analyzing {pendingUtterances} utterance{pendingUtterances === 1 ? '' : 's'}…
          </div>
        )}
        {!pinned && count > 0 && (
          <button
            type="button"
            className="autoscroll-pill"
            onClick={() => {
              pinnedRef.current = true
              setPinned(true)
              if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
            }}
          >
            ↓ resume autoscroll
          </button>
        )}
    </Panel>
  )
}
