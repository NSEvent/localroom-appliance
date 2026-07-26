// Transcription tab: the full-width live transcript plus the appliance audio
// controls, for validating that the mic and STT are working.
//
// The console tab is the demo screen (transcript | record | alerts). This tab
// is the diagnostic one: nothing competes with the transcript for width, and
// the device picker + level meter sit right beside it so a bad mic shows up
// here rather than as a mysteriously empty meeting record.

import { AudioPanel } from './AudioPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { useStore } from '../store'

export function TranscriptionView() {
  const { session, health } = useStore()
  const utterances = session?.utterances ?? []
  const asrReady = health?.asr.status !== 'down'
  const asrLabel = health?.asr.model ?? health?.asr.provider ?? 'unknown'

  return (
    <div className="transcription-view">
      <div className="transcription-main">
        <TranscriptPanel />
      </div>
      <div className="transcription-side">
        <AudioPanel />
        <div className="stt-status">
          <div className="stt-row">
            <span className="stt-key">Recognizer</span>
            <span className="stt-val">{asrLabel}</span>
          </div>
          <div className="stt-row">
            <span className="stt-key">Status</span>
            <span className={`stt-val ${asrReady ? 'good' : 'bad'}`}>
              {asrReady ? 'ready' : 'not ready'}
            </span>
          </div>
          <div className="stt-row">
            <span className="stt-key">Utterances</span>
            <span className="stt-val">{utterances.length}</span>
          </div>
          <p className="audio-note dim">
            Silence produces no utterance — that is expected, not a failure. Lines appear
            only when speech is detected.
          </p>
        </div>
      </div>
    </div>
  )
}
