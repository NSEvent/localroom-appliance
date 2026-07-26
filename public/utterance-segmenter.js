export const END_OF_UTTERANCE_SILENCE_MS = 1_250;
export const MAX_UTTERANCE_MS = 30_000;

export class UtteranceSegmenter {
  constructor({
    endSilenceMs = END_OF_UTTERANCE_SILENCE_MS,
    maxUtteranceMs = MAX_UTTERANCE_MS,
    minSpeechFrames = 3,
    preRollMs = 250,
  } = {}) {
    Object.assign(this, { endSilenceMs, maxUtteranceMs, minSpeechFrames, preRollMs });
    this.noiseFloor = 0.006;
    this.reset();
  }

  push(frame, sampleRate) {
    const durationMs = frame.length / sampleRate * 1_000;
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    const speaking = rms > Math.max(0.012, this.noiseFloor * 2.8);

    if (!this.active && !speaking) {
      this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
      this.preRoll.push(frame);
      this.preRollDurationMs += durationMs;
      while (this.preRollDurationMs > this.preRollMs && this.preRoll.length > 1) {
        const removed = this.preRoll.shift();
        this.preRollDurationMs -= removed.length / sampleRate * 1_000;
      }
      return null;
    }

    if (!this.active) {
      this.active = true;
      this.frames.push(...this.preRoll);
      this.durationMs += this.preRollDurationMs;
      this.preRoll = [];
      this.preRollDurationMs = 0;
    }

    this.frames.push(frame);
    this.durationMs += durationMs;
    this.maxRms = Math.max(this.maxRms, rms);
    if (speaking) {
      this.speechFrames += 1;
      this.silenceMs = 0;
    } else {
      this.silenceMs += durationMs;
    }

    if (this.silenceMs >= this.endSilenceMs && this.speechFrames < this.minSpeechFrames) {
      this.reset();
      return null;
    }

    const completedBySilence =
      this.speechFrames >= this.minSpeechFrames && this.silenceMs >= this.endSilenceMs;
    const completedByLimit =
      this.speechFrames >= this.minSpeechFrames && this.durationMs >= this.maxUtteranceMs;
    if (!completedBySilence && !completedByLimit) return null;

    const result = {
      frames: this.frames,
      snrDb: 20 * Math.log10(Math.max(this.maxRms, 0.00001) / Math.max(this.noiseFloor, 0.00001)),
      reason: completedBySilence ? "silence" : "duration-limit",
      speechFrames: this.speechFrames,
      durationMs: this.durationMs,
    };
    this.reset();
    return result;
  }

  reset() {
    this.frames = [];
    this.preRoll = [];
    this.active = false;
    this.durationMs = 0;
    this.preRollDurationMs = 0;
    this.silenceMs = 0;
    this.speechFrames = 0;
    this.maxRms = 0;
  }
}
