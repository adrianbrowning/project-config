import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import { findPackageJSON } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTaskWrapper } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import type { YES_ANY_IS_OK_HERE } from "./types.ts";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
}

// Keyed by cwd, so a process that runs setup in more than one directory never writes one project's manifest into another
let pj: null | { cwd: string; json: PackageJson; } = null;

export function getPackageJson(): PackageJson {
  if (pj?.cwd === process.cwd()) return pj.json;
  if (!fs.existsSync("package.json")) throw new Error("No package.json found");
  const json = JSON.parse(fs.readFileSync("package.json", "utf8")) as null | PackageJson;
  if (!json) throw new Error("No package.json found");
  pj = { cwd: process.cwd(), json };
  return json;
}

export function getPkgVersion(pkg: string): null | string {
  const pj = getPackageJson();
  let version = "";
  if (pj.dependencies && pj.dependencies[pkg]) {
    version = pj.dependencies[pkg];
  }
  else if (pj.devDependencies && pj.devDependencies[pkg]) {
    version = pj.devDependencies[pkg];
  }
  if (!version) return null;
  return version.replace(/^[~^]/, "").trim();
}

/**
 * Whether `pkg` is installed in the consuming project. Resolves from `process.cwd()`, not from this
 * package: pnpm isolates dependencies, so the consumer's packages are not visible from here.
 */
export function has(pkg: string): boolean {
  try {
    return findPackageJSON(pkg, pathToFileURL(path.join(process.cwd(), "package.json")).href) !== undefined;
  }
  catch {
    return false;
  }
}

// ponytail: always pnpm, add detection back if multi-PM support needed
export function detectPackageManager(): "pnpm" {
  return "pnpm";
}

const TOO_NEW_RE = /ERR_PNPM_NO_MATURE_MATCHING_VERSION\s+Version (\S+) \([^)]*\) of (\S+) does not meet the minimumReleaseAge constraint/;

/** Each lookup returns null when pnpm can't answer, so a failed query never hides the install error. */
type ReleaseLookup = {
  /** `minimumReleaseAge` in minutes, as pnpm resolves it for this project. */
  minimumReleaseAge: () => null | number;
  publishedAt: (name: string, version: string) => Date | null;
};

/**
 * pnpm's `minimumReleaseAge` refusal, rewritten to name the package and when it becomes installable.
 * Null when `output` isn't that refusal.
 */
export function tooNewPackageMessage(output: string, lookup: ReleaseLookup): null | string {
  const match = TOO_NEW_RE.exec(output);
  if (!match) return null;
  const [ , version = "", name = "" ] = match;
  const minutes = lookup.minimumReleaseAge();
  const published = minutes === null ? null : lookup.publishedAt(name, version);
  const age = minutes === null ? "" : ` (${minutes} minutes)`;
  const installable = published && minutes !== null
    ? ` It can be installed from ${new Date(published.getTime() + minutes * 60_000).toISOString()}.`
    : "";
  return `${name}@${version} is younger than minimumReleaseAge${age}, so pnpm won't install it.${installable}`
    + " To change configs in this project without installing packages, use --update.";
}

/* eslint-disable sonarjs/no-os-command-from-path */
const registryLookup: ReleaseLookup = {
  minimumReleaseAge: () => {
    try {
      const minutes = Number(execFileSync("pnpm", [ "config", "get", "minimumReleaseAge" ], { encoding: "utf8" }).trim());
      return Number.isFinite(minutes) ? minutes : null;
    }
    catch {
      return null;
    }
  },
  publishedAt: (name, version) => {
    try {
      const times: unknown = JSON.parse(execFileSync("pnpm", [ "view", name, "time", "--json" ], { encoding: "utf8" }));
      const time: unknown = typeof times === "object" && times !== null ? Object.entries(times).find(([ key ]) => key === version)?.[1] : undefined;
      return typeof time === "string" ? new Date(time) : null;
    }
    catch {
      return null;
    }
  },
};
/* eslint-enable sonarjs/no-os-command-from-path */

export function installPkg(packageManager: "bun" | "npm" | "pnpm" | "yarn", pkg: string): void {
  const isWorkspaceRoot = packageManager === "pnpm" && fs.existsSync("pnpm-workspace.yaml");
  const installCommand = {
    npm: `npm install ${pkg} --save-dev`,
    yarn: `yarn add ${pkg} --dev`,
    pnpm: `pnpm add ${pkg} --save-dev${isWorkspaceRoot ? " -w" : ""}`,
    bun: `bun add ${pkg} --dev`,
  }[packageManager];

  try {
    // pnpm prints its errors on stdout, so capture it to explain a minimumReleaseAge refusal
    execSync(installCommand, { stdio: [ "inherit", "pipe", "inherit" ], encoding: "utf8" });
  }
  catch (error: unknown) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
    const tooNew = tooNewPackageMessage(stdout, registryLookup);
    throw new Error(tooNew ?? `Failed to install packages. Command: ${installCommand}\n${stdout.trim().slice(-2000)}`);
  }
}

export function compareVersions(v1: string, v2: string): -1 | 0 | 1 {
  const splitV1 = v1.replace(/^[^\d]+/, "").split(".")
    .map(Number);
  const splitV2 = v2.replace(/^[^\d]+/, "").split(".")
    .map(Number);

  for (let i = 0; i < Math.max(splitV1.length, splitV2.length); i++) {
    const partV1 = splitV1[i] || 0;
    const partV2 = splitV2[i] || 0;

    if (partV1 > partV2) return 1;
    if (partV1 < partV2) return -1;
  }
  return 0;
}

