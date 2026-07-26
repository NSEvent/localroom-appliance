const MIN_SPEECH_SNR_DB = 8;
const MIN_DOMINANCE_DB = 2.5;

export function selectSpeakerCandidate(candidates) {
  const ranked = candidates
    .filter((candidate) => Number.isFinite(candidate.snrDb))
    .sort((left, right) => right.snrDb - left.snrDb);
  const winner = ranked[0];
  if (!winner || winner.snrDb < MIN_SPEECH_SNR_DB) {
    return { winner: null, reason: "below-speech-floor", confidence: 0 };
  }

  const runnerUp = ranked[1];
  if (!runnerUp) {
    return { winner, reason: "single-active-mic", confidence: 1 };
  }

  const separationDb = winner.snrDb - runnerUp.snrDb;
  if (separationDb < MIN_DOMINANCE_DB) {
    return {
      winner: null,
      reason: "ambiguous-nearby-mics",
      confidence: Math.max(0, separationDb / MIN_DOMINANCE_DB),
      separationDb,
    };
  }

  return {
    winner,
    reason: "dominant-mic",
    confidence: Math.min(1, separationDb / 8),
    separationDb,
  };
}
