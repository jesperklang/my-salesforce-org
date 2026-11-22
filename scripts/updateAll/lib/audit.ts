import * as fs from "node:fs";
import * as path from "node:path";
import {
    colors,
    colorText,
    isRecord,
    markdownColor,
    markdownText
} from "./format.ts";
import { log } from "./progress.ts";
import {
    requireSuccess,
    run,
    runUpdate,
    withProjectCopy,
    withTempDir
} from "./runner.ts";
import type { Advisory, AuditReport, RunContext } from "./types.ts";

export const updateArgs = ["--loglevel=error", "--fund=false"];
export const severityOrder = ["critical", "high", "moderate", "low", "info"];

export const severityColors: Record<string, string> = {
    critical: "\u001b[1;35m",
    high: "\u001b[1;31m",
    moderate: "\u001b[1;33m",
    low: "\u001b[1m",
    info: "\u001b[1m"
};

export const severityMarkdownColors: Record<string, string> = {
    critical: "magenta",
    high: "red",
    moderate: "goldenrod"
};

export function severityRank(severity: string): number {
    const index = severityOrder.indexOf(severity);
    return index < 0 ? severityOrder.length : index;
}

export function severityLevel(counts: Record<string, unknown>): number {
    const levels = ["info", "low", "moderate", "high", "critical"];
    for (let index = levels.length - 1; index >= 0; index--) {
        if (Number(counts[levels[index]]) > 0) {
            return index + 1;
        }
    }
    return 0;
}

export function parseAudit(data: unknown, description: string): AuditReport {
    if (isRecord(data) && isRecord(data.error)) {
        throw new Error(
            `${description} failed: ${String(data.error.summary || data.error.code)}`
        );
    }
    const counts =
        isRecord(data) && isRecord(data.metadata)
            ? data.metadata.vulnerabilities
            : undefined;
    if (!isRecord(counts)) {
        throw new Error(`${description} returned no vulnerability counts.`);
    }
    const severities = new Map<string, string>();
    const effects = new Map<string, string[]>();
    const direct = new Set<string>();
    const advisories = new Map<string, Advisory>();
    const nodes = new Map<string, string[]>();
    if (isRecord(data) && isRecord(data.vulnerabilities)) {
        for (const [name, value] of Object.entries(data.vulnerabilities)) {
            if (!isRecord(value) || typeof value.severity !== "string") {
                continue;
            }
            severities.set(name, value.severity);
            for (const via of Array.isArray(value.via) ? value.via : []) {
                if (isRecord(via) && typeof via.url === "string" && via.url) {
                    advisories.set(via.url, {
                        name: typeof via.name === "string" ? via.name : name,
                        title: typeof via.title === "string" ? via.title : "",
                        severity:
                            typeof via.severity === "string" ? via.severity : value.severity,
                        url: via.url
                    });
                }
            }
            effects.set(
                name,
                (Array.isArray(value.effects) ? value.effects : []).filter(
                    (effect): effect is string => typeof effect === "string"
                )
            );
            const nodeList = (Array.isArray(value.nodes) ? value.nodes : []).filter(
                (node): node is string => typeof node === "string"
            );
            if (nodeList.length > 0) {
                nodes.set(name, nodeList);
            }
            if (value.isDirect === true) {
                direct.add(name);
            }
        }
    }
    return { counts, severities, effects, direct, advisories, nodes };
}

export function recordAdvisories(
    ctx: RunContext,
    label: string,
    report: AuditReport
): void {
    if (report.advisories.size === 0) {
        return;
    }
    const group = ctx.advisoryGroups.get(label) || new Map<string, Advisory>();
    for (const [url, advisory] of report.advisories) {
        group.set(url, advisory);
    }
    ctx.advisoryGroups.set(label, group);
}

export function sortedAdvisories(group: Map<string, Advisory>): Advisory[] {
    return [...group.values()].sort(
        (a, b) =>
            severityRank(a.severity) - severityRank(b.severity) ||
            a.name.localeCompare(b.name) ||
            a.url.localeCompare(b.url)
    );
}

