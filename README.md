# LocalRoom

Local-first, multi-participant WebRTC meeting client with one isolated
transcription stream per browser participant. Each browser emits independent
16 kHz mono WAV segments to the Dell Pro's local NVIDIA Parakeet ASR service.

## Run

```bash
npm install
ASR_URL=http://172.16.10.189:8001 npm start
```

Open `http://localhost:4173` in two browser windows. The meeting code connects
participants. Use headphones when both windows are on the same computer.

Browser camera/microphone access works on `localhost`. For separate LAN devices,
serve with a trusted certificate:

```bash
TLS_KEY=/path/to/key.pem TLS_CERT=/path/to/cert.pem npm start
```

Then open the HTTPS LAN URL on each device.

## Data path

```
Browser A ── WebRTC media ── Browser B
    │
    └── isolated 4.2s audio segments
          └── LocalRoom server (speaker identity + routing)
                └── Dell Pro :8001 (NVIDIA Parakeet)
                      └── speaker-attributed caption → room
```

No TURN server and no cloud services: this is intentionally LAN-first for the
hackathon demo.
