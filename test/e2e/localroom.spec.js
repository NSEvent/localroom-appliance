import { expect, test } from "@playwright/test";

test("console host setup creates the shared room and console root recovers it", async ({ page, request }) => {
  await page.goto("/console/host");
  await expect(page.getByText("LocalRoom", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Meeting title")).toHaveValue("Project Iliad Cancellation Review");
  await page.getByRole("button", { name: "Start session" }).click();

  await expect(page).toHaveURL(/\/console\/session\/DELL-DEMO$/);
  await expect(page.getByText("LAN participant audio")).toBeVisible();
  const stateResponse = await request.get("/api/sessions/DELL-DEMO/state");
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  expect(state.participants.map((participant) => participant.name)).toEqual(["Maya", "Jordan"]);

  await page.goto("/console/");
  await expect(page).toHaveURL(/\/console\/session\/DELL-DEMO$/);
  await expect(page.getByText("No cloud APIs")).toBeVisible();
});

test("participant joins the private WebRTC room and receives a governed policy card", async ({ page, request }) => {
  await page.goto("/?room=E2E-POLICY");
  await expect(page.getByRole("heading", { name: "The intelligence stays in the room." })).toBeVisible();
  await page.getByRole("textbox", { name: "Your name" }).fill("Maya");
  await page.getByRole("button", { name: "Enter private workspace →" }).click();

  await expect(page.getByText("0 B CLOUD EGRESS")).toBeVisible();
  await expect(page.getByText("Listening for Pork Chop")).toBeVisible();

  const injected = await request.post("/api/demo/caption", {
    data: {
      roomId: "E2E-POLICY",
      participantId: "maya",
      name: "Maya",
      text: "Send the confidential Project Iliad conversion-impact analysis to the outside vendor.",
    },
  });
  expect(injected.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "External disclosure blocked" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep blocked" })).toBeVisible();
});

test("web and iOS clients share one room roster and WebRTC authority", async ({ page, request }) => {
  const iosPage = await page.context().newPage();
  await page.goto("/?room=E2E-SHARED&autojoin=1&name=Web%20Client");
  await iosPage.goto("/?room=E2E-SHARED&autojoin=1&name=LocalRoom%20iOS");

  await expect(page.locator("#participant-count")).toHaveText("2 participants + agent");
  await expect(iosPage.locator("#participant-count")).toHaveText("2 participants + agent");
  const roomResponse = await request.get("/api/rooms/E2E-SHARED");
  const room = await roomResponse.json();
  expect(room.participants.map((participant) => participant.name).sort())
    .toEqual(["LocalRoom iOS", "Web Client"]);

  await iosPage.close();
  await expect(page.locator("#participant-count")).toHaveText("1 participant + agent");
});

test("return to meeting resumes ended server state", async ({ page, request }) => {
  await page.goto("/?room=E2E-RESUME&autojoin=1&name=Kevin");
  await expect(page.locator("#participant-count")).toHaveText("1 participant + agent");
  await page.getByRole("button", { name: "End meeting" }).click();
  await expect(page.getByRole("button", { name: "Return to meeting" })).toBeVisible();

  let state = await (await request.get("/api/sessions/E2E-RESUME/state")).json();
  expect(state.session.status).toBe("ended");
  await page.getByRole("button", { name: "Return to meeting" }).click();
  await expect(page.getByRole("button", { name: "End meeting" })).toBeVisible();
  state = await (await request.get("/api/sessions/E2E-RESUME/state")).json();
  expect(state.session.status).toBe("live");
  expect(state.session.ended_at).toBeNull();
});

test("projector console tracks decisions, resolves owner gaps, answers questions, and exports", async ({ page, request }) => {
  const roomId = "E2E-CONSOLE";
  const seeded = await request.post(`/api/sessions/${roomId}/utterances`, {
    data: {
      utterances: [
        {
          id: "utt_001",
          speaker: "Maya",
          text: "We decided that the cancellation experience will use a two-step guided flow.",
        },
        {
          id: "utt_002",
          speaker: "Maya",
          text: "I will send the prototype to Legal by Friday.",
        },
        {
          id: "utt_003",
          speaker: "Jordan",
          text: "Someone should send the final specification to the vendor before Friday.",
        },
        {
          id: "utt_004",
          speaker: "Jordan",
          text: "Does Legal approve sharing the internal analysis outside the company?",
        },
      ],
    },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.goto(`/console/session/${roomId}`);
  await expect(page.getByText("Qwen 3 · 30B")).toBeVisible();
  await expect(page.getByText("No cloud APIs")).toBeVisible();
  await expect(page.getByText("The cancellation experience will use a two-step guided flow", { exact: true })).toBeVisible();
  await expect(page.getByText("Action item has no owner: Send the final specification to the vendor", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "click to assign" }).click();
  const ownerEditor = page.locator("input.inline-edit");
  await ownerEditor.fill("Jordan");
  await ownerEditor.press("Enter");
  const ownerCard = page.locator('[data-entity="act_002"]');
  await expect(ownerCard.getByText("Jordan", { exact: true })).toBeVisible();
  await expect(page.getByText("resolved (1)")).toBeVisible();

  const question = page.getByPlaceholder('Ask the meeting… e.g. "what is still unresolved?"');
  await question.fill("Who owns the follow-up?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Send the final specification to the vendor: Jordan/)).toBeVisible();

  await page.getByRole("button", { name: "Closing Sweep" }).click();
  await expect(page.getByText(/Still open at close: Does Legal approve/)).toBeVisible();

  const exported = await request.get(`/api/sessions/${roomId}/export.md`);
  expect(exported.ok()).toBeTruthy();
  const markdown = await exported.text();
  expect(markdown).toContain("# Project Iliad Cancellation Review");
  expect(markdown).toContain("Jordan");
  expect(markdown).toContain("No meeting content left the appliance");

  await page.reload();
  await expect(page.locator('[data-entity="act_002"]').getByText("Jordan", { exact: true })).toBeVisible();
  await expect(page.getByText(/Still open at close: Does Legal approve/)).toBeVisible();
});

test("participant surface remains usable at iPhone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?room=E2E-MOBILE");

  await expect(page.getByRole("heading", { name: "The intelligence stays in the room." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your name" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Enter private workspace →" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Open room console →" })).toBeVisible();
});
