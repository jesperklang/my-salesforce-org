import { isRecord } from "./format.ts";
import { printChanges } from "./npm.ts";
import { log, printStatus, runTask, skipTask } from "./progress.ts";
import { isSfInstalled, readJson, runUpdate } from "./runner.ts";
import type { PluginTasks, RunContext } from "./types.ts";

export async function pluginVersions(
    ctx: RunContext,
    cwd: string
): Promise<Map<string, string>> {
    const plugins = await readJson(
        ctx,
        "sf",
        ["plugins", "--json"],
        cwd,
        "Listing Salesforce CLI plugins"
    );
    if (!Array.isArray(plugins)) {
        throw new Error("Invalid Salesforce CLI plugin list.");
    }
    const versions = new Map<string, string>();
    for (const plugin of plugins) {
        if (
            isRecord(plugin) &&
            typeof plugin.name === "string" &&
            typeof plugin.version === "string"
        ) {
            versions.set(plugin.name, plugin.version);
        }
    }
    return versions;
}

export async function updatePlugins(
    ctx: RunContext,
    cwd: string,
    tasks: PluginTasks
): Promise<void> {
    if (!(await isSfInstalled(ctx, cwd))) {
        skipTask(ctx, tasks.update, "skipped - Salesforce CLI is not installed");
        log(ctx, "Salesforce CLI is not installed, so no plugins were updated.");
        return;
    }
    await runTask(ctx, tasks.update, "checking for updates...", async () => {
        const before = ctx.dryRun
            ? new Map<string, string>()
            : await pluginVersions(ctx, cwd);
        await runUpdate(
            ctx,
            "sf",
            ["plugins", "update"],
            cwd,
            "Salesforce CLI plugin update",
            true
        );
        if (ctx.dryRun) {
            return;
        }
        const after = await pluginVersions(ctx, cwd);
        const rows = [...after]
            .filter(
                ([name, version]) =>
                    before.has(name) && before.get(name) !== version
            )
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, version]): [string, string, string] => [
                name,
                before.get(name) || "",
                version
            ]);
        if (rows.length > 0) {
            printChanges(ctx, "Updated plugins:", rows);
            printStatus(ctx, "Updated!");
        } else {
            printStatus(ctx, "Up to date!");
        }
    });
}
