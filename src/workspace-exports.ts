/**
 * Publish-safe entry points for the library packages of a workspace: `exports`, `main`, `types`, `type`, `files`, a
 * `build` script and the tsconfig emit options, all derived from `src/index.ts` and the package's output directory.
 *
 * A package is a library when the shared base extends a `library` or `library-monorepo` preset (`--ts-type`), its
 * manifest isn't `"private": true` (npm never publishes a private package, so applications mark themselves private)
 * and it has `src/index.ts`. Anything else is an application and never gets publishing fields.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PlanItem } from "./update/reconcile.ts";

type JsonObject = Record<string, unknown>;

/**
 * The package.json key holding extra public entry points: `{ "gingacodemonkey": { "subpathExports": { "./utils":
 * "./src/utils.ts" } } }`. Each maps a subpath to a source file (or a `*` pattern) and is exported as compiled output.
 */
const SUBPATH_CONFIG_KEY = "gingacodemonkey";

const SHARED_BASE = path.join("sharedConfig", "tsconfig.base.json");
const ENTRY = "src/index.ts";
const BUILD_SCRIPT = "tsc";
// TS 6 defaults rootDir to the tsconfig's directory, which would emit src/index.ts to <outDir>/src/index.js
const ROOT_DIR = "src";

const BUNDLER_LIBRARY_REASON = "bundler mode type-checks with noEmit and leaves building to a bundler this CLI doesn't choose, "
  + "so there is no JavaScript or .d.ts for exports to point at. Rerun setup with --ts-mode=tsc, or mark applications \"private\": true";

export type PackageKind = "application" | "bundler-library" | "library";

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

/** Rewrites one JSON file in place through `change`, keeping its trailing newline (or lack of one). */
function updateJson(file: string, change: (value: JsonObject) => JsonObject): void {
  const content = fs.readFileSync(file, "utf8");
  const value: unknown = JSON.parse(content);
  if (!isObject(value)) throw new Error(`${file} is not a JSON object`);
  fs.writeFileSync(file, JSON.stringify(change(value), null, 2) + (content.endsWith("\n") ? "\n" : ""));
}

