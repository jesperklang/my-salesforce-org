import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
    addedVulnerabilities,
    fixVulnerabilities,
    parseAudit,
    severityLevel,
    severityRank,
    vulnerabilitiesByPackage
} from "./lib/audit.ts";
import {
    ciAnnotation,
    ciGroup,
    markdownCode,
    markdownColor,
    markdownText
} from "./lib/format.ts";
import {
    diffLocks,
    formatNpmSummary,
    lockVersions,
    readPackageFileHashes,
    updatedPackages,
    writeOutputs
} from "./lib/npm.ts";
import { createRunContext, type AuditReport } from "./lib/types.ts";
import { parseArgs, usageText } from "./updateAll.ts";

const scriptPath = fileURLToPath(new URL("./updateAll.ts", import.meta.url));
const scriptDir = path.dirname(scriptPath);

function testEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CI: "1",
        GITHUB_ACTIONS: "false",
        NO_COLOR: "1"
    };
    delete env.GITHUB_OUTPUT;
    delete env.NODE_OPTIONS;
    delete env.UPDATEALL_ALLOW_SCRIPTS;
    return env;
}

test("reports invalid options when launched as an ES module", () => {
    const result = spawnSync(process.execPath, [scriptPath, "--invalid"], {
        encoding: "utf8",
        env: testEnvironment()
    });

    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /Unknown option: --invalid/);
});

test("prints usage and exits 0 for --help and -h", () => {
    for (const flag of ["--help", "-h"]) {
        const result = spawnSync(process.execPath, [scriptPath, flag], {
            encoding: "utf8",
            env: testEnvironment()
        });
        assert.equal(result.status, 0, result.error?.message || result.stderr);
        assert.equal(result.stdout, usageText);
    }
});

test("parses CLI options including --allow-scripts and UPDATEALL_ALLOW_SCRIPTS", () => {
    const fromFlag = parseArgs(
        ["--dry-run", "--ci", "--allow-scripts=@salesforce/cli,esbuild"],
        {}
    );
    assert.equal(fromFlag.dryRun, true);
    assert.equal(fromFlag.ciMode, true);
    assert.equal(fromFlag.allowScripts, "@salesforce/cli,esbuild");

    const fromEnv = parseArgs([], { UPDATEALL_ALLOW_SCRIPTS: "esbuild,yo" });
    assert.equal(fromEnv.allowScripts, "esbuild,yo");

    assert.throws(
        () => parseArgs(["--allow-scripts"], {}),
        /--allow-scripts needs a comma-separated package list/
    );
    assert.throws(
        () => parseArgs(["--allow-scripts=foo;rm -rf /"], {}),
        /Unsupported characters/
    );
});

test("finds the script's Git project when launched from another directory", (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "update all test-"));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

    const project = path.join(temporary, "project with spaces");
    const scriptDirectory = path.join(project, "scripts", "updateAll");
    const bundle = path.join(project, "uiBundles", "bundle with spaces");
    const bin = path.join(temporary, "bin");
    const log = path.join(temporary, "npm-calls.txt");
    fs.mkdirSync(scriptDirectory, { recursive: true });
    fs.mkdirSync(bundle, { recursive: true });
    fs.mkdirSync(bin);
    fs.copyFileSync(scriptPath, path.join(scriptDirectory, "updateAll.ts"));
    fs.cpSync(
        path.join(scriptDir, "lib"),
        path.join(scriptDirectory, "lib"),
        { recursive: true }
    );
    fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({ name: "test-project", private: true, type: "module" })
    );
    fs.writeFileSync(path.join(bundle, "package.json"), JSON.stringify({ name: "test-bundle" }));

    const init = spawnSync("git", ["init", "--quiet"], { cwd: project, encoding: "utf8" });
    assert.equal(init.status, 0, init.error?.message || init.stderr);

    const outdated = JSON.stringify({
        example: { current: "1.0.0", wanted: "1.1.0", latest: "1.2.0" }
    });
    const windows = process.platform === "win32";
    const npm = windows
        ? [
              "@echo off",
              'if not "%~1"=="outdated" exit /b 2',
              '>>"%UPDATEALL_TEST_NPM_LOG%" echo "%CD%"',
              `echo ${outdated}`,
              ""
          ].join("\r\n")
        : [
              "#!/bin/sh",
              'if [ "$1" != "outdated" ]; then exit 2; fi',
              'printf \'"%s"\\n\' "$PWD" >> "$UPDATEALL_TEST_NPM_LOG"',
              `printf '%s\\n' '${outdated}'`,
              ""
          ].join("\n");
    fs.writeFileSync(path.join(bin, windows ? "npm.cmd" : "npm"), npm, { mode: 0o755 });

    const env = testEnvironment();
    env.PATH = `${bin}${path.delimiter}${env.PATH || ""}`;
    env.UPDATEALL_TEST_NPM_LOG = log;
    const result = spawnSync(
        process.execPath,
        [path.join(scriptDirectory, "updateAll.ts"), "--ci", "--dry-run"],
        { cwd: temporary, encoding: "utf8", env }
    );

    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    assert.match(result.stdout, /Repo npm packages/);
    assert.match(result.stdout, /bundle with spaces/);
    assert.equal((result.stdout.match(/Would run: npm update --save --no-audit/g) || []).length, 2);
    const directories = fs
        .readFileSync(log, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => fs.realpathSync(line.slice(1, -1)));
    assert.deepEqual(directories, [fs.realpathSync(project), fs.realpathSync(bundle)]);
});

