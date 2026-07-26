// Module tests for the one virtual clock's pure core (apps/console/src/clock-core.ts).
// Node strips the TypeScript on import, so these run under the repo's existing
// `node --test` runner with no extra toolchain.
//
// What is deliberately NOT covered here: the rAF driver and the React hooks in
// clock.ts, which need a DOM. Those are proven by the browser E2E pass.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_EPOCH_BASE,
  advanceDemoMs,
  agoLabel,
  applyPlan,
  beatIndexAt,
  beatTarget,
  displaySecond,
  liveMeetingMs,
  mmss,
  nowMsFor,
  parseStampMs,
  resolveInitial,
  resolveReplay,
  sortSchedule,
} from "../apps/console/src/clock-core.ts";

import {
  BEATS,
  DEMO_REAL_RUNTIME_MS,
  DEMO_RESOLUTION_MEETING_MS,
  DEMO_START_MEETING_MS,
  DEMO_TIME_SCALE,
} from "../apps/console/src/beats.ts";

// ------------------------------------------------------------- live mode

test("live mode derives meeting time from started_at plus wall clock", () => {
  const startedAt = 1_700_000_000_000;
  assert.equal(liveMeetingMs(startedAt, startedAt), 0);
  assert.equal(liveMeetingMs(startedAt, startedAt + 37_000), 37_000);
});

test("live mode clamps to zero before the session starts", () => {
  const startedAt = 1_700_000_000_000;
  assert.equal(liveMeetingMs(startedAt, startedAt - 5_000), 0);
  assert.equal(liveMeetingMs(null, startedAt), 0);
});

test("live mode measures 'ago' against wall time, not the meeting axis", () => {
  const wall = 1_700_000_000_000;
  assert.equal(nowMsFor("live", 42_000, wall - 42_000, wall), wall);
});

// ------------------------------------------------------------- demo mode

test("demo mode advances by frame delta times TIME_SCALE", () => {
  assert.equal(advanceDemoMs(0, 100, 2, true), 200);
  assert.equal(advanceDemoMs(1_000, 250, 2, true), 1_500);
});

test("demo mode does not advance while paused — this is what freezes counters", () => {
  assert.equal(advanceDemoMs(5_000, 100, 2, false), 5_000);
  // Many paused frames must be indistinguishable from one.
  let ms = 5_000;
  for (let i = 0; i < 600; i += 1) ms = advanceDemoMs(ms, 16.7, 2, false);
  assert.equal(ms, 5_000);
});

test("demo mode ignores non-advancing or nonsense frame deltas", () => {
  assert.equal(advanceDemoMs(1_000, 0, 2, true), 1_000);
  assert.equal(advanceDemoMs(1_000, -50, 2, true), 1_000);
  assert.equal(advanceDemoMs(1_000, Number.NaN, 2, true), 1_000);
});

test("demo mode anchors 'ago' to the fixed synthetic epoch, so pause freezes it", () => {
  const wallA = 1_700_000_000_000;
  const wallB = wallA + 90_000; // a judge interrupts for 90 s
  const meeting = DEMO_START_MEETING_MS;
  assert.equal(nowMsFor("demo", meeting, null, wallA), DEMO_EPOCH_BASE + meeting);
  assert.equal(
    nowMsFor("demo", meeting, null, wallB),
    nowMsFor("demo", meeting, null, wallA),
    "wall time moved but the demo clock did not",
  );
});

// --------------------------------------------------- the designed beat run

test("the scripted window is 37:52 to 47:52 and 5:00 of real time at 2x", () => {
  assert.equal(DEMO_TIME_SCALE, 2);
  assert.equal(mmss(DEMO_START_MEETING_MS / 1000), "37:52");
  assert.equal(mmss(DEMO_RESOLUTION_MEETING_MS / 1000), "47:52");
  assert.equal(DEMO_REAL_RUNTIME_MS, 300_000);
});

