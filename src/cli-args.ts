/**
 * CLI argument parsing for non-interactive/CI mode
 */

export type CliArgs = {
  all: boolean; // Tool selection: every tool
  claudeRunner: "anthropic" | "bedrock"; // Claude PR review runner for --yes runs
  help: boolean;
  noRelease: boolean; // Exclude bumpy from --all
  releaseNpm: boolean; // Publish to npm as well as GitHub releases
  tools: Array<string>; // Tool selection: explicit list
  tsDom: boolean;
  tsJsx: "preserve" | "react" | "react-jsx" | null;
  tsMode: "bundler" | "tsc";
  tsOutdir: string;
  tsType: "app" | "library" | "library-monorepo";
  tsTypeModule: boolean;
  update: boolean; // Update existing configs
  workspacePackages: Array<string>; // Package globs for a new workspace (default: packages/*)
  workspaceUpdateAll: boolean; // Existing workspace: update every discovered package without asking
  yes: boolean; // Accept all defaults/overwrites
};

const TOOL_VALUES = [ "ts", "eslint", "husky", "commitLint", "lintStaged", "knip", "jscpd", "githubActions", "bumpy", "workspace" ] as const;

// Opt-in only: `workspace` turns the TS/ESLint setup into shared root configs, so `--all` must not imply it
const ALL_TOOLS = TOOL_VALUES.filter(tool => tool !== "workspace");

type BooleanFlag = "all" | "help" | "noRelease" | "releaseNpm" | "tsDom" | "tsTypeModule" | "update" | "workspaceUpdateAll" | "yes";

// flag → [field, value]. A Map, so arguments like `constructor` can't hit Object.prototype.
const BOOLEAN_FLAGS = new Map<string, [BooleanFlag, boolean]>([
  [ "--all", [ "all", true ]],
  [ "-a", [ "all", true ]],
  [ "--yes", [ "yes", true ]],
  [ "-y", [ "yes", true ]],
  [ "--update", [ "update", true ]],
  [ "-u", [ "update", true ]],
  [ "--help", [ "help", true ]],
  [ "-h", [ "help", true ]],
  [ "--ts-dom", [ "tsDom", true ]],
  [ "--ts-no-dom", [ "tsDom", false ]],
  [ "--ts-type-module", [ "tsTypeModule", true ]],
  [ "--no-ts-type-module", [ "tsTypeModule", false ]],
  [ "--no-release", [ "noRelease", true ]],
  [ "--release-npm", [ "releaseNpm", true ]],
  [ "--workspace-update-all", [ "workspaceUpdateAll", true ]],
]);

function parseTsMode(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--ts-mode=")) return;
  const value = arg.split("=")[1];
  if (value === "bundler" || value === "tsc") {
    args.tsMode = value;
  }
}

function parseTsDom(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--ts-dom=")) return;
  const value = arg.split("=")[1];
  args.tsDom = value === "dom" || value === "true";
}

function parseTsType(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--ts-type=")) return;
  const value = arg.split("=")[1]?.toLowerCase();
  if (value === "app" || value === "library" || value === "library-monorepo") {
    args.tsType = value;
  }
}

function parseTsJsx(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--ts-jsx=")) return;
  const value = arg.split("=")[1];
  if (value === "react" || value === "react-jsx" || value === "preserve") {
    args.tsJsx = value;
  }
  else if (value === "none" || value === "false") {
    args.tsJsx = null;
  }
}

function parseTsOutdir(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--ts-outdir=")) return;
  const outdir = arg.split("=")[1];
  if (outdir) args.tsOutdir = outdir;
}

function parseTool(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--tool=")) return;
  const tool = arg.split("=")[1];
  if (tool && TOOL_VALUES.includes(tool as typeof TOOL_VALUES[number])) {
    args.tools.push(tool);
  }
}

function parseWorkspacePackages(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--workspace-packages=")) return;
  const glob = arg.slice("--workspace-packages=".length);
  if (glob && !args.workspacePackages.includes(glob)) args.workspacePackages.push(glob);
}

function parseClaudeRunner(arg: string, args: CliArgs): void {
  if (!arg.startsWith("--claude-runner=")) return;
  const value = arg.split("=")[1];
  if (value === "anthropic" || value === "bedrock") args.claudeRunner = value;
}

