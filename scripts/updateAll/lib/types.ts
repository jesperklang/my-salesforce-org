import type { ProgressDisplay } from "./progress.ts";

export type PackageRow = [string, string, string, string];
export type CheckResult = { actionable: boolean; rows: PackageRow[] };
export type CommandResult = { status: number; stdout: string };
export type Advisory = { name: string; title: string; severity: string; url: string };
export type AuditReport = {
    counts: Record<string, unknown>;
    severities: Map<string, string>;
    effects: Map<string, string[]>;
    direct: Set<string>;
    advisories: Map<string, Advisory>;
    nodes?: Map<string, string[]>;
    globalOwners?: boolean;
    owners?: Map<string, Set<string>>;
};
export type LockCheck = {
    updated: string[];
    added: number;
    removed: number;
    before: AuditReport;
    after: AuditReport;
    predictedFix?: AuditReport;
};
export type ProgressState = "pending" | "running" | "complete" | "failed" | "skipped";
export type ProgressStep = {
    label: string;
    state: ProgressState;
    phase?: string;
    note?: string;
    okWhenSkipped?: boolean;
    task?: boolean;
    children?: ProgressStep[];
};
export type Phase =
    | "checking for updates..."
    | "checking dependencies..."
    | "updating..."
    | "checking for vulnerabilities..."
    | "fixing vulnerabilities...";
export type NpmTasks = {
    outdated: ProgressStep;
    dependencies?: ProgressStep;
    update: ProgressStep;
    audit?: ProgressStep;
    fix?: ProgressStep;
};
export type PluginTasks = { update: ProgressStep };
export type CiProvider = "github" | "azure" | "gitlab";
export type Outputs = Record<string, string | number | boolean>;

export class TaskFailed extends Error {}

export type RunContext = {
    dryRun: boolean;
    ciMode: boolean;
    ciProvider: CiProvider | undefined;
    useColor: boolean;
    allowScripts: string | undefined;
    childEnv: NodeJS.ProcessEnv;
    ciSections: number;
    progressDisplay: ProgressDisplay | undefined;
    sfEntryPoint: Promise<string | undefined> | undefined;
    newerOutsideRange: boolean;
    unresolvedVulnerabilities: boolean;
    globalVulnerabilities: boolean;
    worstFound: number;
    worstUnresolved: number;
    advisoryGroups: Map<string, Map<string, Advisory>>;
};

export function detectCiProvider(env: NodeJS.ProcessEnv = process.env): CiProvider | undefined {
    if (env.GITHUB_ACTIONS === "true") {
        return "github";
    }
    if (env.TF_BUILD?.toLowerCase() === "true") {
        return "azure";
    }
    if (env.GITLAB_CI === "true") {
        return "gitlab";
    }
    return undefined;
}

export function createRunContext(options: {
    dryRun?: boolean;
    ciMode?: boolean;
    allowScripts?: string;
    env?: NodeJS.ProcessEnv;
    isTTY?: boolean;
} = {}): RunContext {
    const env = options.env ?? process.env;
    const ciProvider = detectCiProvider(env);
    const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
    const useColor =
        !env.NO_COLOR &&
        ((Boolean(env.FORCE_COLOR) && env.FORCE_COLOR !== "0") ||
            isTTY ||
            Boolean(ciProvider));
    const childEnv: NodeJS.ProcessEnv = {
        ...env,
        NoDefaultCurrentDirectoryInExePath: "1"
    };
    delete childEnv.npm_config_dry_run;
    const allowScripts =
        options.allowScripts ??
        (env.UPDATEALL_ALLOW_SCRIPTS?.trim() || undefined);
    return {
        dryRun: Boolean(options.dryRun),
        ciMode: Boolean(options.ciMode),
        ciProvider,
        useColor,
        allowScripts,
        childEnv,
        ciSections: 0,
        progressDisplay: undefined,
        sfEntryPoint: undefined,
        newerOutsideRange: false,
        unresolvedVulnerabilities: false,
        globalVulnerabilities: false,
        worstFound: 0,
        worstUnresolved: 0,
        advisoryGroups: new Map()
    };
}
