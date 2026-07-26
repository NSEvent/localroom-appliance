import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("client exposes the core hackathon proof points", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  for (const phrase of [
    "speaker-attributed",
    "Processing on Dell Pro",
    "No cloud recording",
    "Local inference",
    "Live transcript",
  ]) assert.match(html, new RegExp(phrase, "i"));
});

test("signaling client has WebRTC and isolated transcription paths", () => {
  const js = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /RTCPeerConnection/);
  assert.match(js, /new MediaStream\(state\.stream\.getAudioTracks\(\)\)/);
  assert.match(js, /x-participant-id/);
  assert.match(js, /\/api\/transcribe/);
  assert.match(js, /withTimeout\(requestMedia\(\), 5000\)/);
  assert.match(js, /Joined without media/);
});
