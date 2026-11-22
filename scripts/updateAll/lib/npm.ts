import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    auditFix,
    auditGlobal,
    auditLockFile,
    fixVulnerabilities,
    printVulnerabilities,
    recordAdvisories,
    severityLevel,
    severityOrder,
    totalOf,
    updateArgs
} from "./audit.ts";
import {
    colors,
    colorText,
    isRecord,
    markdownCode,
    markdownColor,
    markdownText,
    statusMarkdown,
    statusText
} from "./format.ts";
import { log, logTo, printStatus, runTask, skipTask } from "./progress.ts";
import {
    readJson,
    requireSuccess,
    run,
    runUpdate,
    withProjectCopy
} from "./runner.ts";
import type {
    AuditReport,
    CheckResult,
    LockCheck,
    NpmTasks,
    Outputs,
    PackageRow,
    RunContext
} from "./types.ts";

export function hasUpdate(row: PackageRow): boolean {
    return row[1] !== row[2];
}

export function hasNewerOutsideRange(row: PackageRow): boolean {
    return row[3] !== "-" && row[3] !== "Local" && row[2] !== row[3];
}

export function summarize(ctx: RunContext, rows: PackageRow[]): CheckResult {
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const updates = rows.filter(hasUpdate).length;
    const outsideRange = rows.filter(hasNewerOutsideRange).length;
    log(
        ctx,
        outsideRange > 0
            ? `Dependencies with updates: ${updates} (${outsideRange} newer outside range)`
            : `Dependencies with updates: ${updates}`
    );
    printTable(ctx, rows);
    return { actionable: updates > 0, rows };
}

