import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_URL =
  process.env.SALESFORCE_SKILLS_REPO ??
  "https://github.com/forcedotcom/afv-library.git";
const REF = process.env.SALESFORCE_SKILLS_REF;
const SOURCE_PATH = "skills";
const TARGET_PATH = path.join(process.cwd(), ".agents", "skills");
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(
  SCRIPT_DIRECTORY,
  "salesforce-skills-config.json"
);
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

type RunOptions = {
  cwd?: string;
};

type ImportResult = {
  addedFolders: string[];
  changedFolders: string[];
  removedIgnoredFolders: string[];
  ref: string;
  skipped: boolean;
  storedReleaseTag?: string;
};

type SkillsConfig = {
  installedVersion?: string;
  ignoreSkills?: string[];
  [key: string]: unknown;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function run(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code}.${output ? `\n${output}` : ""}`
        )
      );
    });
  });
}

function getGitHubRepositoryPath(repoUrl: string): string | undefined {
  try {
    const url = new URL(repoUrl);

    if (url.hostname !== "github.com") {
      return undefined;
    }

    return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    const match = repoUrl.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);

    return match?.[1];
  }
}

async function resolveLatestReleaseTag(): Promise<string> {
  const repositoryPath = getGitHubRepositoryPath(REPO_URL);

  if (!repositoryPath) {
    throw new Error(
      `Latest release lookup only supports GitHub repository URLs. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit from ${REPO_URL}.`
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${repositoryPath}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "salesforce-skills-importer"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Could not find latest GitHub release for ${REPO_URL}: ${response.status} ${response.statusText}. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit.`
    );
  }

  const release = (await response.json()) as { tag_name?: unknown };

  if (typeof release.tag_name !== "string" || !release.tag_name) {
    throw new Error(
      `Latest GitHub release for ${REPO_URL} did not include a tag_name. Set SALESFORCE_SKILLS_REF to clone a branch, tag, or commit.`
    );
  }

  return release.tag_name;
}

async function readSkillsConfig(): Promise<SkillsConfig> {
  try {
    const config = JSON.parse(
      await fs.readFile(CONFIG_PATH, "utf8")
    ) as SkillsConfig;

    if (
      config.installedVersion !== undefined &&
      typeof config.installedVersion !== "string"
    ) {
      throw new Error(
        `${path.relative(process.cwd(), CONFIG_PATH)} installedVersion must be a string.`
      );
    }

    if (
      config.ignoreSkills !== undefined &&
      !Array.isArray(config.ignoreSkills)
    ) {
      throw new Error(
        `${path.relative(process.cwd(), CONFIG_PATH)} ignoreSkills must be an array.`
      );
    }

    if (config.ignoreSkills?.some((skill) => typeof skill !== "string")) {
      throw new Error(
        `${path.relative(process.cwd(), CONFIG_PATH)} ignoreSkills values must be strings.`
      );
    }

    if (
      config.ignoreSkills?.some(
        (skill) =>
          skill.includes("/") ||
          skill.includes("\\") ||
          skill === "." ||
          skill === ".."
      )
    ) {
      throw new Error(
        `${path.relative(process.cwd(), CONFIG_PATH)} ignoreSkills values must be top-level folder names.`
      );
    }

    return config;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {};
    }

    throw error;
  }
}

