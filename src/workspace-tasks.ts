import fs from "node:fs";
import path from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask, ListrTaskWrapper } from "listr2";
import type { CliArgs, TaskContext } from "./cli-args.ts";
import { eslintConfigContent } from "./eslint-tasks.ts";
import type { YES_ANY_IS_OK_HERE } from "./types.ts";
import { getPkgVersion, updatePkgJsonScript, updateWorkspaceYaml } from "./utils.ts";

type WorkspaceTask = ListrTaskWrapper<TaskContext, YES_ANY_IS_OK_HERE, YES_ANY_IS_OK_HERE>;

/** Asks whether to link every discovered package in an existing workspace. */
export type ConfirmUpdateAll = (task: WorkspaceTask, packages: Array<string>) => Promise<boolean>;

export const promptUpdateAll: ConfirmUpdateAll = async (task, packages) => task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
  type: "confirm",
  name: "updateAll",
  message: `Link all ${packages.length} packages (${packages.join(", ")}) to the shared configs?`,
  initial: true,
});

const TS_VERSION = "__ts_version__";
const ESLINT_VERSION = "__eslint_version__";
// This package's own version, so the shared configs match the CLI that wrote them
const CONFIG_VERSION = "__config_version__";

export const SHARED_DIR = "sharedConfig";
const DEFAULT_GLOB = "packages/*";
const SAMPLE_NAME = "example";

export const PACKAGE_SCRIPTS: Record<string, string> = {
  "lint": "eslint --config eslint.config.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0",
  "lint:fix": "eslint --config eslint.config.style.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0 --fix",
  "lint:ts": "tsc --noEmit",
};

// `pnpm -r` skips the workspace root, so these never recurse into themselves
export const ROOT_SCRIPTS: Record<string, string> = {
  "lint": "pnpm -r lint",
  "lint:fix": "pnpm -r lint:fix",
  "lint:ts": "pnpm -r lint:ts",
};

/** A package's ESLint config file: a re-export of the shared one, `shared` being the relative path to sharedConfig/. */
export function packageEslintLink(shared: string, file: "eslint.config.style.ts" | "eslint.config.ts"): string {
  return `import config from "${shared}/${file}";\n\nexport default config;\n`;
}

type JsonObject = Record<string, unknown>;
type PackageResult = "could not be migrated" | "unchanged" | "updated";

/** Writes `content` unless the file already holds it. Returns whether it wrote. */
function writeIfChanged(file: string, content: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function readJsonObject(file: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
  }
  catch {
    return null;
  }
}

