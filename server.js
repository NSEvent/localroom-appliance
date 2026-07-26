import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import express from "express";
import { createHealthSnapshot } from "./appliance-health.js";
import { selectSpeakerCandidate } from "./audio-arbitration.js";
import { ConsoleHub, createConsoleRouter } from "./console-api.js";
import { answerFromMemory, demoMemory, extractWakePrompt, RoomIntelligence } from "./localroom-core.js";
import { AuditTrail, LocalModelService, LocalSpeechService } from "./local-services.js";
import { WorkspaceActions } from "./workspace-actions.js";
import { corpusStats } from "./corpus-index.js";
import { Glossary, RecognitionArchive } from "./transcript-quality.js";

const PORT = Number(process.env.PORT || 4173);
const ASR_URL = (process.env.ASR_URL || "http://172.16.10.189:8001").replace(/\/$/, "");
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const DATA_DIR = process.env.LOCALROOM_DATA_DIR || path.join(import.meta.dirname, "data");
const GENERATED_DIR = path.join(DATA_DIR, "generated");
const intelligence = new RoomIntelligence();
const consoleHub = new ConsoleHub(intelligence);
const models = new LocalModelService();
const speech = new LocalSpeechService({ outputDir: GENERATED_DIR });
const audit = new AuditTrail(path.join(DATA_DIR, "audit.jsonl"));
const workspace = new WorkspaceActions(path.join(DATA_DIR, "workspace"));
const glossary = new Glossary([
  { term: "LocalRoom", aliases: ["local room"] },
  { term: "Pork Chop", aliases: ["porkchop", "pork shop"] },
  { term: "Project Iliad", aliases: ["project illy ad", "project iliot"] },
  { term: "Qwen", aliases: ["Quinn", "queen"] },
  { term: "Nemotron", aliases: ["nemo tron"] },
  { term: "Parakeet", aliases: ["parrot key"] },
  { term: "OpenShell", aliases: ["open shell"] },
]);
const recognitions = new RecognitionArchive(path.join(DATA_DIR, "recognitions.jsonl"));
const pendingAudioWindows = new Map();
let modelCatalog = [];
const voiceCatalog = [
  { id: "af_heart", label: "Heart", role: "Warm facilitator" },
  { id: "af_bella", label: "Bella", role: "Clear analyst" },
  { id: "am_michael", label: "Michael", role: "Composed advisor" },
  { id: "am_adam", label: "Adam", role: "Direct operator" },
];
const healthSnapshot = createHealthSnapshot({
  asrURL: ASR_URL,
  models,
  intelligence,
  voiceCatalog,
  audit,
  demoMemory,
  corpusStats,
  dataDir: DATA_DIR,
  workspace,
  glossary,
  recognitions,
  onModels: (availableModels) => { modelCatalog = availableModels; },
});

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(import.meta.dirname, "public")));
app.use("/console", express.static(path.join(import.meta.dirname, "apps/console/dist")));
app.use("/generated", express.static(GENERATED_DIR, { maxAge: "1h" }));
app.use("/api", express.json({ limit: "1mb" }));

app.get("/localroom-ca.pem", (_request, response) => {
  const certificate = process.env.CA_CERT_PATH;
  if (!certificate || !fs.existsSync(certificate)) return response.status(404).send("Certificate setup is not enabled.");
  response.download(certificate, "localroom-ca.pem");
});

app.get("/health", async (_request, response) => {
  response.json(await healthSnapshot(_request));
});

app.get("/api/rooms/:roomId", (request, response) => {
  response.json(intelligence.snapshot(clean(request.params.roomId, 80)));
});

app.get("/api/memory", (_request, response) => response.json(demoMemory));
app.get("/api/audit", (_request, response) => response.json(audit.read()));

app.post("/api/demo/caption", (request, response) => {
  const roomId = clean(request.body.roomId, 80);
  const caption = makeCaption({
    participantId: clean(request.body.participantId, 80) || "demo-speaker",
    name: clean(request.body.name, 50) || "Maya Chen",
    text: cleanText(request.body.text, 1200),
    latencyMs: 218,
    attributionConfidence: 0.98,
  });
  publishCaption(roomId, caption);
  response.json({ caption, room: intelligence.snapshot(roomId) });
});

