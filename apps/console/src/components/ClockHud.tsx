// Debug HUD for the one virtual clock — the only thing this lane renders.
// Behind ?clockhud=1, never on the projector by default. It exists so the
// pause proof is observable: freeze the clock, screenshot twice ten seconds
// apart, and every field here must be byte-identical.

import { useClockControl, useMeetingMs, useNowMs } from '../clock.ts'
import { mmss } from '../clock-core.ts'

export function ClockHud() {
  const meetingMs = useMeetingMs()
  const nowMs = useNowMs()
  const { mode, playing, beatIndex, beat, beatCount } = useClockControl()

  return (
    <div className="clock-hud" role="status" aria-label="Virtual clock debug">
      <div className="clock-hud-row">
        <span className="clock-hud-key">LIVE</span>
        <span className="clock-hud-val strong">{mmss(meetingMs / 1000)}</span>
        <span className={`clock-hud-mode ${mode}`}>{mode}</span>
        <span className={`clock-hud-state ${playing ? 'playing' : 'paused'}`}>
          {playing ? '▶ playing' : '⏸ paused'}
        </span>
      </div>
      <div className="clock-hud-row">
        <span className="clock-hud-key">beat</span>
        <span className="clock-hud-val">
          {beatIndex < 0 ? `— / ${beatCount}` : `${beatIndex + 1} / ${beatCount}`}
          {beat ? ` · ${beat.label}` : ''}
        </span>
      </div>
      <div className="clock-hud-row">
        <span className="clock-hud-key">now</span>
        <span className="clock-hud-val">{nowMs}</span>
      </div>
      {mode === 'demo' && (
        <div className="clock-hud-foot">Space pause · ←/→ beat · one clock, no component timers</div>
      )}
    </div>
  )
}
