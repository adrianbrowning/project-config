/**
 * The `#src/*.ts` package import every TypeScript project and workspace package gets, so source files import each
 * other as `#src/utils/format.ts` from anywhere under `src/`. The key keeps the `.ts` extension (#30): the target then
 * names a `.ts` file itself, so TypeScript doesn't report it as an extension it can't rewrite (TS2877).
 *
 * - bundler mode: `./src/*.ts`, read from source by the type-checker, Node's type stripping and the bundler.
 * - tsc mode: `types`/`default` point at the compiled output, so the emitted JavaScript (which keeps `#src/x.ts`)
 *   loads `<outDir>/x.js` under Node and never touches `src/`. Apps and private packages also get the
 *   `gingacodemonkey:source` condition, so their tests run from `src/` without a build
 *   (`node --conditions=gingacodemonkey:source --test`). A publishable library doesn't: every target it declares
 *   must exist in its tarball, which holds only the output.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTaskWrapper } from "listr2";
import type { TaskContext } from "./cli-args.ts";
import type { YES_ANY_IS_OK_HERE } from "./types.ts";
import type { PlanItem } from "./update/reconcile.ts";
import { getPackageJson } from "./utils.ts";

type JsonObject = Record<string, unknown>;
type Mode = "bundler" | "tsc";

const SRC_IMPORT_KEY = "#src/*.ts";
// Written by hand in many projects; it would still match the .ts imports `#src/*.ts` takes over
const BROAD_KEY = "#src/*";
const SOURCE_CONDITION = "gingacodemonkey:source";
/** The test script for tsc-mode packages with the source condition: tests import `#src/…` from `src/`, unbuilt. */
export const SOURCE_TEST_SCRIPT = `node --conditions=${SOURCE_CONDITION} --test`;
const SRC_DIR = "src";
const SOURCE_TARGET = `./${SRC_DIR}/*.ts`;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(value) ? value : undefined;
  }
  catch {
    return undefined;
  }
}

/** Rewrites one JSON file through `change` when it's applied, keeping its trailing newline (or lack of one). */
function updateJson(file: string, change: (value: JsonObject) => JsonObject): void {
  const content = fs.readFileSync(file, "utf8");
  const value: unknown = JSON.parse(content);
  if (!isObject(value)) throw new Error(`${file} is not a JSON object`);
  const next = change(value);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + (content.endsWith("\n") ? "\n" : ""));
  // Later setup tasks write the root manifest from utils' cached copy; keep it in step so they don't undo this
  if (path.resolve(file) === path.resolve("package.json")) Object.assign(getPackageJson(), next);
}