async function writeSkillsConfig(config: SkillsConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`);
}

async function removeIgnoredSkillFolders(
  ignoredSkills: Set<string>
): Promise<string[]> {
  const removedFolders: string[] = [];
  const removals: Promise<string | null>[] = [];

  [...ignoredSkills].sort().forEach((folder) => {
    const folderPath = path.join(TARGET_PATH, folder);

    removals.push(
      (async () => {
        try {
          const stats = await fs.stat(folderPath);

          if (!stats.isDirectory()) {
            return null;
          }

          await fs.rm(folderPath, { force: true, recursive: true });
          return folder;
        } catch (error) {
          if (hasErrorCode(error, "ENOENT")) {
            return null;
          }

          throw error;
        }
      })()
    );
  });

  const removed = await Promise.all(removals);
  removed.forEach((folder) => {
    if (folder) {
      removedFolders.push(folder);
    }
  });

  return removedFolders;
}

async function listTopLevelDirectories(
  directoryPath: string
): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    return new Set(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return new Set();
    }

    throw error;
  }
}

async function hasSameContents(
  sourcePath: string,
  targetPath: string
): Promise<boolean> {
  try {
    const [sourceContents, targetContents] = await Promise.all([
      fs.readFile(sourcePath),
      fs.readFile(targetPath)
    ]);

    return sourceContents.equals(targetContents);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

async function listChangedTopLevelDirectories(
  sourcePath: string,
  targetPath: string,
  ignoredSkills: Set<string>,
  relativePath = ""
): Promise<Set<string>> {
  const entries = await fs.readdir(path.join(sourcePath, relativePath), {
    withFileTypes: true
  });
  const changedFolders = new Set<string>();

  await Promise.all(
    entries.map(async (entry) => {
      const entryRelativePath = path.join(relativePath, entry.name);
      const topLevelFolder = entryRelativePath.split(path.sep)[0];

      if (ignoredSkills.has(topLevelFolder)) {
        return;
      }

      if (entry.isDirectory()) {
        const nestedChangedFolders = await listChangedTopLevelDirectories(
          sourcePath,
          targetPath,
          ignoredSkills,
          entryRelativePath
        );

        nestedChangedFolders.forEach((folder) => {
          changedFolders.add(folder);
        });

        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const sourceFilePath = path.join(sourcePath, entryRelativePath);
      const targetFilePath = path.join(targetPath, entryRelativePath);
      const isUnchanged = await hasSameContents(sourceFilePath, targetFilePath);

      if (!isUnchanged) {
        changedFolders.add(topLevelFolder);
      }
    })
  );

  return changedFolders;
}

async function listRemovedTopLevelDirectories(
  sourcePath: string,
  targetPath: string,
  ignoredSkills: Set<string>,
  relativePath = ""
): Promise<Set<string>> {
  let entries;

  try {
    entries = await fs.readdir(path.join(targetPath, relativePath), {
      withFileTypes: true
    });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return new Set();
    }

    throw error;
  }

  const removedFolders = new Set<string>();

  await Promise.all(
    entries.map(async (entry) => {
      const entryRelativePath = path.join(relativePath, entry.name);
      const topLevelFolder = entryRelativePath.split(path.sep)[0];

      if (ignoredSkills.has(topLevelFolder)) {
        return;
      }

      const sourceEntryPath = path.join(sourcePath, entryRelativePath);

      try {
        await fs.stat(sourceEntryPath);
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) {
          if (relativePath) {
            removedFolders.add(topLevelFolder);
          }

          return;
        }

        throw error;
      }

      if (!entry.isDirectory()) {
        return;
      }

      const nestedRemovedFolders = await listRemovedTopLevelDirectories(
        sourcePath,
        targetPath,
        ignoredSkills,
        entryRelativePath
      );

      nestedRemovedFolders.forEach((folder) => {
        removedFolders.add(folder);
      });
    })
  );

  return removedFolders;
}

async function copySkillFolders(
  sourcePath: string,
  targetPath: string,
  skillFolders: string[]
): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });

  await Promise.all(
    skillFolders.map(async (folder) => {
      const sourceFolderPath = path.join(sourcePath, folder);
      const targetFolderPath = path.join(targetPath, folder);

      await fs.rm(targetFolderPath, { force: true, recursive: true });
      await fs.cp(sourceFolderPath, targetFolderPath, { recursive: true });
    })
  );
}

async function cloneSkillsRepository(
  clonePath: string,
  ref: string
): Promise<void> {
  await run("git", [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--sparse",
    "--branch",
    ref,
    REPO_URL,
    clonePath
  ]);
  await run("git", ["sparse-checkout", "set", SOURCE_PATH], { cwd: clonePath });
}

async function importSkills(): Promise<ImportResult> {
  const skillsConfig = await readSkillsConfig();
  const storedReleaseTag = skillsConfig.installedVersion;
  const ignoredSkills = new Set(skillsConfig.ignoreSkills ?? []);
  const removedIgnoredFolders = await removeIgnoredSkillFolders(ignoredSkills);
  const ref = REF ?? (await resolveLatestReleaseTag());

  if (!REF && storedReleaseTag === ref) {
    return {
      addedFolders: [],
      changedFolders: [],
      removedIgnoredFolders,
      ref,
      skipped: true,
      storedReleaseTag
    };
  }

  const clonePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "salesforce-skills-")
  );

  try {
    await cloneSkillsRepository(clonePath, ref);

    const sourcePath = path.join(clonePath, SOURCE_PATH);
    const sourceFolders = [...(await listTopLevelDirectories(sourcePath))]
      .filter((folder) => !ignoredSkills.has(folder))
      .sort();

    const existingFolders = await listTopLevelDirectories(TARGET_PATH);
    const addedFolders = [...sourceFolders].filter(
      (folder) => !existingFolders.has(folder)
    );
    const changedFolders = new Set([
      ...(
        await listChangedTopLevelDirectories(
          sourcePath,
          TARGET_PATH,
          ignoredSkills
        )
      ),
      ...(
        await listRemovedTopLevelDirectories(
          sourcePath,
          TARGET_PATH,
          ignoredSkills
        )
      )
    ]);
    const changedExistingFolders = [...changedFolders]
      .filter((folder) => !addedFolders.includes(folder))
      .sort();

    await copySkillFolders(sourcePath, TARGET_PATH, sourceFolders);

    if (!REF) {
      await writeSkillsConfig({
        ...skillsConfig,
        installedVersion: ref,
        ignoreSkills: skillsConfig.ignoreSkills ?? []
      });
    }

    return {
      addedFolders,
      changedFolders: changedExistingFolders,
      removedIgnoredFolders,
      ref,
      skipped: false,
      storedReleaseTag
    };
  } finally {
    await fs.rm(clonePath, { force: true, recursive: true });
  }
}

try {
  const {
    addedFolders,
    changedFolders,
    ref,
    removedIgnoredFolders,
    skipped,
    storedReleaseTag
  } = await importSkills();

  if (removedIgnoredFolders.length > 0) {
    console.log("\nRemoved ignored skills:");

    removedIgnoredFolders.forEach((folder) => {
      console.log(`- ${RED}${folder}${RESET}`);
    });
  }

  if (skipped) {
    console.log(`\nCurrent Salesforce skills version: ${storedReleaseTag}`);
    console.log(`\nNo newer release found. ${BLUE}Import skipped${RESET}.\n`);
    process.exit(0);
  } else {
    console.log(
      `\n${GREEN}Updating skills from version ${storedReleaseTag} to ${ref}.${RESET}`
    );
  }

  if (addedFolders.length > 0) {
    console.log("\nNew skills:");

    addedFolders.forEach((folder) => {
      console.log(`- ${GREEN}${folder}${RESET}`);
    });
  }

  if (changedFolders.length > 0) {
    console.log("\nUpdated skills:");

    changedFolders.forEach((folder) => {
      console.log(`- ${BLUE}${folder}${RESET}`);
    });
  }

  console.log(`\n${GREEN}Done!${RESET}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
