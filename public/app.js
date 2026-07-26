import { MeetingMedia } from "./media.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  id: crypto.randomUUID(), roomId: "", name: "", room: null, models: [], voices: [], memory: [],
  media: null, startedAt: null, activeCardId: null, answeredCards: new Set(),
};

$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.name = $("#display-name").value.trim();
  state.roomId = $("#room-code").value.trim().toUpperCase();
  const button = $("#join-form button");
  button.disabled = true;
  button.innerHTML = "Opening private workspace… <span>●</span>";
  state.media = new MeetingMedia({
    id: state.id, roomId: state.roomId,
    onTile: addVideoTile,
    onRemove: removeTile,
    onSpeaking: (id, active) => document.getElementById(`tile-${id}`)?.classList.toggle("speaking", active),
    onState: renderRoom,
    onToast: toast,
    onASR: (ok) => setASR(ok, ok ? "Local AI ready" : "Local AI reconnecting"),
  });
  try { await state.media.request(); }
  catch {
    state.media.noMedia();
    toast("Joined without media—enable camera or microphone when ready.");
  }
  enterMeeting();
});

function enterMeeting() {
  $("#lobby").classList.add("hidden");
  $("#meeting").classList.remove("hidden");
  state.startedAt = Date.now();
  addVideoTile(state.id, state.name, state.media.stream, true);
  state.media.connect(state.name, handleMessage);
  checkHealth();
  setInterval(updateClock, 1000);
  setInterval(checkHealth, 15_000);
}

function handleMessage(message) {
  if (message.type === "welcome") {
    state.models = message.models || [];
    state.voices = message.voices || [];
    state.memory = message.memory || [];
    renderModels();
    renderVoices();
    renderMemory();
    renderRoom(message.room);
  } else if (message.type === "caption") {
    showCaption(message);
  } else if (message.type === "agent-status") {
    const status = {
      "wake-detected": ["thinking", "Pork Chop heard you"],
      retrieving: ["thinking", "Searching local memory…"],
      "preparing-voice": ["thinking", "Answer ready · preparing voice…"],
    }[message.status] || ["thinking", message.detail || "Working locally…"];
    setAgentState(status[0], status[1]);
  } else if (message.type === "agent-answer") {
    showAgentAnswer(message);
  } else if (message.type === "agent-audio") {
    playAgentAudio(message);
  } else if (message.type === "agent-error") {
    setAgentState("", "Listening for Pork Chop");
    toast(`Agent unavailable: ${message.message}`);
  } else if (message.type === "card-conflict") {
    toast(message.reason === "already-voted" ? "Your vote is already counted." : "Another participant resolved this first.");
  } else if (message.type === "security-proof") {
    toast(message.proof?.blocked ? "OpenShell independently verified the network denial." : "Policy denial recorded locally.");
  } else if (message.type === "meeting-ended") {
    showHandoff(message.brief);
  } else if (message.type === "model-error") {
    toast("That model is not currently loaded.");
  } else if (message.type === "voice-error") {
    toast("That voice is unavailable.");
  }
}

function renderRoom(room) {
  if (!room) return;
  state.room = room;
  for (const caption of room.captions || []) showCaption(caption);
  $("#meeting-title").textContent = room.title;
  $("#meeting-code-label").textContent = room.id;
  for (const person of room.participants) {
    const tile = document.getElementById(`tile-${person.id}`);
    tile?.classList.toggle("camera-off", person.cameraOff);
    if (tile) tile.querySelector(".mic-state").textContent = person.muted ? "×" : "♩";
  }
  $("#participant-count").textContent = `${room.participants.length} participant${room.participants.length === 1 ? "" : "s"} + agent`;
  $("#metric-commitments").textContent = room.commitments.length + 7;
  renderTimeline(room.timeline);
  renderCard(room.activeCard);
  const selected = state.models.find((model) => model.id === room.model);
  if (selected) {
    $("#selected-model").textContent = selected.label;
    $("#agent-model-chip").textContent = selected.label;
  }
  const voice = state.voices.find((candidate) => candidate.id === room.voice);
  if (voice) $("#selected-voice").textContent = voice.label;
}