function applyAllToolsFlag(args: CliArgs): void {
  if (!args.all) return;
  args.tools = args.noRelease ? ALL_TOOLS.filter(tool => tool !== "bumpy") : [ ...ALL_TOOLS ];
}

export function parseCliArgs(argv: Array<string> = process.argv.slice(2)): CliArgs {
  const args: CliArgs = {
    all: false,
    claudeRunner: "anthropic",
    tools: [],
    yes: false,
    update: false,
    tsMode: "bundler",
    tsDom: true,
    tsType: "app",
    tsJsx: null,
    tsOutdir: "dist",
    tsTypeModule: false,
    noRelease: false,
    releaseNpm: false,
    help: false,
    workspacePackages: [],
    workspaceUpdateAll: false,
  };

  for (const arg of argv) {
    const boolFlag = BOOLEAN_FLAGS.get(arg);
    if (boolFlag) {
      args[boolFlag[0]] = boolFlag[1];
      continue;
    }

    parseTsMode(arg, args);
    parseTsDom(arg, args);
    parseTsType(arg, args);
    parseTsJsx(arg, args);
    parseTsOutdir(arg, args);
    parseTool(arg, args);
    parseWorkspacePackages(arg, args);
    parseClaudeRunner(arg, args);
  }

  applyAllToolsFlag(args);
  return args;
}

export function isInteractiveMode(args: CliArgs): boolean {
  // Interactive mode is OFF when:
  // - --all is specified, OR
  // - --tools are specified, OR
  // - --yes is specified
  return !args.all && args.tools.length === 0;
}

export function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
@gingacodemonkey/config - CLI Setup Tool

Usage:
  gingacodemonkey-config [options]

Options:
  --all, -a              Select all tools (except workspace)
  --yes, -y              Accept all defaults (non-interactive mode)
  --tool=<name>          Select specific tool (can be used multiple times)
                         Values: ts, eslint, husky, commitLint, lintStaged,
                                 knip, jscpd, githubActions, bumpy, workspace

Workspace Options (pnpm workspace with shared root TS/ESLint configs):
  --workspace-packages=<glob>
                         Package glob for a new workspace (repeatable,
                         default: packages/*). Added to an existing workspace.
  --workspace-update-all Existing workspace: link every discovered package
                         to the shared configs (default with --yes: root only)

GitHub Actions Options (used with --yes):
  --claude-runner=<runner>
                         anthropic | bedrock: how the Claude PR review
                         workflow authenticates (default: anthropic)

Release Options (bumpy):
  --no-release           Exclude bumpy when using --all
  --release-npm          Publish to npm as well as GitHub releases
                         (default with --yes: GitHub releases only)

TypeScript Options (used with --yes):
  --ts-mode=<mode>       bundler | tsc (default: bundler)
  --ts-dom               Enable DOM support (default)
  --ts-no-dom            Disable DOM support
  --ts-type=<type>       app | library | library-monorepo (default: app)
  --ts-jsx=<jsx>         react | react-jsx | preserve | none (default: none)
  --ts-outdir=<dir>      Output directory (default: dist)
  --ts-type-module       Add "type": "module" to package.json
  --no-ts-type-module    Do not add "type": "module" (default)

Examples:
  # Interactive mode (default)
  gingacodemonkey-config

  # Select all tools
  gingacodemonkey-config --all --yes

  # Setup with specific TypeScript config
  gingacodemonkey-config --all --yes --ts-mode=bundler --ts-dom --ts-type=app --ts-jsx=react

  # Select specific tools
  gingacodemonkey-config --tool=ts --tool=eslint --yes

  # Create a pnpm workspace, or link every package in an existing one
  gingacodemonkey-config --tool=workspace --yes --workspace-update-all

  --help, -h             Show this help message
`);
}

/**
 * Collects packages to install, batched at end of setup
 */
export type PackageCollector = {
  add: (pkg: string) => void;
  packages: Set<string>;
};

export function createPackageCollector(): PackageCollector {
  const packages = new Set<string>();
  return {
    packages,
    add(pkg: string) {
      packages.add(pkg);
    },
  };
}

/**
 * Context type that includes CLI args for use in tasks
 */
export type TaskContext = {
  cliArgs: CliArgs;
  overwrite?: boolean;
  packageManager: "bun" | "npm" | "pnpm" | "yarn";
  packages: PackageCollector;
  tsVersion?: string;
};
