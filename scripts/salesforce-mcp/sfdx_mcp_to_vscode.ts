import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type SyncConfig = {
  sendTelemetry?: boolean;
  useNoneGATools?: boolean;
  ignoreToolsets?: string[];
  ignoreTools?: string[];
};

type McpServerConfig = {
  command?: string;
  args: string[];
};

type McpServerCollection = Record<string, Partial<McpServerConfig>>;

type EditorMcpConfig = {
  servers?: McpServerCollection;
  mcpServers?: McpServerCollection;
};

type Editor = "vscode" | "cursor";

type EditorConfig = {
  label: string;
  serverProperty: "servers" | "mcpServers";
  configPath: string;
};

type McpTool = {
  getName(): string;
  getToolsets(): string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageLockJson = {
  packages?: {
    ""?: PackageJson;
    "node_modules/@salesforce/mcp"?: {
      version?: string;
    };
  };
};

type SalesforceMcpPackageState = {
  dependencyRange?: string;
  lockedVersion?: string;
  packageJsonContent: string;
  packageLockContent?: string;
  packageLock?: PackageLockJson;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
}

function stripJsonTrailingCommas(content: string): string {
  return content.replace(/,\s*([}\]])/g, "$1");
}

function readJsonConfigFile<T>(filePath: string, defaultValue: T): T {
  const content = stripJsonTrailingCommas(
    stripJsonComments(fs.readFileSync(filePath, "utf8")),
  );

  return content ? (JSON.parse(content) as T) : defaultValue;
}

function readSalesforceMcpPackageState(): SalesforceMcpPackageState {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageLockPath = path.join(process.cwd(), "package-lock.json");
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageLockContent = fs.existsSync(packageLockPath)
    ? fs.readFileSync(packageLockPath, "utf8")
    : undefined;
  const packageJson = JSON.parse(packageJsonContent) as PackageJson;
  const packageLock = packageLockContent
    ? (JSON.parse(packageLockContent) as PackageLockJson)
    : undefined;
  const dependencyRange =
    packageJson.dependencies?.["@salesforce/mcp"] ??
    packageJson.devDependencies?.["@salesforce/mcp"];

  return {
    dependencyRange,
    lockedVersion:
      packageLock?.packages?.["node_modules/@salesforce/mcp"]?.version,
    packageJsonContent,
    packageLockContent,
    packageLock,
  };
}

function hasSalesforceMcpPackageUpdated(
  previousState: SalesforceMcpPackageState,
  nextState: SalesforceMcpPackageState,
): boolean {
  return (
    previousState.dependencyRange !== nextState.dependencyRange ||
    previousState.lockedVersion !== nextState.lockedVersion ||
    previousState.packageJsonContent !== nextState.packageJsonContent ||
    previousState.packageLockContent !== nextState.packageLockContent
  );
}

function hasSalesforceMcpVersionChanged(
  previousState: SalesforceMcpPackageState,
  nextState: SalesforceMcpPackageState,
): boolean {
  return (
    previousState.dependencyRange !== nextState.dependencyRange ||
    previousState.lockedVersion !== nextState.lockedVersion
  );
}

function formatSalesforceMcpPackageState(
  state: SalesforceMcpPackageState,
): string {
  return [state.dependencyRange, state.lockedVersion]
    .filter(Boolean)
    .join(" / ");
}

function updateSalesforceMcpPackage(): SalesforceMcpPackageState {
  const previousState = readSalesforceMcpPackageState();

  console.log(`\nUpdating @salesforce/mcp...`);

  execFileSync(
    "npm",
    ["update", "@salesforce/mcp", "--save", "--audit=false", "--fund=false"],
    {
      stdio: "inherit",
      shell: true,
    },
  );

  const nextState = readSalesforceMcpPackageState();

  if (hasSalesforceMcpPackageUpdated(previousState, nextState)) {
    const message = hasSalesforceMcpVersionChanged(previousState, nextState)
      ? `@salesforce/mcp updated: ${formatSalesforceMcpPackageState(
          previousState,
        )} -> ${formatSalesforceMcpPackageState(nextState)}`
      : "@salesforce/mcp package files updated";

    console.log(`${GREEN}${message}${RESET}\n`);
  }

  return nextState;
}

