import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify } from "yaml";
import {
  createSkillReferencePattern,
  getGitHubRepositoryPath,
  parseSkillsConfig,
  prefixSkillReferences,
  setInstalledVersion,
} from "./import-salesforce-skills.ts";

const exec = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL("./import-salesforce-skills.ts", import.meta.url),
);
const repositoryUrl = "https://github.com/example/salesforce-skills-test.git";

async function createFixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sf-skills-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const upstream = path.join(root, "upstream");
  const workspace = path.join(root, "workspace");
  const importer = path.join(
    workspace,
    "scripts",
    "salesforce-skills",
    "import-salesforce-skills.ts",
  );
  const configPath = path.join(
    workspace,
    "config",
    "salesforce-skills-config.yaml",
  );
  const agents = path.join(workspace, ".agents", "skills");
  const claude = path.join(workspace, ".claude", "skills");
  await fs.mkdir(upstream);
  await fs.mkdir(workspace);
  await fs.mkdir(path.dirname(importer), { recursive: true });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const yamlLink = path.join(workspace, "node_modules", "yaml");
  await fs.mkdir(path.dirname(yamlLink), { recursive: true });
  await fs.symlink(
    path.join(path.dirname(scriptPath), "..", "..", "node_modules", "yaml"),
    yamlLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  await fs.copyFile(scriptPath, importer);
  await exec("git", ["init", "--quiet", upstream]);
  await exec("git", ["config", "user.name", "Skill Import Test"], {
    cwd: upstream,
  });
  await exec("git", ["config", "user.email", "skill-test@example.invalid"], {
    cwd: upstream,
  });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: upstream });

  async function writeSkill(name: string, body = "Original", newline = "\n") {
    const directory = path.join(upstream, "skills", name);
    await fs.mkdir(path.join(directory, "references"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "SKILL.md"),
      [
        "---",
        `name: '${name}'`,
        "description: Test Salesforce workflow.",
        "---",
        "",
        body,
        "[Reference](./references/example.md)",
        "",
      ].join(newline),
    );
    await fs.writeFile(path.join(directory, "references", "example.md"), body);
  }

  async function release(tag: string) {
    await exec("git", ["add", "."], { cwd: upstream });
    await exec("git", ["commit", "--quiet", "-m", tag], { cwd: upstream });
    await exec("git", ["tag", tag], { cwd: upstream });
  }

  async function configure(
    ignoredSkills: string[] = [],
    installedVersion?: string,
  ) {
    await fs.writeFile(
      configPath,
      stringify({
        ...(installedVersion
          ? {
              installedVersion: {
                version: installedVersion,
                released: "2026-01-02",
              },
            }
          : {}),
        ignoredSkills,
      }),
    );
  }

  function createCommand(
    tag: string,
    force: boolean,
    publishedAt: string,
    waitForInput = false,
  ) {
    const release = JSON.stringify({
      tag_name: tag,
      published_at: publishedAt,
    });
    const preload = `globalThis.fetch = async () => { ${waitForInput ? 'await new Promise(resolve => process.stdin.once("data", resolve));' : ""} return new Response(${JSON.stringify(release)}, { status: 200 }); };`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SALESFORCE_SKILLS_REPO: repositoryUrl,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${upstream}.insteadOf`,
      GIT_CONFIG_VALUE_0: repositoryUrl,
      FORCE_COLOR: "1",
    };
    delete env.SALESFORCE_SKILLS_REF;
    delete env.NO_COLOR;
    delete env.NODE_DISABLE_COLORS;
    if (force) {
      env.SALESFORCE_SKILLS_REF = tag;
    }

    return {
      args: [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        importer,
      ],
      env,
    };
  }

  async function run(
    tag: string,
    force = true,
    publishedAt = "2026-01-02T03:04:05Z",
  ) {
    const { args, env } = createCommand(tag, force, publishedAt);
    return exec(process.execPath, args, { cwd: workspace, env });
  }

  function startWaitingForRelease(tag: string) {
    const { args, env } = createCommand(
      tag,
      false,
      "2026-01-02T03:04:05Z",
      true,
    );
    return spawn(process.execPath, args, { cwd: workspace, env });
  }

  await configure();
  return {
    upstream,
    agents,
    claude,
    configPath,
    writeSkill,
    release,
    configure,
    run,
    startWaitingForRelease,
  };
}

async function readSavedConfig(configPath: string) {
  return parseSkillsConfig(await fs.readFile(configPath, "utf8"));
}

async function assertLinkedSkill(
  agents: string,
  claude: string,
  name: string,
  expectedBody: string,
) {
  const folder = `sf-${name}`;
  assert.equal(
    (await fs.lstat(path.join(claude, folder))).isSymbolicLink(),
    true,
  );
  assert.equal(
    await fs.realpath(path.join(claude, folder)),
    await fs.realpath(path.join(agents, folder)),
  );
  const content = await fs.readFile(
    path.join(claude, folder, "SKILL.md"),
    "utf8",
  );
  assert.match(content, new RegExp(`^name: ${folder}\\r?$`, "m"));
  assert.ok(
    content
      .replace(/\r\n/g, "\n")
      .includes(expectedBody.replace(/\r\n/g, "\n")),
    content,
  );
  assert.equal(
    (
      await fs.readFile(
        path.join(claude, folder, "references", "example.md"),
        "utf8",
      )
    ).replace(/\r\n/g, "\n"),
    expectedBody.replace(/\r\n/g, "\n"),
  );
}

test("imports and updates prefixed skills, preserving unrelated skills", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex", "Original", "\r\n");
  await fixture.writeSkill("retired");
  await fixture.writeSkill("ignore-me");
  await fixture.release("v1");
  await fixture.configure(["sf-ignore-*"]);
  for (const directory of [fixture.agents, fixture.claude]) {
    await fs.mkdir(path.join(directory, "apex"), { recursive: true });
    await fs.writeFile(path.join(directory, "apex", "custom.txt"), "Keep me");
    await fs.mkdir(path.join(directory, "custom"), { recursive: true });
  }

  const first = await fixture.run("v1");
  assert.match(
    first.stdout,
    /^\r?\n\x1b\[34m\[>\] Check salesforce-skills-config\.yaml - checking\.\.\./,
  );
  assert.match(first.stdout, /Using requested Salesforce skills ref: v1/);
  assert.doesNotMatch(
    first.stdout,
    /\[>\] Check latest Salesforce skills release/,
  );
  assert.match(first.stdout, /\[x\] Download release v1 - done!/);
  assert.match(first.stdout, /\[x\] Check out Salesforce skill files - done!/);
  assert.match(first.stdout, /\[x\] Install 2 Salesforce skills - done!/);
  assert.doesNotMatch(
    first.stderr,
    /Cloning into|Receiving objects|warning: --depth/i,
  );
  assert.doesNotMatch(first.stdout, /Cloning Salesforce skills repository/);
  assert.match(first.stdout, /sf-apex/);
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", "Original");
  await assert.rejects(fs.stat(path.join(fixture.agents, "sf-ignore-me")), {
    code: "ENOENT",
  });
  assert.equal(
    (await fixture.run("v1")).stdout.includes("Updated skills:"),
    false,
  );

  await fixture.writeSkill("apex", "Updated");
  await fs.rm(path.join(fixture.upstream, "skills", "retired"), {
    recursive: true,
  });
  await fixture.release("v2");
  const updated = await fixture.run("v2");
  assert.match(
    updated.stdout,
    /\[x\] Remove 1 Salesforce skill no longer in the release - done!/,
  );
  assert.match(updated.stdout, /Updated skills:[\s\S]*sf-apex/);
  assert.match(updated.stdout, /Removed Salesforce skills:[\s\S]*sf-retired/);
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", "Updated");
  for (const directory of [fixture.agents, fixture.claude]) {
    await assert.rejects(fs.lstat(path.join(directory, "sf-retired")), {
      code: "ENOENT",
    });
    assert.equal(
      await fs.readFile(path.join(directory, "apex", "custom.txt"), "utf8"),
      "Keep me",
    );
    assert.equal(
      (await fs.stat(path.join(directory, "custom"))).isDirectory(),
      true,
    );
  }
});

test("restores an empty current installation and repairs links when skipping", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.writeSkill("lwc");
  await fixture.release("v1");
  await fixture.configure([], "v1");

  const installed = await fixture.run("v1", false);
  assert.doesNotMatch(installed.stdout, /Import skipped/);
  assert.match(installed.stdout, /to \x1b\[32mv1\x1b\[39m \(2026-01-02\)/);
  assert.deepEqual(
    (await readSavedConfig(fixture.configPath)).installedVersion,
    {
      version: "v1",
      released: "2026-01-02",
    },
  );
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", "Original");
  await fs.unlink(path.join(fixture.claude, "sf-apex"));
  await fixture.configure(["sf-lwc"], "v1");
  const skipped = await fixture.run("v1", false);
  assert.match(skipped.stdout, /Import skipped/);
  assert.match(
    skipped.stdout,
    /\n1 current skill will be removed and ignored\.\r?\n\r?\n/,
  );
  assert.match(
    skipped.stdout,
    /\[x\] Check latest Salesforce skills release - done![\s\S]*No newer release found![\s\S]*\[x\] Synchronize skill links - done![\s\S]*Import skipped\x1b\[39m\.\r?\n/,
  );
  assert.equal(
    skipped.stdout.match(/Current Salesforce skills version/g)?.length,
    1,
  );
  assert.doesNotMatch(skipped.stdout, /\[>\] Download|up to date/);
  assert.match(skipped.stdout, /\[-\] Install Salesforce skills - skipped/);
  assert.match(
    skipped.stdout,
    /Current Salesforce skills version: v1 \(2026-01-02\)/,
  );
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", "Original");
  for (const directory of [fixture.agents, fixture.claude]) {
    await assert.rejects(fs.lstat(path.join(directory, "sf-lwc")), {
      code: "ENOENT",
    });
  }

  await fs.unlink(path.join(fixture.claude, "sf-apex"));
  const repaired = await fixture.run("v1", false);
  assert.match(repaired.stdout, /\[x\] Synchronize skill links - done!/);
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", "Original");
  const unchanged = await fixture.run("v1", false);
  assert.match(
    unchanged.stdout,
    /No newer release found![\s\S]*\[x\] Synchronize skill links - done!/,
  );
});

test("updates the stored version and date when a new release is imported", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.release("v1");
  await fixture.run("v1", false);

  await fixture.writeSkill("apex", "Updated");
  await fixture.release("v2");
  const result = await fixture.run("v2", false, "2026-03-04T12:30:00Z");
  assert.match(
    result.stdout,
    /^\r?\n[\s\S]*\[x\] Check salesforce-skills-config\.yaml - done!\x1b\[39m\r?\nCurrent Salesforce skills version: v1 \(2026-01-02\)\r?\n\r?\n/,
  );
  const releaseLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("New release found: "));
  assert.equal(
    releaseLine,
    "New release found: \x1b[32mv2\x1b[39m (2026-03-04)",
  );
  assert.ok(
    result.stdout.indexOf("New release found:") <
      result.stdout.indexOf("[>] Download release v2"),
  );
  assert.match(result.stdout, /\[x\] Save release information - done!/);
  assert.match(result.stdout, /\[x\] Synchronize skill links - done!/);
  assert.match(
    result.stdout,
    /from version v1 \(2026-01-02\) to \x1b\[32mv2\x1b\[39m \(2026-03-04\)/,
  );
  assert.deepEqual(
    (await readSavedConfig(fixture.configPath)).installedVersion,
    {
      version: "v2",
      released: "2026-03-04",
    },
  );
});

test("reports checkout and installation without per-skill progress", async (t) => {
  const fixture = await createFixture(t);
  for (let index = 1; index <= 26; index += 1) {
    await fixture.writeSkill(`item-${index}`);
  }
  await fixture.release("v1");
  const result = await fixture.run("v1");
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[\d;]*m/g, ""));
  assert.equal(
    lines.filter(
      (line) => line === "[x] Check out Salesforce skill files - done!",
    ).length,
    1,
  );
  assert.equal(
    lines.filter((line) => line === "[x] Install 26 Salesforce skills - done!")
      .length,
    1,
  );
  assert.doesNotMatch(result.stdout, /(?:Prepared|Installed) \d+\/\d+/);
  assert.doesNotMatch(result.stdout, /Preparing \d+ Salesforce skills/);
  assert.doesNotMatch(
    result.stderr,
    /Cloning into|Receiving objects|warning: --depth/i,
  );
});

test("reports the release check before the request completes", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.release("v1");
  await fixture.run("v1");
  await fixture.configure([], "v1");

  const child = fixture.startWaitingForRelease("v1");
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errors += chunk;
  });
  const checking = new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (
        output.includes(
          "[>] Check latest Salesforce skills release - checking for updates...",
        )
      ) {
        resolve();
      }
    });
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  let timeout: NodeJS.Timeout | undefined;
  let exitCode: number | null;
  try {
    await Promise.race([
      checking,
      finished.then((code) => {
        throw new Error(
          `Importer exited before reporting progress (${code}): ${errors}`,
        );
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for progress.")),
          10000,
        );
      }),
    ]);
    assert.equal(child.exitCode, null);
    assert.doesNotMatch(output, /New release found:/);
    assert.doesNotMatch(output, /\[x\] Check latest Salesforce skills release/);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (!child.stdin.destroyed) {
      child.stdin.end("continue\n");
    }
    exitCode = await finished;
  }
  assert.equal(exitCode, 0, errors);
  assert.match(
    output,
    /No newer release found![\s\S]*\[x\] Synchronize skill links - done![\s\S]*\[-\] Save release information - skipped[\s\S]*Import skipped\x1b\[39m\.\r?\n$/,
  );
  assert.doesNotMatch(output, /Done!/);
});

test("reports download errors without announcing success", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.release("v1");

  await assert.rejects(fixture.run("missing"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok("stdout" in error && typeof error.stdout === "string");
    assert.ok("stderr" in error && typeof error.stderr === "string");
    assert.match(
      error.stdout,
      /\[>\] Download release missing - downloading\.\.\./,
    );
    assert.match(error.stdout, /\[!\] Download release missing - error/);
    assert.doesNotMatch(error.stdout, /\[x\] Download release missing/);
    assert.doesNotMatch(error.stdout, /Done!/);
    assert.match(error.stderr, /failed with code/);
    return true;
  });
});

test("reports invalid release and installation dates", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    fixture.run("v1", false, "invalid"),
    /valid published_at date/,
  );
  await fs.writeFile(
    fixture.configPath,
    JSON.stringify({
      installedVersion: { version: "v1", released: "2026-02-31" },
    }),
  );
  await assert.rejects(
    fixture.run("v1", false),
    /installedVersion.*valid YYYY-MM-DD released date/,
  );
});

test("refuses to overwrite a Claude folder or an unrelated link", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.release("v1");
  const conflict = path.join(fixture.claude, "sf-apex");
  const custom = path.join(fixture.claude, "custom");
  await fs.mkdir(conflict, { recursive: true });
  await fs.mkdir(custom);
  await fs.writeFile(path.join(conflict, "custom.txt"), "Keep me");
  await assert.rejects(fixture.run("v1"), /would be overwritten/);
  assert.equal(
    await fs.readFile(path.join(conflict, "custom.txt"), "utf8"),
    "Keep me",
  );
  await fs.rm(conflict, { recursive: true });
  await fs.symlink(
    custom,
    conflict,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(fixture.run("v1"), /would be overwritten/);
  assert.equal(await fs.realpath(conflict), await fs.realpath(custom));
});

test("namespaces cross-skill references without changing upstream URLs or filenames", async (t) => {
  const fixture = await createFixture(t);
  const body = [
    "Load `lwc` or 'apex' using /lwc.",
    "[lwc](../lwc/SKILL.md)",
    "[Upstream](https://example.invalid/skills/lwc/SKILL.md)",
    "[Notes](./references/lwc.md)",
    "Already prefixed: sf-lwc. Not a skill: custom-lwc.",
  ].join("\n");
  await fixture.writeSkill("apex", body);
  await fixture.writeSkill("lwc");
  await fixture.release("v1");
  await fixture.run("v1");
  const expected = [
    "Load `sf-lwc` or 'sf-apex' using /sf-lwc.",
    "[sf-lwc](../sf-lwc/SKILL.md)",
    "[Upstream](https://example.invalid/skills/lwc/SKILL.md)",
    "[Notes](./references/lwc.md)",
    "Already prefixed: sf-lwc. Not a skill: custom-lwc.",
  ].join("\n");
  await assertLinkedSkill(fixture.agents, fixture.claude, "apex", expected);
  assert.equal(
    (
      await fs.stat(
        path.join(fixture.claude, "sf-apex", "..", "sf-lwc", "SKILL.md"),
      )
    ).isFile(),
    true,
  );
});

test("reinstalls only skills whose files changed", async (t) => {
  const fixture = await createFixture(t);
  await fixture.writeSkill("apex");
  await fixture.writeSkill("lwc");
  await fixture.release("v1");
  await fixture.run("v1");
  const untouched = new Date("2000-01-01T00:00:00Z");
  const lwcSkill = path.join(fixture.agents, "sf-lwc", "SKILL.md");
  await fs.utimes(lwcSkill, untouched, untouched);

  await fixture.writeSkill("apex", "Updated");
  await fixture.release("v2");
  const updated = await fixture.run("v2");
  assert.match(updated.stdout, /\[x\] Install 1 Salesforce skill - done!/);
  assert.match(updated.stdout, /Updated skills:\r?\n- \S*sf-apex/);
  assert.doesNotMatch(updated.stdout, /- \S*sf-lwc/);
  assert.equal((await fs.stat(lwcSkill)).mtimeMs, untouched.getTime());

  await fs.writeFile(
    path.join(fixture.upstream, "skills", "lwc", "references", "new.md"),
    "New",
  );
  await fixture.release("v3");
  const added = await fixture.run("v3");
  assert.match(added.stdout, /Updated skills:\r?\n- \S*sf-lwc/);
  assert.equal(
    await fs.readFile(
      path.join(fixture.agents, "sf-lwc", "references", "new.md"),
      "utf8",
    ),
    "New",
  );
});

test("updates installedVersion without discarding config comments", () => {
  const installation = { version: "v2", released: "2026-03-04" };
  const commented = [
    "# Header",
    "# Industries we do not use",
    "ignoredSkills:",
    "  - sf-tableau* # Keep this comment",
    "installedVersion:",
    '  version: "v1" # Current release',
    '  released: "2026-01-02"',
    "",
  ].join("\r\n");
  assert.equal(
    setInstalledVersion(commented, installation),
    commented.replace('"v1"', '"v2"').replace('"2026-01-02"', '"2026-03-04"'),
  );

  const withoutVersion = "# Header\n# Keep me\nignoredSkills: []\n";
  const inserted = setInstalledVersion(withoutVersion, installation);
  assert.match(inserted, /# Keep me/);
  assert.equal(
    inserted,
    '# Header\n# Keep me\nignoredSkills: []\ninstalledVersion:\n  version: "v2"\n  released: "2026-03-04"\n',
  );
  assert.deepEqual(parseSkillsConfig(inserted).installedVersion, installation);
  assert.deepEqual(parseSkillsConfig(setInstalledVersion("{}", installation)), {
    installedVersion: installation,
  });
});

test("parses GitHub repository paths and prefixes skill references", () => {
  assert.equal(
    getGitHubRepositoryPath("git@github.com:owner/repo.name.git"),
    "owner/repo.name",
  );
  assert.equal(
    getGitHubRepositoryPath("https://github.com/owner/repo.name.git"),
    "owner/repo.name",
  );
  assert.equal(
    prefixSkillReferences(
      "Use lwc, not https://x.invalid/lwc or lwc.md.",
      createSkillReferencePattern(["lwc"]),
    ),
    "Use sf-lwc, not https://x.invalid/lwc or lwc.md.",
  );
});
