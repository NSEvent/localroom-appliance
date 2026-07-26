const $ = (selector) => document.querySelector(selector);
const state = {
  id: crypto.randomUUID(),
  roomId: "",
  name: "",
  stream: null,
  socket: null,
  peers: new Map(),
  roster: new Map(),
  recorder: null,
  transcriptionActive: true,
  muted: false,
  cameraOff: false,
  startedAt: null,
  captions: [],
};
const rtcConfig = { iceServers: [] };

$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.name = $("#display-name").value.trim();
  state.roomId = $("#room-code").value.trim().toUpperCase();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    enterMeeting();
  } catch (error) {
    toast(location.protocol === "http:" && location.hostname !== "localhost"
      ? "Microphone requires HTTPS on LAN devices."
      : "Camera and microphone permission are required.");
  }
});

function enterMeeting() {
  $("#lobby").classList.add("hidden");
  $("#meeting").classList.remove("hidden");
  $("#meeting-code-label").textContent = state.roomId;
  state.startedAt = Date.now();
  addVideoTile(state.id, state.name, state.stream, true);
  monitorSpeaking(state.id, state.stream);
  connectSocket();
  beginTranscription();
  checkHealth();
  setInterval(updateClock, 1000);
  setInterval(checkHealth, 15000);
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.socket = new WebSocket(`${protocol}//${location.host}/signal`);
  state.socket.addEventListener("open", () => send({ type: "join", id: state.id, name: state.name, roomId: state.roomId }));
  state.socket.addEventListener("message", async ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "welcome") {
      for (const participant of message.participants) {
        state.roster.set(participant.id, participant);
        await createPeer(participant.id, true);
      }
    } else if (message.type === "participant-joined") {
      state.roster.set(message.participant.id, message.participant);
      toast(`${message.participant.name} joined`);
    } else if (message.type === "signal") {
      await handleSignal(message.from, message.data);
    } else if (message.type === "participant-left") {
      removePeer(message.id);
    } else if (message.type === "roster") {
      state.roster = new Map(message.participants.map((p) => [p.id, p]));
      updateRoster();
    } else if (message.type === "caption") {
      showCaption(message);
    } else if (message.type === "reaction") {
      showReaction(message.emoji);
    }
  });
  state.socket.addEventListener("close", () => toast("Reconnecting to meeting…"));
}

async function createPeer(peerId, initiator) {
  if (state.peers.has(peerId)) return state.peers.get(peerId);
  const peer = new RTCPeerConnection(rtcConfig);
  state.peers.set(peerId, peer);
  for (const track of state.stream.getTracks()) peer.addTrack(track, state.stream);
  peer.onicecandidate = ({ candidate }) => candidate && send({ type: "signal", to: peerId, data: { candidate } });
  peer.ontrack = ({ streams: [stream] }) => {
    const person = state.roster.get(peerId);
    addVideoTile(peerId, person?.name || "Guest", stream, false);
    monitorSpeaking(peerId, stream);
  };
  peer.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(peer.connectionState)) removePeer(peerId);
  };
  if (initiator) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: "signal", to: peerId, data: { description: peer.localDescription } });
  }
  return peer;
}

async function handleSignal(from, data) {
  const peer = await createPeer(from, false);
  if (data.description) {
    await peer.setRemoteDescription(data.description);
    if (data.description.type === "offer") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ type: "signal", to: from, data: { description: peer.localDescription } });
    }
  } else if (data.candidate) {
    try { await peer.addIceCandidate(data.candidate); } catch {}
  }
}

function send(message) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(message));
}

function addVideoTile(id, name, stream, local) {
  let tile = document.getElementById(`tile-${id}`);
  if (!tile) {
    tile = document.createElement("article");
    tile.id = `tile-${id}`;
    tile.className = `video-tile ${local ? "local" : "remote"}`;
    tile.innerHTML = `<div class="avatar">${initials(name)}</div><video autoplay playsinline ${local ? "muted" : ""}></video><div class="tile-shade"></div><div class="nameplate"><span class="mic-state">♩</span><span>${escapeHtml(name)}${local ? " (You)" : ""}</span></div><div class="audio-ring"></div>`;
    $("#video-grid").append(tile);
  }
  tile.querySelector("video").srcObject = stream;
  updateGrid();
  updateParticipantCount();
}

function removePeer(id) {
  const name = state.roster.get(id)?.name;
  state.peers.get(id)?.close();
  state.peers.delete(id);
  state.roster.delete(id);
  document.getElementById(`tile-${id}`)?.remove();
  if (name) toast(`${name} left`);
  updateGrid();
  updateParticipantCount();
}

function updateGrid() {
  $("#video-grid").classList.toggle("solo", $("#video-grid").children.length === 1);
}

function updateRoster() {
  for (const person of state.roster.values()) {
    const tile = document.getElementById(`tile-${person.id}`);
    tile?.classList.toggle("camera-off", person.cameraOff);
    if (tile) tile.querySelector(".mic-state").textContent = person.muted ? "×" : "♩";
  }
  updateParticipantCount();
}

function beginTranscription() {
  if (!state.stream.getAudioTracks().length) return;
  const audioStream = new MediaStream(state.stream.getAudioTracks());
  const context = new AudioContext();
  const source = context.createMediaStreamSource(audioStream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  let samples = [];
  let segmentStarted = performance.now();
  processor.onaudioprocess = ({ inputBuffer }) => {
    if (!state.transcriptionActive || state.muted) return;
    samples.push(new Float32Array(inputBuffer.getChannelData(0)));
    if (performance.now() - segmentStarted >= 4200) {
      const segment = samples;
      samples = [];
      segmentStarted = performance.now();
      transcribe(encodeWav(segment, context.sampleRate));
    }
  };
  source.connect(processor);
  processor.connect(context.destination);
}

async function transcribe(blob) {
  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": blob.type, "x-participant-id": state.id, "x-room-id": state.roomId },
      body: blob,
    });
    if (!response.ok) throw new Error();
  } catch {
    setAsrState(false, "Local AI reconnecting");
  }
}

