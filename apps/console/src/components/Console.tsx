// Live console (/session/{id}) — the demo screen. Layout per ui-spec §2:
// top bar / transcript | meeting record | alerts + nudge / bottom strip.
// When session.status === "ended" it reflows into the end-meeting review.

import { useEffect } from 'react'
import { useStore } from '../store'
import { AlertsPanel, NudgeBanner } from './AlertsPanel'
import { BottomStrip } from './BottomStrip'
import { EndReview } from './EndReview'
import { MeetingRecord } from './MeetingRecord'
import { TopBar } from './TopBar'
import { TranscriptPanel } from './TranscriptPanel'

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
