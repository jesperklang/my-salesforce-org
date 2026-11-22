import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { advisoryLines, advisoryMarkdown } from "./lib/audit.ts";
import {
    ciAnnotation,
    colors,
    colorText,
    errorMessage,
    markdownColor,
    markdownText,
    supportsAnnotations
} from "./lib/format.ts";
import {
    findBundleDirectories,
    readPackageFileHashes,
    updateNpmPackages,
    writeOutputs
} from "./lib/npm.ts";
import {
    createTask,
    log,
    npmTasks,
    ProgressDisplay,
    taskList,
    writeOutput
} from "./lib/progress.ts";
import { assertSafeArgs, cleanupResources } from "./lib/runner.ts";
import { updatePlugins } from "./lib/sf.ts";
import {
    createRunContext,
    detectCiProvider,
    type PluginTasks,
    type ProgressStep
} from "./lib/types.ts";

export type CliOptions = {
    help: boolean;
    dryRun: boolean;
    ciMode: boolean;
    outputDir: string | undefined;
    allowScripts: string | undefined;
};

export const usageText = `Usage: node scripts/updateAll/updateAll.ts [options]

Updates global npm packages, repo npm packages, Multi-Framework Components
(uiBundles), and Salesforce CLI plugins, and checks for vulnerabilities.

Options:
  --dry-run                    Run checks and preview updates without modifying files
  --ci                         Skip global npm packages and Salesforce CLI plugins
  --output-dir=<folder>        Write summary.md and outputs.env to <folder>
  --allow-scripts=<packages>   Pass --allow-scripts=<packages> to global npm update
                               (or set UPDATEALL_ALLOW_SCRIPTS)
  -h, --help                   Show this help message and exit
`;

export function parseArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env
): CliOptions {
    let help = false;
    let dryRun = env.npm_config_dry_run === "true";
    let ciMode = false;
    let outputDir: string | undefined;
    let allowScripts: string | undefined;
    const unknown: string[] = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "-h" || arg === "--help") {
            help = true;
            continue;
        }
        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (arg === "--ci") {
            ciMode = true;
            continue;
        }
        if (arg === "--output-dir" || arg.startsWith("--output-dir=")) {
            const value = arg.includes("=")
                ? arg.slice(arg.indexOf("=") + 1)
                : args[++index];
            if (!value || value.startsWith("--")) {
                throw new Error(
                    "--output-dir needs a folder path, for example --output-dir=updateAll-output."
                );
            }
            outputDir = path.resolve(value);
            continue;
        }
        if (arg === "--allow-scripts" || arg.startsWith("--allow-scripts=")) {
            const value = arg.includes("=")
                ? arg.slice(arg.indexOf("=") + 1)
                : args[++index];
            if (!value || value.startsWith("--")) {
                throw new Error(
                    "--allow-scripts needs a comma-separated package list, for example --allow-scripts=@salesforce/cli,esbuild."
                );
            }
            assertSafeArgs([`--allow-scripts=${value}`]);
            allowScripts = value;
            continue;
        }
        unknown.push(arg);
    }

    if (unknown.length > 0) {
        throw new Error(
            `Unknown option: ${unknown.join(" ")}. Supported options are --dry-run, --ci, --output-dir, --allow-scripts, and --help (see README.md).`
        );
    }

    if (!allowScripts && env.UPDATEALL_ALLOW_SCRIPTS?.trim()) {
        const envValue = env.UPDATEALL_ALLOW_SCRIPTS.trim();
        assertSafeArgs([`--allow-scripts=${envValue}`]);
        allowScripts = envValue;
    }

    return { help, dryRun, ciMode, outputDir, allowScripts };
}

