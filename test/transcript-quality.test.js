import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkCorrection,
  Glossary,
  phoneticKey,
  RecognitionArchive,
  soundsLike,
} from "../transcript-quality.js";

test("phonetic matching recognizes ASR near-misses without equating unrelated terms", () => {
  assert.equal(phoneticKey("Quinn"), phoneticKey("Qwen"));
  assert.equal(soundsLike("Quinn", "Qwen"), true);
  assert.equal(soundsLike("Nemotron", "Qwen"), false);
});

test("correction guard accepts narrow domain repairs and rejects rewrites", () => {
  assert.equal(
    checkCorrection("Use Quinn locally", "Use Qwen locally", new Set(["qwen"])).accepted,
    true,
  );
  assert.equal(
    checkCorrection("Use Qwen locally", "Nemotron is the better model for this meeting").accepted,
    false,
  );
});

test("glossary applies explicit aliases through the correction guard", () => {
  const glossary = new Glossary([
    { term: "Pork Chop", aliases: ["pork shop"] },
    { term: "OpenShell", aliases: ["open shell"] },
  ]);
  const result = glossary.correct("Pork shop, prove the open shell denial.");

  assert.equal(result.accepted, true);
  assert.equal(result.text, "Pork Chop, prove the OpenShell denial.");
  assert.equal(result.changes.length, 2);
});

test("recognitions append instead of overwriting earlier model opinions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localroom-recognitions-"));
  const archive = new RecognitionArchive(path.join(directory, "recognitions.jsonl"));
  archive.append({ roomId: "R", participantId: "P", model: "a", rawText: "Quinn", text: "Qwen" });
  archive.append({ roomId: "R", participantId: "P", model: "b", rawText: "Qwen", text: "Qwen" });

  assert.deepEqual(archive.read().map((item) => item.model), ["a", "b"]);
  fs.rmSync(directory, { recursive: true });
});
