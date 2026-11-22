import {
    ciAnnotation,
    ciGroup,
    colors,
    colorText,
    errorMessage,
    markdownCode,
    markdownColor,
    markdownText,
    statusMarkdown,
    statusText,
    stripColors
} from "./format.ts";
import {
    TaskFailed,
    type NpmTasks,
    type Phase,
    type PluginTasks,
    type ProgressState,
    type ProgressStep,
    type RunContext
} from "./types.ts";

export class ProgressDisplay {
    private ctx: RunContext;
    private steps: ProgressStep[];
    private remaining: ProgressStep[];
    private onCleanup: (() => void) | undefined;
    private live = false;
    private details = new Map<ProgressStep, string>();
    private errorOutput = new Map<ProgressStep, string>();
    private markdownBlocks = new Map<ProgressStep, { raw: boolean; text: string }[]>();
    private errors: { step: ProgressStep; message: string; output: string }[] = [];
    private activeSteps: ProgressStep[] = [];
    private pendingOutput = "";
    private drawnLines = 0;
    private redrawTimer: ReturnType<typeof setTimeout> | undefined;
    private closed = false;
    endsWithBlankLine = false;

    constructor(ctx: RunContext, steps: ProgressStep[], onCleanup?: () => void) {
        this.ctx = ctx;
        this.steps = steps;
        this.remaining = [...steps];
        this.onCleanup = onCleanup;
    }

    private render(
        step: ProgressStep,
        indent: string,
        details: (step: ProgressStep, indent: string) => string[],
        compact = false
    ): string[] {
        const children = (step.children || []).filter(
            (child) => !compact || !child.task || this.activeSteps.includes(step)
        );
        return [
            this.line(step, indent),
            ...children.flatMap((child) =>
                this.render(child, `${indent}    `, details, compact)
            ),
            ...details(step, `${indent}    `)
        ];
    }

    private rowCount(compact: boolean): number {
        return this.remaining.reduce(
            (total, step) =>
                total + this.render(step, "", () => [], compact).length,
            0
        );
    }

    private status(step: ProgressStep): { marker: string; text: string; color: string } {
        const styles = {
            pending: { marker: "[ ]", text: "waiting", color: "" },
            running: {
                marker: "[>]",
                text: step.phase || "checking for updates...",
                color: colors.blue
            },
            complete: {
                marker: "[x]",
                text: this.ctx.dryRun ? "preview done!" : "done!",
                color: colors.green
            },
            failed: { marker: "[!]", text: "error", color: colors.red },
            skipped: {
                marker: "[-]",
                text: step.note || "skipped",
                color: step.okWhenSkipped ? colors.green : ""
            }
        };
        return styles[step.state];
    }

    private line(step: ProgressStep, indent: string): string {
        const style = this.status(step);
        const text =
            `${indent}${style.marker} ${step.label} - ${style.text}`.replace(
                /[\u0000-\u001f\u007f-\u009f]/g,
                ""
            );
        return colorText(text, style.color, this.ctx.useColor);
    }

