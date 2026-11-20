import fs from "node:fs/promises";
import path from "node:path";
import { styleText } from "node:util";
import * as prettier from "prettier";
import { isScalar, isSeq, parseDocument, stringify } from "yaml";

const CONFIG_PATH = path.join("config", "agent-rules-config.yaml");
const DEFAULT_SOURCE = ".agents/rules/";
const DEFAULT_TARGETS: Target[] = [
  {
    folder: ".claude/rules/",
    fileName: "{name}.md",
    frontmatter: { paths: "$paths" },
  },
  {
    folder: ".github/instructions/",
    fileName: "{name}.instructions.md",
    frontmatter: { applyTo: "$pathsCsv" },
  },
];
const DEFAULT_INDEX_FILE = "AGENTS.md";
const PATHS_LIST = "$paths";
const PATHS_CSV = "$pathsCsv";
const NAME_TOKEN = "{name}";
const INDEX_START = "<!-- agent-rules:start -->";
const INDEX_END = "<!-- agent-rules:end -->";
const GENERATED_MARKER = /<!-- Generated from \S+ by "npm run agent-rules"/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;
const CHECK_MODE = process.argv.includes("--check");

type Target = {
  folder: string;
  fileName: string;
  frontmatter: Record<string, unknown>;
};

type RulesConfig = {
  source: string;
  targets: Target[];
  indexFile?: string;
};

type Rule = {
  name: string;
  sourcePath: string;
  paths: string[];
  /** Frontmatter keys other than `paths`, passed on to every target. */
  extraFrontmatter: Record<string, unknown>;
  body: string;
};

type Outcome = "unchanged" | "changed" | "error";

const results: { outcome: Outcome; message: string }[] = [];

/**
 * Records a result line that is printed when the script finishes.
 * @param outcome Whether the item was unchanged, changed (or would change in --check mode) or failed.
 * @param message Human-readable description of the item.
 */
function report(outcome: Outcome, message: string): void {
  results.push({ outcome, message });
}

/**
 * Converts a path to forward slashes without a trailing slash, for display and links.
 * @param value The path to convert.
 * @returns The normalized path.
 */
