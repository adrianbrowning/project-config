/**
 * CLI argument parsing for non-interactive/CI mode
 */

export type CliArgs = {
  // Tool selection
  all: boolean;
  tools: Array<string>;
  noRelease: boolean;

  // Interactive mode control
  yes: boolean; // Accept all defaults/overwrites

  // TypeScript options
  tsMode: "bundler" | "tsc";
  tsDom: boolean;
  tsType: "app" | "library" | "library-monorepo";
  tsJsx: "react" | "react-jsx" | "preserve" | null;
  tsOutdir: string;

  // Help
  help: boolean;
};

const TOOL_VALUES = [ "ts", "eslint", "husky", "commitLint", "lintStaged", "semanticReleaseNotes", "knip" ] as const;

function parseBooleanFlag(arg: string): boolean | undefined {
  if (arg === "--all" || arg === "-a") return true;
  if (arg === "--yes" || arg === "-y") return true;
  if (arg === "--no-release") return true;
  if (arg === "--help" || arg === "-h") return true;
  if (arg === "--ts-dom") return true;
  if (arg === "--ts-no-dom") return false;
  return undefined;
}

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

function applyAllToolsFlag(args: CliArgs): void {
  if (!args.all) return;
  args.tools = [ ...TOOL_VALUES ];
  if (args.noRelease) {
    args.tools = args.tools.filter(t => t !== "semanticReleaseNotes");
  }
}

export function parseCliArgs(argv: Array<string> = process.argv.slice(2)): CliArgs {
  const args: CliArgs = {
    all: false,
    tools: [],
    noRelease: false,
    yes: false,
    tsMode: "bundler",
    tsDom: true,
    tsType: "app",
    tsJsx: null,
    tsOutdir: "dist",
    help: false,
  };

  for (const arg of argv) {
    const boolFlag = parseBooleanFlag(arg);
    if (boolFlag !== undefined) {
      if (arg === "--all" || arg === "-a") args.all = true;
      else if (arg === "--yes" || arg === "-y") args.yes = true;
      else if (arg === "--no-release") args.noRelease = true;
      else if (arg === "--help" || arg === "-h") args.help = true;
      else if (arg === "--ts-dom") args.tsDom = true;
      else if (arg === "--ts-no-dom") args.tsDom = false;
      continue;
    }

    parseTsMode(arg, args);
    parseTsDom(arg, args);
    parseTsType(arg, args);
    parseTsJsx(arg, args);
    parseTsOutdir(arg, args);
    parseTool(arg, args);
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
  console.log(`
@gingacodemonkey/config - CLI Setup Tool

Usage:
  gingacodemonkey-config [options]

Options:
  --all, -a              Select all tools
  --yes, -y              Accept all defaults (non-interactive mode)
  --no-release           Exclude semantic-release when using --all
  --tool=<name>          Select specific tool (can be used multiple times)
                         Values: ts, eslint, husky, commitLint, lintStaged,
                                 semanticReleaseNotes, knip

TypeScript Options (used with --yes):
  --ts-mode=<mode>       bundler | tsc (default: bundler)
  --ts-dom               Enable DOM support (default)
  --ts-no-dom            Disable DOM support
  --ts-type=<type>       app | library | library-monorepo (default: app)
  --ts-jsx=<jsx>         react | react-jsx | preserve | none (default: none)
  --ts-outdir=<dir>      Output directory (default: dist)

Examples:
  # Interactive mode (default)
  gingacodemonkey-config

  # Select all tools except semantic-release
  gingacodemonkey-config --all --no-release --yes

  # Setup with specific TypeScript config
  gingacodemonkey-config --all --yes --ts-mode=bundler --ts-dom --ts-type=app --ts-jsx=react

  # Select specific tools
  gingacodemonkey-config --tool=ts --tool=eslint --yes

  --help, -h             Show this help message
`);
}

/**
 * Collects packages to install, batched at end of setup
 */
export type PackageCollector = {
  packages: Set<string>;
  add: (pkg: string) => void;
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
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  cliArgs: CliArgs;
  packages: PackageCollector;
  tsVersion?: string;
  overwrite?: boolean;
};
