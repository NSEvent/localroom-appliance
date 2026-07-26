import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtimeRoots = [
  "server.js",
  "appliance-health.js",
  "audio-arbitration.js",
  "console-api.js",
  "corpus-index.js",
  "local-services.js",
  "localroom-core.js",
  "meeting-record.js",
  "transcript-quality.js",
  "workspace-actions.js",
  "public",
  "apps/console/src",
  "apps/ios/LocalRoom",
];
const runtimeFiles = runtimeRoots.flatMap(collectRuntimeFiles);
const forbidden = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.mistral\.ai/i,
  /api\.cohere\.com/i,
  /api\.groq\.com/i,
];
const violations = [];

for (const relativePath of runtimeFiles) {
  const contents = fs.readFileSync(path.join(root, relativePath), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(contents)) violations.push(`${relativePath}: ${pattern.source}`);
  }
}

if (violations.length) {
  console.error(`Hosted AI endpoint found:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`No-cloud gate passed (${runtimeFiles.length} runtime files).`);
}

function collectRuntimeFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(child);
    return /\.(?:html|js|swift|ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}
