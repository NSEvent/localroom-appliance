import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFromMemory, authorizeShare, extractWakePrompt, RoomIntelligence,
} from "../localroom-core.js";

function harness() {
  let tick = 0;
  return new RoomIntelligence({
    id: () => `id-${++tick}`,
    now: () => new Date(`2026-07-26T20:${String(tick).padStart(2, "0")}:00Z`),
  });
}

function caption(text, name = "Maya Chen") {
  return { id: crypto.randomUUID(), participantId: "maya", name, text, at: new Date().toISOString() };
}

test("decision cards are queued and first valid resolution wins globally", () => {
  const system = harness();
  const room = system.room("DELL-DEMO");
  system.addParticipant(room.id, { id: "maya", name: "Maya Chen" });
  system.addParticipant(room.id, { id: "kevin", name: "Kevin Tang" });
  const [card] = system.addCaption(room.id, caption("We decided that the cancellation flow will use two steps."));
  assert.equal(card.type, "decision");
  assert.equal(system.snapshot(room.id).cards.length, 1, "decision language must not double-trigger a commitment");
  assert.equal(system.snapshot(room.id).activeCard.id, card.id);

  const winner = system.resolve(room.id, {
    cardId: card.id, version: 1, action: "confirm", actorId: "kevin", actorName: "Kevin Tang",
  });
  const loser = system.resolve(room.id, {
    cardId: card.id, version: 1, action: "dismiss", actorId: "maya", actorName: "Maya Chen",
  });
  assert.equal(winner.ok, true);
  assert.equal(loser.ok, false);
  assert.equal(loser.reason, "already-resolved");
});

test("commitment resolution creates an always-on monitored obligation", () => {
  const system = harness();
  const room = system.room("DELL-DEMO");
  const [card] = system.addCaption(room.id, caption("I will send the revised prototype to Legal by Friday."));
  const result = system.resolve(room.id, {
    cardId: card.id, version: 1, action: "accept", actorId: "maya", actorName: "Maya Chen",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(system.snapshot(room.id).commitments[0], {
    id: "id-2",
    task: "Send the revised prototype to Legal",
    owner: "Maya Chen",
    due: "Friday",
    status: "monitoring",
    sourceCardId: card.id,
  });
});

test("natural agent prompts create confirmable task cards", () => {
  const system = harness();
  const room = system.room("DELL-DEMO");
  const reminder = system.proposeTaskFromPrompt(
    room.id, "Can you remind me to send the revised prototype to Legal by Friday?", "Kevin Tang");
  assert.equal(reminder.type, "commitment");
  assert.equal(reminder.title, "Send the revised prototype to Legal");
  assert.equal(reminder.metadata.owner, "Kevin Tang");
  assert.equal(reminder.metadata.due, "Friday");

  system.resolve(room.id, {
    cardId: reminder.id, version: 1, action: "accept", actorId: "kevin", actorName: "Kevin Tang",
  });
  const assigned = system.proposeTaskFromPrompt(
    room.id, "Create a task for Maya Chen to prepare the legal review by tomorrow.", "Kevin Tang");
  assert.equal(assigned.metadata.owner, "Maya Chen");
  assert.equal(assigned.metadata.task, "Prepare the legal review");
  assert.equal(assigned.metadata.due, "tomorrow");
});

test("agent answers do not invent commitments from their own speech", () => {
  const system = harness();
  const proposals = system.addCaption("DELL-DEMO", {
    ...caption("I will monitor that task for you.", "LocalRoom Agent"),
    source: "agent",
  });
  assert.deepEqual(proposals, []);
});

test("poll stays open until all participants vote and rejects repeat votes", () => {
  const system = harness();
  const room = system.room("DELL-DEMO");
  system.addParticipant(room.id, { id: "maya", name: "Maya" });
  system.addParticipant(room.id, { id: "kevin", name: "Kevin" });
  const [poll] = system.addCaption(room.id, caption("Let's vote on the cancellation experience between two steps or one page."));
  assert.equal(poll.type, "poll");
  const first = system.resolve(room.id, {
    cardId: poll.id, version: 1, action: "option-1", actorId: "maya", actorName: "Maya",
  });
  assert.equal(first.pollOpen, true);
  const repeat = system.resolve(room.id, {
    cardId: poll.id, version: 2, action: "option-2", actorId: "maya", actorName: "Maya",
  });
  assert.equal(repeat.reason, "already-voted");
  const second = system.resolve(room.id, {
    cardId: poll.id, version: 2, action: "option-1", actorId: "kevin", actorName: "Kevin",
  });
  assert.equal(second.pollOpen, false);
  assert.equal(system.snapshot(room.id).activeCard, null);
});

test("restricted external disclosure is denied with an explainable security card", () => {
  const decision = authorizeShare({
    document: "Project Iliad conversion-impact analysis.pdf",
    classification: "CONFIDENTIAL",
    recipient: "alex@outside-vendor.com",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "EXTERNAL_RECIPIENT_NOT_AUTHORIZED");

  const system = harness();
  const [card] = system.addCaption("DELL-DEMO", caption(
    "Send the confidential Project Iliad conversion-impact analysis to the outside vendor."));
  assert.equal(card.type, "security");
  assert.equal(card.locked, true);
  assert.match(card.detail, /lacks Project Iliad access/);
  assert.ok(!card.actions.some((action) => action.id === "send"));
});

test("institutional memory answers are grounded with wiki-style citations", () => {
  const result = answerFromMemory("Why did we reject the previous cancellation design?");
  assert.match(result.answer, /multi-page cancellation flow/);
  assert.deepEqual(result.citations, ["[[cancellation-review-2026-07-19]]", "[[project-iliad]]"]);
});

test("Pork Chop wake word tolerates likely ASR spellings", () => {
  assert.equal(
    extractWakePrompt("Pork Chop, can you remind me what Project Iliad is?"),
    "can you remind me what Project Iliad is?");
  assert.equal(
    extractWakePrompt("Hey pork shop — who owns the revised flow?"),
    "who owns the revised flow?");
  assert.equal(extractWakePrompt("Porkchop: what did we decide?"), "what did we decide?");
  assert.equal(
    extractWakePrompt("Okay, port job. Can you remind me what Project Iliad is?"),
    "Can you remind me what Project Iliad is?");
  assert.equal(extractWakePrompt("Can you remind me what Project Iliad is?"), null);
});

test("Project Iliad identity question has a deterministic cited answer", () => {
  const result = answerFromMemory("Can you remind me what Project Iliad is?");
  assert.match(result.answer, /historical effort to simplify Prime cancellation/);
  assert.deepEqual(result.citations, ["[[project-iliad]]"]);
});

test("post-meeting handoff contains actions and monitored commitments", () => {
  const system = harness();
  const room = system.room("DELL-DEMO");
  const [card] = system.addCaption(room.id, caption("I will send the revised prototype to Legal by Friday."));
  system.resolve(room.id, {
    cardId: card.id, version: 1, action: "accept", actorId: "maya", actorName: "Maya Chen",
  });
  const brief = system.endMeeting(room.id, "Kevin Tang");
  assert.equal(brief.commitments.length, 1);
  assert.deepEqual(brief.artifacts.map((item) => item.service), ["Vault", "Tasks", "Mailroom", "Calendar"]);
});
