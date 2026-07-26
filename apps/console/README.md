# LocalRoom Console

Projector/operator surface for the LocalRoom appliance.

```bash
npm ci
npm run dev
```

Vite serves `/console/` and proxies REST/WebSocket traffic to LocalRoom on
`127.0.0.1:4173`. Production uses the committed `dist/` from the monorepo’s
single Node process.

The console consumes the authoritative meeting record—utterances, decisions,
actions, questions, alerts, agenda, parking lot, facilitator nudge, Q&A, and
closing/export state. Host edits round-trip through the appliance API and
survive reloads.
