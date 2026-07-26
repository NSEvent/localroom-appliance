// The one virtual clock, proven in a real browser (PRD 225 / DEMO_SCRIPT.md).
//
// The PRD asks for screen recordings as evidence. Recordings rot — they prove
// the build that made them and nothing after. These assert the same properties
// against every future build instead: pause freezes EVERY counter in the same
// frame, ←/→ land on beat boundaries, and the two keys are exact inverses.
//
// The HUD (?clockhud=1) is the readout under test; it renders straight from
// the hook every panel counter uses, so freezing it is freezing them.

import { expect, test } from "@playwright/test";

const ROOM = "E2E-CLOCK";
const HUD = ".clock-hud";

/** Every time-derived string on screen, sampled in one go. */
async function readCounters(page) {
  return {
    live: await page.locator(`${HUD} .clock-hud-val.strong`).innerText(),
    now: await page.locator(`${HUD} .clock-hud-row`).nth(2).locator(".clock-hud-val").innerText(),
    beat: await page.locator(`${HUD} .clock-hud-row`).nth(1).locator(".clock-hud-val").innerText(),
    panels: await page.locator(".panel-foot").allInnerTexts(),
  };
}

test("demo mode runs the clock, and Space freezes every counter at once", async ({ page }) => {
  await page.goto(`/console/session/${ROOM}?demo=1&clockhud=1`);
  await expect(page.locator(HUD)).toBeVisible();

  // The console joins a meeting already in progress, per the script.
  await expect(page.locator(`${HUD} .clock-hud-val.strong`)).toHaveText(/^3[78]:/);
  await expect(page.locator(`${HUD} .clock-hud-mode`)).toHaveText("demo");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/playing/);

  // It is actually running.
  const started = await readCounters(page);
  await page.waitForTimeout(2_500);
  const running = await readCounters(page);
  expect(running.live).not.toEqual(started.live);

  // Space — the judge interrupts.
  await page.keyboard.press("Space");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/paused/);

  // Settle past the frame the key landed on, then sample twice, far apart.
  await page.waitForTimeout(500);
  const frozenA = await readCounters(page);
  await page.waitForTimeout(10_000);
  const frozenB = await readCounters(page);

  expect(frozenB).toEqual(frozenA);

  // Resume: the same clock picks up where it stopped, not where wall time got to.
  await page.keyboard.press("Space");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/playing/);
  await page.waitForTimeout(1_500);
  const resumed = await readCounters(page);
  expect(resumed.live).not.toEqual(frozenB.live);
});

test("arrow keys jump beat boundaries and are exact inverses", async ({ page }) => {
  await page.goto(`/console/session/${ROOM}?demo=1&clockhud=1`);
  await expect(page.locator(HUD)).toBeVisible();

  // Pause first so playback drift cannot be mistaken for a jump.
  await page.keyboard.press("Space");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/paused/);

  const beatValue = page.locator(`${HUD} .clock-hud-row`).nth(1).locator(".clock-hud-val");
  const liveValue = page.locator(`${HUD} .clock-hud-val.strong`);

  await page.keyboard.press("ArrowRight");
  await expect(beatValue).toHaveText(/^2 \/ /);
  const afterFirst = await liveValue.innerText();

  await page.keyboard.press("ArrowRight");
  await expect(beatValue).toHaveText(/^3 \/ /);
  const afterSecond = await liveValue.innerText();
  expect(afterSecond).not.toEqual(afterFirst);

  // Back lands exactly where forward came from — the property the scrub-stress
  // idempotency argument rests on.
  await page.keyboard.press("ArrowLeft");
  await expect(beatValue).toHaveText(/^2 \/ /);
  expect(await liveValue.innerText()).toEqual(afterFirst);

  // Jumping does not resume playback.
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/paused/);
});

test("a scrub stress round-trips the playhead and duplicates no state", async ({ page }) => {
  await page.goto(`/console/session/${ROOM}?demo=1&clockhud=1`);
  await expect(page.locator(HUD)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/paused/);

  const beatValue = page.locator(`${HUD} .clock-hud-row`).nth(1).locator(".clock-hud-val");
  const liveValue = page.locator(`${HUD} .clock-hud-val.strong`);
  const transcriptRows = page.locator(".utt");

  await expect(beatValue).toHaveText(/^1 \/ /);
  const openingLive = await liveValue.innerText();
  const openingRows = await transcriptRows.count();

  // Net zero: +1 +1 -1 +1 -1 -1. If any jump were lossy or a replay
  // double-applied, the playhead would not come home.
  for (const key of [
    "ArrowRight",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowLeft",
  ]) {
    await page.keyboard.press(key);
  }

  await expect(beatValue).toHaveText(/^1 \/ /);
  expect(await liveValue.innerText()).toEqual(openingLive);

  // NOTE: with DEMO_EVENTS still empty (beats.ts — the beat *content* half of
  // the DEMO_SCRIPT.md landing is deferred), there are no scheduled transcript
  // rows to duplicate yet, so this count is currently 0 === 0. It is a
  // regression guard that arms itself the moment the real table lands; the
  // de-duplication logic it guards is unit-tested in test/console-clock.test.js.
  expect(await transcriptRows.count()).toEqual(openingRows);
});

test("Space belongs to the question box while the operator is typing", async ({ page }) => {
  await page.goto(`/console/session/${ROOM}?demo=1&clockhud=1`);
  await expect(page.locator(HUD)).toBeVisible();

  const question = page.getByPlaceholder('Ask the meeting… e.g. "what is still unresolved?"');
  await question.fill("who owns");
  await question.press("Space");
  await question.type("this");

  await expect(question).toHaveValue("who owns this");
  await expect(page.locator(`${HUD} .clock-hud-state`)).toHaveText(/playing/);
});

test("live mode exposes no demo scaffolding", async ({ page }) => {
  await page.goto(`/console/session/${ROOM}?clockhud=1`);
  await expect(page.locator(HUD)).toBeVisible();
  await expect(page.locator(`${HUD} .clock-hud-mode`)).toHaveText("live");

  // Presenter keys are demo-only: Space must not pause a live room.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`${HUD} .clock-hud-mode`)).toHaveText("live");
  await expect(page.locator(`${HUD} .clock-hud-foot`)).toHaveCount(0);
});
