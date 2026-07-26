// One virtual clock, enforced (DEMO_SCRIPT.md). A single stray Date.now() or
// setInterval in a console component is enough to break pause: that one number
// keeps crawling while the rest of the screen is frozen, and the transcript
// desyncs from the clock in front of the judges. Grep is the guard — the rule
// is "nobody but the clock module reads the wall clock", and that is a file
// boundary, not something a type can express.
//
// Prove it fails: add `Date.now()` to any file under apps/console/src other
// than the exempt module below and run `npm run check:console-clock`.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const consoleSrc = "apps/console/src";

/** The sole call site permitted to read the wall clock or run a timer. */
const exempt = new Set(["apps/console/src/clock.ts"]);

const forbidden = [
  { pattern: /\bDate\.now\s*\(/, label: "Date.now()" },
  { pattern: /\bnew\s+Date\s*\(/, label: "new Date()" },
  { pattern: /\bsetInterval\s*\(/, label: "setInterval()" },
  { pattern: /\brequestAnimationFrame\s*\(/, label: "requestAnimationFrame()" },
];

const files = collectSourceFiles(consoleSrc);
const violations = [];

for (const relativePath of files) {
  if (exempt.has(relativePath)) continue;
  const lines = fs.readFileSync(path.join(root, relativePath), "utf8").split("\n");
  lines.forEach((line, index) => {
    // Whole-line comments are skipped so a header can name the banned APIs
    // while explaining the rule. Trailing comments are still checked — the
    // guard stays blunt where it could otherwise be talked around.
    if (isCommentLine(line)) return;
    for (const { pattern, label } of forbidden) {
      if (pattern.test(line)) {
        violations.push(`${relativePath}:${index + 1}: ${label} — use src/clock.ts`);
      }
    }
  });
}

if (violations.length) {
  console.error(
    `Component clock found — every counter must derive from src/clock.ts:\n${violations.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `One-clock gate passed (${files.length} console sources, ${exempt.size} exempt).`,
  );
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function collectSourceFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}
