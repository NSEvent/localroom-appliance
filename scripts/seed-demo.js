import fs from "node:fs/promises";

const baseURL = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const roomId = process.argv[3] || "DELL-DEMO";
const fixture = JSON.parse(await fs.readFile(
  new URL("../fixtures/project-iliad/transcript.json", import.meta.url),
  "utf8",
));
const response = await fetch(`${baseURL}/api/sessions/${encodeURIComponent(roomId)}/utterances`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ utterances: fixture }),
});
if (!response.ok) throw new Error(`seed failed: ${response.status} ${await response.text()}`);
const result = await response.json();
console.log(`Seeded ${result.utterances.length} moments into ${roomId}.`);
console.log(`Participant: ${baseURL}/?room=${encodeURIComponent(roomId)}`);
console.log(`Console: ${baseURL}/console/session/${encodeURIComponent(roomId)}`);
