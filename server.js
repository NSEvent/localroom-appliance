import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import express from "express";
import { selectSpeakerCandidate } from "./audio-arbitration.js";

const PORT = Number(process.env.PORT || 4173);
const ASR_URL = (process.env.ASR_URL || "http://172.16.10.189:8001").replace(/\/$/, "");
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const rooms = new Map();
const pendingAudioWindows = new Map();

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(import.meta.dirname, "public")));
app.get("/localroom-ca.pem", (_request, response) => {
  const certificate = process.env.CA_CERT_PATH;
  if (!certificate || !fs.existsSync(certificate)) {
    return response.status(404).send("Certificate setup is not enabled.");
  }
  response.download(certificate, "localroom-ca.pem");
});
app.get("/health", async (_request, response) => {
  try {
    const upstream = await fetch(`${ASR_URL}/health`, { signal: AbortSignal.timeout(1800) });
    response.json({
      status: "ok",
      local: true,
      asr: upstream.ok ? await upstream.json() : { status: "unavailable" },
    });
  } catch {
    response.json({ status: "ok", local: true, asr: { status: "offline" } });
  }
});

app.post("/api/transcribe", express.raw({ type: "*/*", limit: MAX_AUDIO_BYTES }), async (request, response) => {
  const participantId = clean(request.header("x-participant-id"), 80);
  const roomId = clean(request.header("x-room-id"), 80);
  const participant = rooms.get(roomId)?.get(participantId);
  if (!participant || !Buffer.isBuffer(request.body) || request.body.length < 512) {
    return response.status(400).json({ error: "Invalid audio stream." });
  }

  try {
    const wav = await normalizeAudio(request.body);
    queueAudioCandidate({
      roomId,
      participantId,
      participant,
      wav,
      response,
      started: performance.now(),
      windowId: clean(request.header("x-audio-window"), 30),
      snrDb: Number(request.header("x-audio-snr-db")),
    });
  } catch (error) {
    response.status(502).json({ error: "Dell ASR unavailable", detail: error.message });
  }
});

function queueAudioCandidate(candidate) {
  const serverWindow = Math.floor(Date.now() / 2000);
  const clientWindow = Number(candidate.windowId);
  const safeWindow = Number.isFinite(clientWindow) && Math.abs(clientWindow - serverWindow) <= 1
    ? clientWindow
    : serverWindow;
  const key = `${candidate.roomId}:${safeWindow}`;
  let pending = pendingAudioWindows.get(key);
  if (!pending) {
    pending = { candidates: [], timer: setTimeout(() => flushAudioWindow(key), 700) };
    pendingAudioWindows.set(key, pending);
  }
  pending.candidates.push(candidate);
}

