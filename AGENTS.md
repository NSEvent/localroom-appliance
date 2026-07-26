# LocalRoom appliance

Monorepo for the Dell × NVIDIA hackathon build.

## Surfaces

- `public/` — participant lobby, WebRTC room, private workspace.
- `apps/console/` — React projector/operator console, served at `/console/`.
- `apps/ios/` — native iPhone/iPad wrapper for the participant surface.
- `server.js` — HTTP/TLS entrypoint, signaling, audio arbitration, API wiring.
- `localroom-core.js` — room cards, polls, policy, models, handoff.
- `meeting-record.js` — authoritative structured operator record and alerts.
- `transcript-quality.js` — glossary repair guard and recognition history.
- `apps/console/src/clock.ts` — the one virtual clock (see below).

## One virtual clock

Every visible number in the console — LIVE mm:ss, "updated N ago", inference
age, UNANSWERED — derives from `apps/console/src/clock.ts`. It is the ONLY file
under `apps/console/src` allowed to call `Date.now`, `new Date()`,
`setInterval`, or `requestAnimationFrame`; `npm run check:console-clock` fails
the build otherwise. A stray clock in one panel keeps that panel counting while
the rest of the screen is paused, which desyncs the transcript from the clock
mid-demo.

Live mode anchors to `session.started_at` + wall time. Demo mode (`?demo=1`,
fixed at boot) advances by rAF × `DEMO_TIME_SCALE` only while playing: Space
pauses, ←/→ jump beat boundaries. `?clockhud=1` shows the debug readout. Beat
positions live in `apps/console/src/beats.ts`; the pure, testable half of the
clock is `apps/console/src/clock-core.ts`.

## Commands

```bash
make setup
make gate
make run
make seed
```

Use `127.0.0.1`, not `localhost`, for local automation. Judged runtime must
contain no cloud AI API. Keep each source file under roughly 500 lines.

The console build is committed because the event appliance must work offline.
After console source changes, run `npm run build:console`.

Tests:

- Node unit/contract: `npm test`
- Browser E2E: `npm run test:e2e`
- iOS app + unit-test compile: `npm run test:ios`
