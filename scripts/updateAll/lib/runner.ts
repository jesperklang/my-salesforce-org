import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isRecord } from "./format.ts";
import { log, writeOutput } from "./progress.ts";
import type { CommandResult, RunContext } from "./types.ts";

const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 4 * 1024 * 1024;
const activeChildren = new Set<childProcess.ChildProcess>();
const activeTempDirs = new Set<string>();

export function cleanupResources(): void {
    for (const child of activeChildren) {
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
    }
    activeChildren.clear();
    for (const dir of activeTempDirs) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup on exit/interrupt.
        }
    }
    activeTempDirs.clear();
}

export async function withTempDir<T>(operation: (temp: string) => Promise<T>): Promise<T> {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "updateAll-"));
    activeTempDirs.add(temp);
    try {
        return await operation(temp);
    } finally {
        activeTempDirs.delete(temp);
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

export async function withProjectCopy<T>(
    cwd: string,
    operation: (temp: string) => Promise<T>
): Promise<T> {
    return withTempDir(async (temp) => {
        for (const file of ["package.json", "package-lock.json", ".npmrc"]) {
            const source = path.join(cwd, file);
            if (fs.existsSync(source)) {
                fs.copyFileSync(source, path.join(temp, file));
            }
        }
        return await operation(temp);
    });
}

export function assertSafeArgs(args: string[]): void {
    if (args.some((arg) => !/^[a-zA-Z0-9@/.,=_-]+$/.test(arg))) {
        throw new Error("Unsupported characters in command arguments.");
    }
}

export async function resolveSfEntryPoint(
    ctx: RunContext,
    cwd: string
): Promise<string | undefined> {
    if (!ctx.sfEntryPoint) {
        ctx.sfEntryPoint = findSfEntryPoint(ctx, cwd).catch((error) => {
            ctx.sfEntryPoint = undefined;
            throw error;
        });
    }
    return ctx.sfEntryPoint;
}

async function findSfEntryPoint(
    ctx: RunContext,
    cwd: string
): Promise<string | undefined> {
    const rootResult = await run(
        ctx,
        "npm",
        ["root", "--global", "--loglevel=error"],
        cwd,
        true
    );
    requireSuccess(rootResult, "Locating the global Salesforce CLI");
    const installedRoot = rootResult.stdout.trim();
    if (!installedRoot) {
        throw new Error("npm root returned an empty path.");
    }
    const cliDirectory = path.join(installedRoot, "@salesforce", "cli");
    const manifestPath = path.join(cliDirectory, "package.json");
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (
        !isRecord(manifest) ||
        !isRecord(manifest.bin) ||
        typeof manifest.bin.sf !== "string"
    ) {
        throw new Error("The installed Salesforce CLI has no sf entry point.");
    }
    return path.resolve(cliDirectory, manifest.bin.sf);
}

export async function isSfInstalled(ctx: RunContext, cwd: string): Promise<boolean> {
    if (await resolveSfEntryPoint(ctx, cwd)) {
        return true;
    }
    try {
        return (await run(ctx, "sf", ["--version"], cwd, true, true, true)).status === 0;
    } catch {
        return false;
    }
}

export async function run(
    ctx: RunContext,
    command: "npm" | "sf",
    args: string[],
    cwd: string,
    capture = false,
    quiet = false,
    silent = false
): Promise<CommandResult> {
    assertSafeArgs(args);

    const windows = process.platform === "win32";
    let executable = windows ? process.env.ComSpec || "cmd.exe" : command;
    let commandArgs = windows
        ? ["/d", "/s", "/c", `${command} ${args.join(" ")}`]
        : args;
    if (command === "sf") {
        const entryPoint = await resolveSfEntryPoint(ctx, cwd);
        if (entryPoint) {
            executable = process.execPath;
            commandArgs = [entryPoint, ...args];
        }
    }
    return new Promise((resolve, reject) => {
        const child = childProcess.spawn(executable, commandArgs, {
            cwd,
            env: ctx.childEnv,
            stdio: [capture ? "ignore" : "inherit", "pipe", "pipe"]
        });
        activeChildren.add(child);
        let stdout = "";
        let stderr = "";
        let bytes = 0;
        let stderrBytes = 0;
        let stderrTruncated = false;
        let overflow = false;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            if (capture) {
                bytes += Buffer.byteLength(chunk);
                if (bytes > MAX_STDOUT_BYTES) {
                    if (!overflow) {
                        overflow = true;
                        child.kill();
                        reject(new Error(`${command} output exceeded 64 MiB.`));
                    }
                    return;
                }
                stdout += chunk;
            } else {
                writeOutput(ctx, chunk);
            }
        });
        child.stderr.on("data", (chunk: string) => {
            if (quiet || silent) {
                if (!stderrTruncated) {
                    const chunkBytes = Buffer.byteLength(chunk);
                    if (stderrBytes + chunkBytes > MAX_STDERR_BYTES) {
                        stderrTruncated = true;
                        stderr += "\n... (stderr truncated)\n";
                    } else {
                        stderrBytes += chunkBytes;
                        stderr += chunk;
                    }
                }
            } else {
                writeOutput(ctx, chunk, true);
            }
        });
        child.on("error", (error) => {
            activeChildren.delete(child);
            reject(error);
        });
        child.on("close", (status, signal) => {
            activeChildren.delete(child);
            if (quiet && !silent && status !== 0 && stderr) {
                writeOutput(ctx, stderr, true);
            }
            if (signal || status === null) {
                reject(
                    new Error(
                        `${command} was interrupted${signal ? ` by ${signal}` : ""}.`
                    )
                );
            } else {
                resolve({ status, stdout });
            }
        });
    });
}

export function requireSuccess(
    result: { status: number; stdout: string },
    description: string
): void {
    if (result.status !== 0) {
        throw new Error(`${description} failed (exit ${result.status}).`);
    }
}

export async function runUpdate(
    ctx: RunContext,
    command: "npm" | "sf",
    args: string[],
    cwd: string,
    description: string,
    quiet = false,
    capture = quiet
): Promise<string> {
    if (ctx.dryRun) {
        assertSafeArgs(args);
        log(
            ctx,
            `Would run: ${command} ${args.join(" ")}`,
            `Would run: \`${command} ${args.join(" ")}\``
        );
        return "";
    }
    const result = await run(ctx, command, args, cwd, capture, quiet);
    requireSuccess(result, description);
    return result.stdout;
}

export async function readJson(
    ctx: RunContext,
    command: "npm" | "sf",
    args: string[],
    cwd: string,
    description: string
): Promise<unknown> {
    const result = await run(ctx, command, args, cwd, true);
    requireSuccess(result, description);
    return JSON.parse(result.stdout);
}
