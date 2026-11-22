import type { CiProvider, RunContext } from "./types.ts";

export const colors = {
    blue: "\u001b[34m",
    green: "\u001b[32m",
    yellow: "\u001b[33m",
    red: "\u001b[31m",
    reset: "\u001b[0m"
};

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function colorText(text: string, color: string, useColor: boolean): string {
    return useColor && color ? `${color}${text}${colors.reset}` : text;
}

export function stripColors(text: string): string {
    return text.replace(/\u001b\[[\d;]*m/g, "");
}

export function ciGroup(ctx: RunContext, title: string, body: string[]): string {
    if (ctx.ciProvider === "github") {
        return [`::group::${title}`, ...body, "::endgroup::"].join("\n") + "\n";
    }
    if (ctx.ciProvider === "azure") {
        return [`##[group]${title}`, ...body, "##[endgroup]"].join("\n") + "\n";
    }
    if (ctx.ciProvider === "gitlab") {
        const name = `updateall_${++ctx.ciSections}`;
        const time = () => Math.floor(Date.now() / 1000);
        return (
            [
                `\u001b[0Ksection_start:${time()}:${name}[collapsed=true]\r\u001b[0K${title}`,
                ...body,
                `\u001b[0Ksection_end:${time()}:${name}\r\u001b[0K`
            ].join("\n") + "\n"
        );
    }
    return [title, ...body].join("\n") + "\n";
}

export function ciAnnotation(
    provider: CiProvider | undefined,
    type: "warning" | "error",
    message: string
): string {
    const text = stripColors(message).replace(/\s*\r?\n\s*/g, " ").trim();
    if (provider === "github") {
        return `::${type}::${text.replace(/%/g, "%25")}\n`;
    }
    if (provider === "azure") {
        return `##vso[task.logissue type=${type}]${text.replace(/%/g, "%AZP25")}\n`;
    }
    return "";
}

export function supportsAnnotations(provider: CiProvider | undefined): boolean {
    return provider === "github" || provider === "azure";
}

export function markdownText(text: string): string {
    return stripColors(text)
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
        .split(/(`[^`]+`)/)
        .map((part, index) =>
            index % 2 === 1
                ? part.replace(/\|/g, "\\|")
                : part.replace(/[\\`*_[\]<>|]/g, (char) =>
                      char === "<" ? "&lt;" : char === ">" ? "&gt;" : `\\${char}`
                  )
        )
        .join("");
}

export function markdownCode(lines: string[]): string {
    const body = lines.map(stripColors);
    while (body.length > 0 && !body[body.length - 1].trim()) {
        body.pop();
    }
    if (body.length === 0) {
        return "";
    }
    const longest = Math.max(
        0,
        ...(body.join("\n").match(/`+/g) || []).map((run) => run.length)
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    return [`${fence}text`, ...body, fence].join("\n");
}

// Markdown has no text colors, so colored text uses LaTeX math, which GitHub,
// GitLab, and Azure DevOps render. Only plain characters are colored, so text
// from npm can never break out of the math expression.
export function markdownColor(text: string, color: string, bold = false): string {
    if (!/^[A-Za-z0-9 .,:!()+-]+$/.test(text)) {
        return markdownText(text);
    }
    if (!color) {
        return bold ? `**${text}**` : text;
    }
    return `$\\color{${color}}{\\textsf{${text}}}$`;
}

export function statusText(text: string, useColor: boolean): string {
    return `${text} ${colorText("\u2714", colors.green, useColor)}`;
}

export function statusMarkdown(text: string): string {
    return `${markdownText(text)} $\\color{green}{\\checkmark}$`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