function toPosix(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * Reads a file, returning undefined if it doesn't exist.
 * @param filePath The file to read.
 * @returns The file content, or undefined.
 */
async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Reads the YAML config, falling back to defaults for missing options, and validates the targets.
 * @returns The resolved configuration.
 * @throws Error if a target is invalid.
 */
async function readConfig(): Promise<RulesConfig> {
  const text = await readOptional(CONFIG_PATH);
  const config = ((text ? parseDocument(text).toJS() : undefined) ??
    {}) as Partial<RulesConfig>;
  const targets = config.targets ?? DEFAULT_TARGETS;

  const fileNames = new Set<string>();
  for (const target of targets) {
    if (
      !target?.folder ||
      !target.fileName?.includes(NAME_TOKEN) ||
      !(target.fileName.endsWith(".md") || target.fileName.endsWith(".mdc"))
    ) {
      throw new Error(
        `${CONFIG_PATH}: every target needs a "folder" and a "fileName" containing "${NAME_TOKEN}" and ending with .md or .mdc`,
      );
    }
    const key = path.resolve(target.folder, target.fileName).toLowerCase();
    if (fileNames.has(key))
      throw new Error(
        `${CONFIG_PATH}: two targets write to ${toPosix(path.join(target.folder, target.fileName))}`,
      );
    fileNames.add(key);
    target.frontmatter ??= {};
  }

  return {
    source: config.source ?? DEFAULT_SOURCE,
    targets,
    indexFile: (config.indexFile ?? DEFAULT_INDEX_FILE) || undefined,
  };
}

/**
 * Reads and validates one rule from the source folder.
 * @param source The source folder.
 * @param file The rule's file name.
 * @returns The parsed rule, or undefined if it is invalid.
 */
async function readRule(
  source: string,
  file: string,
): Promise<Rule | undefined> {
  const sourcePath = `${toPosix(source)}/${file}`;
  const text = await fs.readFile(path.join(source, file), "utf8");
  const match = FRONTMATTER_PATTERN.exec(text);
  const document = parseDocument(match?.[1] ?? "");
  const pathsNode = document.get("paths", true);
  const paths =
    isSeq(pathsNode) &&
    pathsNode.items.every(
      (item) => isScalar(item) && typeof item.value === "string",
    )
      ? pathsNode.items.map((item) =>
          String((item as { value: string }).value).trim(),
        )
      : [];

  if (
    document.errors.length > 0 ||
    paths.length === 0 ||
    paths.some((glob) => glob === "" || glob.includes(","))
  ) {
    report(
      "error",
      `${sourcePath}: frontmatter needs a "paths" list of globs (no commas). Always-on rules belong in the index file instead`,
    );
    return undefined;
  }

  const { paths: _paths, ...extraFrontmatter } = (document.toJS() ??
    {}) as Record<string, unknown>;
  return {
    name: file.slice(0, -".md".length),
    sourcePath,
    paths,
    extraFrontmatter,
    body: (match ? text.slice(match[0].length) : text).replace(/^\s+/, ""),
  };
}

/**
 * Builds a target's copy of a rule: its frontmatter, a "generated" notice and the rule body,
 * formatted with the project's Prettier config so lint-staged leaves it unchanged.
 * @param rule The rule to copy.
 * @param target The harness to build the copy for.
 * @param filePath Where the copy is written (used to resolve the Prettier config).
 * @returns The file content.
 */
async function buildCopy(
  rule: Rule,
  target: Target,
  filePath: string,
): Promise<string> {
  const frontmatter: Record<string, unknown> = { ...rule.extraFrontmatter };
  for (const [key, value] of Object.entries(target.frontmatter)) {
    if (value === PATHS_LIST) frontmatter[key] = rule.paths;
    else if (value === PATHS_CSV) frontmatter[key] = rule.paths.join(",");
    else frontmatter[key] = value;
  }

  const text = [
    "---",
    stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    `<!-- Generated from ${rule.sourcePath} by "npm run agent-rules". Edit that file instead. -->`,
    "",
    rule.body,
  ].join("\n");

  const options = (await prettier.resolveConfig(filePath)) ?? {};
  return prettier.format(text, { ...options, parser: "markdown" });
}

/**
 * Writes every rule to a target folder and deletes copies of rules that no longer exist.
 * Files in the folder that weren't generated by this script are never touched.
 * @param target The harness to sync.
 * @param rules The valid rules.
 */
async function syncTarget(target: Target, rules: Rule[]): Promise<void> {
  const folder = toPosix(target.folder);
  const expected = new Set<string>();

  for (const rule of rules) {
    const fileName = target.fileName.replaceAll(NAME_TOKEN, rule.name);
    const filePath = path.join(target.folder, fileName);
    const displayPath = `${folder}/${fileName}`;
    expected.add(fileName.toLowerCase());

    const current = await readOptional(filePath);
    if (current !== undefined && !GENERATED_MARKER.test(current)) {
      report(
        "error",
        `${displayPath}: exists but wasn't generated by this script. Move it to ${rule.sourcePath} or delete it`,
      );
      continue;
    }
    const updated = await buildCopy(rule, target, filePath);
    if (updated === current) {
      report("unchanged", `${displayPath}: in sync`);
      continue;
    }
    if (!CHECK_MODE) {
      await fs.mkdir(target.folder, { recursive: true });
      await fs.writeFile(filePath, updated, "utf8");
    }
    report(
      "changed",
      `${displayPath}: ${CHECK_MODE ? "out of sync" : current === undefined ? "created" : "updated"}`,
    );
  }

  const entries = await fs
    .readdir(target.folder, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || expected.has(entry.name.toLowerCase())) continue;
    const filePath = path.join(target.folder, entry.name);
    if (!GENERATED_MARKER.test((await readOptional(filePath)) ?? "")) continue;
    if (!CHECK_MODE) await fs.unlink(filePath);
    report(
      "changed",
      `${folder}/${entry.name}: ${CHECK_MODE ? "stale copy" : "deleted (rule no longer exists)"}`,
    );
  }
}