function renderCard(card) {
  const container = $("#shared-card");
  if (!card) {
    if (state.activeCardId) container.classList.add("hidden");
    state.activeCardId = null;
    return;
  }
  state.activeCardId = card.id;
  container.className = `shared-card ${card.type}`;
  $("#card-icon").textContent = ({ security: "⊘", commitment: "✓", poll: "◉", decision: "✦" })[card.type] || "✦";
  $("#card-eyebrow").textContent = card.eyebrow.toUpperCase();
  $("#card-confidence").textContent = `${Math.round(card.confidence * 100)}% CONFIDENCE`;
  $("#card-title").textContent = card.title;
  $("#card-detail").textContent = card.detail;
  $("#card-evidence").textContent = `“${card.evidence}”`;
  $(".shared-note").textContent = card.type === "poll"
    ? "Collective room state · one vote per participant"
    : "Shared room state · first valid action resolves for everyone";
  $("#poll-results").classList.toggle("hidden", card.type !== "poll");
  $("#card-actions").classList.toggle("hidden", card.type === "poll");
  if (card.type === "poll") renderPoll(card);
  else {
    $("#card-actions").replaceChildren(...card.actions.map((action) => {
      const button = element("button", action.label, action.primary ? "primary" : "");
      button.addEventListener("click", () => resolveCard(card, action.id));
      return button;
    }));
  }
}

function renderPoll(card) {
  const votes = Object.values(card.votes || {});
  const counts = Object.fromEntries(card.options.map((option) =>
    [option.id, votes.filter((vote) => vote.optionId === option.id).length]));
  const total = Math.max(1, votes.length);
  const voted = Boolean(card.votes?.[state.id]);
  $("#poll-results").replaceChildren(...card.options.map((option) => {
    const row = element("div", "", `poll-option ${card.votes?.[state.id]?.optionId === option.id ? "voted" : ""}`);
    const fill = element("div", "", "poll-option-fill");
    fill.style.width = `${(counts[option.id] / total) * 100}%`;
    const button = element("button");
    button.innerHTML = `<span>${escapeHtml(option.label)}</span><b>${counts[option.id]} vote${counts[option.id] === 1 ? "" : "s"}</b>`;
    button.disabled = voted;
    button.addEventListener("click", () => resolveCard(card, option.id));
    row.append(fill, button);
    return row;
  }));
}

function resolveCard(card, action) {
  state.media.send({ type: "card-action", cardId: card.id, version: card.version, action });
}

function showCaption(caption) {
  if (!caption.text || document.querySelector(`[data-caption-id="${caption.id}"]`)) return;
  $("#transcript .empty-state")?.remove();
  const entry = element("div", "", `transcript-entry ${caption.source === "agent" ? "agent" : ""}`);
  entry.dataset.captionId = caption.id;
  entry.innerHTML = `<div class="meta"><span class="speaker-dot" style="background:${speakerColor(caption.participantId)}"></span><b>${escapeHtml(caption.name)}</b><span>${time(caption.at)}</span><span class="latency">${caption.latencyMs || 0}ms local</span></div><p>${escapeHtml(caption.text)}</p>`;
  $("#transcript").append(entry);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
  $("#caption-speaker").textContent = caption.name;
  $("#caption-text").textContent = caption.text;
  $("#caption-overlay").classList.remove("hidden");
  clearTimeout(showCaption.timer);
  showCaption.timer = setTimeout(() => $("#caption-overlay").classList.add("hidden"), 4000);
}

function showAgentAnswer(answer) {
  setAgentState("thinking", `Answer ready · ${answer.latencyMs}ms · preparing voice…`);
  showCaption({ ...answer, type: "caption", participantId: "localroom-agent", source: "agent", latencyMs: answer.latencyMs });
}

function playAgentAudio(message) {
  if (!message.audioURL) {
    setAgentState("", "Listening for Pork Chop");
    return;
  }
  state.media.transcriptionActive = false;
  setAgentState("speaking", "Speaking locally");
  const audio = new Audio(message.audioURL);
  const finished = () => {
    state.media.transcriptionActive = true;
    setAgentState("", "Listening for Pork Chop");
  };
  audio.addEventListener("ended", finished, { once: true });
  audio.play().catch(finished);
}

