import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, styleText } from "node:util";
import { isAlias, isMap, isScalar, parseDocument, stringify } from "yaml";

const execFileAsync = promisify(execFile);

const REPO_URL =
  process.env.SALESFORCE_SKILLS_REPO ??
  "https://github.com/forcedotcom/afv-library.git";
const REF = process.env.SALESFORCE_SKILLS_REF;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SOURCE_PATH = "skills";
const DEFAULT_INSTALL_PATH = ".agents/skills/";
const DEFAULT_SYMLINK_PATHS = [".claude/skills/"];
const SKILL_PREFIX = "sf-";
const MAX_SKILL_NAME_LENGTH = 64;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(
  SCRIPT_DIRECTORY,
  "..",
  "..",
  "config",
  "salesforce-skills-config.yaml",
);
const CONFIG_DISPLAY_PATH = path.relative(process.cwd(), CONFIG_PATH);
const CONFIG_HEADER = `# yaml-language-server: $schema=./yaml-schemas/salesforce-skills-config.schema.json
# This file is used to configure the Salesforce Skills script.
# It allows you to specify which skills to ignore and where to install and link them.
# For more information, see the README in the scripts/salesforce-skills folder.

`;
const RELEASE_REQUEST_TIMEOUT_MS = 15_000;
const FILE_CONCURRENCY = 16;
const IS_WINDOWS = process.platform === "win32";
const CI_MODE = process.argv.includes("--ci");
const OUTPUT_STREAM = CI_MODE ? process.stderr : process.stdout;

type Installation = {
  version: string;
  released: string;
};

type SaveOptions = {
  source?: string;
  symlinks?: string[];
};

type SkillsConfig = {
  installedVersion?: Installation;
  ignoredSkills?: string[];
  saveOptions?: SaveOptions;
  [key: string]: unknown;
};

type SavePaths = {
  installPath: string;
  linkPaths: string[];
};

type LinkPlan = {
  linkPath: string;
  staleLinks: string[];
  missingFolders: string[];
};

type ImportResult = {
  addedFolders: string[];
  changedFolders: string[];
  removedFolders: string[];
  changed: boolean;
  ref: string;
  releaseDate?: string;
  skipped: boolean;
  installed?: Installation;
};

type SkillIgnoreMatcher = (folder: string) => boolean;

type ProgressState = "pending" | "running" | "complete" | "failed" | "skipped";
type ProgressStep = {
  label: string;
  phase: string;
  state: ProgressState;
  note?: string;
};
type ProgressStepId =
  | "config"
  | "ignored"
  | "release"
  | "download"
  | "checkout"
  | "prepare"
  | "install"
  | "obsolete"
  | "links"
  | "save";

function writeLog(message = ""): void {
  OUTPUT_STREAM.write(`${message}\n`);
}

class ProgressDisplay {
  private steps: Record<ProgressStepId, ProgressStep> = {
    config: {
      label: "Check salesforce-skills-config.yaml",
      phase: "checking...",
      state: "pending",
    },
    ignored: {
      label: "Remove ignored Salesforce skills",
      phase: "removing...",
      state: "pending",
    },
    release: {
      label: "Check latest Salesforce skills release",
      phase: "checking for updates...",
      state: "pending",
    },
    download: {
      label: "Download Salesforce skills",
      phase: "downloading...",
      state: "pending",
    },
    checkout: {
      label: "Check out Salesforce skill files",
      phase: "checking out...",
      state: "pending",
    },
    prepare: {
      label: "Prepare Salesforce skills",
      phase: "preparing...",
      state: "pending",
    },
    install: {
      label: "Install Salesforce skills",
      phase: "installing...",
      state: "pending",
    },
    obsolete: {
      label: "Remove obsolete Salesforce skills",
      phase: "removing...",
      state: "pending",
    },
    links: {
      label: "Synchronize skill links",
      phase: "syncing...",
      state: "pending",
    },
    save: {
      label: "Save release information",
      phase: "saving...",
      state: "pending",
    },
  };
  private live = false;
  private drawnLines = 0;
  private closed = false;

  private canRenderLive(): boolean {
    return Boolean(
      OUTPUT_STREAM.isTTY &&
      process.env.TERM !== "dumb" &&
      OUTPUT_STREAM.columns >= 40 &&
      OUTPUT_STREAM.rows >= Object.keys(this.steps).length + 3,
    );
  }

