import assert from "node:assert/strict";
import test from "node:test";
import { LocalModelService } from "../local-services.js";
import { buildMeetingContext, groundMeetingAnswer } from "../meeting-context.js";
import { RoomIntelligence } from "../localroom-core.js";

test("meeting context exposes authoritative identity, attendance, and stats", () => {
  const intelligence = new RoomIntelligence();
  const room = intelligence.room("LAN-42");
  room.title = "Launch Readiness Review";
  room.organization = "Acme Labs";
  intelligence.addParticipant(room.id, { id: "maya", name: "Maya Chen", role: "Product" });
  intelligence.addCaption(room.id, {
    id: "utterance-1",
    participantId: "maya",
    name: "Maya Chen",
    text: "We decided to ship the private beta.",
    at: new Date().toISOString(),
  });

  const context = buildMeetingContext(room);
  assert.equal(context.meeting.title, "Launch Readiness Review");
  assert.equal(context.meeting.organization, "Acme Labs");
  assert.equal(context.participants.activeCount, 1);
  assert.deepEqual(context.participants.active, [{ name: "Maya Chen", role: "Product" }]);
  assert.equal(context.stats.utterances, 1);
  assert.equal(context.stats.confirmedDecisions, 1);
});

test("local model prompt receives live meeting context as authoritative data", async () => {
  let request;
  const models = new LocalModelService({
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Three people are active." } }] }),
      };
    },
  });
  const meeting = {
    meeting: { id: "LAN-42", title: "Launch Readiness Review", organization: "Acme Labs" },
    participants: {
      activeCount: 3,
      active: [{ name: "Maya Chen" }, { name: "Jordan Lee" }, { name: "Kevin Tang" }],
    },
    stats: { utterances: 14, confirmedDecisions: 2 },
  };

  await models.answer("qwen-30b", {
    question: "Who is here and what meeting is this?",
    transcript: "Maya Chen: Let's begin.",
    memory: "",
    meeting,
  });

  const prompt = request.messages[0].content;
  assert.match(prompt, /LIVE MEETING STATE \(authoritative JSON/);
  assert.match(prompt, /Launch Readiness Review/);
  assert.match(prompt, /Maya Chen/);
  assert.match(prompt, /\"activeCount\": 3/);
  assert.match(prompt, /\"confirmedDecisions\": 2/);
});

test("agent fails over from an unavailable selected model to healthy Nemotron", async () => {
  const calls = [];
  const models = new LocalModelService({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/models")) {
	if (url.includes("8090")) {
	  return { ok: true, json: async () => ({ data: [{ id: "nemotron-3-nano-30b-a3b" }] }) };
	}
	throw new TypeError("fetch failed");
      }
      if (url.includes("8090/v1/chat/completions")) {
	return {
	  ok: true,
	  json: async () => ({ choices: [{ message: { content: "Healthy local answer." } }] }),
	};
      }
      throw new TypeError("fetch failed");
    },
  });

  await models.models();
  const result = await models.answer("qwen-30b", {
    question: "What did I miss?",
    transcript: "",
    memory: "",
    meeting: { meeting: { id: "ROOM" }, participants: {}, stats: {} },
  });

  assert.equal(result.model, "nemotron-30b");
  assert.equal(result.text, "Healthy local answer.");
  assert.equal(calls.some((url) => url.includes("8080/chat/completions")), false);
});

test("live meeting facts override a model's stale closing summary", () => {
  const meeting = {
    meeting: { status: "live" },
    participants: { activeCount: 2 },
    stats: { confirmedDecisions: 0, actionItems: 5, openQuestions: 1 },
  };
  const answer = groundMeetingAnswer(
    "The meeting ended with no decision recorded and no action items confirmed.",
    meeting,
  );

  assert.equal(
    answer,
    "The meeting is still live. No decision is recorded yet. 5 action items captured.",
  );
});
