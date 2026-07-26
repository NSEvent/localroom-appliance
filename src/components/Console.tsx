// Live console (/session/{id}) — the demo screen. Layout per ui-spec §2:
// top bar / transcript | meeting record | alerts + nudge / bottom strip.
// When session.status === "ended" it reflows into the end-meeting review.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { AlertsPanel, NudgeBanner } from './AlertsPanel'
import { BottomStrip } from './BottomStrip'
import { EndReview } from './EndReview'
import { MeetingRecord } from './MeetingRecord'
import { TopBar } from './TopBar'
import { TranscriptPanel } from './TranscriptPanel'
import { TranscriptionView } from './TranscriptionView'

type Tab = 'console' | 'transcription'

export function Console() {
  const { session, loadError, loading, wsStatus, sessionId } = useStore()

  // Sessions live in memory, so an API restart leaves open tabs pointed at a
  // session that no longer exists — 404 on every poll and 403 on the socket,
  // forever. Send them back to the join page instead of letting them sit on a
  // dead screen retrying. Same for a meeting that has ended.
  useEffect(() => {
    if (!loadError || loading) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`)
        if (!cancelled && res.status === 404) {
          history.replaceState(null, '', '/')
          location.reload()
        }
      } catch {
        /* network blip — the poll will try again */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadError, loading, sessionId])
  const ended = session?.session.status === 'ended'
  // Simplified default (audio settings + live transcript). The full demo
  // console is one tab away and unchanged — this is a default, not a
  // deletion. Flip back to 'console' when the demo screen is what's wanted.
  const [tab, setTab] = useState<Tab>('transcription')

  return (
    <div className="console">
      {wsStatus !== 'open' && (
        <div className="banner reconnect" role="status">
          reconnecting… panels keep the last good state
        </div>
      )}
      {tab === 'console' && <TopBar />}
      {loadError && !session && !loading ? (
        <div className="centered-note">
          Could not load this session ({loadError}). Retrying over the live connection…
        </div>
      ) : ended ? (
        <EndReview />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="console view">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'console'}
              className={`tab ${tab === 'console' ? 'active' : ''}`}
              onClick={() => setTab('console')}
            >
              Console
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'transcription'}
              className={`tab ${tab === 'transcription' ? 'active' : ''}`}
              onClick={() => setTab('transcription')}
            >
              Transcription
            </button>
          </div>
          {tab === 'console' ? (
            <>
              <div className="console-main">
                <TranscriptPanel />
                <MeetingRecord />
                <div className="col">
                  <AlertsPanel />
                  <NudgeBanner />
                </div>
              </div>
              <BottomStrip />
            </>
          ) : (
            <TranscriptionView />
          )}
        </>
      )}
    </div>
  )
}
