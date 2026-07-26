const QUESTION_WORDS = /^(?:who|what|when|where|why|how|does|do|is|are|can|could|should|will)\b/i;
const DECISION_WORDS = /\b(?:we (?:have )?(?:decided|agreed)|decision(?: is)?|approved|we(?:'re| are) going to)\b/i;
const PARKING_WORDS = /\b(?:parking lot|not today|table (?:that|this)|come back to)\b/i;

export function createMeetingRecord(roomId, title, now = new Date()) {
  const at = iso(now);
  return {
    schema_version: 1,
    state_version: 0,
    session: {
      id: roomId,
      title,
      goal: "Leave with a decision, a named owner, and no sensitive data outside the room.",
      status: "created",
      started_at: null,
      ended_at: null,
      context_dir: "data/corpus",
    },
    context_files: {},
    participants: [],
    agenda: [
      agenda("agenda_001", 1, "Review the prior cancellation decision", "active"),
      agenda("agenda_002", 2, "Decide the guided-flow direction"),
      agenda("agenda_003", 3, "Assign owners and deadlines"),
      agenda("agenda_004", 4, "Review external-sharing policy"),
      agenda("agenda_005", 5, "Run closing sweep"),
    ],
    utterances: [],
    decisions: [],
    action_items: [],
    open_questions: [],
    parking_lot: [],
    alerts: [],
    facilitator_nudge: null,
    qa: [],
    meeting_summary: "The room is ready. LocalRoom will track decisions, owners, deadlines, and unresolved risks as people speak.",
    follow_up_email: {
      subject: `Follow-Up: ${title}`,
      body: "",
      rendered_at: at,
      host_edited: false,
    },
  };
}

export function addRecordParticipant(record, participant) {
  const normalizedName = String(participant.name || "").trim().toLowerCase();
  const existing = record.participants.find((item) =>
    item.id === participant.id || item.name.trim().toLowerCase() === normalizedName);
  const value = { id: participant.id, name: participant.name, role: participant.role || null };
  if (existing) Object.assign(existing, value);
  else record.participants.push(value);
  mutate(record);
}

export function removeRecordParticipant(record, participantId) {
  const previous = record.participants.length;
  record.participants = record.participants.filter((item) => item.id !== participantId);
  if (record.participants.length !== previous) mutate(record);
}

export function ingestRecordCaption(record, caption) {
  if (!caption.text?.trim()) return null;
  const utterance = {
    id: caption.id || nextId(record.utterances, "utt"),
    speaker: caption.name || "Participant",
    text: caption.text.trim(),
    ts_start: secondsSince(record.session.started_at, caption.at),
    ts_end: secondsSince(record.session.started_at, caption.at),
    is_final: true,
    source: caption.demo ? "script" : "mic",
    source_id: caption.participantId || null,
    source_kind: caption.source === "agent" ? "agent" : "browser",
    at_utc: caption.at || new Date().toISOString(),
  };
  if (!record.utterances.some((item) => item.id === utterance.id)) record.utterances.push(utterance);
  if (record.session.status === "created") {
    record.session.status = "live";
    record.session.started_at = utterance.at_utc;
    utterance.ts_start = 0;
    utterance.ts_end = 0;
  }

  if (caption.source !== "agent") extractMeetingState(record, utterance);
  updateAgenda(record);
  finalize(record);
  return utterance;
}

export function applyCardToRecord(record, card, action, actorName) {
  if (card.type === "decision" && action === "confirm") {
    upsertDecision(record, card.title, card.evidence, "decided", card.confidence);
  }
  if (card.type === "commitment" && ["accept", "assign-me"].includes(action)) {
    const owner = action === "assign-me" ? actorName : card.metadata?.owner;
    upsertAction(record, card.metadata?.task || card.title, owner, card.metadata?.due, card.evidence);
  }
  if (card.type === "security" && card.locked) {
    const existing = record.alerts.find((item) => item.dedupe_key === `policy:${card.id}`);
    if (!existing) {
      record.alerts.push({
        id: nextId(record.alerts, "alert"),
        type: "off_agenda",
        severity: "high",
        text: card.title,
        suggested_prompt: "Keep the restricted material inside the room.",
        related_id: null,
        source: "rule",
        dedupe_key: `policy:${card.id}`,
        status: "resolved",
      });
    }
  }
  finalize(record);
}

export function patchRecordEntity(record, entityId, fields) {
  if (entityId === "follow_up_email") {
    for (const key of ["subject", "body"]) {
      if (key in fields) record.follow_up_email[key] = String(fields[key] ?? "");
    }
    record.follow_up_email.host_edited = true;
    record.follow_up_email.rendered_at = new Date().toISOString();
    mutate(record);
    return record.follow_up_email;
  }
  const collections = ["decisions", "action_items", "open_questions", "parking_lot"];
  for (const name of collections) {
    const entity = record[name].find((item) => item.id === entityId);
    if (!entity) continue;
    const allowed = allowedFields(name);
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) continue;
      entity[key] = value === "" && ["owner", "deadline", "answer"].includes(key) ? null : value;
    }
    entity.host_locked = true;
    if ("updated_at" in entity) entity.updated_at = new Date().toISOString();
    finalize(record);
    return entity;
  }
  return null;
}