  private line(step: ProgressStep): string {
    const styles = {
      pending: { marker: "[ ]", text: "waiting", color: undefined },
      running: { marker: "[>]", text: step.phase, color: "blue" },
      complete: { marker: "[x]", text: "done!", color: "green" },
      failed: { marker: "[!]", text: "error", color: "red" },
      skipped: {
        marker: "[-]",
        text: step.note ?? "skipped",
        color: step.note === "not run" ? undefined : "green",
      },
    } as const;
    const style = styles[step.state];
    const text = `${style.marker} ${step.label} - ${style.text}`.replace(
      /[\u0000-\u001f\u007f-\u009f]/g,
      "",
    );
    const clipped = this.live
      ? [...text].slice(0, Math.max(1, OUTPUT_STREAM.columns - 1)).join("")
      : text;
    return style.color ? styleText(style.color, clipped) : clipped;
  }

  private clear(): void {
    if (this.drawnLines > 0) {
      OUTPUT_STREAM.write(`\u001b[${this.drawnLines}F\u001b[0J`);
      this.drawnLines = 0;
    }
  }

  private draw(): void {
    if (!this.live) {
      return;
    }
    this.clear();
    const lines = Object.values(this.steps).map((step) => this.line(step));
    OUTPUT_STREAM.write(lines.map((line) => `${line}\r\n`).join(""));
    this.drawnLines = lines.length;
  }

  private update(step: ProgressStep): void {
    if (this.live) {
      this.draw();
    } else {
      writeLog(this.line(step));
    }
  }

  start(): void {
    this.live = this.canRenderLive();
    this.draw();
    OUTPUT_STREAM.on("resize", this.onResize);
    process.once("exit", this.onExit);
  }

  log(message = ""): void {
    this.clear();
    writeLog(message);
    this.draw();
  }

  async run<T>(
    id: ProgressStepId,
    operation: () => Promise<T>,
    label?: string,
  ): Promise<T> {
    const step = this.steps[id];
    if (label !== undefined) {
      step.label = label;
    }
    step.state = "running";
    this.update(step);
    let completed = false;
    try {
      const result = await operation();
      completed = true;
      return result;
    } finally {
      step.state = completed ? "complete" : "failed";
      this.update(step);
    }
  }

  skip(id: ProgressStepId): void {
    const step = this.steps[id];
    step.state = "skipped";
    this.update(step);
  }

  private onResize = (): void => {
    this.clear();
    this.live = this.canRenderLive();
    if (this.live) {
      this.draw();
    } else {
      writeLog(
        Object.values(this.steps)
          .map((step) => this.line(step))
          .join("\n"),
      );
    }
  };

  private onExit = (): void => {
    this.finish();
  };

  finish(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const step of Object.values(this.steps)) {
      if (step.state === "running") {
        step.state = "failed";
      } else if (step.state === "pending") {
        step.state = "skipped";
        step.note = "not run";
        if (!this.live) {
          this.update(step);
        }
      }
    }
    this.draw();
    this.live = false;
    this.drawnLines = 0;
    OUTPUT_STREAM.off("resize", this.onResize);
    process.off("exit", this.onExit);
  }
}

