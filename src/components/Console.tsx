// Live console (/session/{id}) — the demo screen. Layout per ui-spec §2:
// top bar / transcript | meeting record | alerts + nudge / bottom strip.
// When session.status === "ended" it reflows into the end-meeting review.

import { useState } from 'react'
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
  const { session, loadError, loading, wsStatus } = useStore()
  const ended = session?.session.status === 'ended'
  // Diagnostic view for checking mic + STT without the demo panels competing
  // for width. Never auto-switches: the console tab is the demo screen.
  const [tab, setTab] = useState<Tab>('console')

  return (
    <div className="console">
      {wsStatus !== 'open' && (
        <div className="banner reconnect" role="status">
          reconnecting… panels keep the last good state
        </div>
      )}
      <TopBar />
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
            <div className="console-main">
              <TranscriptPanel />
              <MeetingRecord />
              <div className="col">
                <AlertsPanel />
                <NudgeBanner />
              </div>
            </div>
          ) : (
            <TranscriptionView />
          )}
          <BottomStrip />
        </>
      )}
    </div>
  )
}