app.post("/api/rooms/:roomId/agent", async (request, response) => {
  const roomId = clean(request.params.roomId, 80);
  const question = cleanText(request.body.question, 1000);
  const actorName = clean(request.body.actorName, 50) || "Participant";
  if (!question) return response.status(400).json({ error: "Question required" });
  try {
    const result = await answerAgent(roomId, question, actorName);
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

app.post("/api/rooms/:roomId/end", (request, response) => {
  const roomId = clean(request.params.roomId, 80);
  const brief = performEndMeeting(roomId, clean(request.body.actorName, 50) || "Organizer");
  response.json(brief);
});

app.post("/api/transcribe", express.raw({ type: "*/*", limit: MAX_AUDIO_BYTES }), async (request, response) => {
  const participantId = clean(request.header("x-participant-id"), 80);
  const roomId = clean(request.header("x-room-id"), 80);
  const participant = intelligence.room(roomId).participants.get(participantId);
  if (!participant || !Buffer.isBuffer(request.body) || request.body.length < 512) {
    return response.status(400).json({ error: "Invalid audio stream." });
  }
  try {
    const wav = await normalizeAudio(request.body);
    queueAudioCandidate({
      roomId, participantId, participant, wav, response,
      started: performance.now(),
      windowId: clean(request.header("x-audio-window"), 30),
      snrDb: Number(request.header("x-audio-snr-db")),
    });
  } catch (error) {
    response.status(502).json({ error: "Dell ASR unavailable", detail: error.message });
  }
});

app.use("/api", createConsoleRouter({
  intelligence,
  consoleHub,
  health: healthSnapshot,
  publishDemoCaption,
  endMeeting: performEndMeeting,
}));

app.get(/^\/console(?:\/.*)?$/, (_request, response) => {
  response.sendFile(path.join(import.meta.dirname, "apps/console/dist/index.html"));
});

const tlsKey = process.env.TLS_KEY;
const tlsCert = process.env.TLS_CERT;
const server = tlsKey && tlsCert
  ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, app)
  : http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localroom").pathname;
  if (pathname === "/signal") {
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
    return;
  }
  if (consoleHub.upgrade(request, socket, head, pathname)) return;
  socket.destroy();
});

wss.on("connection", (socket, request) => {
  socket.clientAddress = request.socket.remoteAddress;
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("message", (data) => handleSocketMessage(socket, data));
  socket.on("close", () => removeSocket(socket));
});

async function handleSocketMessage(socket, data) {
  let message;
  try { message = JSON.parse(data); } catch { return; }
  if (message.type === "join") return joinRoom(socket, message);
  const meta = socket.meta;
  if (!meta) return;
  if (message.type === "signal" && message.to) {
    const target = intelligence.room(meta.roomId).participants.get(clean(message.to, 80));
    target?.socket.send(JSON.stringify({ type: "signal", from: meta.id, data: message.data }));
  } else if (message.type === "state") {
    updateParticipantState(meta, message);
  } else if (message.type === "reaction") {
    broadcast(meta.roomId, { type: "reaction", from: meta.id, emoji: allowedEmoji(message.emoji) });
  } else if (message.type === "card-action") {
    await resolveCard(meta, message);
  } else if (message.type === "select-model") {
    await selectModel(meta, message.modelId);
  } else if (message.type === "select-voice") {
    selectVoice(meta, message.voiceId);
  }
}

function joinRoom(socket, message) {
  const roomId = clean(message.roomId, 80);
  const id = clean(message.id, 80);
  const name = clean(message.name, 50) || "Guest";
  if (!roomId || !id) return;
  socket.meta = { roomId, id, name };
  const room = intelligence.room(roomId);
  const existing = [...room.participants.values()].map(publicParticipant);
  intelligence.addParticipant(roomId, { id, name, muted: false, cameraOff: false, socket });
  socket.send(JSON.stringify({
    type: "welcome",
    participants: existing,
    room: intelligence.snapshot(roomId),
    models: modelCatalog,
    voices: voiceCatalog,
    memory: demoMemory,
  }));
  broadcast(roomId, { type: "participant-joined", participant: { id, name } }, id);
  broadcastRoom(roomId);
}

async function resolveCard(meta, message) {
  const result = intelligence.resolve(meta.roomId, {
    cardId: clean(message.cardId, 80),
    version: Number(message.version),
    action: clean(message.action, 80),
    actorId: meta.id,
    actorName: meta.name,
  });
  if (!result.ok) {
    return sendTo(meta.id, meta.roomId, { type: "card-conflict", reason: result.reason, card: result.card });
  }
  const card = result.card;
  audit.append({
    kind: card.type === "security" ? "tool_action" : "agent_run",
    status: card.type === "security" ? "blocked" : "completed",
    actor: meta.name,
    action: message.action,
    cardId: card.id,
    roomId: meta.roomId,
    redaction: "metadata_only",
  });
  broadcastRoom(meta.roomId);
  if (card.type === "security") {
    const proof = await audit.proveBlockedEgress();
    broadcast(meta.roomId, { type: "security-proof", proof });
  }
}

async function selectModel(meta, modelId) {
  if (!modelCatalog.length) modelCatalog = await models.models();
  const result = intelligence.selectModel(meta.roomId, clean(modelId, 80), meta.name, modelCatalog);
  if (!result.ok) return sendTo(meta.id, meta.roomId, { type: "model-error", reason: result.reason });
  broadcastRoom(meta.roomId);
}

