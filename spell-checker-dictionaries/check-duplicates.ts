import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(directory, { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"),
  )
  .map((entry) => entry.name)
  .sort();
let duplicateCount = 0;

console.log("Checking dictionary duplicates...");

for (const file of files) {
  const filePath = join(directory, file);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const firstOccurrences = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const word = line.trim();
    if (!word || word.startsWith("#")) {
      continue;
    }

    const key = word.toLowerCase();
    const firstLine = firstOccurrences.get(key);
    if (firstLine !== undefined) {
      duplicateCount++;
      console.log(
        `${filePath}:${index + 1}:${line.search(/\S/) + 1}: warning: Duplicate dictionary entry ${JSON.stringify(word)} (first occurrence: line ${firstLine}).`,
      );
    } else {
      firstOccurrences.set(key, index + 1);
    }
  }
}

console.log(
  `Checked ${files.length} dictionaries: ${duplicateCount} duplicate entries.`,
);
console.log("Dictionary duplicate check complete.");
process.exitCode = duplicateCount > 0 ? 1 : 0;