/** Package globs from an existing `pnpm-workspace.yaml`, or null when it has no `packages` key. */
export function readWorkspaceGlobs(): Array<string> | null {
  if (!fs.existsSync("pnpm-workspace.yaml")) return null;
  const lines = fs.readFileSync("pnpm-workspace.yaml", "utf8").split("\n");
  const unquote = (item: string) => item.trim().replace(/^['"]/, "")
    .replace(/['"]$/, "");

  const start = lines.findIndex(line => line.startsWith("packages:"));
  if (start === -1) return null;
  const inline = lines[start]!.slice("packages:".length).trim();
  if (inline.startsWith("[")) return inline.replace(/^\[/, "").replace(/\]$/, "")
    .split(",")
    .map(unquote)
    .filter(Boolean);

  const globs: Array<string> = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("-")) break;
    globs.push(unquote(trimmed.slice(1)));
  }
  return globs.filter(Boolean);
}

/** Package directories (relative, `/`-separated) matched by the workspace globs, honouring `!` exclusions. */
export function discoverPackages(globs: Array<string>): Array<string> {
  const normalise = (glob: string) => {
    const normalised = path.posix.normalize(glob);
    return normalised.endsWith("/") ? normalised.slice(0, -1) : normalised;
  };
  const include = globs.filter(glob => !glob.startsWith("!")).map(normalise);
  const exclude = globs.filter(glob => glob.startsWith("!")).map(glob => normalise(glob.slice(1)));
  if (include.length === 0) return [];

  return [ ...new Set(fs.globSync(include).map(match => match.split(path.sep).join("/"))) ]
    .filter(dir => dir !== "." && !/(?:^|\/)node_modules(?:\/|$)/.test(dir))
    .filter(dir => fs.existsSync(path.join(dir, "package.json")))
    .filter(dir => !exclude.some(glob => path.matchesGlob(dir, glob)))
    .toSorted((a, b) => a.localeCompare(b));
}

/** Where the sample package goes for a glob: `packages/*` → `packages/example`, `apps/web` → `apps/web`. */
function sampleDirFor(glob: string): string {
  const segments = glob.replace(/^\.\//, "").split("/");
  const firstWild = segments.findIndex(segment => /[*?[{]/.test(segment));
  return firstWild === -1 ? segments.join("/") : [ ...segments.slice(0, firstWild), SAMPLE_NAME ].join("/");
}

function tsPreset(cliArgs: CliArgs): string {
  const mode = cliArgs.tsMode === "tsc" ? "tsc" : "bundler";
  return `@gingacodemonkey/config/${mode}/${cliArgs.tsDom ? "dom" : "no-dom"}/${cliArgs.tsType}`;
}

function writeSharedConfigs(cliArgs: CliArgs): void {
  const baseFile = path.join(SHARED_DIR, "tsconfig.base.json");
  const existing = fs.existsSync(baseFile) ? readJsonObject(baseFile) : null;
  if (fs.existsSync(baseFile) && !existing) {
    throw new Error(`${baseFile} is not valid JSON; fix or delete it and rerun setup`);
  }
  // Keep whatever else the shared base holds; only the preset (and jsx, when asked for) is ours
  const compilerOptions = { ...(existing?.compilerOptions as JsonObject | undefined), ...(cliArgs.tsJsx ? { jsx: cliArgs.tsJsx } : {}) };
  writeIfChanged(baseFile, toJson({
    ...existing,
    extends: tsPreset(cliArgs),
    ...(Object.keys(compilerOptions).length > 0 ? { compilerOptions } : {}),
  }));
  writeIfChanged(path.join(SHARED_DIR, "eslint.config.ts"), eslintConfigContent("eslint"));
  writeIfChanged(path.join(SHARED_DIR, "eslint.config.style.ts"), eslintConfigContent("styled"));
}

function createSamplePackage(dir: string): void {
  writeIfChanged(path.join(dir, "package.json"), toJson({ name: SAMPLE_NAME, version: "0.0.0", private: true, type: "module" }));
  writeIfChanged(path.join(dir, "src", "index.ts"), [
    "export function greet(name: string): string {",
    "  return `Hello, ${name}!`;",
    "}",
    "",
  ].join("\n"));
}

/** The shared base goes first so a package's own `extends` and options still override it. */
function withSharedExtends(current: unknown, sharedBase: string): Array<string> {
  if (current === undefined) return [ sharedBase ];
  const list = Array.isArray(current) ? current.map(String) : [ String(current) ];
  return list.includes(sharedBase) ? list : [ sharedBase, ...list ];
}

/** Points one package at the shared configs. Reads everything before writing, so a failure changes nothing. */
function linkPackage(dir: string): { reason?: string; result: PackageResult; } {
  const manifestFile = path.join(dir, "package.json");
  const tsconfigFile = path.join(dir, "tsconfig.json");
  const manifest = readJsonObject(manifestFile);
  if (!manifest) return { result: "could not be migrated", reason: "package.json is not valid JSON" };
  const tsconfig = fs.existsSync(tsconfigFile) ? readJsonObject(tsconfigFile) : {};
  if (!tsconfig) return { result: "could not be migrated", reason: "tsconfig.json is not plain JSON (comments or trailing commas?)" };

  const shared = path.posix.relative(dir, SHARED_DIR);
  let changed = false;

  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  if (Object.entries(PACKAGE_SCRIPTS).some(([ name, command ]) => scripts[name] !== command)) {
    changed = writeIfChanged(manifestFile, toJson({ ...manifest, scripts: { ...scripts, ...PACKAGE_SCRIPTS } })) || changed;
  }

  const sharedBase = `${shared}/tsconfig.base.json`;
  const extendsList = withSharedExtends(tsconfig.extends, sharedBase);
  const nextTsconfig = {
    ...tsconfig,
    // One base stays a plain string; an existing extends is kept after the shared one (TS 5+ extends arrays)
    extends: extendsList.length === 1 ? extendsList[0] : extendsList,
    ...(tsconfig.include === undefined && tsconfig.files === undefined ? { include: [ "src" ] } : {}),
  };
  if (JSON.stringify(nextTsconfig) !== JSON.stringify(tsconfig)) {
    changed = writeIfChanged(tsconfigFile, toJson(nextTsconfig)) || changed;
  }

  // Package ESLint configs are replaced outright; they only re-export the shared ones
  changed = writeIfChanged(path.join(dir, "eslint.config.ts"), packageEslintLink(shared, "eslint.config.ts")) || changed;
  changed = writeIfChanged(path.join(dir, "eslint.config.style.ts"), packageEslintLink(shared, "eslint.config.style.ts")) || changed;

  return { result: changed ? "updated" : "unchanged" };
}

/**
 * `confirmUpdateAll` is null for `--tool=…` runs, which never prompt: packages are then only linked
 * with `--workspace-update-all`, and otherwise reported as skipped.
 */
export function createWorkspaceTasks(cliArgs: CliArgs, confirmUpdateAll: ConfirmUpdateAll | null): Array<ListrTask<TaskContext>> {
  const state: { existing: boolean; globs: Array<string>; } = { existing: false, globs: [] };

  return [
    {
      title: "Checking workspace dependencies",
      task: (ctx, task) => {
        if (!fs.existsSync("package.json")) {
          const name = path.basename(process.cwd()).toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-");
          fs.writeFileSync("package.json", toJson({ name, private: true, type: "module" }));
        }
        const required: Array<[string, string]> = [
          [ "typescript", TS_VERSION ],
          [ "@types/node", "^24.0.0" ],
          [ "eslint", ESLINT_VERSION ],
          [ "jiti", "" ],
          [ "@gingacodemonkey/config", CONFIG_VERSION ],
        ];
        const missing = required.filter(([ name ]) => !getPkgVersion(name));
        for (const [ name, version ] of missing) ctx.packages.add(version ? `${name}@${version}` : name);
        task.title = missing.length > 0
          ? `Workspace root needs ${missing.map(([ name ]) => name).join(", ")}`
          : "Workspace root dependencies already installed";
      },
    },
    {
      title: "Configuring pnpm workspace packages",
      task: (_ctx, task) => {
        const existingGlobs = readWorkspaceGlobs();
        state.existing = existingGlobs !== null;
        const base = existingGlobs ?? (cliArgs.workspacePackages.length > 0 ? cliArgs.workspacePackages : [ DEFAULT_GLOB ]);
        const known = new Set(base);
        state.globs = [ ...base, ...cliArgs.workspacePackages.filter(glob => !known.has(glob)) ];
        if (existingGlobs?.length !== state.globs.length) updateWorkspaceYaml({ packages: state.globs });
        task.title = `${state.existing ? "Existing" : "New"} workspace packages: ${state.globs.join(", ")}`;
      },
    },
    {
      title: `Writing shared configs to ${SHARED_DIR}/`,
      task: () => writeSharedConfigs(cliArgs),
    },
    {
      title: "Adding recursive lint scripts to the workspace root",
      task: () => {
        for (const [ name, command ] of Object.entries(ROOT_SCRIPTS)) updatePkgJsonScript(name, command);
      },
    },
    {
      title: "Linking packages to the shared configs",
      task: async (_ctx, task) => {
        let packages = discoverPackages(state.globs);
        if (!state.existing && packages.length === 0) {
          const sampleDir = sampleDirFor(state.globs[0] ?? DEFAULT_GLOB);
          createSamplePackage(sampleDir);
          packages = [ sampleDir ];
        }
        if (packages.length === 0) {
          task.title = "No packages found for the workspace globs";
          return;
        }

        // A new workspace only holds the sample package, so it is always linked
        let updateAll = !state.existing || cliArgs.workspaceUpdateAll;
        if (!updateAll && confirmUpdateAll) updateAll = await confirmUpdateAll(task, packages);

        const counts: Record<"skipped" | PackageResult, number> = { "updated": 0, "unchanged": 0, "skipped": 0, "could not be migrated": 0 };
        const lines = packages.map(dir => {
          if (!updateAll) {
            counts.skipped++;
            return `${dir}: skipped`;
          }
          const { result, reason } = linkPackage(dir);
          counts[result]++;
          return `${dir}: ${result}${reason ? ` (${reason})` : ""}`;
        });
        task.title = `Packages: ${Object.entries(counts).map(([ status, count ]) => `${count} ${status}`)
          .join(", ")}\n  ${lines.join("\n  ")}`;
      },
    },
  ];
}