/**
 * Rewrites the generated rules index between the markers in the index file,
 * appending the markers at the end if they are missing.
 * @param indexFile The always-on instructions file (e.g. AGENTS.md).
 * @param rules The valid rules to list.
 */
async function syncIndex(indexFile: string, rules: Rule[]): Promise<void> {
  const text = (await readOptional(indexFile)) ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const section = [
    INDEX_START,
    '<!-- Generated by "npm run agent-rules". Edit the rule files, not this section. -->',
    "",
    "## Path-Specific Rules",
    "",
    "Before you create or edit a file that matches a rule's paths, read that rule file and follow it. Skip this if your tool has already loaded the rule automatically.",
    "",
    ...rules.map(
      (rule) =>
        `- [${rule.sourcePath}](${rule.sourcePath}): ${rule.paths.map((glob) => `\`${glob}\``).join(", ")}`,
    ),
    "",
    INDEX_END,
  ].join(eol);

  const start = text.indexOf(INDEX_START);
  const end = text.indexOf(INDEX_END);
  const updated =
    start !== -1 && end > start
      ? text.slice(0, start) + section + text.slice(end + INDEX_END.length)
      : `${text.trimEnd()}${text ? `${eol}${eol}` : ""}${section}${eol}`;

  if (updated === text) {
    report("unchanged", `${indexFile}: rules index in sync`);
    return;
  }
  if (!CHECK_MODE) await fs.writeFile(indexFile, updated, "utf8");
  report(
    "changed",
    `${indexFile}: ${CHECK_MODE ? "rules index out of sync" : "updated rules index"}`,
  );
}

/**
 * Prints all results and sets the exit code: 1 on errors, and in --check mode also when
 * anything is out of sync.
 */
function printResults(): void {
  const symbols: Record<Outcome, string> = {
    unchanged: styleText("green", "[-]"),
    changed: CHECK_MODE
      ? styleText("yellow", "[~]")
      : styleText("green", "[x]"),
    error: styleText("red", "[!]"),
  };
  for (const { outcome, message } of results)
    console.log(`${symbols[outcome]} ${message}`);

  const errors = results.filter((result) => result.outcome === "error").length;
  const changes = results.filter(
    (result) => result.outcome === "changed",
  ).length;
  if (errors > 0) {
    console.log(
      styleText("red", `\n${errors} error(s). Fix them and run again.`),
    );
    process.exitCode = 1;
  } else if (CHECK_MODE && changes > 0) {
    console.log(
      styleText(
        "yellow",
        `\n${changes} item(s) out of sync. Run: npm run agent-rules`,
      ),
    );
    process.exitCode = 1;
  } else {
    console.log(
      styleText(
        "green",
        changes > 0
          ? `\nSynced ${changes} item(s).`
          : "\nEverything is in sync.",
      ),
    );
  }
}

const config = await readConfig();
console.log(
  `Syncing agent rules from ${toPosix(config.source)}${CHECK_MODE ? " (check only)" : ""}...\n`,
);

const ruleFiles = (await fs.readdir(config.source, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      entry.name.toLowerCase() !== "readme.md",
  )
  .map((entry) => entry.name)
  .sort();
const rules: Rule[] = [];
for (const file of ruleFiles) {
  const rule = await readRule(config.source, file);
  if (rule) rules.push(rule);
}
// Skip writing targets when a rule is invalid, so a typo can't delete that rule's copies.
if (rules.length === ruleFiles.length) {
  for (const target of config.targets) await syncTarget(target, rules);
  if (config.indexFile) await syncIndex(config.indexFile, rules);
}

printResults();