export function printTable(ctx: RunContext, rows: PackageRow[]): void {
    if (rows.length === 0) {
        return;
    }
    const table: PackageRow[] = [
        ["Package", "Current", "Wanted", "Latest"],
        ...rows
    ];
    const widths = [0, 0, 0, 0];
    for (const row of table) {
        row.forEach((value, index) => {
            widths[index] = Math.max(widths[index], value.length);
        });
    }
    const lines: string[] = [];
    const markdown: string[] = [];
    for (const [rowIndex, row] of table.entries()) {
        if (rowIndex === 0) {
            lines.push(
                colorText(
                    row
                        .map((value, index) => value.padEnd(widths[index]))
                        .join("  ")
                        .trimEnd(),
                    colors.blue,
                    ctx.useColor
                )
            );
            markdown.push(
                `| ${row.map((value) => markdownText(value)).join(" | ")} |`,
                `| ${row.map(() => "---").join(" | ")} |`
            );
            continue;
        }
        const color = hasUpdate(row) ? colors.yellow : colors.green;
        const newer = hasNewerOutsideRange(row);
        ctx.newerOutsideRange ||= newer;
        lines.push(
            row
                .map((value, index) => {
                    const padded = value.padEnd(widths[index]);
                    if (index === 1) {
                        return colorText(padded, color, ctx.useColor);
                    }
                    return index === 3 && newer
                        ? value + colorText("*", colors.blue, ctx.useColor)
                        : padded;
                })
                .join("  ")
                .trimEnd()
        );
        const [name, current, wanted, latest] = row;
        const latestMarkdown = `${markdownText(latest)}${newer ? "\\*" : ""}`;
        markdown.push(
            `| ${markdownText(`\`${name}\``)} | ${markdownColor(
                current,
                hasUpdate(row) ? "goldenrod" : "green"
            )} | ${markdownText(wanted)} | ${latestMarkdown} |`
        );
    }
    log(ctx, lines.join("\n"), markdown.join("\n"));
}

export async function checkOutdated(
    ctx: RunContext,
    cwd: string,
    global = false
): Promise<CheckResult> {
    const scope = global ? ["--global"] : [];
    const result = await run(
        ctx,
        "npm",
        ["outdated", "--json", "--loglevel=error", ...scope],
        cwd,
        true
    );
    if (result.status !== 0 && result.status !== 1) {
        throw new Error(`npm outdated failed (exit ${result.status}).`);
    }
    const data: unknown = JSON.parse(result.stdout.trim() || "{}");
    if (!isRecord(data) || "error" in data) {
        throw new Error(
            `Invalid npm outdated response: ${JSON.stringify(data)}`
        );
    }
    const entries = Object.entries(data);
    if (result.status === 1 && entries.length === 0) {
        throw new Error("npm outdated failed without reporting packages.");
    }

    const rows: PackageRow[] = [];
    for (const [name, value] of entries) {
        if (!isRecord(value) || typeof value.wanted !== "string") {
            throw new Error(`Cannot determine Wanted for ${name}.`);
        }
        rows.push([
            name,
            typeof value.current === "string" ? value.current : "MISSING",
            value.wanted,
            typeof value.latest === "string" ? value.latest : "-"
        ]);
    }
    if (global) {
        const installed = await readJson(
            ctx,
            "npm",
            [
                "ls",
                "--global",
                "--depth=0",
                "--long",
                "--json",
                "--loglevel=error"
            ],
            cwd,
            "Listing installed global npm packages"
        );
        if (
            !isRecord(installed) ||
            ("dependencies" in installed && !isRecord(installed.dependencies))
        ) {
            throw new Error("Invalid global npm package list.");
        }
        const reportedRows = new Map(rows.map((row) => [row[0], row]));
        for (const [name, value] of Object.entries(
            installed.dependencies || {}
        )) {
            if (!isRecord(value) || typeof value.version !== "string") {
                throw new Error(
                    `Cannot determine installed version for ${name}.`
                );
            }
            const local =
                value.private === true ||
                value.link === true ||
                (typeof value.resolved === "string" &&
                    value.resolved.startsWith("file:"));
            const row = reportedRows.get(name);
            if (!row) {
                rows.push([
                    name,
                    value.version,
                    value.version,
                    local ? "Local" : value.version
                ]);
            } else if (local) {
                row[3] = "Local";
            }
        }
    }
    return summarize(ctx, rows);
}

export function printChanges(
    ctx: RunContext,
    heading: string,
    changes: [string, string, string][]
): void {
    if (changes.length === 0) {
        return;
    }
    log(
        ctx,
        [
            heading,
            ...changes.map(
                ([name, from, to]) =>
                    `    ${name} ${colorText(from, colors.yellow, ctx.useColor)} → ${colorText(to, colors.green, ctx.useColor)}`
            )
        ].join("\n"),
        [
            markdownText(heading),
            "",
            ...changes.map(
                ([name, from, to]) =>
                    `- ${markdownText(`\`${name}\``)} ${markdownColor(from, "goldenrod")} → ${markdownColor(to, "green")}`
            )
        ].join("\n")
    );
}

export function lockVersions(file: string): Map<string, string> {
    const lock: unknown = JSON.parse(
        fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")
    );
    if (!isRecord(lock) || !isRecord(lock.packages)) {
        throw new Error(`Unsupported lock file format: ${file}`);
    }
    const versions = new Map<string, string[]>();
    for (const [key, value] of Object.entries(lock.packages)) {
        const index = key.lastIndexOf("node_modules/");
        if (index < 0 || !isRecord(value) || typeof value.version !== "string") {
            continue;
        }
        const name = key.slice(index + "node_modules/".length);
        versions.set(name, [...(versions.get(name) || []), value.version]);
    }
    return new Map(
        [...versions].map(([name, list]) => [
            name,
            [...new Set(list)].sort().join(",")
        ])
    );
}

export async function checkLockFile(
    ctx: RunContext,
    cwd: string
): Promise<LockCheck | undefined> {
    const lockPath = path.join(cwd, "package-lock.json");
    if (!fs.existsSync(lockPath)) {
        log(ctx, "No package-lock.json, so dependencies were not checked.");
        return undefined;
    }
    return withProjectCopy(cwd, async (temp) => {
        const before = await auditLockFile(ctx, temp);
        requireSuccess(
            await run(
                ctx,
                "npm",
                [
                    "update",
                    "--save",
                    "--package-lock-only",
                    "--ignore-scripts",
                    "--no-audit",
                    "--fund=false",
                    "--loglevel=error"
                ],
                temp,
                true,
                true
            ),
            "Checking dependencies"
        );
        const after = await auditLockFile(ctx, temp);
        const predictedFix =
            ctx.dryRun && totalOf(after) > 0
                ? await auditFix(ctx, temp, true)
                : undefined;
        const current = lockVersions(lockPath);
        const next = lockVersions(path.join(temp, "package-lock.json"));
        return { ...diffLocks(current, next), before, after, predictedFix };
    });
}

export function diffLocks(
    current: Map<string, string>,
    next: Map<string, string>
): { updated: string[]; added: number; removed: number } {
    return {
        updated: [...next]
            .filter(([name, versions]) => {
                const old = current.get(name);
                return old !== undefined && old !== versions;
            })
            .map(([name]) => name),
        added: [...next.keys()].filter((name) => !current.has(name)).length,
        removed: [...current.keys()].filter((name) => !next.has(name)).length
    };
}

export function printLockChanges(ctx: RunContext, check: LockCheck): void {
    const lines: string[] = [];
    const markdown: string[] = [];
    if (check.updated.length > 0) {
        const groups = new Map<string, number>();
        for (const name of check.updated) {
            const severity = check.before.severities.get(name);
            const fixed =
                severity && !check.after.severities.has(name)
                    ? severity
                    : "other";
            groups.set(fixed, (groups.get(fixed) || 0) + 1);
        }
        const width = String(check.updated.length).length;
        const heading = `Dependencies ${ctx.dryRun ? "to update" : "updated"}: ${check.updated.length}`;
        lines.push(heading);
        markdown.push(heading, "");
        for (const severity of [...severityOrder, "other"]) {
            const count = groups.get(severity);
            if (!count) {
                continue;
            }
            const text = `${count} ${
                severity === "other"
                    ? "other updates"
                    : `${ctx.dryRun ? "fix" : "fixed"} ${severity} vulnerabilities`
            }`;
            const line = `    ${String(count).padStart(width)}${text.slice(String(count).length)}`;
            const red = severity === "critical" || severity === "high";
            lines.push(red ? colorText(line, colors.red, ctx.useColor) : line);
            markdown.push(`- ${markdownColor(text, red ? "red" : "")}`);
        }
    }
    for (const [count, label] of [
        [check.added, ctx.dryRun ? "to add" : "added"],
        [check.removed, ctx.dryRun ? "to remove" : "removed"]
    ] as const) {
        if (count > 0) {
            lines.push(`Dependencies ${label}: ${count}`);
            markdown.push(
                ...(markdown.length > 0 ? [""] : []),
                `Dependencies ${label}: ${count}`
            );
        }
    }
    if (lines.length > 0) {
        log(ctx, lines.join("\n"), markdown.join("\n"));
    }
}

export function formatNpmSummary(line: string): string | undefined {
    if (
        !/^(?:up to date|(?:added|removed|changed|audited) \d+ packages?)(?:, (?:and )?(?:added|removed|changed|audited) \d+ packages?)* in \S+$/.test(
            line
        )
    ) {
        return undefined;
    }
    const parts = line.split(/,\s+(?:and\s+)?/);
    const formatted =
        parts.length === 2
            ? `${parts[0]} and ${parts[1]}`
            : parts.length > 2
              ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
              : parts[0];
    return `${formatted[0].toUpperCase()}${formatted.slice(1)}.`;
}

export async function updateNpmPackages(
    ctx: RunContext,
    cwd: string,
    tasks: NpmTasks,
    label: string,
    global = false
): Promise<void> {
    const outdated = await runTask(
        ctx,
        tasks.outdated,
        "checking for updates...",
        () => checkOutdated(ctx, cwd, global)
    );
    const lockPath = path.join(cwd, "package-lock.json");
    const hasLock = !global && fs.existsSync(lockPath);
    const preview = await runTask(
        ctx,
        tasks.dependencies,
        "checking dependencies...",
        async () => {
            if (!tasks.dependencies) {
                return undefined;
            }
            const check = await checkLockFile(ctx, cwd);
            if (check) {
                printLockChanges(ctx, check);
            }
            return check;
        }
    );
    const previewChanged = Boolean(
        preview &&
            (preview.updated.length > 0 || preview.added > 0 || preview.removed > 0)
    );
    const updating = ctx.dryRun
        ? outdated.actionable || previewChanged
        : outdated.actionable || hasLock;
    let auditBefore: AuditReport | undefined;
    let auditAfter: AuditReport | undefined;
    let changed = false;
    if (updating) {
        const globalUpdateArgs = ctx.allowScripts
            ? ["--global", `--allow-scripts=${ctx.allowScripts}`]
            : ["--global"];
        changed = await runTask(
            ctx,
            tasks.update,
            outdated.actionable || ctx.dryRun ? "updating..." : "checking for updates...",
            async () => {
                const lockBefore =
                    !ctx.dryRun && hasLock ? lockVersions(lockPath) : undefined;
                auditBefore = lockBefore ? await auditLockFile(ctx, cwd) : undefined;
                const output = await runUpdate(
                    ctx,
                    "npm",
                    [
                        "update",
                        ...(global ? globalUpdateArgs : ["--save", "--no-audit"]),
                        ...updateArgs
                    ],
                    cwd,
                    "npm update",
                    false,
                    true
                );
                const changes = ctx.dryRun
                    ? outdated.rows
                          .filter(hasUpdate)
                          .map(([name, current, wanted]): [string, string, string] => [
                              name,
                              current,
                              wanted
                          ])
                    : await updatedPackages(ctx, cwd, outdated.rows, global);
                let lockCheck: LockCheck | undefined;
                if (lockBefore && auditBefore) {
                    const diff = diffLocks(lockBefore, lockVersions(lockPath));
                    if (diff.updated.length > 0 || diff.added > 0 || diff.removed > 0) {
                        auditAfter = await auditLockFile(ctx, cwd);
                        lockCheck = { ...diff, before: auditBefore, after: auditAfter };
                    }
                }
                if (!ctx.dryRun && changes.length === 0 && !lockCheck) {
                    return false;
                }
                printChanges(
                    ctx,
                    ctx.dryRun ? "Would update packages:" : "Updated packages:",
                    changes
                );
                if (lockCheck) {
                    printLockChanges(ctx, lockCheck);
                }
                const summary = output.replace(/^\s+|\s+$/g, "");
                if (summary) {
                    const formatted = formatNpmSummary(summary);
                    if (formatted) {
                        log(ctx, formatted);
                    } else {
                        const lines = summary
                            .split(/\r?\n/)
                            .map((line) => formatNpmSummary(line.trim()) ?? line);
                        log(ctx, lines.join("\n"), markdownCode(lines));
                    }
                }
                if (!ctx.dryRun) {
                    printStatus(ctx, "Up to date!");
                }
                return true;
            }
        );
    }
    if (!changed) {
        skipTask(ctx, tasks.update, "skipped", true);
        logTo(
            ctx,
            tasks.update,
            statusText("Nothing to update", ctx.useColor),
            statusMarkdown("Nothing to update")
        );
    }
    const vulnerabilities = await runTask(
        ctx,
        tasks.audit,
        "checking for vulnerabilities...",
        async () => {
            const report = global
                ? await auditGlobal(ctx, cwd)
                : ctx.dryRun
                  ? preview?.after
                  : auditAfter ||
                    auditBefore ||
                    (fs.existsSync(lockPath) ? await auditLockFile(ctx, cwd) : undefined);
            if (!report) {
                log(ctx, "No package-lock.json, so vulnerabilities were not checked.");
                return undefined;
            }
            printVulnerabilities(ctx, report);
            ctx.worstFound = Math.max(ctx.worstFound, severityLevel(report.counts));
            if (global) {
                ctx.worstUnresolved = Math.max(
                    ctx.worstUnresolved,
                    severityLevel(report.counts)
                );
                recordAdvisories(ctx, label, report);
                if (totalOf(report) > 0) {
                    ctx.globalVulnerabilities = true;
                }
            }
            return report;
        }
    );
    if (tasks.fix && vulnerabilities && totalOf(vulnerabilities) > 0) {
        const report = vulnerabilities;
        try {
            const remaining = await runTask(
                ctx,
                tasks.fix,
                "fixing vulnerabilities...",
                () => fixVulnerabilities(ctx, cwd, report, preview?.predictedFix)
            );
            recordAdvisories(ctx, label, remaining);
        } catch (error) {
            ctx.unresolvedVulnerabilities = true;
            ctx.worstUnresolved = Math.max(
                ctx.worstUnresolved,
                severityLevel(report.counts)
            );
            recordAdvisories(ctx, label, report);
            throw error;
        }
    } else {
        skipTask(ctx, tasks.fix, vulnerabilities ? "skipped - no need" : "skipped");
    }
}

export async function updatedPackages(
    ctx: RunContext,
    cwd: string,
    rows: PackageRow[],
    global: boolean
): Promise<[string, string, string][]> {
    if (rows.length === 0) {
        return [];
    }
    const result = await run(
        ctx,
        "npm",
        ["ls", "--depth=0", "--json", "--loglevel=error", ...(global ? ["--global"] : [])],
        cwd,
        true,
        true
    );
    if (result.status !== 0 && result.status !== 1) {
        throw new Error(`Listing installed npm packages failed (exit ${result.status}).`);
    }
    const data: unknown = JSON.parse(result.stdout.trim() || "{}");
    const dependencies =
        isRecord(data) && isRecord(data.dependencies) ? data.dependencies : {};
    const changes: [string, string, string][] = [];
    for (const [name, before] of rows) {
        const entry = dependencies[name];
        const after =
            isRecord(entry) && typeof entry.version === "string" ? entry.version : "";
        if (after && after !== before) {
            changes.push([name, before, after]);
        }
    }
    return changes;
}

export function readPackageFileHashes(
    directories: string[]
): Map<string, string | undefined> {
    return new Map(
        directories
            .flatMap((directory) =>
                ["package.json", "package-lock.json"].map((file) =>
                    path.join(directory, file)
                )
            )
            .map((file): [string, string | undefined] => [
                file,
                fs.existsSync(file)
                    ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
                    : undefined
            ])
    );
}

export function writeOutputs(
    outputs: Outputs,
    summary: string,
    outputDir: string | undefined,
    githubOutput = process.env.GITHUB_OUTPUT
): void {
    if (githubOutput) {
        const delimiter = `UPDATEALL_${crypto.randomUUID()}`;
        fs.appendFileSync(
            githubOutput,
            Object.entries(outputs)
                .map(([name, value]) => `${name}=${value}\n`)
                .join("") + `summary<<${delimiter}\n${summary}\n${delimiter}\n`
        );
    }
    if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, "summary.md"), `${summary}\n`);
        fs.writeFileSync(
            path.join(outputDir, "outputs.env"),
            Object.entries(outputs)
                .map(
                    ([name, value]) =>
                        `UPDATEALL_${name.toUpperCase().replace(/-/g, "_")}=${value}\n`
                )
                .join("")
        );
    }
}

export function findBundleDirectories(projectRoot: string): string[] {
    return fs
        .globSync("**/uiBundles/**/package.json", {
            cwd: projectRoot,
            exclude: ["**/node_modules", "**/.git"]
        })
        .map((file) => path.join(projectRoot, path.dirname(file)))
        .sort();
}
