import assert from "node:assert/strict";
import test from "node:test";
import {
  END_OF_UTTERANCE_SILENCE_MS,
  UtteranceSegmenter,
} from "../public/utterance-segmenter.js";

const SAMPLE_RATE = 1_000;
const speech = () => new Float32Array(100).fill(0.03);
const silence = () => new Float32Array(100).fill(0.001);

test("keeps one utterance across a natural mid-sentence pause", () => {
  const segmenter = new UtteranceSegmenter();
  for (let index = 0; index < 4; index += 1) assert.equal(segmenter.push(speech(), SAMPLE_RATE), null);
  for (let index = 0; index < 8; index += 1) assert.equal(segmenter.push(silence(), SAMPLE_RATE), null);
  for (let index = 0; index < 3; index += 1) assert.equal(segmenter.push(speech(), SAMPLE_RATE), null);
  for (let index = 0; index < 12; index += 1) assert.equal(segmenter.push(silence(), SAMPLE_RATE), null);

  const utterance = segmenter.push(silence(), SAMPLE_RATE);
  assert.equal(END_OF_UTTERANCE_SILENCE_MS, 1_250);
  assert.equal(utterance.reason, "silence");
  assert.equal(utterance.speechFrames, 7);
  assert.equal(utterance.frames.length, 28);
});

test("discards a short noise burst instead of holding an endless segment", () => {
  const segmenter = new UtteranceSegmenter({ endSilenceMs: 300 });
  assert.equal(segmenter.push(speech(), SAMPLE_RATE), null);
  assert.equal(segmenter.push(silence(), SAMPLE_RATE), null);
  assert.equal(segmenter.push(silence(), SAMPLE_RATE), null);
  assert.equal(segmenter.push(silence(), SAMPLE_RATE), null);
  assert.equal(segmenter.active, false);
  assert.equal(segmenter.frames.length, 0);
});