async function askAgent(question = $("#agent-question").value.trim()) {
  if (!question) return;
  $("#agent-question").value = "";
  setAgentState("thinking", "Reasoning over room memory");
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/agent`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, actorName: state.name }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
  } catch (error) {
    setAgentState("", "Listening for Pork Chop");
    toast(`Agent unavailable: ${error.message}`);
  }
}

function renderModels() {
  $("#model-menu").replaceChildren(...state.models.map((model) => {
    const button = element("button", "", "model-option");
    button.disabled = !model.available;
    button.innerHTML = `<span><b>${escapeHtml(model.label)}</b><span>${escapeHtml(model.role)}</span></span><small>${model.available ? `${model.latencyMs}ms · READY` : "NOT LOADED"}</small>`;
    button.addEventListener("click", () => {
      state.media.send({ type: "select-model", modelId: model.id });
      $("#model-menu").classList.add("hidden");
    });
    return button;
  }));
}

function renderVoices() {
  $("#voice-menu").replaceChildren(...state.voices.map((voice) => {
    const button = element("button", "", "model-option");
    button.innerHTML = `<span><b>${escapeHtml(voice.label)}</b><span>${escapeHtml(voice.role)}</span></span><small>LOCAL</small>`;
    button.addEventListener("click", () => {
      state.media.send({ type: "select-voice", voiceId: voice.id });
      $("#voice-menu").classList.add("hidden");
    });
    return button;
  }));
}

function renderMemory(filter = "") {
  const pages = state.memory.filter((page) =>
    `${page.name} ${page.summary} ${page.facts.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  $("#memory-pages").replaceChildren(...pages.map((page) => {
    const article = element("article", "", "memory-page");
    article.innerHTML = `<span>${escapeHtml(page.classification)} · [[${escapeHtml(page.slug)}]]</span><h3>${escapeHtml(page.name)}</h3><p>${escapeHtml(page.summary)}</p><small>${escapeHtml(page.source)}</small>`;
    return article;
  }));
}

function renderTimeline(items = []) {
  $("#timeline").replaceChildren(...items.map((item) => {
    const row = element("div", "", `timeline-item ${item.kind}`);
    row.innerHTML = `<b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.actor)} · ${relativeTime(item.at)}</span>`;
    return row;
  }));
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const health = await response.json();
    state.models = health.models || state.models;
    state.voices = health.voices || state.voices;
    renderModels();
    renderVoices();
    const ok = health.asr?.status === "ok" && health.asr?.ready !== false;
    setASR(ok, ok ? "Dell AI online" : "Local AI unavailable");
    $("#model-label").textContent = ok ? `NVIDIA Parakeet · ${health.asr.provider || "local"}` : "NVIDIA ASR · reconnecting";
    $("#metric-memory").textContent = health.memoryRecords || 42;
    $("#handoff-memory").textContent = health.memoryRecords || 0;
    if (health.commitmentMonitor?.commitments) $("#metric-commitments").textContent = health.commitmentMonitor.commitments;
    $("#handoff-audit").textContent = health.auditRecords || 0;
  } catch { setASR(false, "Local AI unavailable"); }
}

function addVideoTile(id, name, stream, local) {
  let tile = document.getElementById(`tile-${id}`);
  if (!tile) {
    tile = element("article", "", `video-tile ${local ? "local" : "remote"}`);
    tile.id = `tile-${id}`;
    tile.innerHTML = `<div class="avatar">${initials(name)}</div><video autoplay playsinline ${local ? "muted" : ""}></video><div class="tile-shade"></div><div class="nameplate"><span class="mic-state">♩</span><span>${escapeHtml(name)}${local ? " (You)" : ""}</span></div><div class="audio-ring"></div>`;
    $("#video-grid").append(tile);
  }
  tile.querySelector("video").srcObject = stream;
  $("#video-grid").classList.toggle("solo", $("#video-grid").children.length === 1);
}

function removeTile(id) {
  document.getElementById(`tile-${id}`)?.remove();
  $("#video-grid").classList.toggle("solo", $("#video-grid").children.length === 1);
}

async function showHandoff(brief) {
  $("#brief-summary").textContent = brief.summary;
  $("#brief-decisions").innerHTML = brief.decisions.map((decision) => `<p>✓ ${escapeHtml(decision)}</p>`).join("") || "<p>Decision log remains available in institutional memory.</p>";
  $("#brief-actions").replaceChildren(...brief.artifacts.map((artifact) => briefAction(artifact.label, `${artifact.service} · ${artifact.status.toUpperCase()}`)));
  $("#brief-commitments").replaceChildren(...brief.commitments.map((item) => briefAction(item.task, `${item.owner} · ${item.due} · MONITORING`)));
  $("#meeting").classList.add("hidden");
  $("#handoff").classList.remove("hidden");
  await checkHealth();
}

