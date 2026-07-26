import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { formatMeetingContext } from "./meeting-context.js";

const MODEL_CONFIGS = [
  {
    id: "qwen-30b",
    label: "Qwen 3 · 30B",
    role: "Deep reasoning",
    endpoint: process.env.QWEN_URL || "http://127.0.0.1:8080/v1",
    model: process.env.QWEN_MODEL || "Qwen3-30B-A3B-Instruct",
    color: "#b8f34a",
  },
  {
    id: "nemotron-30b",
    label: "Nemotron 3 · 30B",
    role: "Policy specialist",
    endpoint: process.env.NEMOTRON_URL || "http://172.17.0.1:8090/v1",
    model: process.env.NEMOTRON_MODEL || "nemotron-3-nano-30b-a3b",
    color: "#76d7ff",
  },
  {
    id: "nemotron-4b",
    label: "Nemotron 3 · 4B",
    role: "Fast live cards",
    endpoint: process.env.FAST_MODEL_URL || "http://127.0.0.1:8091/v1",
    model: process.env.FAST_MODEL || "nemotron-3-nano-4b",
    color: "#ffbd66",
  },
];

export class LocalModelService {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.health = new Map();
  }

  async models() {
    await Promise.all(MODEL_CONFIGS.map(async (config) => {
      const started = performance.now();
      try {
        const response = await this.fetch(`${config.endpoint}/models`, { signal: AbortSignal.timeout(1200) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        this.health.set(config.id, {
          available: true,
          latencyMs: Math.round(performance.now() - started),
          loadedModel: result.data?.[0]?.id || result.models?.[0]?.model || config.model,
        });
      } catch (error) {
        this.health.set(config.id, { available: false, latencyMs: null, error: error.message });
      }
    }));
    return MODEL_CONFIGS.map(({ endpoint: _endpoint, model: _model, ...config }) => ({
      ...config,
      ...(this.health.get(config.id) || { available: false }),
    }));
  }

  async answer(modelId, { question, transcript, memory, meeting }) {
    const config = MODEL_CONFIGS.find((candidate) => candidate.id === modelId) || MODEL_CONFIGS[0];
    const prompt = [
      "You are LocalRoom Agent, a concise private meeting participant.",
      "Answer in 1-3 short sentences. Use only the supplied live meeting state, institutional memory, and meeting transcript.",
      "Use live meeting state for questions about the meeting name, participants, attendance, status, and statistics.",
      "When citing memory, include its [[wiki-slug]]. Never claim an external action succeeded.",
      "",
      formatMeetingContext(meeting),
      "",
      `INSTITUTIONAL MEMORY:\n${memory}`,
      `RECENT TRANSCRIPT:\n${transcript}`,
      `QUESTION: ${question}`,
    ].join("\n");
    const started = performance.now();
    const response = await this.fetch(`${config.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 700,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}`);
    const result = await response.json();
    const message = result.choices?.[0]?.message || {};
    const text = String(message.content || message.reasoning_content || "").trim();
    if (!text) throw new Error("Local model returned an empty answer");
    return { text, model: config.id, latencyMs: Math.round(performance.now() - started) };
  }
}

export class LocalSpeechService {
  constructor({ outputDir, fetchImpl = fetch } = {}) {
    this.outputDir = outputDir;
    this.fetch = fetchImpl;
    fs.mkdirSync(outputDir, { recursive: true });
  }

  async synthesize(text, voice = "en_US-lessac-medium") {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const filename = `${id}.wav`;
    const output = path.join(this.outputDir, filename);
    if (process.env.TTS_URL) {
      const response = await this.fetch(process.env.TTS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice, output_format: "wav" }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`TTS service returned HTTP ${response.status}`);
      fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
      return `/generated/${filename}`;
    }
    if (process.env.PIPER_BIN && process.env.PIPER_MODEL) {
      await run(process.env.PIPER_BIN, [
        "--model", process.env.PIPER_MODEL,
        "--output_file", output,
      ], `${text}\n`);
      return `/generated/${filename}`;
    }
    return null;
  }
}

export class AuditTrail {
  constructor(filename) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  append(event) {
    const record = { id: crypto.randomUUID(), at: new Date().toISOString(), ...event };
    fs.appendFileSync(this.filename, `${JSON.stringify(record)}\n`);
    return record;
  }

  read(limit = 50) {
    if (!fs.existsSync(this.filename)) return [];
    return fs.readFileSync(this.filename, "utf8").trim().split("\n").filter(Boolean)
      .slice(-limit).reverse().map((line) => JSON.parse(line));
  }

  async proveBlockedEgress() {
    if (!process.env.OPENSHELL_DENIAL_COMMAND) return { attempted: false };
    try {
      await run("/bin/sh", ["-lc", process.env.OPENSHELL_DENIAL_COMMAND]);
      return { attempted: true, blocked: false };
    } catch (error) {
      return { attempted: true, blocked: true, evidence: error.message.slice(0, 500) };
    }
  }
}

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(output)
      : reject(new Error(errors.trim() || output.trim() || `${command} exited ${code}`)));
    if (input) child.stdin.end(input);
  });
}