test("parseAudit, severityRank, severityLevel, and addedVulnerabilities handle unknown severities safely", () => {
    assert.ok(severityRank("critical") < severityRank("high"));
    assert.ok(severityRank("info") < severityRank("unknown"));
    assert.equal(severityLevel({ info: 0, low: 1, moderate: 0, high: 2, critical: 0 }), 4);
    assert.equal(severityLevel({}), 0);

    const before = parseAudit(
        {
            metadata: { vulnerabilities: { moderate: 1, total: 1 } },
            vulnerabilities: {
                pkgA: {
                    severity: "moderate",
                    isDirect: true,
                    via: [
                        {
                            name: "pkgA",
                            title: "Issue A",
                            severity: "moderate",
                            url: "https://example.com/a"
                        }
                    ],
                    effects: [],
                    nodes: ["node_modules/pkgA"]
                }
            }
        },
        "npm audit"
    );
    const after = parseAudit(
        {
            metadata: { vulnerabilities: { high: 1, total: 2 } },
            vulnerabilities: {
                pkgA: {
                    severity: "unknown-level",
                    isDirect: true,
                    via: [],
                    effects: []
                },
                pkgB: {
                    severity: "high",
                    isDirect: false,
                    via: [],
                    effects: ["pkgA"]
                }
            }
        },
        "npm audit"
    );

    const added = addedVulnerabilities(before, after);
    // pkgA changed from moderate to an unrecognized severity, so it must NOT be treated as more severe than critical
    assert.equal(added.has("pkgA"), false);
    assert.equal(added.get("pkgB"), "high");
});

test("vulnerabilitiesByPackage uses exact node paths for global packages to avoid cross-version false attribution", () => {
    const report: AuditReport = {
        ...parseAudit(
            {
                metadata: { vulnerabilities: { high: 1, total: 1 } },
                vulnerabilities: {
                    sharedDep: {
                        severity: "high",
                        isDirect: false,
                        via: [],
                        effects: [],
                        nodes: ["node_modules/@scope/pkg-a/node_modules/sharedDep"]
                    }
                }
            },
            "npm audit"
        ),
        globalOwners: true,
        owners: new Map([["sharedDep", new Set(["@scope/pkg-a", "pkg-b"])]])
    };

    const byPkg = vulnerabilitiesByPackage(report);
    assert.deepEqual([...byPkg.keys()], ["@scope/pkg-a"]);
    assert.equal(byPkg.get("@scope/pkg-a")?.get("high"), 1);
    assert.equal(byPkg.has("pkg-b"), false);
});

test("diffLocks, lockVersions, and formatNpmSummary work as expected", (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "updateAll-lock-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

    const lockA = path.join(temp, "a.json");
    const lockB = path.join(temp, "b.json");
    fs.writeFileSync(
        lockA,
        JSON.stringify({
            lockfileVersion: 3,
            packages: {
                "": { version: "1.0.0" },
                "node_modules/alpha": { version: "1.0.0" },
                "node_modules/beta": { version: "2.0.0" }
            }
        })
    );
    fs.writeFileSync(
        lockB,
        JSON.stringify({
            lockfileVersion: 3,
            packages: {
                "": { version: "1.0.0" },
                "node_modules/alpha": { version: "1.1.0" },
                "node_modules/gamma": { version: "3.0.0" }
            }
        })
    );

    const diff = diffLocks(lockVersions(lockA), lockVersions(lockB));
    assert.deepEqual(diff, { updated: ["alpha"], added: 1, removed: 1 });

    assert.equal(
        formatNpmSummary("added 1 package, removed 2 packages, and changed 3 packages in 4s"),
        "Added 1 package, removed 2 packages, and changed 3 packages in 4s."
    );
    assert.equal(formatNpmSummary("not an npm summary"), undefined);
});