function briefAction(title, detail) {
  const div = element("div", "", "brief-action");
  div.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span>`;
  return div;
}

const demoLines = {
  decision: "We decided that the cancellation experience will use a two-step guided flow with an immediate exit option.",
  commitment: "I will send the revised two-step prototype to Legal by Friday.",
  poll: "Let's vote on the cancellation experience between a two-step guided flow or a single-page immediate exit.",
  security: "Send the confidential Project Iliad conversion-impact analysis to the outside vendor.",
};

async function injectDemo(kind) {
  $("#demo-director").classList.add("hidden");
  if (kind === "memory") return askAgent("Why did we reject the previous cancellation design?");
  const response = await fetch("/api/demo/caption", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: state.roomId, participantId: state.id, name: state.name, text: demoLines[kind] }),
  });
  if (!response.ok) toast("Demo injection failed.");
}

$("#ask-form").addEventListener("submit", (event) => { event.preventDefault(); askAgent(); });
$("#agent-button").addEventListener("click", () => { showPanel(); $("#agent-question").focus(); });
$("#mic-button").addEventListener("click", async () => {
  await state.media.toggle("audio");
  $("#mic-button").classList.toggle("off", state.media.muted);
  $("#mic-button small").textContent = state.media.muted ? "Unmute" : "Mute";
});
$("#camera-button").addEventListener("click", async () => {
  await state.media.toggle("video");
  $("#camera-button").classList.toggle("off", state.media.cameraOff);
  document.getElementById(`tile-${state.id}`)?.classList.toggle("camera-off", state.media.cameraOff);
});
$("#share-button").addEventListener("click", async () => {
  await navigator.clipboard.writeText(`Join my LocalRoom meeting: ${location.origin}/?room=${state.roomId}`);
  toast("Private meeting link copied.");
});
$("#leave-button").addEventListener("click", async () => {
  const response = await fetch(`/api/rooms/${state.roomId}/end`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorName: state.name }),
  });
  if (response.ok) showHandoff(await response.json());
});
$("#return-button").addEventListener("click", async () => {
  const response = await fetch(`/api/rooms/${state.roomId}/resume`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorName: state.name }),
  });
  if (!response.ok) return toast("Could not resume this meeting.");
  const { room } = await response.json();
  renderRoom(room);
  $("#handoff").classList.add("hidden");
  $("#meeting").classList.remove("hidden");
});
$("#transcript-button").addEventListener("click", () => $(".intelligence-panel").classList.toggle("hidden"));
$("#close-panel").addEventListener("click", () => $(".intelligence-panel").classList.add("hidden"));
$("#model-button").addEventListener("click", () => $("#model-menu").classList.toggle("hidden"));
$("#voice-button").addEventListener("click", () => $("#voice-menu").classList.toggle("hidden"));
$("#memory-search").addEventListener("input", (event) => renderMemory(event.target.value));
$$(".panel-tabs button").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
$("#demo-toggle").addEventListener("click", () => $("#demo-director").classList.toggle("hidden"));
$("#demo-close").addEventListener("click", () => $("#demo-director").classList.add("hidden"));
$$("[data-demo]").forEach((button) => button.addEventListener("click", () => injectDemo(button.dataset.demo)));

function activateTab(name) {
  $$(".panel-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${name}`));
}
function showPanel() { $(".intelligence-panel").classList.remove("hidden"); }
function setAgentState(className, text) {
  $("#agent-tile").className = `agent-tile ${className}`;
  $("#agent-state").textContent = text;
}
function setASR(ok, text) {
  $("#asr-state").textContent = text;
  $(".footer-right").classList.toggle("offline", !ok);
}
function updateClock() {
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  $("#clock").textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function element(tag, text = "", className = "") {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function initials(name) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function speakerColor(id) {
  const palette = ["#b8f34a", "#63d7ff", "#ffbd66", "#d8a0ff", "#ff7b8c", "#70e0bb"];
  const hash = [...String(id)].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);
  return palette[Math.abs(hash) % palette.length];
}
function escapeHtml(value) {
  const node = document.createElement("span"); node.textContent = String(value || ""); return node.innerHTML;
}
function time(value) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}
function toast(message) {
  $("#toast").textContent = message; $("#toast").classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2600);
}

const params = new URLSearchParams(location.search);
if (params.get("room")) $("#room-code").value = params.get("room").toUpperCase();
$("#console-link").href = `/console/session/${encodeURIComponent($("#room-code").value)}`;
if (params.get("autojoin") === "1") {
  $("#display-name").value = params.get("name") || "LocalRoom iOS";
  requestAnimationFrame(() => $("#join-form").requestSubmit());
}
