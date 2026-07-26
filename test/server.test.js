import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("client exposes the core hackathon proof points", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  for (const phrase of [
    "speaker-attributed",
    "Processing on Dell Pro",
    "Zero cloud recording",
    "Local models",
    "Institutional memory",
    "0 B CLOUD EGRESS",
    "COMMITMENT MONITOR",
    "Change local model",
  ]) assert.match(html, new RegExp(phrase, "i"));
});

test("media client has WebRTC and isolated transcription paths", () => {
  const js = fs.readFileSync(new URL("../public/media.js", import.meta.url), "utf8");
  assert.match(js, /RTCPeerConnection/);
  assert.match(js, /new MediaStream\(this\.stream\.getAudioTracks\(\)\)/);
  assert.match(js, /x-participant-id/);
  assert.match(js, /\/api\/transcribe/);
  assert.match(js, /speechFrames >= 3/);
  assert.match(js, /turn:172\.16\.10\.189:3478/);
  assert.match(js, /autoGainControl: false/);
  assert.match(js, /x-audio-snr-db/);
});

test("UI exposes shared cards, collective polls, agent, and model switching", () => {
  const js = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /card-action/);
  assert.match(js, /renderPoll/);
  assert.match(js, /one vote per participant/i);
  assert.match(js, /select-model/);
  assert.match(js, /agent-answer/);
  assert.match(js, /security-proof/);
  assert.match(js, /meeting-ended/);
  assert.match(js, /room\.captions/);
});