export function advisoryLines(ctx: RunContext): string[] {
    if (ctx.advisoryGroups.size === 0) {
        return [];
    }
    const width = Math.max(...severityOrder.map((severity) => severity.length));
    const lines = ["Vulnerability links:"];
    for (const [label, group] of ctx.advisoryGroups) {
        lines.push(`  ${label}:`);
        for (const { name, title, severity, url } of sortedAdvisories(group)) {
            const text = title.toLowerCase().startsWith(name.toLowerCase())
                ? title
                : title
                  ? `${name}: ${title}`
                  : name;
            lines.push(
                `    ${colorText(severity.padEnd(width), severityColors[severity] || "", ctx.useColor)}  ${text}`,
                `    ${" ".repeat(width)}  ${url}`
            );
        }
    }
    return lines;
}

export function advisoryMarkdown(ctx: RunContext): string[] {
    if (ctx.advisoryGroups.size === 0) {
        return [];
    }
    const lines = ["", "### Vulnerability links"];
    for (const [label, group] of ctx.advisoryGroups) {
        lines.push(
            "",
            `#### ${markdownText(label)}`,
            "",
            "| Severity | Package | Advisory |",
            "| --- | --- | --- |"
        );
        for (const { name, title, severity, url } of sortedAdvisories(group)) {
            const text = markdownText(title || url);
            const link = /^https?:\/\//.test(url)
                ? `[${text}](${url.replace(/[()\s<>]/g, encodeURIComponent)})`
                : text;
            lines.push(
                `| ${markdownColor(severity, severityMarkdownColors[severity] || "", true)} | ${markdownText(`\`${name}\``)} | ${link} |`
            );
        }
    }
    return lines;
}

export async function auditGlobal(ctx: RunContext, cwd: string): Promise<AuditReport> {
    const rootResult = await run(
        ctx,
        "npm",
        ["root", "--global", "--loglevel=error"],
        cwd,
        true,
        true
    );
    requireSuccess(rootResult, "Locating global npm packages");
    const root = rootResult.stdout.trim();
    if (!root) {
        throw new Error("npm root returned an empty path.");
    }
    const packages: Record<string, unknown> = {};
    const walk = (directory: string, prefix: string): void => {
        const entries = fs.readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) {
                continue;
            }
            const full = path.join(directory, entry.name);
            if (entry.name.startsWith("@")) {
                walk(full, `${prefix}${entry.name}/`);
                continue;
            }
            const manifestPath = path.join(full, "package.json");
            if (!fs.existsSync(manifestPath)) {
                continue;
            }
            let manifest: unknown;
            try {
                manifest = JSON.parse(
                    fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")
                );
            } catch {
                continue;
            }
            if (!isRecord(manifest) || typeof manifest.version !== "string") {
                continue;
            }
            const key = `${prefix}${entry.name}`;
            packages[key] = {
                version: manifest.version,
                ...(isRecord(manifest.dependencies)
                    ? { dependencies: manifest.dependencies }
                    : {}),
                ...(isRecord(manifest.optionalDependencies)
                    ? { optionalDependencies: manifest.optionalDependencies }
                    : {})
            };
            const nested = path.join(full, "node_modules");
            if (fs.existsSync(nested)) {
                walk(nested, `${key}/node_modules/`);
            }
        }
    };
    walk(root, "node_modules/");
    const dependencies: Record<string, string> = {};
    for (const [key, value] of Object.entries(packages)) {
        const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
        if (match && isRecord(value) && typeof value.version === "string") {
            dependencies[match[1]] = value.version;
        }
    }
    const manifest = { name: "global-packages", version: "1.0.0", private: true, dependencies };
    return withTempDir(async (temp) => {
        fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify(manifest));
        fs.writeFileSync(
            path.join(temp, "package-lock.json"),
            JSON.stringify({
                ...manifest,
                lockfileVersion: 3,
                requires: true,
                packages: { "": manifest, ...packages }
            })
        );
        const owners = new Map<string, Set<string>>();
        for (const key of Object.keys(packages)) {
            const top = /^node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(key)?.[1];
            const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
            if (top) {
                owners.set(name, (owners.get(name) || new Set()).add(top));
            }
        }
        return { ...(await auditLockFile(ctx, temp)), globalOwners: true, owners };
    });
}

async function runAudit(
    ctx: RunContext,
    args: string[],
    cwd: string,
    description: string
): Promise<unknown> {
    const result = await run(ctx, "npm", args, cwd, true, true);
    if (result.status !== 0 && result.status !== 1) {
        throw new Error(`${description} failed (exit ${result.status}).`);
    }
    return JSON.parse(result.stdout.trim() || "{}");
}

export async function auditLockFile(ctx: RunContext, cwd: string): Promise<AuditReport> {
    return parseAudit(
        await runAudit(
            ctx,
            ["audit", "--package-lock-only", "--json", "--loglevel=error"],
            cwd,
            "npm audit"
        ),
        "npm audit"
    );
}

export async function auditFix(
    ctx: RunContext,
    cwd: string,
    lockOnly: boolean
): Promise<AuditReport> {
    const data = await runAudit(
        ctx,
        [
            "audit",
            "fix",
            ...(lockOnly ? ["--package-lock-only", "--ignore-scripts"] : []),
            "--json",
            "--fund=false",
            "--loglevel=error"
        ],
        cwd,
        "npm audit fix"
    );
    return parseAudit(
        isRecord(data) && !isRecord(data.error) ? data.audit : data,
        "npm audit fix"
    );
}

export function totalOf(report: AuditReport): number {
    return Number(report.counts.total) || 0;
}

export function severityParts(
    counts: Map<string, number> | Record<string, unknown>,
    useColor: boolean,
    markdown = false
): string {
    const value = (severity: string) =>
        Number(counts instanceof Map ? counts.get(severity) : counts[severity]) || 0;
    return [...severityOrder]
        .reverse()
        .filter((severity) => value(severity) > 0)
        .map((severity) => {
            const text = `${value(severity)} ${severity}`;
            return markdown
                ? markdownColor(text, severityMarkdownColors[severity] || "", true)
                : colorText(text, severityColors[severity], useColor);
        })
        .join(", ");
}

export function vulnerabilityLine(
    label: string,
    total: number,
    counts: Map<string, number> | Record<string, unknown>,
    warn: boolean,
    useColor: boolean,
    markdown = false
): string {
    const parts = severityParts(counts, useColor, markdown);
    const text = `${label}: ${total}` + (parts ? ` (${parts})` : "");
    const mark = markdown
        ? markdownColor("!", "red")
        : colorText("!", colors.red, useColor);
    return warn ? `${mark} ${text}` : text;
}

export function logVulnerabilities(
    ctx: RunContext,
    label: string,
    total: number,
    counts: Map<string, number> | Record<string, unknown>,
    warn: boolean,
    packages: [string, Map<string, number>][] = []
): void {
    log(
        ctx,
        [
            vulnerabilityLine(label, total, counts, warn, ctx.useColor),
            ...packages.map(
                ([name, pkgCounts]) =>
                    `    ${name} (${severityParts(pkgCounts, ctx.useColor)})`
            )
        ].join("\n"),
        [
            vulnerabilityLine(label, total, counts, warn, ctx.useColor, true),
            ...(packages.length > 0 ? [""] : []),
            ...packages.map(
                ([name, pkgCounts]) =>
                    `- ${markdownText(`\`${name}\``)} (${severityParts(pkgCounts, ctx.useColor, true)})`
            )
        ].join("\n")
    );
}

export function vulnerabilitiesByPackage(
    report: AuditReport
): Map<string, Map<string, number>> {
    const result = new Map<string, Map<string, number>>();
    for (const [name, severity] of report.severities) {
        const owners = new Set<string>();
        const nodePaths = report.nodes?.get(name);
        if (report.globalOwners && nodePaths && nodePaths.length > 0) {
            for (const nodePath of nodePaths) {
                const top = /^node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(nodePath)?.[1];
                if (top) {
                    owners.add(top);
                }
            }
        } else {
            for (const owner of report.owners?.get(name) || []) {
                owners.add(owner);
            }
        }
        const seen = new Set([name]);
        const queue = [name];
        while (queue.length > 0) {
            const current = queue.shift() || "";
            if (report.direct.has(current)) {
                owners.add(current);
            }
            for (const effect of report.effects.get(current) || []) {
                if (!seen.has(effect)) {
                    seen.add(effect);
                    queue.push(effect);
                }
            }
        }
        for (const owner of owners) {
            const counts = result.get(owner) || new Map<string, number>();
            counts.set(severity, (counts.get(severity) || 0) + 1);
            result.set(owner, counts);
        }
    }
    return result;
}

export function printVulnerabilities(ctx: RunContext, report: AuditReport): void {
    const found = totalOf(report);
    if (found === 0) {
        log(ctx, "found 0 vulnerabilities");
        return;
    }
    logVulnerabilities(
        ctx,
        "Vulnerabilities found",
        found,
        report.counts,
        true,
        [...vulnerabilitiesByPackage(report)].sort(([a], [b]) => a.localeCompare(b))
    );
}

// Packages that are vulnerable in `after` but not in `before`, or more severe.
// npm audit fix can add these, for example by downgrading a peer dependency.
export function addedVulnerabilities(
    before: AuditReport,
    after: AuditReport
): Map<string, string> {
    return new Map(
        [...after.severities].filter(([name, severity]) => {
            const previous = before.severities.get(name);
            return (
                previous === undefined ||
                severityRank(severity) < severityRank(previous)
            );
        })
    );
}

export function logAddedVulnerabilities(
    ctx: RunContext,
    label: string,
    added: Map<string, string>
): void {
    const counts = new Map<string, number>();
    for (const severity of added.values()) {
        counts.set(severity, (counts.get(severity) || 0) + 1);
    }
    logVulnerabilities(
        ctx,
        label,
        added.size,
        counts,
        true,
        [...added]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, severity]): [string, Map<string, number>] => [
                name,
                new Map([[severity, 1]])
            ])
    );
}

export async function fixVulnerabilities(
    ctx: RunContext,
    cwd: string,
    before: AuditReport,
    predicted: AuditReport | undefined
): Promise<AuditReport> {
    const prediction =
        predicted ||
        (ctx.dryRun
            ? before
            : await withProjectCopy(cwd, (temp) => auditFix(ctx, temp, true)));
    const predictedAdded = addedVulnerabilities(before, prediction);
    let after = before;
    if (predictedAdded.size > 0) {
        logAddedVulnerabilities(
            ctx,
            ctx.dryRun
                ? "Would skip, npm audit fix would add"
                : "Skipped, npm audit fix would add",
            predictedAdded
        );
    } else {
        if (ctx.dryRun) {
            await runUpdate(
                ctx,
                "npm",
                ["audit", "fix", ...updateArgs],
                cwd,
                "npm audit fix"
            );
            after = prediction;
        } else {
            after = await auditFix(ctx, cwd, false);
        }
        const fixed = new Map<string, number>();
        for (const [name, severity] of before.severities) {
            if (!after.severities.has(name)) {
                fixed.set(severity, (fixed.get(severity) || 0) + 1);
            }
        }
        const fixedTotal = [...fixed.values()].reduce((sum, count) => sum + count, 0);
        logVulnerabilities(
            ctx,
            ctx.dryRun ? "Would fix" : "Fixed",
            fixedTotal,
            fixed,
            false
        );
        const added = addedVulnerabilities(before, after);
        if (added.size > 0) {
            logAddedVulnerabilities(ctx, "Added by npm audit fix", added);
        }
    }
    const remaining = totalOf(after);
    if (remaining === 0) {
        log(
            ctx,
            ctx.dryRun
                ? "All vulnerabilities would be resolved."
                : "All vulnerabilities resolved."
        );
    } else {
        ctx.unresolvedVulnerabilities = true;
        ctx.worstUnresolved = Math.max(
            ctx.worstUnresolved,
            severityLevel(after.counts)
        );
        logVulnerabilities(
            ctx,
            ctx.dryRun ? "Would not resolve" : "Not resolved",
            remaining,
            after.counts,
            true
        );
    }
    return after;
}