export function dismissRecordAlert(record, alertId) {
  const alert = record.alerts.find((item) => item.id === alertId);
  if (!alert) return null;
  alert.status = "dismissed";
  mutate(record);
  return alert;
}

export function dismissRecordNudge(record) {
  if (!record.facilitator_nudge) return null;
  record.facilitator_nudge.status = "dismissed";
  mutate(record);
  return record.facilitator_nudge;
}

export function closeRecord(record) {
  record.session.status = "closing";
  const active = record.agenda.find((item) => item.status === "active");
  if (active) active.status = "done";
  const closing = record.agenda.at(-1);
  if (closing) closing.status = "active";
  finalize(record);
}

export function endRecord(record) {
  record.session.status = "ended";
  record.session.ended_at = new Date().toISOString();
  for (const item of record.agenda) item.status = "done";
  finalize(record);
}

export function resumeRecord(record) {
  if (!["closing", "ended"].includes(record.session.status)) return record.session;
  record.session.status = "live";
  record.session.ended_at = null;
  finalize(record);
  return record.session;
}

export function answerRecordQuestion(record, question, askedBy = "host") {
  const normalized = question.toLowerCase();
  let answer;
  if (normalized.includes("unresolved") || normalized.includes("still open")) {
    const gaps = activeAlerts(record).map((item) => item.text);
    answer = gaps.length ? gaps.join(" ") : "No unresolved owner, deadline, or closing-question gaps remain.";
  } else if (normalized.includes("who") && normalized.includes("own")) {
    const actions = record.action_items.map((item) => `${item.task}: ${item.owner || "OWNER NEEDED"}`);
    answer = actions.length ? actions.join(" ") : "No action items have been captured yet.";
  } else if (normalized.includes("decision")) {
    const decisions = record.decisions.filter((item) => item.status === "decided").map((item) => item.text);
    answer = decisions.length ? decisions.join(" ") : "The room has not confirmed a decision yet.";
  } else {
    answer = record.meeting_summary;
  }
  const qa = {
    id: nextId(record.qa, "qa"),
    question,
    asked_by: askedBy,
    answer,
    source_utterance_ids: record.utterances.slice(-4).map((item) => item.id),
    source_files: ["[[project-iliad]]"],
    status: "answered",
    created_at: new Date().toISOString(),
  };
  record.qa.push(qa);
  mutate(record);
  return qa;
}

export function exportRecordMarkdown(record) {
  const lines = [
    `# ${record.session.title}`,
    "",
    record.meeting_summary,
    "",
    "## Decisions",
    ...record.decisions.map((item) => `- ${item.text} (${item.status})`),
    "",
    "## Actions",
    ...record.action_items.map((item) =>
      `- [${item.status === "done" ? "x" : " "}] ${item.task} — ${item.owner || "OWNER NEEDED"}${item.deadline ? `, due ${item.deadline}` : ""}`),
    "",
    "## Open questions",
    ...record.open_questions.filter((item) => item.status === "open").map((item) => `- ${item.text}`),
    "",
    "## Transcript",
    ...record.utterances.map((item) => `- **${item.speaker}:** ${item.text}`),
    "",
    "_Generated locally by LocalRoom. No meeting content left the appliance._",
  ];
  return `${lines.join("\n")}\n`;
}