function normaliseDir(dir: string): string {
  return path.posix.normalize(dir.replaceAll("\\", "/")).replace(/\/$/, "")
    .replace(/^\.\//, "");
}

/** Which of this package's presets `file` extends, read from its `extends` (a string or an array). */
export function presetMode(file: string): Mode | undefined {
  for (const preset of [ readJson(file)?.extends ].flat()) {
    const match = typeof preset === "string" ? /^@gingacodemonkey\/config\/(bundler|tsc)\//.exec(preset) : null;
    if (match) return match[1] as Mode;
  }
  return undefined;
}

/** Every mapping this CLI generates for one output location; any of them is ours to replace. */
function generatedTargets(outPrefix: string, typesPrefix: string): { app: JsonObject; bundler: string; library: JsonObject; } {
  const types = `./${path.posix.join(typesPrefix, "*.d.ts")}`;
  const output = `./${path.posix.join(outPrefix, "*.js")}`;
  return {
    bundler: SOURCE_TARGET,
    app: { "types": types, [SOURCE_CONDITION]: SOURCE_TARGET, "default": output },
    library: { types, default: output },
  };
}

/** The `imports["#src/*.ts"]` entry: added when missing, replaced only when it's one this CLI wrote. */
function importItem(file: string, imports: unknown, wanted: unknown, known: ReadonlyArray<unknown>): PlanItem {
  const label = `${file} › imports[${JSON.stringify(SRC_IMPORT_KEY)}]`;
  // Merged into the user's imports: their other aliases keep their values and order
  const apply = () => updateJson(file, manifest => ({
    ...manifest,
    imports: { ...(isObject(manifest.imports) ? manifest.imports : {}), [SRC_IMPORT_KEY]: wanted },
  }));
  if (imports === undefined) return { label, status: "added", apply };
  if (!isObject(imports)) return { label, status: "customized", reason: "imports isn't an object; left as is" };
  const current = imports[SRC_IMPORT_KEY];
  if (isDeepStrictEqual(current, wanted)) return { label, status: "unchanged" };
  if (current === undefined) {
    const broad = imports[BROAD_KEY];
    if (broad === undefined) return { label, status: "added", apply };
    return { label, status: "conflict", reason: `your ${JSON.stringify(BROAD_KEY)} is ${JSON.stringify(broad)}; the generated ${JSON.stringify(wanted)} would take over its .ts imports`, apply };
  }
  if (known.some(value => isDeepStrictEqual(current, value))) return { label, status: "updated", apply };
  return { label, status: "conflict", reason: `is ${JSON.stringify(current)}, expected ${JSON.stringify(wanted)}`, apply };
}

/**
 * What setup and --update manage for the `#src/*.ts` import of the package in `dir`: the `package.json` entry and, in
 * tsc mode, `rootDir: "src"` when the tsconfig sets none (output paths follow it, and TypeScript versions default it
 * differently). `mode` comes from the preset the package's tsconfig extends; `library` is a publishable library;
 * `defaultOutDir` applies when the tsconfig has no `outDir`.
 */
export function srcImportItems(dir: string, mode: Mode | undefined, library: boolean, defaultOutDir = "dist"): Array<PlanItem> {
  const manifestFile = path.join(dir, "package.json");
  const tsconfigFile = path.join(dir, "tsconfig.json");
  const label = `${manifestFile} › imports[${JSON.stringify(SRC_IMPORT_KEY)}]`;
  const manifest = readJson(manifestFile);
  if (!manifest) return [{ label, status: "skipped", reason: "package.json is missing or not plain JSON" }];
  if (!mode) return [{ label, status: "skipped", reason: `${tsconfigFile} doesn't extend a @gingacodemonkey/config preset, so its build mode is unknown` }];
  if (mode === "bundler") return [ importItem(manifestFile, manifest.imports, SOURCE_TARGET, []) ];

  const tsconfig = readJson(tsconfigFile);
  if (!tsconfig) return [{ label, status: "skipped", reason: `${tsconfigFile} is missing or not plain JSON; can't read its outDir` }];
  const options = isObject(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
  const rootDir = typeof options.rootDir === "string" ? normaliseDir(options.rootDir) : SRC_DIR;
  // Where src/ lands inside the output: `dist` for rootDir src, `dist/src` for rootDir "."
  const inOutput = path.posix.relative(rootDir, SRC_DIR);
  if (inOutput.startsWith("..") || path.posix.isAbsolute(inOutput)) {
    return [{ label, status: "skipped", reason: `${SRC_DIR}/ is outside rootDir ${rootDir}, so it isn't compiled` }];
  }
  const outDir = normaliseDir(typeof options.outDir === "string" ? options.outDir : defaultOutDir);
  const typesDir = typeof options.declarationDir === "string" ? normaliseDir(options.declarationDir) : outDir;
  const targets = generatedTargets(path.posix.join(outDir, inOutput), path.posix.join(typesDir, inOutput));

  return [
    ...(options.rootDir === undefined
      ? [{ label: `${tsconfigFile} › compilerOptions.rootDir`,
        status: "added" as const,
        apply: () => updateJson(tsconfigFile, current => ({
          ...current,
          compilerOptions: { ...(isObject(current.compilerOptions) ? current.compilerOptions : {}), rootDir: SRC_DIR },
        })) }]
      : []),
    importItem(manifestFile, manifest.imports, library ? targets.library : targets.app, Object.values(targets)),
  ];
}

/** Interactive setup: whether to replace one existing `#src` mapping. */
type ConfirmReplace = (item: PlanItem) => Promise<boolean>;

/** Interactive setup asks before replacing a mapping of the user's, defaulting to keeping it. */
export function promptReplace(task: ListrTaskWrapper<TaskContext, YES_ANY_IS_OK_HERE, YES_ANY_IS_OK_HERE>): ConfirmReplace {
  return async item => task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
    type: "confirm",
    name: "replace",
    message: `${item.label} ${item.reason ?? "differs"}. Replace it with the generated mapping?`,
    initial: false,
  });
}

/**
 * Setup: writes what's missing or still an earlier generated value. A conflicting mapping of the user's is kept and
 * reported, unless `confirm` (interactive setup) says to replace it. Returns one note per item it didn't write.
 */
export async function applySrcImports(items: ReadonlyArray<PlanItem>, confirm: ConfirmReplace | null): Promise<Array<string>> {
  const notes: Array<string> = [];
  for (const item of items) {
    // One question at a time, in order
    // eslint-disable-next-line no-await-in-loop
    const replace = item.status === "conflict" && confirm !== null && await confirm(item);
    if (item.status === "added" || item.status === "updated" || replace) item.apply?.();
    else if (item.status !== "unchanged") notes.push(`${item.status === "conflict" ? "kept your own" : item.status} ${item.label}${item.reason ? ` (${item.reason})` : ""}`);
  }
  return notes;
}
