// Adapted from the glossary, correction-guard, and append-only recognition
// work in outdoorsea/meety-local. Original code: MIT; see THIRD_PARTY_NOTICES.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EQUIVALENTS = [
  ["ph", "f"], ["ck", "k"], ["qu", "kw"], ["q", "k"], ["x", "ks"],
  ["z", "s"], ["ie", "i"], ["ee", "i"], ["oo", "u"], ["y", "i"],
  ["c", "k"], ["wr", "r"], ["kn", "n"], ["gh", ""], ["dg", "j"],
];
const COMMON = new Set("a an and are as at be by can do for from has have i in is it my no not of on or our that the their this to we what when who will with you your".split(" "));

export function phoneticKey(value) {
  let word = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!word) return "";
  for (const [from, to] of EQUIVALENTS) word = word.replaceAll(from, to);
  word = word.replace(/(.)\1+/g, "$1");
  return `${word.slice(0, 1).replace(/[aeiou]/g, "")}${word.slice(1).replace(/[aeiou]/g, "")}` || value[0];
}

export function soundsLike(left, right, threshold = 0.6) {
  const a = phoneticKey(left);
  const b = phoneticKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return similarity(a, b) >= threshold;
}

export function checkCorrection(original, corrected, glossary = new Set()) {
  const before = words(original);
  const after = words(corrected);
  if (!corrected?.trim()) return { accepted: false, reason: "empty correction" };
  if (original.trim() === corrected.trim()) return { accepted: false, reason: "no-op" };
  const ratio = after.length / Math.max(1, before.length);
  if (ratio > 1.5 || ratio < 1 / 1.5) return { accepted: false, reason: "rewrite length" };
  const introduced = after.filter((word) => !before.some((old) =>
    old.toLowerCase() === word.toLowerCase() || soundsLike(old, word)));
  const unsafe = introduced.filter((word) => !glossary.has(word.toLowerCase()));
  return unsafe.length
    ? { accepted: false, reason: `no phonetic basis: ${unsafe.slice(0, 5).join(", ")}` }
    : { accepted: true, reason: "phonetic repair within length bounds" };
}

export class Glossary {
  constructor(entries = []) {
    this.entries = new Map();
    for (const entry of entries) this.add(entry.term, entry.aliases);
  }

  add(term, aliases = []) {
    const clean = String(term || "").trim();
    if (!clean || clean.length > 60) return false;
    this.entries.set(clean.toLowerCase(), {
      term: clean,
      aliases: new Set([clean, ...aliases].map((value) => String(value).toLowerCase())),
    });
    return true;
  }

  correct(text) {
    const terms = new Set(this.entries.keys());
    let corrected = String(text || "");
    const changes = [];
    for (const entry of this.entries.values()) {
      for (const alias of entry.aliases) {
        if (alias === entry.term.toLowerCase()) continue;
        const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, "gi");
        if (!pattern.test(corrected)) continue;
        corrected = corrected.replace(pattern, entry.term);
        changes.push({ heard: alias, term: entry.term });
      }
    }
    if (!changes.length) {
      for (const token of words(corrected)) {
        if (token.length < 4 || COMMON.has(token.toLowerCase())) continue;
        const matches = [...this.entries.values()].filter((entry) =>
          !entry.term.includes(" ") && soundsLike(token, entry.term, 0.78));
        if (matches.length !== 1) continue;
        corrected = corrected.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, "g"), matches[0].term);
        changes.push({ heard: token, term: matches[0].term });
      }
    }
    const guard = checkCorrection(text, corrected, terms);
    return guard.accepted
      ? { text: corrected, original: text, changes, accepted: true, reason: guard.reason }
      : { text, original: text, changes: [], accepted: false, reason: guard.reason };
  }

  stats() {
    return { terms: this.entries.size };
  }
}

export class RecognitionArchive {
  constructor(filename) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  append({ roomId, participantId, model, provider, rawText, text, latencyMs, correction }) {
    const record = {
      schema: "localroom.recognition",
      schema_version: 1,
      id: crypto.randomUUID(),
      room_id: roomId,
      participant_id: participantId,
      model: model || null,
      provider: provider || null,
      raw_text: rawText,
      text,
      latency_ms: latencyMs ?? null,
      correction: correction || null,
      run_at: new Date().toISOString(),
    };
    fs.appendFileSync(this.filename, `${JSON.stringify(record)}\n`);
    return record;
  }

  read(limit = 100) {
    if (!fs.existsSync(this.filename)) return [];
    return fs.readFileSync(this.filename, "utf8").split("\n").filter(Boolean)
      .slice(-limit).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
  }
}

function words(value) {
  return String(value || "").match(/[A-Za-z0-9']+/g) || [];
}

function similarity(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return 1 - rows[left.length][right.length] / Math.max(left.length, right.length);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
