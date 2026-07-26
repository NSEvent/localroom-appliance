import fs from "node:fs";
import path from "node:path";

export function corpusStats(dataDir) {
  const filename = path.join(dataDir, "corpus", "ftc-amazon-prime-complaint.txt");
  if (!fs.existsSync(filename)) return { records: 0, source: "FTC complaint unavailable" };
  const text = fs.readFileSync(filename, "utf8");
  const paragraphs = text.split(/\n\s*\n/).map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 140);
  const records = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (`${current} ${paragraph}`.length > 5500 && current) {
      records.push(current);
      current = "";
    }
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) records.push(current);
  return {
    records: records.length,
    characters: text.length,
    source: "FTC v. Amazon revised public complaint, November 2, 2023",
    localPath: filename,
  };
}