test("playing the window frame by frame lands on 47:52 in 5:00 of real time", () => {
  const FRAME_MS = 16.7;
  let meeting = DEMO_START_MEETING_MS;
  let realMs = 0;
  while (meeting < DEMO_RESOLUTION_MEETING_MS) {
    meeting = advanceDemoMs(meeting, FRAME_MS, DEMO_TIME_SCALE, true);
    realMs += FRAME_MS;
  }
  // Within one frame of the designed mark, in both axes.
  assert.ok(
    Math.abs(meeting - DEMO_RESOLUTION_MEETING_MS) <= FRAME_MS * DEMO_TIME_SCALE,
    `landed at ${meeting}`,
  );
  assert.ok(Math.abs(realMs - DEMO_REAL_RUNTIME_MS) <= FRAME_MS, `took ${realMs} ms real`);
});

test("every beat sits inside the designed window", () => {
  assert.ok(BEATS.length > 1);
  for (const beat of BEATS) {
    assert.ok(
      beat.atMeetingMs >= DEMO_START_MEETING_MS &&
        beat.atMeetingMs <= DEMO_RESOLUTION_MEETING_MS,
      `${beat.id} at ${beat.atMeetingMs} is outside 37:52–47:52`,
    );
  }
});

// ------------------------------------------------------------ beat jumps

const beats = sortSchedule([
  { id: "b1", atMeetingMs: 0 },
  { id: "b3", atMeetingMs: 20_000 },
  { id: "b2", atMeetingMs: 10_000 },
]);

test("beats sort by meeting time regardless of authoring order", () => {
  assert.deepEqual(
    beats.map((b) => b.id),
    ["b1", "b2", "b3"],
  );
});

test("beatIndexAt reports the beat currently in effect", () => {
  assert.equal(beatIndexAt(beats, -1), -1);
  assert.equal(beatIndexAt(beats, 0), 0);
  assert.equal(beatIndexAt(beats, 9_999), 0);
  assert.equal(beatIndexAt(beats, 10_000), 1);
  assert.equal(beatIndexAt(beats, 999_999), 2);
});

test("arrow keys snap to strict boundaries and run out at the ends", () => {
  assert.equal(beatTarget(beats, 0, 1)?.id, "b2");
  assert.equal(beatTarget(beats, 15_000, 1)?.id, "b3");
  assert.equal(beatTarget(beats, 20_000, 1), null);
  assert.equal(beatTarget(beats, 20_000, -1)?.id, "b2");
  assert.equal(beatTarget(beats, 15_000, -1)?.id, "b2");
  assert.equal(beatTarget(beats, 0, -1), null);
});

test("forward then back returns the playhead to where it started", () => {
  const forward = beatTarget(beats, 10_000, 1);
  assert.equal(forward?.id, "b3");
  const back = beatTarget(beats, forward.atMeetingMs, -1);
  assert.equal(back?.atMeetingMs, 10_000, "left and right are exact inverses");
});

// -------------------------------------------------------- scrub / replay

const schedule = sortSchedule([
  { id: "e1", atMeetingMs: 1_000 },
  { id: "e2", atMeetingMs: 5_000 },
  { id: "e3", atMeetingMs: 9_000 },
  { id: "e4", atMeetingMs: 14_000 },
]);

/** Stand-in for the console: rebuilds from empty on reset, appends otherwise. */
function makeConsumer() {
  const applied = new Set();
  const rows = [];
  return {
    rows,
    applied,
    seek(from, to) {
      const plan = resolveReplay(schedule, from, to);
      if (plan.reset) rows.length = 0;
      for (const event of applyPlan(applied, plan)) rows.push(event.id);
      return plan;
    },
  };
}

test("a forward run applies each event exactly once", () => {
  const c = makeConsumer();
  c.seek(0, 6_000);
  c.seek(6_000, 15_000);
  assert.deepEqual(c.rows, ["e1", "e2", "e3", "e4"]);
});

test("landing cold on a mark includes an event sitting exactly on it", () => {
  const onTheMark = sortSchedule([{ id: "start", atMeetingMs: 1_000 }]);
  // Forward playback is half-open, so a cold start must not use it.
  assert.deepEqual(resolveReplay(onTheMark, 1_000, 1_000).apply, []);
  assert.deepEqual(
    resolveInitial(onTheMark, 1_000).apply.map((e) => e.id),
    ["start"],
  );
  assert.equal(resolveInitial(onTheMark, 1_000).reset, true);
});

