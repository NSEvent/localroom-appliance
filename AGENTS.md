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