    private detailLines(text: string, indent: string): string[] {
        if (!text) {
            return [];
        }
        const safe = text
            .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, (sequence) =>
                /^\u001b\[[\d;]*m$/.test(sequence) ? sequence : ""
            )
            .replace(/\r\n?/g, "\n")
            .replace(/\t/g, "    ")
            .replace(/\u001b(?!\[[\d;]*m)/g, "")
            .replace(/[\u0000-\u0009\u000b-\u001a\u001c-\u001f\u007f-\u009f]/g, "");
        return safe
            .replace(/\n((?:\u001b\[[\d;]*m)*)$/, "$1")
            .split("\n")
            .map((line) => {
                if (!line) {
                    return "";
                }
                const warning = /^(?:\u001b\[[\d;]*m)*!(?:\u001b\[[\d;]*m)* /.test(line);
                return `${warning && indent.length >= 2 ? indent.slice(2) : indent}${line}`;
            });
    }

    private block(step: ProgressStep): string[] {
        return this.render(step, "", (row, indent) =>
            this.detailLines(this.details.get(row) || "", indent)
        );
    }

    private liveLines(): string[] {
        const height = Math.max(1, process.stdout.rows - 1);
        const compact = this.rowCount(false) >= height;
        const budget = Math.max(0, height - this.rowCount(compact));
        const active = this.activeSteps.at(-1);
        const lineCount = (step: ProgressStep) =>
            this.detailLines(this.details.get(step) || "", "").length;
        const activeBudget = active ? Math.min(lineCount(active), budget) : 0;
        let remainingBudget = budget - activeBudget;
        const finished = new Set<ProgressStep>();
        const collect = (step: ProgressStep): void => {
            if (
                step !== active &&
                step.state !== "pending" &&
                step.state !== "running"
            ) {
                const count = lineCount(step);
                if (count > 0 && count <= remainingBudget) {
                    finished.add(step);
                    remainingBudget -= count;
                }
            }
            for (const child of step.children || []) {
                if (!compact || !child.task || this.activeSteps.includes(step)) {
                    collect(child);
                }
            }
        };
        this.remaining.forEach(collect);
        const lines = this.remaining.flatMap((step) =>
            this.render(
                step,
                "",
                (row, indent) => {
                    if (finished.has(row)) {
                        return this.detailLines(this.details.get(row) || "", indent);
                    }
                    if (row !== active || activeBudget === 0) {
                        return [];
                    }
                    const details = this.detailLines(
                        this.details.get(row) || "",
                        indent
                    );
                    return details.length <= activeBudget
                        ? details
                        : [
                              `${indent}...`,
                              ...(activeBudget > 1
                                  ? details.slice(-(activeBudget - 1))
                                  : [])
                          ].slice(-activeBudget);
                },
                compact
            )
        );
        return lines.slice(0, height);
    }

    private clip(line: string): string {
        const width = Math.max(1, process.stdout.columns - 1);
        let columns = 0;
        let result = "";
        for (const token of line.match(/\u001b\[[\d;]*m|[^\u001b]/gu) || []) {
            if (!token.startsWith("\u001b") && ++columns > width) {
                break;
            }
            result += token;
        }
        return result + colors.reset;
    }

    private canRenderLive(): boolean {
        return Boolean(
            process.stdout.isTTY &&
            process.env.TERM !== "dumb" &&
            process.stdout.columns >= 40 &&
            process.stdout.rows >= this.rowCount(true) + 3
        );
    }

    private emit(text: string): void {
        if (text) {
            this.endsWithBlankLine = /\n\s*\n$/.test(
                text.replace(/\u001b\[[\d;]*m/g, "")
            );
        }
        if (this.live) {
            this.pendingOutput += text;
        } else {
            process.stdout.write(text);
        }
    }

    start(): void {
        this.live = this.canRenderLive();
        if (this.live) {
            process.stdout.write("\u001b[?25l");
            this.draw();
            process.stdout.on("resize", this.onResize);
        } else if (process.stdout.isTTY) {
            process.stdout.write(
                this.steps
                    .flatMap((step) => this.render(step, "", () => []))
                    .join("\n") + "\n\n"
            );
        }
        process.once("exit", this.onExit);
        process.once("SIGINT", this.onInterrupt);
        process.once("SIGTERM", this.onTerminate);
    }

    private draw(): void {
        if (this.redrawTimer) {
            clearTimeout(this.redrawTimer);
            this.redrawTimer = undefined;
        }
        if (!this.live) {
            return;
        }
        const lines = this.liveLines().map((line) => this.clip(line));
        process.stdout.write(
            (this.drawnLines > 0 ? `\u001b[${this.drawnLines}F` : "\r") +
                "\u001b[0J" +
                this.pendingOutput +
                "\u001b[?7l" +
                lines.map((line) => `${line}\r\n`).join("") +
                "\u001b[?7h"
        );
        this.pendingOutput = "";
        this.drawnLines = lines.length;
    }

    private scheduleDraw(): void {
        if (this.live && !this.redrawTimer) {
            this.redrawTimer = setTimeout(() => this.draw(), 50);
        }
    }

    private emitBlock(step: ProgressStep): void {
        const [title, ...body] = this.block(step);
        this.emit(
            this.ctx.ciProvider && !this.live
                ? ciGroup(this.ctx, stripColors(title), body)
                : [title, ...body].join("\n") + "\n"
        );
    }

    private complete(step: ProgressStep): void {
        this.remaining = this.remaining.filter((entry) => entry !== step);
        this.emitBlock(step);
        this.draw();
    }

    write(text: string, error = false, markdown?: string): void {
        const step = this.activeSteps.at(-1);
        const detail = error
            ? text
                  .split("\n")
                  .map((part) => (part ? colorText(part, colors.red, this.ctx.useColor) : part))
                  .join("\n")
            : text;
        if (!step) {
            this.emit(detail);
            this.scheduleDraw();
            return;
        }
        this.details.set(step, (this.details.get(step) || "") + detail);
        this.addMarkdown(step, text, markdown);
        if (error) {
            this.errorOutput.set(
                step,
                (this.errorOutput.get(step) || "") + text
            );
        }
        this.scheduleDraw();
    }

    private addMarkdown(step: ProgressStep, text: string, markdown: string | undefined): void {
        const blocks = this.markdownBlocks.get(step) || [];
        const last = blocks.at(-1);
        if (markdown !== undefined) {
            blocks.push({ raw: false, text: markdown });
        } else if (last?.raw) {
            last.text += text;
        } else {
            blocks.push({ raw: true, text });
        }
        this.markdownBlocks.set(step, blocks);
    }

    setPhase(phase: Phase): void {
        const previews: Partial<Record<Phase, string>> = {
            "updating...": "previewing updates...",
            "fixing vulnerabilities...": "previewing fixes..."
        };
        const label = (this.ctx.dryRun && previews[phase]) || phase;
        let changed = false;
        for (const step of this.activeSteps) {
            if (step.phase !== label) {
                step.phase = label;
                changed = true;
            }
        }
        if (changed) {
            this.draw();
        }
    }

    async runStep(
        step: ProgressStep,
        operation: () => Promise<boolean | void>
    ): Promise<boolean> {
        step.state = "running";
        this.activeSteps.push(step);
        this.setPhase("checking for updates...");
        this.draw();
        const previousErrors = this.errors.length;
        let succeeded = false;
        try {
            succeeded = (await operation()) !== false;
        } catch (error) {
            if (!(error instanceof TaskFailed)) {
                this.recordError(step, errorMessage(error));
            }
        }
        if (!succeeded && this.errors.length === previousErrors) {
            this.recordError(
                step,
                "One or more operations did not complete successfully."
            );
        }
        this.activeSteps.pop();
        this.skipPending(step);
        step.state = succeeded ? "complete" : "failed";
        if (!succeeded) {
            process.exitCode = 1;
        }
        if (this.remaining.includes(step)) {
            this.complete(step);
        } else {
            this.draw();
        }
        return succeeded;
    }

    async runTask<T>(
        task: ProgressStep,
        phase: Phase,
        operation: () => Promise<T>
    ): Promise<T> {
        task.state = "running";
        this.activeSteps.push(task);
        this.setPhase(phase);
        this.draw();
        try {
            const value = await operation();
            task.state = "complete";
            return value;
        } catch (error) {
            task.state = "failed";
            this.recordError(task, errorMessage(error));
            throw new TaskFailed();
        } finally {
            this.activeSteps.pop();
            this.draw();
        }
    }

    skip(task: ProgressStep, note: string, ok = false): void {
        task.state = "skipped";
        task.note = note;
        task.okWhenSkipped = ok;
        this.draw();
    }

    writeTo(step: ProgressStep, text: string, markdown?: string): void {
        this.details.set(step, (this.details.get(step) || "") + text);
        this.addMarkdown(step, text, markdown);
        this.scheduleDraw();
    }

    private skipPending(step: ProgressStep): void {
        for (const child of step.children || []) {
            if (child.state === "pending") {
                child.state = "skipped";
            }
            this.skipPending(child);
        }
    }

    private pathTo(
        step: ProgressStep,
        steps = this.steps,
        trail: string[] = []
    ): string[] | undefined {
        for (const entry of steps) {
            const next = [...trail, entry.label];
            if (entry === step) {
                return next;
            }
            const found = this.pathTo(step, entry.children || [], next);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    private recordError(step: ProgressStep, message: string): void {
        this.errors.push({
            step,
            message,
            output: this.errorOutput.get(step) || ""
        });
        this.write(
            `${step.label}: ${message}\n`,
            true,
            `❌ ${markdownColor(`${step.label}: ${message}`, "red")}`
        );
    }

    markdown(): string[] {
        const icons: Record<ProgressState, string> = {
            pending: "⬜",
            running: "⏳",
            complete: "✅",
            failed: "❌",
            skipped: "⏭️"
        };
        const lines: string[] = [];
        const add = (step: ProgressStep, depth: number): void => {
            const title = `${icons[step.state]} ${markdownText(
                `${step.label} - ${this.status(step).text}`
            )}`;
            lines.push(
                "",
                step.task
                    ? `**${title}**`
                    : `${"#".repeat(Math.min(6, depth + 3))} ${title}`
            );
            for (const child of step.children || []) {
                add(child, depth + 1);
            }
            for (const block of this.markdownBlocks.get(step) || []) {
                const text = block.raw
                    ? markdownCode(this.detailLines(block.text, ""))
                    : block.text;
                if (text) {
                    lines.push("", text);
                }
            }
        };
        this.steps.forEach((step) => add(step, 0));
        if (this.errors.length > 0) {
            lines.push("", "### Errors");
            for (const { step, message, output } of this.errors) {
                const label = (this.pathTo(step) || [step.label]).join(" > ");
                lines.push(
                    "",
                    `**${markdownText(label)}**: ${markdownColor(message, "red")}`
                );
                const code = markdownCode(this.detailLines(output, ""));
                if (code) {
                    lines.push("", code);
                }
            }
        }
        return lines;
    }

    private printErrors(): void {
        if (this.errors.length === 0) {
            return;
        }
        const lines = ["", "Errors:"];
        for (const { step, message, output } of this.errors) {
            const label = (this.pathTo(step) || [step.label]).join(" > ");
            lines.push(...this.detailLines(`${label}: ${message}\n`, "- "));
            lines.push(...this.detailLines(output, "    "));
            process.stdout.write(
                ciAnnotation(this.ctx.ciProvider, "error", `${label}: ${message}`)
            );
        }
        process.stderr.write(
            colorText(lines.join("\n") + "\n", colors.red, this.ctx.useColor)
        );
        this.endsWithBlankLine = false;
    }

    private onResize = (): void => {
        if (this.canRenderLive()) {
            this.draw();
            return;
        }
        process.stdout.write(
            (this.drawnLines > 0 ? `\u001b[${this.drawnLines}F` : "\r") +
                "\u001b[0J" +
                this.pendingOutput +
                "\u001b[?25h"
        );
        this.pendingOutput = "";
        this.drawnLines = 0;
        this.live = false;
        process.stdout.off("resize", this.onResize);
    };

    private onExit = (): void => {
        this.onCleanup?.();
        this.finish();
    };

    private interrupt(code: number): void {
        this.onCleanup?.();
        for (const step of this.activeSteps) {
            this.errors.push({
                step,
                message: "Interrupted before completion.",
                output: this.errorOutput.get(step) || ""
            });
            step.state = "failed";
        }
        this.activeSteps = [];
        this.finish();
        process.exit(code);
    }

    private onInterrupt = (): void => {
        this.interrupt(130);
    };

    private onTerminate = (): void => {
        this.interrupt(143);
    };

    finish(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const step of this.remaining) {
            this.emitBlock(step);
        }
        this.remaining = [];
        if (this.live) {
            this.draw();
            process.stdout.write("\u001b[?25h");
            this.live = false;
        }
        this.printErrors();
        process.stdout.off("resize", this.onResize);
        process.off("exit", this.onExit);
        process.off("SIGINT", this.onInterrupt);
        process.off("SIGTERM", this.onTerminate);
    }
}

export function writeOutput(ctx: RunContext, text: string, error = false): void {
    if (ctx.progressDisplay) {
        ctx.progressDisplay.write(text, error);
    } else {
        (error ? process.stderr : process.stdout).write(text);
    }
}

export function log(
    ctx: RunContext,
    message = "",
    markdown = markdownText(message)
): void {
    if (ctx.progressDisplay) {
        ctx.progressDisplay.write(`${message}\n`, false, markdown);
    } else {
        process.stdout.write(`${message}\n`);
    }
}

export function printStatus(ctx: RunContext, text: string): void {
    log(ctx, statusText(text, ctx.useColor), statusMarkdown(text));
}

export async function runTask<T>(
    ctx: RunContext,
    task: ProgressStep | undefined,
    phase: Phase,
    operation: () => Promise<T>
): Promise<T> {
    return ctx.progressDisplay && task
        ? ctx.progressDisplay.runTask(task, phase, operation)
        : operation();
}

export function skipTask(
    ctx: RunContext,
    task: ProgressStep | undefined,
    note: string,
    ok = false
): void {
    if (task) {
        ctx.progressDisplay?.skip(task, note, ok);
    }
}

export function logTo(
    ctx: RunContext,
    task: ProgressStep | undefined,
    message: string,
    markdown = markdownText(message)
): void {
    if (ctx.progressDisplay && task) {
        ctx.progressDisplay.writeTo(task, `${message}\n`, markdown);
    } else {
        log(ctx, message, markdown);
    }
}

export function createTask(label: string): ProgressStep {
    return { label, state: "pending", task: true };
}

export function npmTasks(global: boolean, dryRun: boolean): NpmTasks {
    return {
        outdated: createTask("Check for outdated packages"),
        dependencies: global || !dryRun ? undefined : createTask("Check dependencies"),
        update: createTask("Update packages"),
        audit: createTask("Check for vulnerabilities"),
        fix: global ? undefined : createTask("Attempt fixing vulnerabilities")
    };
}

export function taskList(tasks: NpmTasks | PluginTasks): ProgressStep[] {
    return Object.values(tasks).filter((task): task is ProgressStep =>
        Boolean(task)
    );
}