function showCaption(caption) {
  if (!caption.text) return;
  state.captions.push(caption);
  $("#transcript .empty-state")?.remove();
  const entry = document.createElement("div");
  entry.className = "transcript-entry";
  entry.innerHTML = `<div class="meta"><span class="speaker-dot"></span><b>${escapeHtml(caption.name)}</b><span>${new Date(caption.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span class="latency">${caption.latencyMs}ms local</span></div><p>${escapeHtml(caption.text)}</p>`;
  $("#transcript").append(entry);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
  $("#caption-speaker").textContent = caption.name;
  $("#caption-text").textContent = caption.text;
  $("#caption-overlay").classList.remove("hidden");
  clearTimeout(showCaption.timeout);
  showCaption.timeout = setTimeout(() => $("#caption-overlay").classList.add("hidden"), 4500);
  updateBrief();
}

function updateBrief() {
  const all = state.captions.map((c) => c.text).join(" ");
  const decision = state.captions.findLast?.((c) => /\b(decide|agree|approved|ship|will)\b/i.test(c.text));
  const action = state.captions.findLast?.((c) => /\b(action|follow up|send|review|owner)\b/i.test(c.text));
  if (decision || action) {
    $("#meeting-brief").textContent = [
      decision ? `Decision: ${decision.text}` : "",
      action ? `Action: ${action.text}` : "",
    ].filter(Boolean).join(" ");
  } else if (all) {
    $("#meeting-brief").textContent = `${state.captions.length} live segment${state.captions.length === 1 ? "" : "s"} captured with speaker identity. Local summary builds as decisions emerge.`;
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const health = await response.json();
    const ok = health.asr?.status === "ok" && health.asr?.ready !== false;
    setAsrState(ok, ok ? "Dell AI online" : "Local AI unavailable");
    $("#model-label").textContent = ok
      ? `NVIDIA ${health.asr.model?.includes("parakeet") ? "Parakeet" : "ASR"} · ${health.asr.provider || "local"}`
      : "NVIDIA ASR · reconnecting";
  } catch {
    setAsrState(false, "Local AI unavailable");
  }
}

function setAsrState(ok, text) {
  $("#asr-state").textContent = text;
  $(".footer-right").classList.toggle("offline", !ok);
}

function monitorSpeaking(id, stream) {
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const sample = () => {
      analyser.getByteFrequencyData(data);
      const volume = data.reduce((sum, value) => sum + value, 0) / data.length;
      document.getElementById(`tile-${id}`)?.classList.toggle("speaking", volume > 18);
      requestAnimationFrame(sample);
    };
    sample();
  } catch {}
}

$("#mic-button").addEventListener("click", () => {
  state.muted = !state.muted;
  state.stream.getAudioTracks().forEach((track) => { track.enabled = !state.muted; });
  $("#mic-button").classList.toggle("off", state.muted);
  $("#mic-button small").textContent = state.muted ? "Unmute" : "Mute";
  sendState();
});
$("#camera-button").addEventListener("click", () => {
  state.cameraOff = !state.cameraOff;
  state.stream.getVideoTracks().forEach((track) => { track.enabled = !state.cameraOff; });
  $("#camera-button").classList.toggle("off", state.cameraOff);
  document.getElementById(`tile-${state.id}`)?.classList.toggle("camera-off", state.cameraOff);
  $("#camera-button small").textContent = state.cameraOff ? "Start video" : "Camera";
  sendState();
});
$("#share-button").addEventListener("click", async () => {
  const link = `${location.origin}/?room=${encodeURIComponent(state.roomId)}`;
  await navigator.clipboard.writeText(`Join my LocalRoom meeting: ${link}`);
  toast("Secure meeting link copied");
});
$("#reaction-button").addEventListener("click", () => {
  send({ type: "reaction", emoji: "👏" });
  showReaction("👏");
});
$("#transcript-button").addEventListener("click", togglePanel);
$("#close-panel").addEventListener("click", togglePanel);
$("#leave-button").addEventListener("click", () => location.reload());

function sendState() {
  send({ type: "state", muted: state.muted, cameraOff: state.cameraOff });
}
function togglePanel() {
  $(".intelligence-panel").classList.toggle("hidden");
  $("#transcript-button").classList.toggle("active");
}
function showReaction(emoji) {
  const el = document.createElement("span");
  el.className = "reaction";
  el.textContent = emoji;
  el.style.left = `${20 + Math.random() * 60}%`;
  $("#reaction-layer").append(el);
  setTimeout(() => el.remove(), 2600);
}
function updateClock() {
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  $("#clock").textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function updateParticipantCount() {
  const count = $("#video-grid").children.length;
  $("#participant-count").textContent = `${count} participant${count === 1 ? "" : "s"}`;
}
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => $("#toast").classList.remove("show"), 2200);
}

function encodeWav(chunks, inputRate) {
  const joined = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const outputRate = 16000;
  const ratio = inputRate / outputRate;
  const sampleCount = Math.floor(joined.length / ratio);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (at, text) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    const sourceIndex = index * ratio;
    const low = Math.floor(sourceIndex);
    const fraction = sourceIndex - low;
    const sample = joined[low] * (1 - fraction) + (joined[low + 1] || joined[low]) * fraction;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam) $("#room-code").value = roomParam.toUpperCase();