function extractMeetingState(record, utterance) {
  const text = utterance.text;
  if (DECISION_WORDS.test(text)) upsertDecision(record, cleanDecision(text), text, "decided", 0.94, utterance.id);
  const commitment = parseCommitment(text, utterance.speaker);
  if (commitment) upsertAction(record, commitment.task, commitment.owner, commitment.deadline, text, utterance.id);
  if (text.endsWith("?") && QUESTION_WORDS.test(text)) upsertQuestion(record, text, utterance.id);
  if (PARKING_WORDS.test(text)) upsertParking(record, text, utterance.speaker);
}

function parseCommitment(text, speaker) {
  const firstPerson = text.match(/\bI(?:'ll| will| can)\s+(.+?)(?:\s+(?:by|before|on)\s+(.+?))?[.!?]?$/i);
  if (firstPerson) {
    return { task: sentence(firstPerson[1]), owner: speaker, deadline: firstPerson[2] || null };
  }
  const unowned = text.match(/\b(?:someone|somebody|we)\s+(?:should|has to|need to|needs to)\s+(.+?)(?:\s+(?:by|before|on)\s+(.+?))?[.!?]?$/i);
  if (unowned) {
    return { task: sentence(unowned[1]), owner: null, deadline: unowned[2] || null };
  }
  return null;
}

function upsertDecision(record, text, evidence, status, confidence, utteranceId) {
  const key = normalize(text);
  let item = record.decisions.find((candidate) => normalize(candidate.text) === key);
  const at = new Date().toISOString();
  if (!item) {
    item = {
      id: nextId(record.decisions, "dec"), text, status, confidence,
      evidence_quote: evidence, evidence_utterance_ids: [], host_locked: false,
      created_at: at, updated_at: at,
    };
    record.decisions.push(item);
  } else if (!item.host_locked) {
    Object.assign(item, { status, confidence, evidence_quote: evidence, updated_at: at });
  }
  if (utteranceId && !item.evidence_utterance_ids.includes(utteranceId)) item.evidence_utterance_ids.push(utteranceId);
}

function upsertAction(record, task, owner, deadline, evidence, utteranceId) {
  const key = normalize(task);
  let item = record.action_items.find((candidate) => normalize(candidate.task) === key);
  const at = new Date().toISOString();
  if (!item) {
    item = {
      id: nextId(record.action_items, "act"), task, owner: owner || null,
      deadline: deadline && deadline !== "No deadline captured" ? deadline : null,
      status: "open", evidence_quote: evidence, evidence_utterance_ids: [],
      host_locked: false, created_at: at, updated_at: at,
    };
    record.action_items.push(item);
  } else if (!item.host_locked) {
    if (owner) item.owner = owner;
    if (deadline && deadline !== "No deadline captured") item.deadline = deadline;
    item.updated_at = at;
  }
  if (utteranceId && !item.evidence_utterance_ids.includes(utteranceId)) item.evidence_utterance_ids.push(utteranceId);
}

function upsertQuestion(record, text, utteranceId) {
  if (record.open_questions.some((item) => normalize(item.text) === normalize(text))) return;
  record.open_questions.push({
    id: nextId(record.open_questions, "q"), text, status: "open", answer: null,
    host_locked: false, evidence_utterance_ids: utteranceId ? [utteranceId] : [],
  });
}

function upsertParking(record, text, raisedBy) {
  if (record.parking_lot.some((item) => normalize(item.text) === normalize(text))) return;
  record.parking_lot.push({
    id: nextId(record.parking_lot, "park"), text, raised_by: raisedBy, host_locked: false,
  });
}

function finalize(record) {
  deriveAlerts(record);
  renderSummary(record);
  renderEmail(record);
  mutate(record);
}

function deriveAlerts(record) {
  const activeKeys = new Set();
  for (const action of record.action_items.filter((item) => item.status === "open")) {
    if (!action.owner) ensureGap(record, activeKeys, `unowned:${action.id}`, "unowned_action", "high",
      `Action item has no owner: ${action.task}`, `Who owns: ${action.task}?`, action.id);
    if (!action.deadline) ensureGap(record, activeKeys, `undated:${action.id}`, "undated_action", "warn",
      `Action item has no deadline: ${action.task}`, `When will “${action.task}” be done?`, action.id);
  }
  if (["closing", "ended"].includes(record.session.status)) {
    for (const question of record.open_questions.filter((item) => item.status === "open")) {
      ensureGap(record, activeKeys, `close:${question.id}`, "open_question_at_close", "high",
        `Still open at close: ${question.text}`, `Before we close: ${question.text}`, question.id);
    }
  }
  for (const alert of record.alerts) {
    if (alert.source === "rule" && alert.status === "active" && !activeKeys.has(alert.dedupe_key)) alert.status = "resolved";
  }
  const highest = activeAlerts(record).find((item) => item.severity === "high");
  if (highest && record.facilitator_nudge?.status !== "dismissed") {
    record.facilitator_nudge = {
      id: "nudge_001", text: highest.suggested_prompt, reason: highest.text,
      created_at: new Date().toISOString(), status: "active",
    };
  } else if (!highest && record.facilitator_nudge?.status === "active") {
    record.facilitator_nudge.status = "expired";
  }
}

function ensureGap(record, activeKeys, key, type, severity, text, prompt, relatedId) {
  activeKeys.add(key);
  let alert = record.alerts.find((item) => item.dedupe_key === key);
  if (!alert) {
    alert = {
      id: nextId(record.alerts, "alert"), type, severity, text,
      suggested_prompt: prompt, related_id: relatedId, source: "rule",
      dedupe_key: key, status: "active",
    };
    record.alerts.push(alert);
  } else if (alert.status === "resolved") alert.status = "active";
}

function renderSummary(record) {
  const decisions = record.decisions.filter((item) => item.status === "decided");
  const actions = record.action_items.filter((item) => item.status === "open");
  if (!decisions.length && !actions.length) return;
  const parts = [];
  if (decisions.length) parts.push(`The room confirmed ${lowerFirst(decisions.at(-1).text)}.`);
  if (actions.length) {
    const gaps = actions.filter((item) => !item.owner || !item.deadline).length;
    parts.push(`${actions.length} follow-up action${actions.length === 1 ? "" : "s"} captured${gaps ? `; ${gaps} still need${gaps === 1 ? "s" : ""} an owner or deadline` : ""}.`);
  }
  record.meeting_summary = parts.join(" ");
}

function renderEmail(record) {
  if (record.follow_up_email.host_edited) return;
  const lines = ["Hi team,", "", record.meeting_summary, "", "Decisions:"];
  for (const item of record.decisions.filter((entry) => entry.status === "decided")) lines.push(`- ${item.text}`);
  lines.push("", "Action items:");
  for (const item of record.action_items.filter((entry) => entry.status === "open")) {
    lines.push(`- ${item.task} — ${item.owner || "OWNER NEEDED"}${item.deadline ? `, due ${item.deadline}` : ""}`);
  }
  record.follow_up_email.body = `${lines.join("\n")}\n`;
  record.follow_up_email.rendered_at = new Date().toISOString();
}

function updateAgenda(record) {
  const count = record.utterances.filter((item) => item.source_kind !== "agent").length;
  const activeIndex = Math.min(record.agenda.length - 2, Math.floor(count / 2));
  record.agenda.forEach((item, index) => {
    if (index < activeIndex) item.status = "done";
    else if (index === activeIndex) item.status = "active";
    else if (item.status !== "done") item.status = "pending";
  });
}

function activeAlerts(record) {
  return record.alerts.filter((item) => item.status === "active");
}

function allowedFields(collection) {
  return new Set({
    decisions: ["text", "status", "confidence", "evidence_quote"],
    action_items: ["task", "owner", "deadline", "status"],
    open_questions: ["text", "status", "answer"],
    parking_lot: ["text", "raised_by"],
  }[collection]);
}

function mutate(record) {
  record.state_version += 1;
}

function agenda(id, order, title, status = "pending") {
  return { id, order, title, status };
}

function nextId(items, prefix) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.id?.split("_").at(-1)) || 0), 0);
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}

function secondsSince(startedAt, at) {
  if (!startedAt) return 0;
  return Math.max(0, (new Date(at || Date.now()).getTime() - new Date(startedAt).getTime()) / 1000);
}

function cleanDecision(text) {
  return sentence(text.replace(/^.*?\b(?:we (?:have )?(?:decided|agreed)(?: that)?|decision(?: is)?|approved(?: that)?)\s*/i, ""));
}

function sentence(value) {
  const text = String(value || "").trim().replace(/[.!?]+$/, "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function lowerFirst(value) {
  const text = String(value || "");
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
