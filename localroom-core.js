import crypto from "node:crypto";
import {
  addRecordParticipant,
  applyCardToRecord,
  createMeetingRecord,
  endRecord,
  ingestRecordCaption,
  removeRecordParticipant,
} from "./meeting-record.js";

const RESTRICTED = new Set(["CONFIDENTIAL", "CUI", "CUI // EXPORT CONTROLLED", "M&A CLEAN TEAM ONLY"]);
const EXTERNAL_DOMAINS = new Set(["outside-vendor.com", "gmail.com", "proton.me"]);

export class RoomIntelligence {
  constructor({ now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
    this.now = now;
    this.id = id;
    this.rooms = new Map();
  }

  room(roomId) {
    if (!this.rooms.has(roomId)) {
      const title = "Project Iliad Cancellation Review";
      this.rooms.set(roomId, {
        id: roomId,
        title,
        organization: "Rainforest",
        participants: new Map(),
        captions: [],
        cards: [],
        activeCardId: null,
        commitments: [],
        model: "qwen-30b",
        voice: "af_heart",
        timeline: seededTimeline(this.now),
        transcriptVersion: 0,
        record: createMeetingRecord(roomId, title, this.now()),
      });
    }
    return this.rooms.get(roomId);
  }

  snapshot(roomId) {
    const room = this.room(roomId);
    return {
      ...room,
      participants: [...room.participants.values()].map(publicParticipant),
      activeCard: room.cards.find((card) => card.id === room.activeCardId) || null,
      cards: room.cards.map((card) => ({ ...card })),
    };
  }

  addParticipant(roomId, participant) {
    const room = this.room(roomId);
    room.participants.set(participant.id, participant);
    addRecordParticipant(room.record, participant);
  }

  removeParticipant(roomId, participantId) {
    const room = this.room(roomId);
    room.participants.delete(participantId);
    removeRecordParticipant(room.record, participantId);
  }

  addCaption(roomId, caption) {
    const room = this.room(roomId);
    room.captions.push(caption);
    room.transcriptVersion += 1;
    ingestRecordCaption(room.record, caption);
    if (caption.source === "agent") return [];
    return this.detectCards(room, caption);
  }

  proposeTaskFromPrompt(roomId, prompt, actorName) {
    const commitment = parseAgentTask(prompt, actorName);
    if (!commitment) return null;
    return this.propose(roomId, commitmentCard(commitment, prompt, "Task requested"));
  }

  detectCards(room, caption) {
    const text = caption.text.trim();
    const proposals = [];
    if (/\b(?:let'?s (?:vote|poll)|put (?:that|this) to a vote|what should we vote on)\b/i.test(text)) {
      const poll = inferPoll(text, room.captions);
      proposals.push(this.proposePoll(room.id, { ...poll, evidence: text, actorName: caption.name }));
      return proposals.filter(Boolean);
    }
    const isDecision = /\b(?:we (?:have )?(?:decided|agreed)|decision(?: is)?|approved|we(?:'re| are) going to)\b/i.test(text);
    if (isDecision) {
      proposals.push(this.propose(room.id, {
        type: "decision",
        eyebrow: "Decision detected",
        title: sentence(text),
        detail: `Captured from ${caption.name}'s statement. Confirm this as the room's shared decision.`,
        evidence: text,
        confidence: 0.94,
        actions: [
          { id: "confirm", label: "Confirm decision", primary: true },
          { id: "edit", label: "Needs revision" },
          { id: "dismiss", label: "Dismiss" },
        ],
      }));
    }

    const commitment = isDecision ? null : parseCommitment(text, caption.name);
    if (commitment) {
      proposals.push(this.propose(room.id, commitmentCard(commitment, text, "Commitment detected")));
    }

    const disclosure = parseDisclosure(text);
    if (disclosure) {
      const decision = authorizeShare(disclosure);
      proposals.push(this.propose(room.id, {
        type: "security",
        eyebrow: decision.allowed ? "Access verified" : "OpenShell policy intervention",
        title: decision.allowed ? "Document sharing approved" : "External disclosure blocked",
        detail: decision.reason,
        evidence: text,
        confidence: 0.99,
        locked: !decision.allowed,
        metadata: { disclosure, decision },
        actions: decision.allowed
          ? [{ id: "send", label: "Send securely", primary: true }, { id: "dismiss", label: "Dismiss" }]
          : [{ id: "keep-blocked", label: "Keep blocked", primary: true }, { id: "review", label: "Request security review" }],
      }));
    }
    return proposals.filter(Boolean);
  }

  propose(roomId, proposal) {
    const room = this.room(roomId);
    const duplicate = room.cards.find((card) =>
      card.status !== "resolved" && card.type === proposal.type && card.evidence === proposal.evidence);
    if (duplicate) return null;
    const card = {
      id: this.id(),
      version: 1,
      status: "queued",
      createdAt: this.now().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
      ...proposal,
    };
    room.cards.push(card);
    if (!room.activeCardId) {
      card.status = "active";
      room.activeCardId = card.id;
    }
    return card;
  }

  resolve(roomId, { cardId, version, action, actorId, actorName }) {
    const room = this.room(roomId);
    const card = room.cards.find((candidate) => candidate.id === cardId);
    if (!card || card.status !== "active" || room.activeCardId !== cardId || card.version !== version) {
      return { ok: false, reason: "already-resolved", card };
    }
    if (card.type === "poll") return this.vote(roomId, { card, optionId: action, actorId, actorName });
    if (!card.actions.some((candidate) => candidate.id === action)) {
      return { ok: false, reason: "invalid-action", card };
    }
    card.status = "resolved";
    card.version += 1;
    card.resolvedAt = this.now().toISOString();
    card.resolvedBy = { id: actorId, name: actorName };
    card.resolution = action;
    room.activeCardId = null;
    applyCardToRecord(room.record, card, action, actorName);

    if (card.type === "commitment" && ["accept", "assign-me"].includes(action)) {
      const metadata = { ...card.metadata };
      if (action === "assign-me") metadata.owner = actorName;
      room.commitments.push({
        id: this.id(),
        task: metadata.task,
        owner: metadata.owner,
        due: metadata.due,
        status: "monitoring",
        sourceCardId: card.id,
      });
    }
    room.timeline.unshift({
      id: this.id(),
      at: card.resolvedAt,
      kind: card.type,
      title: timelineTitle(card, action),
      actor: actorName,
    });
    const next = room.cards.find((candidate) => candidate.status === "queued");
    if (next) {
      next.status = "active";
      room.activeCardId = next.id;
    }
    return { ok: true, card, next: next || null };
  }

  vote(roomId, { card, optionId, actorId, actorName }) {
    const room = this.room(roomId);
    if (!card.options?.some((option) => option.id === optionId)) {
      return { ok: false, reason: "invalid-option", card };
    }
    if (card.votes[actorId]) return { ok: false, reason: "already-voted", card };
    card.votes[actorId] = { optionId, actorName, at: this.now().toISOString() };
    card.version += 1;
    const eligible = Math.max(1, room.participants.size);
    const complete = Object.keys(card.votes).length >= eligible;
    if (complete) this.closePoll(room, card, "All participants voted");
    return { ok: true, card, next: null, pollOpen: !complete };
  }

  closePoll(room, card, reason = "Poll closed by organizer") {
    card.status = "resolved";
    card.resolvedAt = this.now().toISOString();
    card.resolution = "poll-complete";
    card.closeReason = reason;
    room.activeCardId = null;
    const counts = Object.values(card.votes).reduce((result, vote) => {
      result[vote.optionId] = (result[vote.optionId] || 0) + 1;
      return result;
    }, {});
    const winner = [...card.options].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))[0];
    room.timeline.unshift({
      id: this.id(),
      at: card.resolvedAt,
      kind: "poll",
      title: `Poll complete: ${winner?.label || "No votes"}`,
      actor: "LocalRoom Agent",
    });
    const next = room.cards.find((candidate) => candidate.status === "queued");
    if (next) {
      next.status = "active";
      room.activeCardId = next.id;
    }
  }

  proposePoll(roomId, { question, options, evidence, actorName }) {
    const normalized = options.slice(0, 4).map((label, index) => ({ id: `option-${index + 1}`, label }));
    return this.propose(roomId, {
      type: "poll",
      eyebrow: "Room decision",
      title: question,
      detail: `Proposed from the live discussion by ${actorName}. One vote per participant.`,
      evidence,
      confidence: 0.9,
      options: normalized,
      votes: {},
      actions: normalized.map((option) => ({ id: option.id, label: option.label })),
    });
  }

  selectModel(roomId, modelId, actorName, availableModels) {
    const model = availableModels.find((candidate) => candidate.id === modelId && candidate.available);
    if (!model) return { ok: false, reason: "model-unavailable" };
    const room = this.room(roomId);
    room.model = modelId;
    room.timeline.unshift({
      id: this.id(),
      at: this.now().toISOString(),
      kind: "model",
      title: `Room intelligence switched to ${model.label}`,
      actor: actorName,
    });
    return { ok: true, model };
  }

  selectVoice(roomId, voiceId, actorName, availableVoices) {
    const voice = availableVoices.find((candidate) => candidate.id === voiceId);
    if (!voice) return { ok: false, reason: "voice-unavailable" };
    const room = this.room(roomId);
    room.voice = voiceId;
    room.timeline.unshift({
      id: this.id(), at: this.now().toISOString(), kind: "model",
      title: `Agent voice switched to ${voice.label}`, actor: actorName,
    });
    return { ok: true, voice };
  }

  endMeeting(roomId, actorName) {
    const room = this.room(roomId);
    endRecord(room.record);
    const decisions = room.cards.filter((card) =>
      card.type === "decision" && card.resolution === "confirm");
    const brief = {
      id: this.id(),
      at: this.now().toISOString(),
      title: `${room.title} brief`,
      summary: decisions[0]?.title || "The team reviewed Project Iliad's cancellation experience and governance requirements.",
      decisions: decisions.map((card) => card.title),
      commitments: room.commitments.map((item) => ({ ...item })),
      artifacts: [
        { service: "Vault", label: "Meeting brief stored", status: "complete" },
        { service: "Tasks", label: `${room.commitments.length} monitored commitment${room.commitments.length === 1 ? "" : "s"} created`, status: "complete" },
        { service: "Mailroom", label: "Follow-up drafted for internal attendees", status: "approval" },
        { service: "Calendar", label: "Friday governance review proposed", status: "approval" },
      ],
      createdBy: actorName,
    };
    room.brief = brief;
    room.timeline.unshift({
      id: this.id(),
      at: brief.at,
      kind: "agent",
      title: "LocalRoom completed the meeting handoff",
      actor: "LocalRoom Agent",
    });
    return brief;
  }
}

export function authorizeShare({ document, classification, recipient }) {
  const domain = String(recipient).split("@")[1]?.toLowerCase() || "";
  if (RESTRICTED.has(classification) && EXTERNAL_DOMAINS.has(domain)) {
    return {
      allowed: false,
      code: "EXTERNAL_RECIPIENT_NOT_AUTHORIZED",
      reason: `${document} is marked ${classification}. ${recipient} is outside Rainforest and lacks Project Iliad access.`,
    };
  }
  return { allowed: true, code: "AUTHORIZED", reason: "Recipient and document policy are compatible." };
}

export const demoMemory = [
  {
    slug: "project-iliad",
    name: "Project Iliad",
    classification: "CONFIDENTIAL",
    summary: "Rainforest's historical effort to simplify Prime cancellation while measuring retention impact.",
    facts: [
      "The working group treated cancellation clarity, accidental enrollment, and retention impact as linked product risks.",
      "Legal review is required before internal conversion-impact analysis leaves the Project Iliad group.",
      "Outside vendors may receive sanitized UX specifications, not internal conversion or legal-risk analysis.",
    ],
    source: "Historical simulation based on public FTC court filings; restricted artifacts are synthetic.",
  },
  {
    slug: "cancellation-review-2026-07-19",
    name: "Prior cancellation review",
    classification: "INTERNAL",
    summary: "The team rejected a multi-page cancellation flow and requested a two-step alternative.",
    facts: [
      "Maya owns the revised two-step flow.",
      "Legal requested explicit consent language and a record of every rejected alternative.",
      "The next governance checkpoint is Friday.",
    ],
    source: "Synthetic LocalRoom institutional-memory record.",
  },
];

export function answerFromMemory(question) {
  const normalized = question.toLowerCase();
  if (normalized.includes("project iliad") && /\b(?:what|explain|describe|tell me)\b/.test(normalized)) {
    return {
      answer: "Project Iliad is Rainforest's historical effort to simplify Prime cancellation while measuring retention impact. This demo grounds that history in public FTC filings; its restricted internal artifacts are synthetic.",
      citations: ["[[project-iliad]]"],
    };
  }
  if (normalized.includes("why") && (normalized.includes("previous") || normalized.includes("reject"))) {
    return {
      answer: "The prior multi-page cancellation flow was rejected because it obscured the exit path and conflicted with Legal's explicit-consent requirement. The room requested a two-step alternative.",
      citations: ["[[cancellation-review-2026-07-19]]", "[[project-iliad]]"],
    };
  }
  if (normalized.includes("who") && (normalized.includes("own") || normalized.includes("responsible"))) {
    return {
      answer: "Maya owns the revised two-step cancellation flow. Legal owns consent-language review, with the next checkpoint Friday.",
      citations: ["[[cancellation-review-2026-07-19]]"],
    };
  }
  if (normalized.includes("send") || normalized.includes("share") || normalized.includes("vendor")) {
    return {
      answer: "The outside vendor may receive sanitized UX specifications, but not internal conversion-impact analysis or attorney–client material. I can check a specific artifact and recipient.",
      citations: ["[[project-iliad]]"],
    };
  }
  return null;
}

export function extractWakePrompt(text) {
  const match = String(text).match(
    /^\s*(?:(?:hey|okay|ok|um|uh)[\s,]+)*(?:pork|port|poor)[\s-]*(?:chop|shop|job)\b[\s,.:;!?—-]*(.+?)\s*$/i);
  return match?.[1]?.trim() || null;
}

function parseCommitment(text, speaker) {
  const clean = String(text || "").trim();
  let match = clean.match(/\b(I|we)\s+(?:will|shall)\s+([^.!?]+)/i);
  let owner = match?.[1].toLowerCase() === "we" ? "Team" : speaker;
  let task = match?.[2];

  if (!match) {
    match = clean.match(/(?:^|[.!?]\s+|,\s*)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+will\s+([^.!?]+)/);
    const nonNames = new Set(["He", "She", "They", "You", "It", "This", "That", "Someone", "Everyone"]);
    if (!match || nonNames.has(match[1])) return null;
    owner = match[1];
    task = match[2];
  }

  task = task.trim();
  if (task.length > 180 || task.split(/\s+/).length > 28) return null;
  const dueMatch = task.match(
    /\s+by\s+(today|tomorrow|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|end of (?:the )?day|EOD|next week)$/i);
  const due = dueMatch?.[1] || "No deadline captured";
  if (dueMatch) task = task.slice(0, dueMatch.index);
  task = task.charAt(0).toUpperCase() + task.slice(1);
  return { task, owner, due };
}

function parseAgentTask(text, actorName) {
  const clean = text.trim().replace(/[.!?]+$/, "");
  const withoutLead = clean.replace(
    /^(?:(?:hey\s+)?local\s*room[,\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?/i, "");
  let owner = actorName;
  let task;

  let match = withoutLead.match(/^remind\s+me\s+to\s+(.+)$/i);
  if (match) task = match[1];

  if (!task) {
    match = withoutLead.match(
      /^(?:create|add|capture|record|track)\s+(?:a\s+)?(?:task|action item|commitment)(?:\s+for\s+(.+?))?\s+(?:to|that)\s+(.+)$/i);
    if (match) {
      owner = match[1]?.trim() || actorName;
      task = match[2];
    }
  }

  if (!task) {
    match = withoutLead.match(/^make\s+sure\s+(I|we|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(.+)$/);
    if (match) {
      owner = /^I$/i.test(match[1]) ? actorName : (/^we$/i.test(match[1]) ? "Team" : match[1]);
      task = match[2];
    }
  }

  if (!task) return null;
  const dueMatch = task.match(
    /\s+by\s+(today|tomorrow|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|end of (?:the )?day|EOD|next week)$/i);
  const due = dueMatch?.[1] || "No deadline captured";
  if (dueMatch) task = task.slice(0, dueMatch.index);
  task = task.trim();
  task = task.charAt(0).toUpperCase() + task.slice(1);
  return { task, owner, due };
}

function commitmentCard(commitment, evidence, eyebrow) {
  return {
    type: "commitment",
    eyebrow,
    title: commitment.task,
    detail: `${commitment.owner} · ${commitment.due}`,
    evidence,
    confidence: 0.93,
    metadata: commitment,
    actions: [
      { id: "accept", label: "Accept commitment", primary: true },
      { id: "assign-me", label: "Assign to me" },
      { id: "dismiss", label: "Dismiss" },
    ],
  };
}

function parseDisclosure(text) {
  const looksLikeShare = /\b(?:send|share|email|forward)\b/i.test(text);
  const looksExternal = /\b(?:outside|external|vendor|outside-vendor\.com)\b/i.test(text);
  const looksRestricted = /\b(?:confidential|CUI|export[- ]controlled|conversion[- ]impact|thermal envelope|privileged)\b/i.test(text);
  if (!looksLikeShare || !looksExternal || !looksRestricted) return null;
  return {
    document: /thermal/i.test(text) ? "Falcon thermal envelope.pdf" : "Project Iliad conversion-impact analysis.pdf",
    classification: /(?:CUI|export[- ]controlled|thermal)/i.test(text) ? "CUI // EXPORT CONTROLLED" : "CONFIDENTIAL",
    recipient: "alex@outside-vendor.com",
  };
}

function inferPoll(text, captions) {
  const explicit = text.match(/(?:vote|poll)(?:\s+on)?\s+(.*?)(?:\s*:\s*|\s+between\s+)(.+?)\s+(?:or|versus|vs\.?)\s+(.+?)[?.!]?$/i);
  if (explicit) {
    return {
      question: `Which option should the room choose for ${explicit[1].replace(/\?$/, "")}?`,
      options: [explicit[2].trim(), explicit[3].trim()],
    };
  }
  const context = captions.slice(-6).map((caption) => caption.text).join(" ");
  if (/two[- ]step|three[- ]step|cancellation/i.test(context)) {
    return {
      question: "Which cancellation experience should Project Iliad advance?",
      options: ["Two-step guided flow", "Single-page immediate exit", "Run a controlled experiment"],
    };
  }
  return {
    question: "Which direction should the room advance?",
    options: ["Proceed with the current proposal", "Revise before proceeding", "Escalate for specialist review"],
  };
}

function publicParticipant({ socket: _socket, ...participant }) {
  return participant;
}

function sentence(text) {
  const clean = text.replace(/^(?:so\s+)?(?:we (?:have )?(?:decided|agreed)(?: that)?|decision(?: is)?|approved(?: that)?)[,:]?\s*/i, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1).replace(/[.!?]+$/, "");
}

function timelineTitle(card, action) {
  if (card.type === "security") return action === "review" ? "Security review requested; disclosure remains blocked" : "Unauthorized disclosure remained blocked";
  if (card.type === "commitment") return `Commitment accepted: ${card.title}`;
  if (card.type === "decision") return action === "confirm" ? `Decision confirmed: ${card.title}` : "Proposed decision dismissed";
  return card.title;
}

function seededTimeline(now) {
  const base = now().getTime();
  return [
    { id: "seed-1", at: new Date(base - 18 * 60_000).toISOString(), kind: "monitor", title: "Commitment monitor checked 7 open obligations", actor: "LocalRoom Agent" },
    { id: "seed-2", at: new Date(base - 52 * 60_000).toISOString(), kind: "security", title: "Vault access policy verified—0 exceptions", actor: "OpenShell" },
    { id: "seed-3", at: new Date(base - 3.2 * 3_600_000).toISOString(), kind: "memory", title: "Institutional memory indexed 42 internal records", actor: "LocalRoom Agent" },
  ];
}
