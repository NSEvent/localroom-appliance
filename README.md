# LocalRoom

LocalRoom is a LAN-only WebRTC meeting workspace with a private AI participant. It
transcribes each participant separately, proposes synchronized decisions and commitments,
conducts collective polls, answers from institutional memory, governs sensitive actions,
and persists follow-up work after participants leave.

## Demo endpoint

`https://172.16.10.189:4174/?room=DELL-DEMO`

The iOS wrapper auto-joins this endpoint. Browser clients must trust the event's local
certificate once; `/setup.html` contains the Windows flow.

## What is real

- Browser-to-browser WebRTC media on the LAN.
- Isolated 16 kHz transcription streams and speaker arbitration.
- NVIDIA Parakeet ASR on the Dell Pro.
- Room-authoritative cards with atomic first-action-wins semantics.
- Multi-participant polls that close only after all current participants vote.
- Three selectable local LLMs: Qwen 30B, Nemotron 30B, Nemotron 4B.
- Four selectable Kokoro 82M voices; WAV synthesis never leaves the box.
- Wiki-style institutional memory grounded in a local copy of the public FTC Amazon Prime complaint.
- Classification/recipient policy that removes unsafe send actions.
- A real OpenShell sandbox egress attempt whose 403 denial is shown in the meeting.
- Meeting brief, task JSON, email draft, and calendar invite written to local disk.
- A recurring commitment-monitor sweep recorded in the append-only audit trail.

Restricted Project Iliad artifacts and meeting dialogue are synthetic. Historical context
is a simulation based on public court records.

## Service map

| Port | Service |
|---|---|
| 4173 | LocalRoom HTTP |
| 4174 | LocalRoom HTTPS |
| 8001 | Parakeet ASR |
| 8003 | Kokoro TTS |
| 8080 | Qwen 30B |
| 8092 | Nemotron 30B |
| 8093 | Nemotron 4B |
| 8100 | NemoClaw/OpenShell gateway |

Persistent app data lives under `data/`: the FTC source corpus, metadata-only audit JSONL,
generated speech, and workspace handoff artifacts.

## Local gate

```bash
npm run check
npm test
```

## GB10 recovery

```bash
ssh gb10
tmux list-sessions
curl -sk https://127.0.0.1:4174/health | python3 -m json.tool
```

Expected sessions: `localroom`, `localroom-https`, `localroom-ai`, `meety`, `nemoclaw`.
Do not stop `meety`; it owns the shared ASR service.

To restart only LocalRoom:

```bash
tmux kill-session -t localroom
tmux kill-session -t localroom-https
tmux new-session -d -s localroom '$HOME/hack/localroom/start-localroom.sh 4173'
tmux new-session -d -s localroom-https '$HOME/hack/localroom/start-localroom.sh 4174'
```

The lower-left `⌘` opens the discreet demo director. It injects transcript moments through
the same server path as live ASR; cards, policies, votes, actions, and synchronization are
not mocked.

Say **“Wagyu, …”** to address the room agent hands-free. The wake-word parser also accepts
the common ASR rendering “wag you”; ordinary conversation does not trigger an agent reply.