function readSyncConfig(): {
  sendTelemetry: boolean;
  useNoneGATools: boolean;
  ignoreToolsets: Set<string>;
  ignoreTools: Set<string>;
} {
  const configPath = path.join(
    process.cwd(),
    "scripts",
    "salesforce-mcp",
    "vibes-mcp-to-editor.jsonc",
  );
  const config = readJsonConfigFile<SyncConfig>(configPath, {});
  const sendTelemetry = config.sendTelemetry ?? true;
  const useNoneGATools = config.useNoneGATools ?? false;
  const ignoreToolsets = config.ignoreToolsets ?? [];
  const ignoreTools = config.ignoreTools ?? [];

  if (typeof sendTelemetry !== "boolean") {
    throw new Error(
      "scripts/salesforce-mcp/vibes-mcp-to-editor.jsonc sendTelemetry must be a boolean",
    );
  }

  if (typeof useNoneGATools !== "boolean") {
    throw new Error(
      "scripts/salesforce-mcp/vibes-mcp-to-editor.jsonc useNoneGATools must be a boolean",
    );
  }

  if (!Array.isArray(ignoreToolsets)) {
    throw new Error(
      "scripts/salesforce-mcp/vibes-mcp-to-editor.jsonc ignoreToolsets must be an array",
    );
  }

  if (!Array.isArray(ignoreTools)) {
    throw new Error(
      "scripts/salesforce-mcp/vibes-mcp-to-editor.jsonc ignoreTools must be an array",
    );
  }

  return {
    sendTelemetry,
    useNoneGATools,
    ignoreToolsets: new Set(ignoreToolsets),
    ignoreTools: new Set(ignoreTools),
  };
}

const { sendTelemetry, useNoneGATools, ignoreToolsets, ignoreTools } =
  readSyncConfig();

function assertSalesforceMcpInstalled(packageLock?: PackageLockJson): void {
  const rootPackage = packageLock?.packages?.[""];
  const dependencies = {
    ...rootPackage?.dependencies,
    ...rootPackage?.devDependencies,
  };

  if (!dependencies["@salesforce/mcp"]) {
    console.error(`\n${RED}@salesforce/mcp is not installed${RESET}`);
    process.exit(1);
  }
}

const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const SERVER_NAME = "Salesforce DX";
const DEFAULT_SERVER: McpServerConfig = {
  command: "npx",
  args: [
    "-y",
    "@salesforce/mcp",
    "--orgs",
    "DEFAULT_TARGET_ORG",
    "--toolsets",
    "",
    "--tools",
    "",
  ],
};
const EDITORS: Record<Editor, EditorConfig> = {
  vscode: {
    label: "VS Code",
    serverProperty: "servers",
    configPath: path.join(process.cwd(), ".vscode", "mcp.json"),
  },
  cursor: {
    label: "Cursor",
    serverProperty: "mcpServers",
    configPath: path.join(process.cwd(), ".cursor", "mcp.json"),
  },
};
const EDITOR_ORDER: Editor[] = ["vscode", "cursor"];

function getMcpServer(
  mcpConfig: EditorMcpConfig,
  editor: Editor,
): Partial<McpServerConfig> | undefined {
  return mcpConfig[EDITORS[editor].serverProperty]?.[SERVER_NAME];
}

function readEditorServerConfig(editor: Editor): McpServerConfig | undefined {
  const { configPath } = EDITORS[editor];

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const mcpConfig = readJsonFile<EditorMcpConfig>(configPath);
  const server = getMcpServer(mcpConfig, editor);

  return Array.isArray(server?.args) ? (server as McpServerConfig) : undefined;
}

