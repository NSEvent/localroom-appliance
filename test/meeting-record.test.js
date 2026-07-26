import assert from "node:assert/strict";
import test from "node:test";
import {
  addRecordParticipant,
  answerRecordQuestion,
  closeRecord,
  createMeetingRecord,
  ingestRecordCaption,
  patchRecordEntity,
} from "../meeting-record.js";

function caption(id, name, text) {
  return {
    id,
    participantId: name.toLowerCase(),
    name,
    text,
    at: new Date(Date.UTC(2026, 6, 26, 19, 0, Number(id.split("_").at(-1)))).toISOString(),
    demo: true,
  };
}

test("live transcript becomes a structured meeting record with deterministic gaps", () => {
  const record = createMeetingRecord("DELL-DEMO", "Project Iliad Review", new Date("2026-07-26T19:00:00Z"));
  ingestRecordCaption(record, caption("utt_001", "Maya",
    "We decided that the cancellation experience will use a two-step guided flow."));
  ingestRecordCaption(record, caption("utt_002", "Maya",
    "I will send the prototype to Legal by Friday."));
  ingestRecordCaption(record, caption("utt_003", "Jordan",
    "Someone should send the final specification to the vendor before Friday."));

  assert.equal(record.session.status, "live");
  assert.equal(record.decisions[0].status, "decided");
  assert.deepEqual(
    record.action_items.map(({ owner, deadline }) => ({ owner, deadline })),
    [{ owner: "Maya", deadline: "Friday" }, { owner: null, deadline: "Friday" }],
  );
  assert.equal(record.alerts.find((item) => item.type === "unowned_action")?.status, "active");
  assert.match(record.meeting_summary, /1 still needs an owner or deadline/);
});

test("live participant identity replaces its matching planned attendee", () => {
  const record = createMeetingRecord("DELL-DEMO", "Review");
  addRecordParticipant(record, { id: "setup-1", name: "Maya", role: "Product" });
  addRecordParticipant(record, { id: "live-maya", name: "Maya", role: null });

  assert.deepEqual(record.participants, [{ id: "live-maya", name: "Maya", role: null }]);
});

test("host edits lock state and automatically resolve the matching rule alert", () => {
  const record = createMeetingRecord("DELL-DEMO", "Review");
  ingestRecordCaption(record, caption("utt_001", "Jordan",
    "Someone should send the final specification to the vendor before Friday."));
  const action = record.action_items[0];
  const patched = patchRecordEntity(record, action.id, { owner: "Jordan" });

  assert.equal(patched.owner, "Jordan");
  assert.equal(patched.host_locked, true);
  assert.equal(record.alerts.find((item) => item.type === "unowned_action")?.status, "resolved");
  assert.doesNotMatch(record.follow_up_email.body, /OWNER NEEDED/);
});

test("closing sweep promotes open questions to high-severity alerts", () => {
  const record = createMeetingRecord("DELL-DEMO", "Review");
  ingestRecordCaption(record, caption("utt_001", "Jordan",
    "Does Legal approve sharing the internal analysis outside the company?"));
  closeRecord(record);

  assert.equal(record.session.status, "closing");
  assert.equal(record.alerts.find((item) => item.type === "open_question_at_close")?.severity, "high");
});

test("meeting Q&A answers from the authoritative record with evidence ids", () => {
  const record = createMeetingRecord("DELL-DEMO", "Review");
  ingestRecordCaption(record, caption("utt_001", "Jordan",
    "Someone should send the final specification to the vendor before Friday."));
  const qa = answerRecordQuestion(record, "What is still unresolved?", "Kevin");

  assert.equal(qa.status, "answered");
  assert.match(qa.answer, /has no owner/i);
  assert.deepEqual(qa.source_utterance_ids, ["utt_001"]);
});
