import assert from "node:assert/strict";
import test from "node:test";
import { selectSpeakerCandidate } from "../audio-arbitration.js";

test("selects the mic with clearly dominant gain", () => {
  const near = { participantId: "near", snrDb: 22 };
  const far = { participantId: "far", snrDb: 13 };
  const result = selectSpeakerCandidate([far, near]);
  assert.equal(result.winner, near);
  assert.equal(result.reason, "dominant-mic");
  assert.ok(result.confidence > 0.9);
});

test("suppresses ambiguous adjacent microphones", () => {
  const result = selectSpeakerCandidate([
    { participantId: "left", snrDb: 18.5 },
    { participantId: "right", snrDb: 17.4 },
  ]);
  assert.equal(result.winner, null);
  assert.equal(result.reason, "ambiguous-nearby-mics");
});

test("suppresses room noise", () => {
  const result = selectSpeakerCandidate([{ participantId: "room", snrDb: 5 }]);
  assert.equal(result.winner, null);
  assert.equal(result.reason, "below-speech-floor");
});