function readExistingServerConfig(): McpServerConfig {
  return (
    EDITOR_ORDER.map(readEditorServerConfig).find(Boolean) ?? DEFAULT_SERVER
  );
}

function getArgValue(args: string[], flag: string): string {
  const flagIndex = args.indexOf(flag);

  if (flagIndex === -1) {
    throw new Error(`Missing ${flag} in mcp.json args`);
  }

  if (flagIndex === args.length - 1) {
    throw new Error(`Missing value for ${flag} in mcp.json args`);
  }

  return args[flagIndex + 1];
}

function toList(value: string): string[] {
  return value.split(",").filter(Boolean);
}

function removeIgnoredValues(
  values: string[],
  ignoredValues: Set<string>,
): string[] {
  return values.filter((value) => !ignoredValues.has(value));
}

function toUniqueList(values: string[]): string[] {
  return [...new Set(values)];
}

function isToolIncluded(tool: McpTool): boolean {
  const toolName = tool.getName();
  const toolsets = tool.getToolsets();

  return (
    !ignoreTools.has(toolName) &&
    !toolsets.some((toolset) => ignoreToolsets.has(toolset))
  );
}

function findAddedValues(
  currentValues: string[],
  nextValues: string[],
): string[] {
  const currentValueSet = new Set(currentValues);

  return nextValues.filter((value) => !currentValueSet.has(value));
}

function findRemovedValues(
  currentValues: string[],
  nextValues: string[],
): string[] {
  const nextValueSet = new Set(nextValues);

  return currentValues.filter((value) => !nextValueSet.has(value));
}

function hasSameValues(currentValues: string[], nextValues: string[]): boolean {
  return (
    currentValues.length === nextValues.length &&
    currentValues.every((value, index) => value === nextValues[index])
  );
}

function logChangedValues(
  label: string,
  color: string,
  values: string[],
): void {
  if (values.length > 0) {
    console.log(`${label}: ${color}${values.join(",")}${RESET}`);
  }
}

function updateArgValue(args: string[], flag: string, value: string): void {
  const flagIndex = args.indexOf(flag);

  if (flagIndex === -1) {
    throw new Error(`Missing ${flag} in mcp.json args`);
  }

  if (flagIndex === args.length - 1) {
    throw new Error(`Missing value for ${flag} in mcp.json args`);
  }

  args[flagIndex + 1] = value;
}

function syncStandaloneArg(
  args: string[],
  flag: string,
  shouldExist: boolean,
): string[] {
  const nextArgs = args.filter((arg) => arg !== flag);

  if (shouldExist) {
    nextArgs.push(flag);
  }

  return nextArgs;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}

function createUpdatedArgs(
  args: string[],
  toolsets: string[],
  tools: string[],
): string[] {
  let nextArgs = [...args];

  updateArgValue(nextArgs, "--toolsets", toolsets.join(","));
  updateArgValue(nextArgs, "--tools", tools.join(","));
  nextArgs = syncStandaloneArg(
    nextArgs,
    "--allow-non-ga-tools",
    useNoneGATools,
  );
  nextArgs = syncStandaloneArg(nextArgs, "--no-telemetry", !sendTelemetry);

  return nextArgs;
}

function updateEditorMcpConfig(editor: Editor, server: McpServerConfig): void {
  const { serverProperty, configPath } = EDITORS[editor];
  let mcpConfig: EditorMcpConfig = {};

  if (fs.existsSync(configPath)) {
    mcpConfig = readJsonFile<EditorMcpConfig>(configPath);
  }

  mcpConfig[serverProperty] ??= {};
  mcpConfig[serverProperty][SERVER_NAME] = {
    command: server.command ?? "npx",
    args: server.args,
  };
  writeJsonFile(configPath, mcpConfig);
}