test("markdown and CI formatting helpers escape special characters", () => {
    assert.equal(markdownText("a*b_c <tag> | `code|pipe`"), "a\\*b\\_c &lt;tag&gt; \\| `code\\|pipe`");
    assert.equal(markdownColor("2 high", "red"), "$\\color{red}{\\textsf{2 high}}$");
    assert.equal(markdownColor("bad{latex}", "red"), "bad{latex}");
    assert.equal(markdownCode(["line 1", "```fence```"]), "````text\nline 1\n```fence```\n````");

    const ghCtx = createRunContext({ env: { GITHUB_ACTIONS: "true", NO_COLOR: "1" } });
    assert.equal(
        ciGroup(ghCtx, "Title", ["line"]),
        "::group::Title\nline\n::endgroup::\n"
    );
    assert.equal(
        ciAnnotation("github", "warning", "100% done\nnext"),
        "::warning::100%25 done next\n"
    );
    assert.equal(
        ciAnnotation("azure", "error", "50% failed"),
        "##vso[task.logissue type=error]50%AZP25 failed\n"
    );
});

test("writeOutputs and readPackageFileHashes persist outputs and detect changes", (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "updateAll-out-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

    const pkgFile = path.join(temp, "package.json");
    fs.writeFileSync(pkgFile, '{"name":"a","version":"1.0.0"}');
    const before = readPackageFileHashes([temp]);
    fs.writeFileSync(pkgFile, '{"name":"a","version":"1.0.1"}');
    const after = readPackageFileHashes([temp]);
    assert.notEqual(before.get(pkgFile), after.get(pkgFile));

    const outDir = path.join(temp, "out");
    const ghOutput = path.join(temp, "gh-output.txt");
    writeOutputs(
        {
            "packages-changed": true,
            "worst-severity-found": 4,
            "worst-severity-unresolved": 2
        },
        "### Summary",
        outDir,
        ghOutput
    );

    assert.equal(fs.readFileSync(path.join(outDir, "summary.md"), "utf8"), "### Summary\n");
    assert.match(
        fs.readFileSync(path.join(outDir, "outputs.env"), "utf8"),
        /UPDATEALL_PACKAGES_CHANGED=true\nUPDATEALL_WORST_SEVERITY_FOUND=4\nUPDATEALL_WORST_SEVERITY_UNRESOLVED=2\n/
    );
    const ghContent = fs.readFileSync(ghOutput, "utf8");
    assert.match(ghContent, /packages-changed=true\n/);
    assert.match(ghContent, /summary<<UPDATEALL_[\s\S]+### Summary\nUPDATEALL_/);
});

test("fixVulnerabilities skips when predicted fix adds vulnerabilities and marks unresolved", async () => {
    const ctx = createRunContext({ dryRun: true, env: { NO_COLOR: "1" } });
    const before = parseAudit(
        {
            metadata: { vulnerabilities: { moderate: 1, total: 1 } },
            vulnerabilities: {
                pkgA: { severity: "moderate", isDirect: true, via: [], effects: [] }
            }
        },
        "npm audit"
    );
    const predicted = parseAudit(
        {
            metadata: { vulnerabilities: { critical: 1, total: 1 } },
            vulnerabilities: {
                pkgB: { severity: "critical", isDirect: true, via: [], effects: [] }
            }
        },
        "npm audit"
    );

    const remaining = await fixVulnerabilities(ctx, process.cwd(), before, predicted);
    assert.equal(remaining, before);
    assert.equal(ctx.unresolvedVulnerabilities, true);
    assert.equal(ctx.worstUnresolved, 3);
});

test("updatedPackages returns immediately when rows are empty", async () => {
    const ctx = createRunContext({ env: { NO_COLOR: "1" } });
    const result = await updatedPackages(ctx, process.cwd(), [], false);
    assert.deepEqual(result, []);
});