function relaunchThroughWinpty(): boolean {
    if (
        process.platform !== "win32" ||
        process.stdout.isTTY ||
        !process.env.MSYSTEM ||
        process.env.UPDATEALL_WINPTY ||
        process.env.CI ||
        detectCiProvider()
    ) {
        return false;
    }
    const winpty = (process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, "winpty.exe"))
        .find((file) => fs.existsSync(file));
    if (!winpty) {
        return false;
    }
    const env = { ...process.env, UPDATEALL_WINPTY: "1" };
    const probe = childProcess.spawnSync(
        winpty,
        [process.execPath, "-e", "process.exit(process.stdout.isTTY ? 0 : 3)"],
        { stdio: ["inherit", "inherit", "ignore"], env }
    );
    if (probe.status !== 0) {
        return false;
    }
    const result = childProcess.spawnSync(
        winpty,
        [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
        { stdio: "inherit", env }
    );
    process.exitCode = result.status ?? 1;
    return true;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(usageText);
        return;
    }

    const ctx = createRunContext({
        dryRun: options.dryRun,
        ciMode: options.ciMode,
        allowScripts: options.allowScripts
    });

    const git = childProcess.spawnSync(
        "git",
        [
            "-C",
            path.dirname(fileURLToPath(import.meta.url)),
            "rev-parse",
            "--show-toplevel"
        ],
        { encoding: "utf8" }
    );
    if (git.error) {
        throw git.error;
    }
    if (git.status !== 0 || !git.stdout.trim()) {
        throw new Error(
            git.stderr.trim() ||
                "The script must be located inside the intended Git project."
        );
    }
    const projectRoot = path.resolve(git.stdout.trim());
    let directories: string[] = [];
    let discoveryError: { message: string } | undefined;
    try {
        directories = findBundleDirectories(projectRoot);
    } catch (error) {
        discoveryError = { message: errorMessage(error) };
    }

    const globalTasks = npmTasks(true, ctx.dryRun);
    const pluginTasks: PluginTasks = {
        update: createTask("Check and update plugins")
    };
    const projectTasks = npmTasks(false, ctx.dryRun);
    const bundleTasks = directories.map(() => npmTasks(false, ctx.dryRun));
    const globalStep: ProgressStep = {
        label: "Global npm packages",
        state: "pending",
        children: taskList(globalTasks)
    };
    const pluginStep: ProgressStep = {
        label: "Salesforce CLI plugins",
        state: "pending",
        children: taskList(pluginTasks)
    };
    const projectStep: ProgressStep = {
        label: "Repo npm packages",
        state: "pending",
        children: taskList(projectTasks)
    };
    const bundleSteps: ProgressStep[] = directories.map((directory, index) => ({
        label: path.basename(directory),
        state: "pending",
        children: taskList(bundleTasks[index])
    }));
    const bundlesStep: ProgressStep = {
        label: "Multi-Framework Components",
        state: "pending",
        children: bundleSteps
    };
    const showBundles = Boolean(discoveryError) || directories.length > 0;
    const display = new ProgressDisplay(
        ctx,
        [
            ...(ctx.ciMode ? [] : [globalStep]),
            projectStep,
            ...(showBundles ? [bundlesStep] : []),
            ...(ctx.ciMode ? [] : [pluginStep])
        ],
        cleanupResources
    );
    ctx.progressDisplay = display;
    const packageFilesBefore = readPackageFileHashes([projectRoot, ...directories]);
    display.start();
    try {
        if (ctx.dryRun) {
            log(ctx, "Dry run. Checks run normally, but no updates will be made.");
        }
        if (!ctx.ciMode) {
            await display.runStep(globalStep, () =>
                updateNpmPackages(ctx, projectRoot, globalTasks, globalStep.label, true)
            );
        }
        await display.runStep(projectStep, async () => {
            if (
                !fs
                    .statSync(path.join(projectRoot, "package.json"), {
                        throwIfNoEntry: false
                    })
                    ?.isFile()
            ) {
                throw new Error("No package.json in the Git project root.");
            }
            await updateNpmPackages(ctx, projectRoot, projectTasks, projectStep.label);
        });
        if (showBundles) {
            await display.runStep(bundlesStep, async () => {
                if (discoveryError) {
                    throw new Error(
                        `Could not discover Multi-Framework Components: ${discoveryError.message}`
                    );
                }
                let succeeded = true;
                for (const [index, directory] of directories.entries()) {
                    const passed = await display.runStep(bundleSteps[index], () =>
                        updateNpmPackages(
                            ctx,
                            directory,
                            bundleTasks[index],
                            `${bundlesStep.label} > ${bundleSteps[index].label}`
                        )
                    );
                    succeeded = passed && succeeded;
                }
                return succeeded;
            });
        }
        if (!ctx.ciMode) {
            await display.runStep(pluginStep, () =>
                updatePlugins(ctx, projectRoot, pluginTasks)
            );
        }
    } finally {
        display.finish();
        const packageFilesAfter = readPackageFileHashes([projectRoot, ...directories]);
        ctx.progressDisplay = undefined;
        const noteText = (text: string): string =>
            text
                .split("`npm audit`")
                .join(colorText("npm audit", colors.blue, ctx.useColor));
        const warnings: string[] = [];
        if (ctx.unresolvedVulnerabilities) {
            warnings.push(
                " Some vulnerabilities could not be fixed automatically. Run `npm audit` in the\n" +
                    "  repo or Multi-Framework Component folder for details and how to fix them."
            );
        }
        if (ctx.globalVulnerabilities) {
            warnings.push(
                " Global packages have vulnerabilities that npm cannot fix. `npm audit` does not\n" +
                    "  support global packages; update the affected global packages when fixes are released."
            );
        }
        for (const warning of warnings) {
            process.stdout.write(
                ciAnnotation(ctx.ciProvider, "warning", warning.replace(/`/g, ""))
            );
        }
        const notes = supportsAnnotations(ctx.ciProvider)
            ? []
            : warnings.map(
                  (warning) =>
                      colorText("!", colors.red, ctx.useColor) + noteText(warning)
              );
        if (ctx.newerOutsideRange) {
            notes.push(
                colorText("*", colors.blue, ctx.useColor) +
                    " Newer than your version range allows, so npm update skips it.\n" +
                    "  See https://docs.npmjs.com/cli/commands/npm-update"
            );
        }
        const links = advisoryLines(ctx);
        const output = [
            ...notes,
            ...(notes.length > 0 && links.length > 0 ? [""] : []),
            ...links
        ];
        if (output.length > 0) {
            process.stdout.write(
                (display.endsWithBlankLine ? "" : "\n") + output.join("\n") + "\n"
            );
        }
        process.stdout.write("\n");
        const markdownNotes = [
            ...warnings.map(
                (warning) =>
                    `- ${markdownColor("!", "red")} ${markdownText(warning.replace(/\s+/g, " ").trim())}`
            ),
            ...(ctx.newerOutsideRange
                ? [
                      "- \\* Newer than your version range allows, so npm update skips it. " +
                          "See [npm update](https://docs.npmjs.com/cli/commands/npm-update)."
                  ]
                : [])
        ];
        const summary = [
            ...(ctx.dryRun
                ? ["> Dry run. Checks run normally, but no updates were made."]
                : []),
            ...display.markdown(),
            ...(markdownNotes.length > 0
                ? ["", "### Notes", "", ...markdownNotes]
                : []),
            ...advisoryMarkdown(ctx)
        ]
            .join("\n")
            .replace(/^\n+/, "");
        writeOutputs(
            {
                "packages-changed": [...packageFilesBefore].some(
                    ([file, hash]) => packageFilesAfter.get(file) !== hash
                ),
                "worst-severity-found": ctx.worstFound,
                "worst-severity-unresolved": ctx.worstUnresolved
            },
            summary,
            options.outputDir
        );
    }
}

function isMainModule(): boolean {
    if (!process.argv[1]) {
        return false;
    }
    try {
        return (
            fs.realpathSync(process.argv[1]).toLowerCase() ===
            fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase()
        );
    } catch {
        return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
    }
}

if (isMainModule() && !relaunchThroughWinpty()) {
    main().catch((error: unknown) => {
        const ctx = createRunContext();
        writeOutput(
            ctx,
            colorText(
                `\n[!] Script - error\n\nErrors:\n- Script: ${errorMessage(error)}\n`,
                colors.red,
                ctx.useColor
            ),
            true
        );
        process.stdout.write(
            ciAnnotation(ctx.ciProvider, "error", `Script: ${errorMessage(error)}`)
        );
        process.exitCode = 1;
    });
}