function selectVoice(meta, voiceId) {
  const result = intelligence.selectVoice(meta.roomId, clean(voiceId, 80), meta.name, voiceCatalog);
  if (!result.ok) return sendTo(meta.id, meta.roomId, { type: "voice-error", reason: result.reason });
  broadcastRoom(meta.roomId);
}

async function answerAgent(roomId, question, actorName) {
  const room = intelligence.room(roomId);
  broadcast(roomId, {
    type: "agent-status", status: "retrieving", detail: "Searching local meeting memory", question, actorName,
  });
  const taskCard = intelligence.proposeTaskFromPrompt(roomId, question, actorName);
  let answer = taskCard ? {
    answer: `I captured “${taskCard.title}” for ${taskCard.metadata.owner}${taskCard.metadata.due === "No deadline captured" ? ". Confirm the shared task card to start monitoring it." : ` by ${taskCard.metadata.due}. Confirm the shared task card to start monitoring it.`}`,
    citations: [],
  } : answerFromMemory(question);
  let modelInfo = { model: room.model, latencyMs: 34, grounded: true };
  if (!answer) {
    const transcript = room.captions.slice(-16).map((item) => `${item.name}: ${item.text}`).join("\n");
    const memory = demoMemory.map((page) =>
      `[[${page.slug}]] ${page.summary}\n${page.facts.join("\n")}`).join("\n\n");
    const result = await models.answer(room.model, { question, transcript, memory });
    answer = { answer: result.text, citations: extractCitations(result.text) };
    modelInfo = result;
  }
  const event = {
    type: "agent-answer",
    id: crypto.randomUUID(),
    name: "LocalRoom Agent",
    question,
    text: answer.answer,
    citations: answer.citations,
    at: new Date().toISOString(),
    ...modelInfo,
  };
  intelligence.addCaption(roomId, makeCaption({
    id: event.id,
    participantId: "localroom-agent",
    name: "LocalRoom Agent",
    text: event.text,
    latencyMs: event.latencyMs,
    attributionConfidence: 1,
    source: "agent",
  }));
  intelligence.room(roomId).timeline.unshift({
    id: event.id, at: event.at, kind: "agent",
    title: `Answered ${actorName}'s question`, actor: "LocalRoom Agent",
  });
  audit.append({ kind: "agent_run", status: "completed", actor: "LocalRoom Agent", action: "answer", roomId, model: event.model });
  broadcast(roomId, event);
  broadcastRoom(roomId);
  synthesizeAnswer(roomId, event, room.voice);
  return event;
}

function publishCaption(roomId, caption) {
  intelligence.addCaption(roomId, caption);
  broadcast(roomId, caption);
  const utterance = intelligence.room(roomId).record.utterances.find((item) => item.id === caption.id);
  if (utterance) consoleHub.broadcast(roomId, { type: "utterance.created", utterance });
  broadcastRoom(roomId);
  const question = extractWakePrompt(caption.text);
  if (question) {
    console.log(`[wake] Pork Chop detected for room ${roomId}; participant ${caption.participantId}`);
    broadcast(roomId, {
      type: "agent-status", status: "wake-detected", detail: "Pork Chop heard you", question, actorName: caption.name,
    });
    answerAgent(roomId, question, caption.name).catch((error) =>
      broadcast(roomId, { type: "agent-error", message: error.message }));
  }
}

function publishDemoCaption(roomId, item) {
  const caption = makeCaption({
    id: clean(item.id, 80) || crypto.randomUUID(),
    participantId: clean(item.source_id, 80) || clean(item.speaker, 80) || "demo-speaker",
    name: clean(item.speaker || item.name, 50) || "Participant",
    text: cleanText(item.text, 1200),
    latencyMs: 218,
    attributionConfidence: 0.98,
    demo: true,
  });
  publishCaption(roomId, caption);
  return intelligence.room(roomId).record.utterances.find((entry) => entry.id === caption.id) || null;
}

function performEndMeeting(roomId, actorName) {
  const brief = intelligence.endMeeting(roomId, actorName);
  brief.artifacts = workspace.execute(roomId, brief);
  audit.append({ kind: "agent_run", status: "completed", actor: "LocalRoom Agent", action: "meeting-handoff", roomId });
  broadcast(roomId, { type: "meeting-ended", brief, room: intelligence.snapshot(roomId) });
  broadcastRoom(roomId);
  return brief;
}

async function synthesizeAnswer(roomId, event, voice) {
  broadcast(roomId, {
    type: "agent-status", status: "preparing-voice", detail: "Answer ready · preparing local voice",
  });
  let audioURL = null;
  try { audioURL = await speech.synthesize(event.text, voice); } catch {}
  broadcast(roomId, { type: "agent-audio", id: event.id, audioURL });
}