test("a backward jump resets and replays from zero", () => {
  const c = makeConsumer();
  c.seek(0, 15_000);
  const plan = c.seek(15_000, 6_000);
  assert.equal(plan.reset, true);
  assert.deepEqual(c.rows, ["e1", "e2"]);
});

test("scrubbing back and forth duplicates nothing", () => {
  const c = makeConsumer();
  for (const [from, to] of [
    [0, 15_000],
    [15_000, 3_000],
    [3_000, 15_000],
    [15_000, 0],
    [0, 15_000],
    [15_000, 9_000],
    [9_000, 15_000],
  ]) {
    c.seek(from, to);
  }
  assert.deepEqual(c.rows, ["e1", "e2", "e3", "e4"]);
  assert.equal(new Set(c.rows).size, c.rows.length, "no duplicated ledger lines");
});

test("scrubbing to the same position is idempotent", () => {
  const c = makeConsumer();
  c.seek(0, 9_000);
  const before = [...c.rows];
  c.seek(9_000, 9_000);
  c.seek(9_000, 9_000);
  assert.deepEqual(c.rows, before);
});

test("a repeated backward jump converges on the same state", () => {
  const a = makeConsumer();
  a.seek(0, 15_000);
  a.seek(15_000, 5_000);

  const b = makeConsumer();
  b.seek(0, 5_000);

  assert.deepEqual(a.rows, b.rows, "rewound state equals a clean run to the same mark");
});

// ------------------------------------------------------------ display 1 Hz

test("displaySecond is the render gate — sub-second motion changes nothing", () => {
  assert.equal(displaySecond(0), 0);
  assert.equal(displaySecond(999), 0);
  assert.equal(displaySecond(1_000), 1);
  assert.equal(displaySecond(1_999), 1);
});

test("60 fps of frames costs one render per displayed second, not per frame", () => {
  const FRAMES = 300; // 5 s of real time at 60 fps → 10 s of meeting time at 2x
  let ms = 0;
  let crossings = 0;
  let previous = displaySecond(ms);
  for (let i = 0; i < FRAMES; i += 1) {
    ms = advanceDemoMs(ms, 1000 / 60, DEMO_TIME_SCALE, true);
    const current = displaySecond(ms);
    if (current !== previous) crossings += 1;
    previous = current;
  }
  // Exact regardless of float drift: a monotonic sequence with sub-second
  // steps crosses each boundary once, so crossings is the final second index.
  assert.equal(crossings, displaySecond(ms));
  assert.ok(crossings * 10 < FRAMES, `${crossings} renders for ${FRAMES} frames`);
});

test("a paused clock crosses no display boundary at all", () => {
  let ms = 12_500;
  let crossings = 0;
  let previous = displaySecond(ms);
  for (let i = 0; i < 600; i += 1) {
    ms = advanceDemoMs(ms, 1000 / 60, DEMO_TIME_SCALE, false);
    const current = displaySecond(ms);
    if (current !== previous) crossings += 1;
    previous = current;
  }
  assert.equal(crossings, 0, "ten seconds of frames while paused, zero re-renders");
});

test("mmss and agoLabel render mm:ss and never go negative", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(9), "0:09");
  assert.equal(mmss(72), "1:12");
  assert.equal(mmss(2_272), "37:52");
  assert.equal(agoLabel(1_000, 13_000), "0:12");
  assert.equal(agoLabel(13_000, 1_000), "0:00", "a stamp from the future reads as now");
});

test("parseStampMs accepts ISO, epoch ms, and nothing", () => {
  assert.equal(parseStampMs("2026-07-26T16:00:00.000Z"), DEMO_EPOCH_BASE);
  assert.equal(parseStampMs(1_234), 1_234);
  assert.equal(parseStampMs(null), null);
  assert.equal(parseStampMs(undefined), null);
  assert.equal(parseStampMs("not a date"), null);
});