const progressDisplay = new ProgressDisplay();

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isInstallation(value: unknown): value is Installation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const { version, released } = value as Record<string, unknown>;
  return typeof version === "string" && !!version && isValidDate(released);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSamePath(first: string, second: string): boolean {
  return IS_WINDOWS
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function displayPath(entryPath: string): string {
  return path.relative(process.cwd(), entryPath) || ".";
}

function isEmptyYamlDocument(node: unknown): boolean {
  return (
    node === null ||
    (isScalar(node) &&
      node.value === null &&
      node.range != null &&
      node.range[0] === node.range[1])
  );
}

function parseConfigDocument(content: string) {
  const document = parseDocument(content);

  if (document.errors.length > 0) {
    throw new Error(
      `${CONFIG_DISPLAY_PATH} contains invalid YAML: ${document.errors[0].message}`,
    );
  }
  for (const warning of document.warnings) {
    console.warn(`${CONFIG_DISPLAY_PATH}: ${warning.message}`);
  }
  if (!isMap(document.contents) && !isEmptyYamlDocument(document.contents)) {
    throw new Error(`${CONFIG_DISPLAY_PATH} must contain a YAML mapping.`);
  }

  return document;
}

function escapeRegExp(content: string): string {
  return content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSkillsConfig(content: string): SkillsConfig {
  const document = parseConfigDocument(content);
  const config = (document.toJS() ?? {}) as SkillsConfig;

  if (
    config.installedVersion !== undefined &&
    !isInstallation(config.installedVersion)
  ) {
    throw new Error(
      `${CONFIG_DISPLAY_PATH} installedVersion must contain a version string and a valid YYYY-MM-DD released date.`,
    );
  }

  if (
    config.ignoredSkills !== undefined &&
    !Array.isArray(config.ignoredSkills)
  ) {
    throw new Error(`${CONFIG_DISPLAY_PATH} ignoredSkills must be an array.`);
  }

  if (config.ignoredSkills?.some((skill) => typeof skill !== "string")) {
    throw new Error(
      `${CONFIG_DISPLAY_PATH} ignoredSkills values must be strings.`,
    );
  }

  if (
    config.ignoredSkills?.some(
      (skill) =>
        skill.includes("/") ||
        skill.includes("\\") ||
        skill === "." ||
        skill === "..",
    )
  ) {
    throw new Error(
      `${CONFIG_DISPLAY_PATH} ignoredSkills values must be top-level folder names or wildcard patterns.`,
    );
  }

  const { saveOptions } = config;
  if (saveOptions !== undefined) {
    if (
      saveOptions === null ||
      typeof saveOptions !== "object" ||
      Array.isArray(saveOptions)
    ) {
      throw new Error(`${CONFIG_DISPLAY_PATH} saveOptions must be an object.`);
    }

    if (
      saveOptions.source !== undefined &&
      !isNonEmptyString(saveOptions.source)
    ) {
      throw new Error(
        `${CONFIG_DISPLAY_PATH} saveOptions.source must be a non-empty string.`,
      );
    }

    if (
      saveOptions.symlinks !== undefined &&
      (!Array.isArray(saveOptions.symlinks) ||
        !saveOptions.symlinks.every(isNonEmptyString))
    ) {
      throw new Error(
        `${CONFIG_DISPLAY_PATH} saveOptions.symlinks must be an array of non-empty strings.`,
      );
    }
  }

  return config;
}

/**
 * Resolves the install and link folders against the workspace root, falling
 * back to `.agents/skills/` linked into `.claude/skills/` when not configured.
 */
function resolveSavePaths(saveOptions: SaveOptions = {}): SavePaths {
  const installPath = path.resolve(saveOptions.source ?? DEFAULT_INSTALL_PATH);
  const linkPaths = (saveOptions.symlinks ?? DEFAULT_SYMLINK_PATHS).map(
    (linkPath) => path.resolve(linkPath),
  );
  const seenPaths = [installPath];

  for (const linkPath of linkPaths) {
    if (seenPaths.some((seenPath) => isSamePath(seenPath, linkPath))) {
      throw new Error(
        `${CONFIG_DISPLAY_PATH} saveOptions.symlinks must not repeat a folder or include saveOptions.source: ${displayPath(linkPath)}.`,
      );
    }
    seenPaths.push(linkPath);
  }

  return { installPath, linkPaths };
}

/**
 * Updates only the `installedVersion` value so that comments and formatting
 * elsewhere in the YAML content are preserved.
 */
export function setInstalledVersion(
  content: string,
  installation: Installation,
): string {
  const document = parseConfigDocument(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const version = JSON.stringify(installation.version);
  const released = JSON.stringify(installation.released);
  const inlineVersion = `{ version: ${version}, released: ${released} }`;
  const blockVersion = (indent: string) =>
    `${indent}installedVersion:${newline}${indent}  version: ${version}${newline}${indent}  released: ${released}${newline}`;
  const root = document.contents;

  if (isEmptyYamlDocument(root)) {
    const insertAt = document.range[1];
    const before = content.slice(0, insertAt);
    const separator = before && !before.endsWith("\n") ? newline : "";
    return `${before}${separator}${blockVersion("")}${content.slice(insertAt)}`;
  }

  if (!isMap(root) || !root.range) {
    throw new Error(`${CONFIG_DISPLAY_PATH} must contain a YAML mapping.`);
  }

  if (!root.has("installedVersion")) {
    if (root.flow) {
      const insertAt = root.range[0] + 1;
      const separator = root.items.length > 0 ? ", " : " ";
      return (
        content.slice(0, insertAt) +
        `installedVersion: ${inlineVersion}${separator}` +
        content.slice(insertAt)
      );
    }

    const lineStart = content.lastIndexOf("\n", root.range[0] - 1) + 1;
    const prefix = content.slice(lineStart, root.range[0]);
    const indent = /^[\uFEFF]?([ \t]*)$/.exec(prefix)?.[1];
    if (indent === undefined) {
      throw new Error(`${CONFIG_DISPLAY_PATH} has an unsupported YAML layout.`);
    }
    const insertAt = root.range[1];
    const before = content.slice(0, insertAt);
    const separator = before.endsWith("\n") ? "" : newline;
    return `${before}${separator}${blockVersion(indent)}${content.slice(insertAt)}`;
  }

  const existing: unknown = root.get("installedVersion", true);
  if (isAlias(existing) && existing.range) {
    const [start, end] = existing.range;
    return content.slice(0, start) + inlineVersion + content.slice(end);
  }
  if (!isMap(existing)) {
    throw new Error(
      `${CONFIG_DISPLAY_PATH} installedVersion must be a mapping.`,
    );
  }

  // Use YAML's source offsets so unrelated formatting and comments stay intact.
  const replacements = [
    { node: existing.get("version", true), value: version },
    { node: existing.get("released", true), value: released },
  ].map(({ node, value }) => {
    if ((!isScalar(node) && !isAlias(node)) || !node.range) {
      throw new Error(
        `${CONFIG_DISPLAY_PATH} installedVersion must contain scalar version and released values.`,
      );
    }
    const [start, end] = node.range;
    const source = content.slice(start, end);
    const comment =
      isScalar(node) &&
      (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED")
        ? (/^[|>][^#\r\n]*?([ \t]+#[^\r\n]*)/.exec(source)?.[1] ?? "")
        : "";
    const ending = /\r?\n$/.exec(source)?.[0] ?? "";
    return { start, end, value: value + comment + ending };
  });

  for (const { start, end, value } of replacements.sort(
    (first, second) => second.start - first.start,
  )) {
    content = content.slice(0, start) + value + content.slice(end);
  }
  return content;
}

export function createSkillIgnoreMatcher(
  ignoreSkills: string[],
): SkillIgnoreMatcher {
  const exactMatches = new Set(
    ignoreSkills.filter((skill) => !skill.includes("*")),
  );
  const wildcardPatterns = ignoreSkills
    .filter((skill) => skill.includes("*"))
    .map(
      (skill) =>
        new RegExp(`^${skill.split("*").map(escapeRegExp).join(".*")}$`),
    );

  return (folder) =>
    exactMatches.has(folder) ||
    wildcardPatterns.some((pattern) => pattern.test(folder));
}

function toSkillName(folder: string): string {
  // Trim names over the limit, without leaving a trailing hyphen.
  return `${SKILL_PREFIX}${folder}`
    .slice(0, MAX_SKILL_NAME_LENGTH)
    .replace(/-+$/, "");
}

export function createSkillReferencePattern(skillNames: string[]): RegExp {
  return new RegExp(
    `https?:\\/\\/[^\\s<>"\`]+|(?<![a-zA-Z0-9_-])(${skillNames.map(escapeRegExp).join("|")})(?![a-zA-Z0-9_-]|\\.[a-zA-Z0-9])`,
    "g",
  );
}

export function prefixSkillReferences(
  content: string,
  skillReferences: RegExp,
): string {
  // Keep upstream URLs and filenames intact while renaming skill references.
  return content.replace(
    skillReferences,
    (match: string, skill: string | undefined) =>
      skill ? toSkillName(skill) : match,
  );
}

export function getGitHubRepositoryPath(repoUrl: string): string | undefined {
  try {
    const url = new URL(repoUrl);

    if (url.hostname !== "github.com") {
      return undefined;
    }

    return url.pathname.replace(/^\/|\/$/g, "").replace(/\.git$/, "");
  } catch {
    return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repoUrl)?.[1];
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T) => Promise<R>,
  limit = FILE_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  // Wait for in-flight work so callers can safely clean up after a failure.
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  const rejection = outcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  if (rejection) {
    throw rejection.reason;
  }
  return results;
}

async function git(args: string[], cwd?: string): Promise<void> {
  try {
    await execFileAsync("git", args, { cwd });
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
    };
    const output = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(
      `git ${args.join(" ")} failed with code ${String(code)}.${output ? `\n${output}` : ""}`,
    );
  }
}

async function resolveLatestRelease(): Promise<Installation> {
  const repositoryPath = getGitHubRepositoryPath(REPO_URL);

  if (!repositoryPath) {
    throw new Error(
      `Latest release lookup only supports GitHub repository URLs. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit from ${REPO_URL}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${repositoryPath}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "salesforce-skills-importer",
          ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
        },
        signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Timed out after ${RELEASE_REQUEST_TIMEOUT_MS / 1000} seconds while checking the latest GitHub release for ${REPO_URL}.`,
      );
    }

    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `Could not find latest GitHub release for ${REPO_URL}: ${response.status} ${response.statusText}. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit.`,
    );
  }

  const release = (await response.json()) as {
    tag_name?: unknown;
    published_at?: unknown;
  };

  if (typeof release.tag_name !== "string" || !release.tag_name) {
    throw new Error(
      `Latest GitHub release for ${REPO_URL} did not include a tag_name. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit.`,
    );
  }

  if (
    typeof release.published_at !== "string" ||
    !Number.isFinite(Date.parse(release.published_at))
  ) {
    throw new Error(
      `Latest GitHub release for ${REPO_URL} did not include a valid published_at date.`,
    );
  }

  return {
    version: release.tag_name,
    released: new Date(release.published_at).toISOString().slice(0, 10),
  };
}

async function readConfigFile(): Promise<string | undefined> {
  try {
    return await fs.readFile(CONFIG_PATH, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function saveInstalledVersion(
  configContent: string | undefined,
  installation: Installation,
): Promise<boolean> {
  return progressDisplay.run("save", async () => {
    if (configContent === undefined) {
      await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
      await fs.writeFile(
        CONFIG_PATH,
        `${CONFIG_HEADER}${stringify({
          ignoredSkills: [],
          saveOptions: {
            source: DEFAULT_INSTALL_PATH,
            symlinks: DEFAULT_SYMLINK_PATHS,
          },
          installedVersion: installation,
        })}`,
      );
      return true;
    }

    const updatedContent = setInstalledVersion(configContent, installation);
    if (updatedContent === configContent) {
      return false;
    }

    await fs.writeFile(CONFIG_PATH, updatedContent);
    return true;
  });
}

function formatVersion(
  version: string | undefined,
  date: string | undefined,
): string {
  return `${version ?? "unknown"}${date ? ` (${date})` : ""}`;
}

function skillWord(count: number): string {
  return count === 1 ? "skill" : "skills";
}

async function lstatIfExists(
  entryPath: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(entryPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function listTopLevelDirectories(
  directoryPath: string,
): Promise<string[]> {
  return (await readDirectoryIfExists(directoryPath))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function listFiles(directoryPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directoryPath, {
      recursive: true,
      withFileTypes: true,
    });

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(directoryPath, path.join(entry.parentPath, entry.name)),
      )
      .sort();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function removeFolders(
  installPath: string,
  folders: string[],
): Promise<void> {
  await Promise.all(
    folders.map((folder) =>
      fs.rm(path.join(installPath, folder), { force: true, recursive: true }),
    ),
  );
}

async function readLinkTarget(linkPath: string): Promise<string> {
  return path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
}

async function readDirectoryIfExists(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function planSkillLinks(
  linkPath: string,
  installPath: string,
  skillFolders: string[],
): Promise<LinkPlan> {
  const expectedFolders = new Set(skillFolders);
  const staleLinks: string[] = [];
  const missingFolders: string[] = [];

  for (const entry of await readDirectoryIfExists(linkPath)) {
    const entryPath = path.join(linkPath, entry.name);

    if (
      entry.name.startsWith(SKILL_PREFIX) &&
      entry.isSymbolicLink() &&
      !expectedFolders.has(entry.name) &&
      isSamePath(
        await readLinkTarget(entryPath),
        path.join(installPath, entry.name),
      )
    ) {
      staleLinks.push(entryPath);
    }
  }

  for (const folder of skillFolders) {
    const entryPath = path.join(linkPath, folder);
    const stats = await lstatIfExists(entryPath);

    if (!stats) {
      missingFolders.push(folder);
      continue;
    }

    if (stats.isSymbolicLink()) {
      const target = await readLinkTarget(entryPath);

      if (isSamePath(target, path.join(installPath, folder))) {
        continue;
      }

      // A link to a same-named skill elsewhere is left from a previous install path.
      if (path.basename(target) === folder) {
        staleLinks.push(entryPath);
        missingFolders.push(folder);
        continue;
      }
    }

    throw new Error(
      `Cannot link ${displayPath(entryPath)}: an existing file, directory, or unrelated link would be overwritten. Move it aside and rerun the importer.`,
    );
  }

  return { linkPath, staleLinks, missingFolders };
}

async function syncSkillLinks(
  { installPath, linkPaths }: SavePaths,
  skillFolders: string[],
): Promise<boolean> {
  if (linkPaths.length === 0) {
    progressDisplay.skip("links");
    return false;
  }

  return progressDisplay.run("links", async () => {
    // Check every link folder for conflicts before changing any of them.
    const plans = await Promise.all(
      linkPaths.map((linkPath) =>
        planSkillLinks(linkPath, installPath, skillFolders),
      ),
    );

    for (const { linkPath, staleLinks, missingFolders } of plans) {
      await Promise.all(staleLinks.map((entryPath) => fs.unlink(entryPath)));

      if (missingFolders.length === 0) {
        continue;
      }

      await fs.mkdir(linkPath, { recursive: true });
      await Promise.all(
        missingFolders.map((folder) => {
          const targetPath = path.join(installPath, folder);
          return fs.symlink(
            IS_WINDOWS ? targetPath : path.relative(linkPath, targetPath),
            path.join(linkPath, folder),
            IS_WINDOWS ? "junction" : "dir",
          );
        }),
      );
    }

    return plans.some(
      ({ staleLinks, missingFolders }) =>
        staleLinks.length > 0 || missingFolders.length > 0,
    );
  });
}

async function prefixSkillReferencesInFolder(
  directoryPath: string,
  skillReferences: RegExp,
): Promise<void> {
  const markdownFiles = (await listFiles(directoryPath)).filter(
    (file) => path.extname(file).toLowerCase() === ".md",
  );

  for (const file of markdownFiles) {
    const filePath = path.join(directoryPath, file);
    const content = await fs.readFile(filePath, "utf8");
    const updated = prefixSkillReferences(content, skillReferences);

    if (updated !== content) {
      await fs.writeFile(filePath, updated);
    }
  }
}

async function prepareSkillFolders(
  sourcePath: string,
  preparedPath: string,
  sourceFolders: string[],
  isIgnoredSkill: SkillIgnoreMatcher,
): Promise<string[]> {
  // Create the folder up front so that an empty release still has a source.
  await fs.mkdir(preparedPath, { recursive: true });
  const skillReferences = createSkillReferencePattern(sourceFolders);
  const includedFolders = sourceFolders.filter(
    (folder) => !isIgnoredSkill(toSkillName(folder)),
  );
  const folderBySkillName = new Map<string, string>();

  for (const folder of includedFolders) {
    const skillName = toSkillName(folder);

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
      throw new Error(`Invalid prefixed Salesforce skill name: ${skillName}.`);
    }

    const otherFolder = folderBySkillName.get(skillName);
    if (otherFolder) {
      throw new Error(
        `Salesforce skills ${otherFolder} and ${folder} both become ${skillName}; ignore one of them.`,
      );
    }
    folderBySkillName.set(skillName, folder);
  }

  return mapWithConcurrency(includedFolders, async (folder) => {
    const skillName = toSkillName(folder);

    const skillPath = path.join(sourcePath, folder, "SKILL.md");
    const content = await fs.readFile(skillPath, "utf8");
    const header = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

    if (!header || !/^name:[ \t]*\S[^\r\n]*/m.test(header[1])) {
      throw new Error(`${skillPath} must have YAML frontmatter with a name.`);
    }

    const renamedHeader = header[0].replace(
      /^name:[^\r\n]*/m,
      `name: ${skillName}`,
    );
    const preparedFolder = path.join(preparedPath, skillName);
    await fs.cp(path.join(sourcePath, folder), preparedFolder, {
      recursive: true,
    });
    await fs.writeFile(
      path.join(preparedFolder, "SKILL.md"),
      renamedHeader + content.slice(header[0].length),
    );
    await prefixSkillReferencesInFolder(preparedFolder, skillReferences);
    return skillName;
  });
}

async function hasSameContents(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  const [sourceContents, targetContents] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(targetPath),
  ]);

  return sourceContents.equals(targetContents);
}

async function hasFolderChanged(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  const [sourceFiles, targetFiles] = await Promise.all([
    listFiles(sourcePath),
    listFiles(targetPath),
  ]);

  if (
    sourceFiles.length !== targetFiles.length ||
    sourceFiles.some((file, index) => file !== targetFiles[index])
  ) {
    return true;
  }

  for (const file of sourceFiles) {
    if (
      !(await hasSameContents(
        path.join(sourcePath, file),
        path.join(targetPath, file),
      ))
    ) {
      return true;
    }
  }

  return false;
}

async function listChangedFolders(
  sourcePath: string,
  installPath: string,
  folders: string[],
): Promise<string[]> {
  const changed = await mapWithConcurrency(folders, async (folder) =>
    (await hasFolderChanged(
      path.join(sourcePath, folder),
      path.join(installPath, folder),
    ))
      ? folder
      : undefined,
  );

  return changed.filter((folder): folder is string => folder !== undefined);
}

async function copySkillFolders(
  sourcePath: string,
  installPath: string,
  skillFolders: string[],
): Promise<void> {
  if (skillFolders.length === 0) {
    progressDisplay.skip("install");
    return;
  }

  await progressDisplay.run(
    "install",
    async () => {
      await fs.mkdir(installPath, { recursive: true });
      await mapWithConcurrency(skillFolders, async (folder) => {
        const targetFolderPath = path.join(installPath, folder);
        await fs.rm(targetFolderPath, { force: true, recursive: true });
        await fs.cp(path.join(sourcePath, folder), targetFolderPath, {
          recursive: true,
        });
      });
    },
    `Install ${skillFolders.length} Salesforce ${skillWord(skillFolders.length)}`,
  );
}

async function cloneSkillsRepository(
  clonePath: string,
  ref: string,
): Promise<void> {
  await progressDisplay.run(
    "download",
    () =>
      git([
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--sparse",
        // Keep upstream line endings so installs are identical on every platform.
        "--config",
        "core.autocrlf=false",
        "--config",
        "core.eol=lf",
        "--branch",
        ref,
        REPO_URL,
        clonePath,
      ]),
    `Download release ${ref}`,
  );
  await progressDisplay.run("checkout", () =>
    git(["sparse-checkout", "set", SOURCE_PATH], clonePath),
  );
}

async function importSkills(): Promise<ImportResult> {
  const { configContent, config, savePaths } = await progressDisplay.run(
    "config",
    async () => {
      const configContent = await readConfigFile();
      const config = parseSkillsConfig(configContent ?? "");
      return {
        configContent,
        config,
        savePaths: resolveSavePaths(config.saveOptions),
      };
    },
  );
  const { installPath } = savePaths;
  const installed = config.installedVersion;
  if (installed) {
    progressDisplay.log(
      `Current Salesforce skills version: ${formatVersion(installed.version, installed.released)}\n`,
    );
  }

  const isIgnoredSkill = createSkillIgnoreMatcher(config.ignoredSkills ?? []);
  const installedFolders = (await listTopLevelDirectories(installPath)).filter(
    (folder) => folder.startsWith(SKILL_PREFIX),
  );
  const removedFolders = installedFolders.filter(isIgnoredSkill);
  if (removedFolders.length > 0) {
    await progressDisplay.run("ignored", () =>
      removeFolders(installPath, removedFolders),
    );
    progressDisplay.log(
      `${removedFolders.length} current ${skillWord(removedFolders.length)} will be removed and ignored.\n`,
    );
  } else {
    progressDisplay.skip("ignored");
  }
  const existingFolders = new Set(
    installedFolders.filter((folder) => !isIgnoredSkill(folder)),
  );

  let latestRelease: Installation | undefined;
  let ref: string;
  if (REF) {
    ref = REF;
    progressDisplay.skip("release");
  } else {
    latestRelease = await progressDisplay.run("release", resolveLatestRelease);
    ref = latestRelease.version;
  }

  const releaseDate =
    latestRelease?.released ??
    (installed?.version === ref ? installed.released : undefined);

  if (latestRelease && installed?.version === ref && existingFolders.size > 0) {
    progressDisplay.log(styleText("green", "No newer release found!"));
    for (const id of [
      "download",
      "checkout",
      "prepare",
      "install",
      "obsolete",
    ] as const) {
      progressDisplay.skip(id);
    }
    const linksChanged = await syncSkillLinks(savePaths, [...existingFolders]);
    let versionChanged = false;
    if (installed.released !== latestRelease.released) {
      versionChanged = await saveInstalledVersion(configContent, latestRelease);
    } else {
      progressDisplay.skip("save");
    }
    return {
      addedFolders: [],
      changedFolders: [],
      removedFolders,
      changed: removedFolders.length > 0 || linksChanged || versionChanged,
      ref,
      releaseDate,
      skipped: true,
      installed,
    };
  }

  if (latestRelease) {
    progressDisplay.log(
      `New release found: ${styleText("green", ref)} (${releaseDate})\n`,
    );
    if (!installed) {
      progressDisplay.log(
        "No Salesforce skills release is recorded; starting the initial import.",
      );
    } else if (installed.version === ref) {
      progressDisplay.log(
        "The recorded release has no installed skills; restoring the installation.",
      );
    }
  } else {
    progressDisplay.log(
      `Using requested Salesforce skills ref: ${formatVersion(ref, releaseDate)}.`,
    );
  }

  const clonePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "salesforce-skills-"),
  );

  try {
    await cloneSkillsRepository(clonePath, ref);

    const upstreamPath = path.join(clonePath, SOURCE_PATH);
    const upstreamFolders = (
      await listTopLevelDirectories(upstreamPath)
    ).sort();
    const sourcePath = path.join(clonePath, "prefixed-skills");
    const { sourceFolders, addedFolders, changedFolders } =
      await progressDisplay.run("prepare", async () => {
        const sourceFolders = await prepareSkillFolders(
          upstreamPath,
          sourcePath,
          upstreamFolders,
          isIgnoredSkill,
        );
        const addedFolders = sourceFolders.filter(
          (folder) => !existingFolders.has(folder),
        );
        const changedFolders = await listChangedFolders(
          sourcePath,
          installPath,
          sourceFolders.filter((folder) => existingFolders.has(folder)),
        );
        return { sourceFolders, addedFolders, changedFolders };
      });
    const sourceFolderSet = new Set(sourceFolders);

    await copySkillFolders(sourcePath, installPath, [
      ...addedFolders,
      ...changedFolders,
    ]);

    const obsoleteFolders = [...existingFolders].filter(
      (folder) => !sourceFolderSet.has(folder),
    );
    if (obsoleteFolders.length > 0) {
      await progressDisplay.run(
        "obsolete",
        () => removeFolders(installPath, obsoleteFolders),
        `Remove ${obsoleteFolders.length} Salesforce ${skillWord(obsoleteFolders.length)} no longer in the release`,
      );
      removedFolders.push(...obsoleteFolders);
    } else {
      progressDisplay.skip("obsolete");
    }
    const linksChanged = await syncSkillLinks(savePaths, sourceFolders);

    let versionChanged = false;
    if (latestRelease) {
      versionChanged = await saveInstalledVersion(configContent, latestRelease);
    } else {
      progressDisplay.skip("save");
    }

    return {
      addedFolders,
      changedFolders,
      removedFolders,
      changed:
        addedFolders.length > 0 ||
        changedFolders.length > 0 ||
        removedFolders.length > 0 ||
        linksChanged ||
        versionChanged,
      ref,
      releaseDate,
      skipped: false,
      installed,
    };
  } finally {
    await fs.rm(clonePath, { force: true, recursive: true });
  }
}

function printFolders(
  title: string,
  folders: string[],
  format: "green" | "blue" | "red",
): void {
  if (folders.length === 0) {
    return;
  }

  writeLog(`\n${title}`);
  for (const folder of folders) {
    writeLog(`- ${styleText(format, folder)}`);
  }
}

async function main(): Promise<void> {
  writeLog();

  progressDisplay.start();
  let result: ImportResult;
  try {
    result = await importSkills();
  } finally {
    progressDisplay.finish();
  }

  const {
    addedFolders,
    changedFolders,
    ref,
    releaseDate,
    removedFolders,
    skipped,
    installed,
    changed,
  } = result;

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }

  printFolders("Removed Salesforce skills:", removedFolders.sort(), "red");

  if (skipped) {
    writeLog(`\n${styleText("blue", "Import skipped")}.`);
  } else {
    writeLog(
      `\nUpdating skills from version ${formatVersion(installed?.version, installed?.released)} to ${formatVersion(styleText("green", ref), releaseDate)}.`,
    );
    printFolders("New skills:", addedFolders, "green");
    printFolders("Updated skills:", changedFolders, "blue");
    writeLog(`\n${styleText("green", "Done!")}`);
  }

  if (CI_MODE) {
    process.stdout.write(`${changed}\n`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
