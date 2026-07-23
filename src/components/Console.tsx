// Live console (/session/{id}) — the demo screen. Layout per ui-spec §2:
// top bar / transcript | meeting record | alerts + nudge / bottom strip.
// When session.status === "ended" it reflows into the end-meeting review.

import { useStore } from '../store'
import { AlertsPanel, NudgeBanner } from './AlertsPanel'
import { BottomStrip } from './BottomStrip'
import { EndReview } from './EndReview'
import { MeetingRecord } from './MeetingRecord'
import { TopBar } from './TopBar'
import { TranscriptPanel } from './TranscriptPanel'

export function Console() {
  const { session, loadError, loading, wsStatus } = useStore()
  const ended = session?.session.status === 'ended'

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
      )}
    </div>
  )
}