/** `./dist/`, `dist` and `dist/.` are the same directory: compare and write them as `dist`. */
function normaliseDir(dir: string): string {
  return path.posix.normalize(dir.replaceAll("\\", "/")).replace(/\/$/, "")
    .replace(/^\.\//, "");
}

/**
 * Library, application, or a library in a bundler-mode workspace (which has no build output to publish). Read from
 * the files on disk, so setup and --update classify a package the same way. `presetFile` is the tsconfig that
 * extends the preset: the shared base in a workspace, a single package's own `tsconfig.json` otherwise.
 */
export function packageKind(dir: string, presetFile = SHARED_BASE): PackageKind {
  const preset = readJson(presetFile)?.extends;
  const match = typeof preset === "string" ? /^@gingacodemonkey\/config\/(bundler|tsc)\/[^/]+\/library(?:-monorepo)?$/.exec(preset) : null;
  if (!match) return "application";
  const manifest = readJson(path.join(dir, "package.json"));
  if (!manifest || manifest.private === true || !fs.existsSync(path.join(dir, ENTRY))) return "application";
  return match[1] === "tsc" ? "library" : "bundler-library";
}

type Target = { default: string; types: string; };

/** The compiled JavaScript and declaration paths `tsc` emits for one source file (or `*` pattern). */
function emitted(source: string, rootDir: string, outDir: string): Target | { error: string; } {
  const relative = path.posix.relative(rootDir, normaliseDir(source));
  if (relative.startsWith("..") || path.posix.isAbsolute(relative)) return { error: `${source} is outside rootDir ${rootDir}` };
  const extension = /\.d\.[cm]?ts$/.test(relative) ? undefined : /\.([cm]?)tsx?$/.exec(relative);
  if (!extension) return { error: `${source} isn't a TypeScript source file` };
  const stem = `./${path.posix.join(outDir, relative.slice(0, -extension[0].length))}`;
  const flavour = extension[1] ?? "";
  return { types: `${stem}.d.${flavour}ts`, default: `${stem}.${flavour}js` };
}

/** True when a published export target would load TypeScript source or a private `src` path. */
function unsafeTarget(target: unknown): string | undefined {
  if (typeof target === "string") {
    const isSource = /\.[cm]?tsx?$/.test(target) && !/\.d\.[cm]?ts$/.test(target);
    return isSource || /^(?:\.\/)?src\//.test(target) ? target : undefined;
  }
  if (Array.isArray(target)) return target.map(unsafeTarget).find(Boolean);
  return isObject(target) ? Object.values(target).map(unsafeTarget)
    .find(Boolean) : undefined;
}

type Wanted = { exports: Record<string, Target>; invalid: Array<PlanItem>; };

/** The root entry plus every subpath configured under `gingacodemonkey.subpathExports`. */
function wantedExports(dir: string, manifest: JsonObject, rootDir: string, outDir: string, label: string): Wanted {
  const wanted: Wanted = { exports: {}, invalid: [] };
  const root = emitted(ENTRY, rootDir, outDir);
  if ("error" in root) {
    wanted.invalid.push({ label: `${label} › exports["."]`, status: "skipped", reason: root.error });
    return wanted;
  }
  wanted.exports["."] = root;
  const config = manifest[SUBPATH_CONFIG_KEY];
  const subpaths = isObject(config) ? config.subpathExports : undefined;
  for (const [ subpath, source ] of Object.entries(isObject(subpaths) ? subpaths : {})) {
    const itemLabel = `${label} › exports[${JSON.stringify(subpath)}]`;
    const stars = (value: string) => value.split("*").length - 1;
    let problem: string | undefined;
    if (!subpath.startsWith("./") || subpath === "./") problem = "subpath must start with ./";
    else if (typeof source !== "string") problem = "source must be a path such as ./src/utils.ts";
    else if (stars(subpath) > 1 || stars(subpath) !== stars(source)) problem = "subpath and source need the same single * (or none)";
    else if (stars(source) === 0 && !fs.existsSync(path.join(dir, source))) problem = `${source} doesn't exist`;
    const target = problem === undefined ? emitted(String(source), rootDir, outDir) : { error: problem };
    if ("error" in target) wanted.invalid.push({ label: itemLabel, status: "skipped", reason: target.error });
    else wanted.exports[subpath] = target;
  }
  return wanted;
}

/** A value the CLI owns: added when missing, a conflict (never silently replaced) when the user's differs. */
function owned(label: string, value: unknown, current: unknown, apply: () => void): PlanItem {
  if (value === undefined) return { label, status: "added", apply };
  if (isDeepStrictEqual(value, current)) return { label, status: "unchanged" };
  return { label, status: "conflict", reason: `is ${JSON.stringify(value)}, expected ${JSON.stringify(current)}`, apply };
}

function tsconfigItems(file: string, options: JsonObject, outDir: string): Array<PlanItem> {
  const set = (key: string, value: string) => () => updateJson(file, tsconfig => ({
    ...tsconfig,
    compilerOptions: { ...(isObject(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {}), [key]: value },
  }));
  // Values already set are the package's own build choices, so they're used rather than reported
  return ([
    [ "outDir", outDir ],
    [ "rootDir", ROOT_DIR ],
    // The presets' tsBuildInfoFile resolves inside node_modules/@gingacodemonkey/config, shared by every package;
    // inside outDir, deleting the output also forgets the build state, so the next build emits everything again
    [ "tsBuildInfoFile", `${outDir}/.tsbuildinfo` ],
  ] as const).map(([ key, value ]) => (options[key] === undefined
    ? { label: `${file} › compilerOptions.${key}`, status: "added", apply: set(key, value) }
    : { label: `${file} › compilerOptions.${key}`, status: "unchanged" }));
}

function exportsItems(file: string, existing: unknown, wanted: Wanted["exports"]): { items: Array<PlanItem>; ownsRoot: boolean; } {
  const label = `${file} › exports`;
  const replace = () => updateJson(file, manifest => ({ ...manifest, exports: wanted }));
  if (existing === undefined) return { items: [{ label, status: "added", apply: replace }], ownsRoot: true };
  // A string, array or conditions object is one custom root export: the package's own, never merged into
  if (!isObject(existing) || !Object.keys(existing).every(key => key.startsWith("."))) {
    const unsafe = unsafeTarget(existing);
    const reason = `is a custom root export; kept${unsafe ? `, but it resolves to ${unsafe}, which isn't compiled output` : ""}`;
    return { items: [{ label: `${label}["."]`, status: "conflict", reason, apply: replace }], ownsRoot: false };
  }

  const items = Object.entries(wanted).map(([ subpath, target ]) => owned(`${label}[${JSON.stringify(subpath)}]`, existing[subpath], target, () => updateJson(file, manifest => {
    const next: JsonObject = { ...(isObject(manifest.exports) ? manifest.exports : {}), [subpath]: target };
    // The root entry leads, as resolvers and readers expect
    return { ...manifest, exports: { ".": next["."], ...next } };
  })));
  // Subpaths the package declared itself are kept, but one that would publish TypeScript source is reported
  for (const [ subpath, target ] of Object.entries(existing)) {
    const unsafe = subpath in wanted ? undefined : unsafeTarget(target);
    if (unsafe) items.push({ label: `${label}[${JSON.stringify(subpath)}]`, status: "customized", reason: `resolves to ${unsafe}, which isn't compiled output; kept` });
  }
  return { items, ownsRoot: isDeepStrictEqual(existing["."] ?? wanted["."], wanted["."]) };
}

function filesItem(file: string, existing: unknown, outDir: string): PlanItem {
  const label = `${file} › files`;
  // Tests compile next to the code; neither they nor the build state belong in the tarball
  const wanted = [ outDir, `!${outDir}/**/*.test.*`, `!${outDir}/**/*.spec.*`, `!${outDir}/.tsbuildinfo` ];
  if (existing === undefined) return { label, status: "added", apply: () => updateJson(file, manifest => ({ ...manifest, files: wanted })) };
  if (!Array.isArray(existing)) return { label, status: "conflict", reason: "isn't an array", apply: () => updateJson(file, manifest => ({ ...manifest, files: wanted })) };
  // An allow-list the user extended (README assets, even src) keeps those entries; ours are only appended
  const present = new Set(existing);
  const missing = wanted.filter(entry => !present.has(entry));
  if (missing.length === 0) return { label, status: "unchanged" };
  return { label, status: "added", reason: `adds ${missing.join(", ")}`, apply: () => updateJson(file, manifest => ({ ...manifest, files: [ ...(Array.isArray(manifest.files) ? manifest.files : []), ...missing ] })) };
}

/**
 * What setup and --update manage for one workspace package: nothing for an application, a skip for a library in
 * bundler mode, otherwise its tsconfig emit options and publishing fields. `defaultOutDir` applies only when the
 * package's tsconfig has no `outDir` of its own.
 */
export function libraryExportItems(dir: string, defaultOutDir = "dist"): Array<PlanItem> {
  const manifestFile = path.join(dir, "package.json");
  const tsconfigFile = path.join(dir, "tsconfig.json");
  const kind = packageKind(dir);
  if (kind === "application") return [];
  if (kind === "bundler-library") return [{ label: `${manifestFile} › exports`, status: "skipped", reason: `library in bundler mode: ${BUNDLER_LIBRARY_REASON}` }];

  const manifest = readJson(manifestFile)!;
  const tsconfig = readJson(tsconfigFile);
  if (!tsconfig) return [{ label: tsconfigFile, status: "skipped", reason: "missing or not plain JSON; can't read its outDir" }];
  const options = isObject(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
  const outDir = normaliseDir(typeof options.outDir === "string" ? options.outDir : defaultOutDir);
  if (outDir === "." || outDir.startsWith("../") || outDir === ".." || path.posix.isAbsolute(outDir) || outDir === ROOT_DIR || outDir.startsWith(`${ROOT_DIR}/`)) {
    return [{ label: `${tsconfigFile} › compilerOptions.outDir`, status: "skipped", reason: `${outDir} must be a directory inside the package and outside ${ROOT_DIR}/` }];
  }
  const rootDir = normaliseDir(typeof options.rootDir === "string" ? options.rootDir : ROOT_DIR);

  const wanted = wantedExports(dir, manifest, rootDir, outDir, manifestFile);
  const root = wanted.exports["."];
  if (!root) return wanted.invalid;
  const field = (key: string, value: unknown) => () => updateJson(manifestFile, current => ({ ...current, [key]: value }));
  const exportsPlan = exportsItems(manifestFile, manifest.exports, wanted.exports);
  const scripts = isObject(manifest.scripts) ? manifest.scripts : {};

  return [
    ...tsconfigItems(tsconfigFile, options, outDir),
    // tsc emits ES modules for the NodeNext presets only when the package is type: module
    owned(`${manifestFile} › type`, manifest.type, "module", field("type", "module")),
    ...exportsPlan.items,
    ...wanted.invalid,
    // main/types are fallbacks for resolvers that ignore exports, so they follow our root export or stay out
    ...(exportsPlan.ownsRoot
      ? [
        owned(`${manifestFile} › main`, manifest.main, root.default, field("main", root.default)),
        owned(`${manifestFile} › types`, manifest.types, root.types, field("types", root.types)),
      ]
      : []),
    filesItem(manifestFile, manifest.files, outDir),
    owned(`${manifestFile} › scripts.build`, scripts.build, BUILD_SCRIPT, () => updateJson(manifestFile, current => ({
      ...current,
      scripts: { ...(isObject(current.scripts) ? current.scripts : {}), build: BUILD_SCRIPT },
    }))),
  ];
}

/**
 * Setup: writes the missing library fields of each linked package and keeps every value the user set. Fails when a
 * library sits in a bundler-mode workspace. Returns one summary line per library, for the task title.
 */
export function configureLibraryExports(dirs: ReadonlyArray<string>, defaultOutDir: string): Array<string> {
  const unsupported = dirs.filter(dir => packageKind(dir) === "bundler-library");
  if (unsupported.length > 0) {
    throw new Error(`Library packages ${unsupported.join(", ")} can't be published from a bundler-mode workspace: ${BUNDLER_LIBRARY_REASON}`);
  }
  return dirs.filter(dir => packageKind(dir) === "library").map(dir => {
    const items = libraryExportItems(dir, defaultOutDir);
    for (const item of items) if (item.status === "added") item.apply?.();
    const notes = items.filter(item => item.status !== "added" && item.status !== "unchanged")
      .map(item => `${item.status === "conflict" ? "kept your own" : item.status} ${item.label.replace(`${dir}/`, "")}${item.reason ? ` (${item.reason})` : ""}`);
    const result = items.some(item => item.status === "added") ? "updated" : "unchanged";
    return `${dir}: ${result}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`;
  });
}