async function flushAudioWindow(key) {
  const pending = pendingAudioWindows.get(key);
  if (!pending) return;
  pendingAudioWindows.delete(key);
  const selection = selectSpeakerCandidate(pending.candidates);

  for (const candidate of pending.candidates) {
    if (candidate !== selection.winner && !candidate.response.headersSent) {
      candidate.response.json({
        suppressed: true,
        reason: selection.reason,
        confidence: selection.confidence,
      });
    }
  }
  if (!selection.winner) {
    console.log(`audio arbitration ${key} suppressed=${selection.reason}`);
    return;
  }

  const winner = selection.winner;
  try {
    const form = new FormData();
    form.append("file", new Blob([winner.wav], { type: "audio/wav" }), `${winner.participantId}.wav`);
    const upstream = await fetch(`${ASR_URL}/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) throw new Error(`ASR ${upstream.status}`);
    const result = await upstream.json();
    const text = String(result.text || "").trim();
    const event = {
      type: "caption",
      id: crypto.randomUUID(),
      participantId: winner.participantId,
      name: winner.participant.name,
      text,
      at: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - winner.started),
      attributionConfidence: selection.confidence,
      separationDb: selection.separationDb,
    };
    if (text) broadcast(winner.roomId, event);
    winner.response.json(event);
  } catch (error) {
    winner.response.status(502).json({ error: "Dell ASR unavailable", detail: error.message });
  }
}

const tlsKey = process.env.TLS_KEY;
const tlsCert = process.env.TLS_CERT;
const server = tlsKey && tlsCert
  ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, app)
  : http.createServer(app);
const wss = new WebSocketServer({ server, path: "/signal" });

wss.on("connection", (socket, request) => {
  socket.clientAddress = request.socket.remoteAddress;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("message", (data) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }

    if (message.type === "join") {
      const roomId = clean(message.roomId, 80);
      const id = clean(message.id, 80);
      const name = clean(message.name, 50) || "Guest";
      if (!roomId || !id) return;
      socket.meta = { roomId, id };
      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      const room = rooms.get(roomId);
      const existing = [...room.values()].map(publicParticipant);
      room.set(id, { id, name, muted: false, cameraOff: false, socket });
      console.log(`join room=${roomId} participant=${name} address=${socket.clientAddress}`);
      socket.send(JSON.stringify({ type: "welcome", participants: existing }));
      broadcast(roomId, { type: "participant-joined", participant: { id, name } }, id);
      broadcastRoster(roomId);
      return;
    }

    const meta = socket.meta;
    if (!meta) return;
    if (message.type === "signal" && message.to) {
      const target = rooms.get(meta.roomId)?.get(clean(message.to, 80));
      target?.socket.send(JSON.stringify({ type: "signal", from: meta.id, data: message.data }));
    } else if (message.type === "state") {
      const participant = rooms.get(meta.roomId)?.get(meta.id);
      if (participant) {
        participant.muted = Boolean(message.muted);
        participant.cameraOff = Boolean(message.cameraOff);
        broadcastRoster(meta.roomId);
      }
    } else if (message.type === "reaction") {
      broadcast(meta.roomId, {
        type: "reaction",
        from: meta.id,
        emoji: ["👏", "👍", "❤️"].includes(message.emoji) ? message.emoji : "👏",
      });
    }
  });
  socket.on("close", () => removeSocket(socket));
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) socket.terminate();
    socket.isAlive = false;
    socket.ping();
  }
}, 25_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  const protocol = tlsKey && tlsCert ? "https" : "http";
  console.log(`LocalRoom ready at ${protocol}://localhost:${PORT}`);
  console.log(`Dell ASR: ${ASR_URL}`);
});

function clean(value, length) {
  return String(value || "").replace(/[^\w .@-]/g, "").slice(0, length);
}

function publicParticipant({ id, name, muted, cameraOff }) {
  return { id, name, muted, cameraOff };
}

function broadcast(roomId, payload, exceptId) {
  for (const participant of rooms.get(roomId)?.values() || []) {
    if (participant.id !== exceptId && participant.socket.readyState === 1) {
      participant.socket.send(JSON.stringify(payload));
    }
  }
}

function broadcastRoster(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcast(roomId, { type: "roster", participants: [...room.values()].map(publicParticipant) });
}

function removeSocket(socket) {
  const meta = socket.meta;
  if (!meta) return;
  const room = rooms.get(meta.roomId);
  console.log(`leave room=${meta.roomId} participant=${meta.id} address=${socket.clientAddress}`);
  room?.delete(meta.id);
  broadcast(meta.roomId, { type: "participant-left", id: meta.id });
  if (room?.size) broadcastRoster(meta.roomId);
  else rooms.delete(meta.roomId);
}

function normalizeAudio(input) {
  if (input.subarray(0, 4).toString("ascii") === "RIFF"
      && input.subarray(8, 12).toString("ascii") === "WAVE") {
    return Promise.resolve(input);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
    ]);
    let errors = "";
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => { errors += chunk; });
    ffmpeg.on("error", () => reject(new Error("Unsupported audio format; browser must send WAV")));
    ffmpeg.on("close", (code) => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(errors.trim() || `ffmpeg exited ${code}`)));
    ffmpeg.stdin.end(input);
  });
}