function queueAudioCandidate(candidate) {
  const serverWindow = Math.floor(Date.now() / 2000);
  const clientWindow = Number(candidate.windowId);
  const safeWindow = Number.isFinite(clientWindow) && Math.abs(clientWindow - serverWindow) <= 1 ? clientWindow : serverWindow;
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
      candidate.response.json({ suppressed: true, reason: selection.reason, confidence: selection.confidence });
    }
  }
  if (!selection.winner) return;
  const winner = selection.winner;
  try {
    const form = new FormData();
    form.append("file", new Blob([winner.wav], { type: "audio/wav" }), `${winner.participantId}.wav`);
    const upstream = await fetch(`${ASR_URL}/transcribe`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok) throw new Error(`ASR ${upstream.status}`);
    const result = await upstream.json();
    const rawText = String(result.text || "").trim();
    const correction = glossary.correct(rawText);
    const latencyMs = Math.round(performance.now() - winner.started);
    recognitions.append({
      roomId: winner.roomId,
      participantId: winner.participantId,
      model: result.model,
      provider: result.provider || "NVIDIA Parakeet",
      rawText,
      text: correction.text,
      latencyMs,
      correction: correction.accepted ? correction.changes : null,
    });
    const caption = makeCaption({
      participantId: winner.participantId,
      name: winner.participant.name,
      text: correction.text,
      rawText: correction.accepted ? rawText : null,
      correction: correction.accepted ? correction.changes : null,
      latencyMs,
      attributionConfidence: selection.confidence,
      separationDb: selection.separationDb,
    });
    if (caption.text) publishCaption(winner.roomId, caption);
    winner.response.json(caption);
  } catch (error) {
    winner.response.status(502).json({ error: "Dell ASR unavailable", detail: error.message });
  }
}

function updateParticipantState(meta, message) {
  const participant = intelligence.room(meta.roomId).participants.get(meta.id);
  if (!participant) return;
  participant.muted = Boolean(message.muted);
  participant.cameraOff = Boolean(message.cameraOff);
  broadcastRoom(meta.roomId);
}

function broadcastRoom(roomId) {
  broadcast(roomId, { type: "room-state", room: intelligence.snapshot(roomId) });
  consoleHub.broadcastState(roomId);
}

function broadcast(roomId, payload, exceptId) {
  for (const participant of intelligence.room(roomId).participants.values()) {
    if (participant.id !== exceptId && participant.socket.readyState === 1) participant.socket.send(JSON.stringify(payload));
  }
}

function sendTo(participantId, roomId, payload) {
  const participant = intelligence.room(roomId).participants.get(participantId);
  if (participant?.socket.readyState === 1) participant.socket.send(JSON.stringify(payload));
}

function removeSocket(socket) {
  const meta = socket.meta;
  if (!meta) return;
  intelligence.removeParticipant(meta.roomId, meta.id);
  broadcast(meta.roomId, { type: "participant-left", id: meta.id });
  broadcastRoom(meta.roomId);
}

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) socket.terminate();
    socket.isAlive = false;
    socket.ping();
  }
}, 25_000).unref();

setInterval(() => {
  const monitor = workspace.monitor();
  if (monitor.commitments) {
    audit.append({
      kind: "agent_run", status: "completed", actor: "LocalRoom Agent",
      action: "commitment-monitor-sweep", commitments: monitor.commitments,
    });
  }
}, 60_000).unref();

server.listen(PORT, "0.0.0.0", async () => {
  modelCatalog = await models.models();
  console.log(`LocalRoom ready at ${tlsKey && tlsCert ? "https" : "http"}://localhost:${PORT}`);
  console.log(`Dell ASR: ${ASR_URL}; local models: ${modelCatalog.filter((model) => model.available).map((model) => model.label).join(", ") || "probing"}`);
});

function makeCaption(values) {
  return { type: "caption", id: crypto.randomUUID(), at: new Date().toISOString(), ...values };
}

function normalizeAudio(input) {
  if (input.subarray(0, 4).toString("ascii") === "RIFF" && input.subarray(8, 12).toString("ascii") === "WAVE") return Promise.resolve(input);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"]);
    let errors = "";
    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => { errors += chunk; });
    ffmpeg.on("error", () => reject(new Error("Unsupported audio format")));
    ffmpeg.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(errors.trim() || `ffmpeg exited ${code}`)));
    ffmpeg.stdin.end(input);
  });
}

function clean(value, length) {
  return String(value || "").replace(/[^\w .@:/-]/g, "").slice(0, length);
}
function cleanText(value, length) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, length);
}
function publicParticipant({ socket: _socket, ...participant }) {
  return participant;
}
function allowedEmoji(value) {
  return ["👏", "👍", "❤️"].includes(value) ? value : "👏";
}
function extractCitations(text) {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => `[[${match[1]}]]`);
}