type ConfigContext = {
  overwrite: boolean;
};

export function writeConfigFile(fileName: string, content: string) {

  return async function (parentCtx: TaskContext, task: ListrTaskWrapper<TaskContext, YES_ANY_IS_OK_HERE, YES_ANY_IS_OK_HERE>) {

    return task.newListr([
      {
        title: `Checking if ${fileName} exists`,

        task: async (ctx: ConfigContext, task) => {
          const lintConfigExists = getLintConfig(fileName);
          ctx.overwrite = true;
          if (lintConfigExists) {
            if (parentCtx.cliArgs.yes) {
              ctx.overwrite = true;
            }
            else {
              ctx.overwrite = await task.prompt(ListrEnquirerPromptAdapter).run({
                type: "confirm",
                name: "overwrite",
                message: `${fileName} already exists. Would you like to overwrite it?`,
              });
              if (!ctx.overwrite) {
                task.skip(`User chose not to overwrite ${fileName}. Task aborted.`);
              }
            }
          }
        },
      },
      {
        title: `Setting up ${fileName}`,
        enabled: (ctx: ConfigContext) => ctx.overwrite === true,
        task: async () => {
          const dir = path.dirname(fileName); // Get the directory path
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true }); // Ensure the directory and parents exist
          }
          fs.writeFileSync(fileName, content);
        },
      },
    ],
    { concurrent: false });
  };
}

function getLintConfig(fileName: string): boolean {
  return fs.existsSync("./" + fileName);
}

export function updatePkgJsonScript(name: string, value: string): void {
  const pkgJ = getPackageJson();
  pkgJ.scripts = pkgJ.scripts || {};
  pkgJ.scripts[name] = value;
  fs.writeFileSync("package.json", JSON.stringify(pkgJ, null, 2));
}

export function updatePkgJson(key: string, value: unknown): void {
  const pkgJ = getPackageJson() as Record<string, unknown>;
  // Merge objects if both are objects
  if (typeof value === "object" && value !== null && !Array.isArray(value) &&
        typeof pkgJ[key] === "object" && pkgJ[key] !== null && !Array.isArray(pkgJ[key])) {
    pkgJ[key] = { ...(pkgJ[key]), ...(value) };
  }
  else {
    pkgJ[key] = value;
  }
  fs.writeFileSync("package.json", JSON.stringify(pkgJ, null, 2));
}

type YamlValue = Array<string> | boolean | number | Record<string, boolean> | string;

const yamlChildKeyRe = /^ {2}['"]?([^'"\s:]+)['"]?:/;

function yamlEntry(key: string, val: YamlValue, existingBlock = ""): string {
  if (Array.isArray(val)) return key + ":\n" + val.map(item => "  - '" + item + "'").join("\n") + "\n";
  if (typeof val !== "object") return key + ": " + String(val) + "\n";

  // Maps merge: entries the user already has win, missing ones are appended
  const existingLines = existingBlock.split("\n").slice(1)
    .filter(line => line.trim().length > 0);
  const existingKeys = new Set(existingLines.map(line => yamlChildKeyRe.exec(line)?.[1]));
  const added = Object.entries(val).filter(([ child ]) => !existingKeys.has(child))
    .map(([ child, childVal ]) => "  '" + child + "': " + String(childVal));
  return key + ":\n" + [ ...existingLines, ...added ].join("\n") + "\n";
}

/**
 * Older versions of this CLI nested settings under a `pnpm:` key, where pnpm ignores them.
 * Drop those nested entries for the keys being written; drop the `pnpm:` key once it is empty.
 */
function removeLegacyPnpmEntries(content: string, keys: Array<string>): string {
  const legacyBlockRe = /^pnpm:[ \t]*\n((?:[ \t].*\n|\n)*)/m;
  return content.replace(legacyBlockRe, (_block, body: string) => {
    const kept: Array<string> = [];
    let dropping = false;
    for (const line of body.split("\n").slice(0, -1)) {
      const childKey = yamlChildKeyRe.exec(line)?.[1];
      if (childKey !== undefined) dropping = keys.includes(childKey);
      if (!dropping) kept.push(line);
    }
    return kept.some(line => line.trim().length > 0) ? "pnpm:\n" + kept.join("\n") + "\n" : "";
  });
}

/**
 * Upsert top-level keys in pnpm-workspace.yaml. pnpm only reads settings at the top level,
 * so existing keys (including `packages:`) are kept; scalars and lists are replaced, maps are merged.
 */
export function updateWorkspaceYaml(values: Record<string, YamlValue>): void {
  const filePath = "pnpm-workspace.yaml";
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").trimEnd() : "";
  let content = removeLegacyPnpmEntries(existing.length > 0 ? existing + "\n" : "", Object.keys(values));

  for (const [ key, val ] of Object.entries(values)) {
    // The key's own line plus any indented or `- ` list lines that belong to it
    const existingKeyRe = new RegExp("^" + key + ":.*\\n(?:[ \\t].*\\n|- .*\\n)*", "m");
    const existingBlock = existingKeyRe.exec(content)?.[0];
    const entry = yamlEntry(key, val, existingBlock);
    content = existingBlock === undefined ? content + entry : content.replace(existingKeyRe, () => entry);
  }

  fs.writeFileSync(filePath, content);
}
