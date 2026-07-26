# LocalRoom

**A meeting room that keeps the people—and the intelligence—in the room.**

LocalRoom is a LAN-only meeting appliance built for the 2026 Dell × NVIDIA
hackathon. Browsers and native iOS clients join over WebRTC. A Dell Pro with
NVIDIA GB10 transcribes each speaker, maintains a shared meeting record, catches
missing owners and unresolved questions, blocks unsafe disclosures, answers
from local institutional memory, and produces the handoff. No meeting content
needs a cloud AI API.

## The demo

1. Join from two participant devices. LocalRoom arbitrates nearby microphones
   and attributes captions to the right speaker.
2. Project `/console/`. Decisions, actions, questions, alerts, and parking-lot
   items assemble live from the same authoritative room state.
3. Ask **“Pork Chop, …”** for a private local-model answer.
4. Attempt to share restricted Project Iliad analysis externally. LocalRoom
   removes the unsafe action and records proof of the block.
5. Run **Closing Sweep**. Resolve the remaining owner/question, then export the
   brief and local workspace artifacts.

The event dialogue and Project Iliad material are synthetic. Historical context
uses public court records.

## One appliance, three surfaces

| Surface | Route / source | Job |
|---|---|---|
| Participant workspace | `/` · `public/` | WebRTC media, captions, shared cards, polls, private AI |
| Projector console | `/console/` · `apps/console/` | Live record, alerts, host corrections, closing sweep, export |
| Native client | `apps/ios/` | iPhone/iPad wrapper with configurable LAN endpoint |

One Node process owns signaling, room state, console WebSockets, transcription
coordination, policy, local model routing, and handoff artifacts. The committed
console build lets the event appliance run without a package registry or WAN.

## Run it

Requires Node 20+, npm, and `ffmpeg` for non-WAV browser audio. Xcode is only
needed for the iOS gate.

```bash
make setup
make run
```

Open:

- Participant: <http://127.0.0.1:4173/?room=DELL-DEMO>
- Projector: <http://127.0.0.1:4173/console/session/DELL-DEMO>

Seed the deterministic five-moment judge flow after the server starts:

```bash
make seed
```

Production appliance services can be supplied through `ASR_URL`, `QWEN_URL`,
`NEMOTRON_URL`, `FAST_MODEL_URL`, and `TTS_URL`. Local defaults target
Parakeet, Qwen 3 30B, and Nemotron endpoints on the appliance/LAN. `TLS_KEY`,
`TLS_CERT`, and `CA_CERT_PATH` enable the event HTTPS/certificate flow.

## Quality gate

```bash
make gate
```

The gate runs:

- syntax, console lint/typecheck/production build, and hosted-AI endpoint scan;
- 28 Node unit/contract tests;
- browser E2E with fake camera/microphone: host setup/recovery, WebRTC entry,
  policy block, live-console edits, Q&A, closing sweep, export, and iPhone layout;
- iOS app plus unit-test target `build-for-testing`.

CI repeats the web gate on Ubuntu and the iOS compile gate on macOS.

## What came from where

This monorepo preserves the useful history from all three team efforts:

- [`NSEvent/localroom`](https://github.com/NSEvent/localroom)—participant
  experience, WebRTC, private AI, policy, polls, and handoff.
- [`NSEvent/localroom-ios-app`](https://github.com/NSEvent/localroom-ios-app)—the
  native iPhone/iPad client, now under `apps/ios/`.
- [`outdoorsea/meety-local`](https://github.com/outdoorsea/meety-local)—the
  projector-console foundation and transcript-quality patterns, now integrated
  against LocalRoom’s single authority.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for imported MIT-licensed
portions.

## Source map

| File | Responsibility |
|---|---|
| `server.js` | HTTP/TLS entrypoint, signaling, audio, API wiring |
| `localroom-core.js` | cards, polls, policy, model/voice choice, handoff |
| `meeting-record.js` | authoritative decisions/actions/questions/alerts record |
| `console-api.js` | console REST and WebSocket compatibility layer |
| `transcript-quality.js` | glossary correction guard and recognition archive |
| `appliance-health.js` | local-runtime proof and appliance health |
| `local-services.js` | local model, speech, and append-only audit adapters |
| `audio-arbitration.js` | speaker selection across co-located microphones |
| `workspace-actions.js` | brief, task JSON, email draft, and calendar invite |
| `test/` | unit, contract, and browser end-to-end suites |

## License

Source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md)—free to read, build, and run
for noncommercial use. Commercial licenses: <https://thekevintang.gumroad.com/>.