function getRequestedEditors(): Editor[] {
  const editorArg = process.argv.find((arg) => arg.startsWith("--editor="));
  const editorValue = editorArg?.split("=")[1]?.toLowerCase();

  if (editorValue === "vscode") {
    return ["vscode"];
  }

  if (editorValue === "cursor") {
    return ["cursor"];
  }

  if (editorValue === "all") {
    return ["vscode", "cursor"];
  }

  if (editorValue) {
    throw new Error("--editor must be one of: vscode, cursor, all");
  }

  if (
    process.env.CURSOR_TRACE_ID ||
    process.env.CURSOR_USER_DATA_DIR ||
    process.env.CURSOR_SESSION_ID
  ) {
    return ["cursor"];
  }

  if (process.env.TERM_PROGRAM === "vscode" || process.env.VSCODE_PID) {
    return ["vscode"];
  }

  const editors: Editor[] = [];

  editors.push(
    ...EDITOR_ORDER.filter((editor) =>
      fs.existsSync(EDITORS[editor].configPath),
    ),
  );

  return editors.length > 0 ? editors : ["vscode"];
}

function updateEditorMcpConfigs(
  editors: Editor[],
  server: McpServerConfig,
): void {
  editors.forEach((editor) => {
    updateEditorMcpConfig(editor, server);
    console.log(`${EDITORS[editor].label} MCP config synced\n`);
  });
}

async function main(): Promise<void> {
  process.noDeprecation = true;

  const packageState = updateSalesforceMcpPackage();
  assertSalesforceMcpInstalled(packageState.packageLock);

  const writeStderr = process.stderr.write;
  process.stderr.write = () => true;
  let mcpTools: McpTool[];
  let toolsets: string[];

  try {
    const { Toolset } =
      await import("@salesforce/mcp/node_modules/@salesforce/mcp-provider-api/dist/enums.js");
    const { Services } = await import("@salesforce/mcp/lib/services.js");
    const { MCP_PROVIDER_REGISTRY } =
      await import("@salesforce/mcp/lib/registry.js");

    const services = new Services({
      telemetry: undefined,
      dataDir: process.cwd(),
      startupFlags: {
        "allow-non-ga-tools": useNoneGATools,
        debug: false,
      },
    });

    mcpTools = (
      await Promise.all(
        MCP_PROVIDER_REGISTRY.map(
          (provider: { provideTools(services: unknown): Promise<McpTool[]> }) =>
            provider.provideTools(services),
        ),
      )
    ).flat();
    toolsets = removeIgnoredValues(Object.values(Toolset), ignoreToolsets);
  } finally {
    process.stderr.write = writeStderr;
  }

  const tools = toUniqueList(
    mcpTools.filter(isToolIncluded).map((tool) => tool.getName()),
  );
  const editors = getRequestedEditors();
  const server = readExistingServerConfig();
  const args = server.args;
  const currentToolsets = toList(getArgValue(args, "--toolsets"));
  const currentTools = toList(getArgValue(args, "--tools"));
  const addedToolsets = findAddedValues(currentToolsets, toolsets);
  const addedTools = findAddedValues(currentTools, tools);
  const removedToolsets = findRemovedValues(currentToolsets, toolsets);
  const removedTools = findRemovedValues(currentTools, tools);
  const nextArgs = createUpdatedArgs(args, toolsets, tools);
  const nextServer = {
    ...server,
    args: nextArgs,
  };

  if (
    hasSameValues(currentToolsets, toolsets) &&
    hasSameValues(currentTools, tools)
  ) {
    updateEditorMcpConfigs(editors, nextServer);
    console.log(`${BLUE}No additional toolsets or tools added${RESET}\n`);
    return;
  }

  logChangedValues("Added toolsets", GREEN, addedToolsets);
  logChangedValues("Added tools", GREEN, addedTools);
  logChangedValues("Removed toolsets", RED, removedToolsets);
  logChangedValues("Removed tools", RED, removedTools);
  updateEditorMcpConfigs(editors, nextServer);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
