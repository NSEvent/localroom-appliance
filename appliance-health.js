export function createHealthSnapshot({
  asrURL,
  models,
  intelligence,
  voiceCatalog,
  audit,
  demoMemory,
  corpusStats,
  dataDir,
  workspace,
  glossary,
  recognitions,
  onModels,
}) {
  return async function healthSnapshot(request) {
    const [asr, availableModels] = await Promise.all([probeAsr(asrURL), models.models()]);
    onModels(availableModels);
    const address = request?.socket?.remoteAddress || "";
    const localClient = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
    const activeRoom = [...intelligence.rooms.values()]
      .find((room) => room.record.session.status !== "ended");
    const selected = availableModels.find((model) => model.id === activeRoom?.model)
      || availableModels[0];
    const gpuAvailable = availableModels.some((model) => model.available);

    return {
      status: "ok",
      mode: gpuAvailable ? "gpu" : "demo-safe",
      local: true,
      cloudEgressBytes: 0,
      asr,
      operator: {
        status: selected?.available ? "ok" : "deterministic fallback",
        model: selected?.label || "LocalRoom deterministic operator",
        last_tok_s: null,
      },
      gpu: gpuAvailable ? "Dell Pro · NVIDIA GB10" : "Local fallback",
      capture: {
        client_is_appliance: localClient,
        browser_capture_default: localClient ? "off" : "on",
        appliance_device: localClient ? "room microphone" : null,
      },
      models: availableModels,
      voices: voiceCatalog,
      auditRecords: audit.read(500).length,
      memoryRecords: demoMemory.length + corpusStats(dataDir).records,
      corpus: corpusStats(dataDir),
      commitmentMonitor: workspace.monitor(),
      glossary: glossary.stats(),
      recognitions: recognitions.read(500).length,
    };
  };
}

async function probeAsr(asrURL) {
  try {
    const upstream = await fetch(`${asrURL}/health`, { signal: AbortSignal.timeout(1800) });
    return upstream.ok ? await upstream.json() : { status: "unavailable" };
  } catch {
    return { status: "offline" };
  }
}
