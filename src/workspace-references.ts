/**
 * TypeScript project references for a pnpm workspace, derived from the dependencies between its packages, so
 * `tsc --build` checks and builds them incrementally, each dependency before its consumers.
 *
 * Policy (documented in the readme's workspace section):
 * - A package takes part when its tsconfig.json is plain JSON and extends the shared base. Build options
 *   (composite, outDir, tsBuildInfoFile; for no-emit presets noEmit: false + emitDeclarationOnly) are only
 *   added when the package's own compilerOptions lack them, so its overrides always win.
 * - References to a workspace package's directory are generated from dependencies: setup and --update add and
 *   remove them. Any other reference is the user's and is kept.
 * - Output goes to each package's outDir (default `dist/`), with the build info inside it; setup makes sure
 *   the root .gitignore ignores those locations.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PlanError } from "./update/reconcile.ts";
import type { PlanItem } from "./update/reconcile.ts";
import { DEPENDENCY_SECTIONS, discoverPackages, findCycles, internalDependencies, readWorkspaceGlobs, readWorkspacePackages, sectionEntries } from "./workspace-graph.ts";
import type { InternalDependency, WorkspacePackage } from "./workspace-graph.ts";

type JsonObject = Record<string, unknown>;

const BUILD_OUT_DIR = "dist";
// Same name the library exports layer writes, so a package gets one build info file whichever task runs first
const BUILD_INFO = ".tsbuildinfo";
// Bundler presets set noEmit, but a referenced project must emit at least its declarations (TS6310)
const NO_EMIT_PRESETS = "@gingacodemonkey/config/bundler/";
const SOLUTION = "tsconfig.json";
const GITIGNORE = ".gitignore";
const GITIGNORE_HEADER = "# TypeScript build output (tsc --build)";
const ERRORS_HEADER = "Can't generate TypeScript project references:\n  ";

type Member =
  | { kind: "built"; pkg: WorkspacePackage; tsconfig: JsonObject; }
  | { kind: "left out"; pkg: WorkspacePackage; reason: string; }
  | { kind: "untyped"; pkg: WorkspacePackage; };

/** One managed file and what it should hold. */
interface PlannedFile {
  changed: boolean;
  content: string;
  created: boolean;
  file: string;
  label: string;
}

export interface ReferencePlan {
  /** Packages in the root solution, by directory */
  built: Array<string>;
  /** Why the plan can't be applied: cycles, missing or invalid referenced packages */
  errors: Array<string>;
  files: Array<PlannedFile>;
  /** Packages left out of build mode, with the reason */
  notes: Array<string>;
}

interface IgnoreEntry {
  /** Lines that already ignore the location */
  equivalent: Array<string>;
  line: string;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(file: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(value) ? value : null;
  }
  catch {
    return null;
  }
}

function ownOptions(tsconfig: JsonObject): JsonObject {
  return isObject(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
}

function outDirOf(options: JsonObject): string {
  return path.posix.normalize(typeof options.outDir === "string" ? options.outDir : BUILD_OUT_DIR).replace(/\/$/, "");
}

function classify(pkg: WorkspacePackage, sharedDir: string): Member {
  const file = path.join(pkg.dir, "tsconfig.json");
  if (!fs.existsSync(file)) return { kind: "untyped", pkg };
  const tsconfig = readJsonObject(file);
  if (!tsconfig) return { kind: "left out", pkg, reason: "its tsconfig.json isn't plain JSON (comments or trailing commas?)" };
  const base = `${path.posix.relative(pkg.dir, sharedDir)}/tsconfig.base.json`;
  if (![ tsconfig.extends ].flat().includes(base)) {
    return { kind: "left out", pkg, reason: `its tsconfig.json doesn't extend ${base}; link it with --tool=workspace --workspace-update-all` };
  }
  if (tsconfig.compilerOptions !== undefined && !isObject(tsconfig.compilerOptions)) return { kind: "left out", pkg, reason: "its compilerOptions isn't an object" };
  const options = ownOptions(tsconfig);
  if (options.composite === false) return { kind: "left out", pkg, reason: "its tsconfig.json sets composite: false" };
  if (options.noEmit === true) return { kind: "left out", pkg, reason: "its tsconfig.json sets noEmit: true, and a referenced project must emit declarations" };
  if (outDirOf(options) === ".") return { kind: "left out", pkg, reason: "its outDir is the package directory itself, which can't be git-ignored" };
  return { kind: "built", pkg, tsconfig };
}

/** The shared base extends a preset (or sets noEmit itself) that emits nothing, so packages emit declarations only. */
function emitsNothing(sharedDir: string): boolean {
  const base = readJsonObject(path.join(sharedDir, "tsconfig.base.json")) ?? {};
  const presets = [ base.extends ].flat();
  return presets.some(preset => typeof preset === "string" && preset.startsWith(NO_EMIT_PRESETS)) || ownOptions(base).noEmit === true;
}

/** The package's compilerOptions plus every build option it doesn't set itself; `outDir` is the default output. */
function withBuildOptions(own: JsonObject, declarationsOnly: boolean, outDir: string): JsonObject {
  const wanted: JsonObject = {
    composite: true,
    outDir,
    // The presets' own tsBuildInfoFile resolves inside node_modules/@gingacodemonkey/config, shared by every package
    tsBuildInfoFile: path.posix.join(outDirOf({ outDir, ...own }), BUILD_INFO),
    ...(declarationsOnly ? { noEmit: false, emitDeclarationOnly: true } : {}),
  };
  return { ...own, ...Object.fromEntries(Object.entries(wanted).filter(([ key ]) => own[key] === undefined)) };
}

/** Where a reference points, relative to the workspace root: the directory, or the config file it names. */
function referencePath(from: string, reference: unknown): string | undefined {
  if (!isObject(reference) || typeof reference.path !== "string" || path.posix.isAbsolute(reference.path)) return undefined;
  return path.posix.normalize(path.posix.join(from, reference.path)).replace(/\/$/, "");
}

function referenceDir(target: string): string {
  return target.endsWith(".json") ? path.posix.dirname(target) : target;
}

/**
 * `existing` with its references to workspace packages replaced by `wanted` (directories relative to the root).
 * An entry already pointing at a wanted package keeps its place and form; other entries for workspace packages
 * are dropped, so each package is referenced once. Any other reference is the user's and is kept.
 */
function mergeReferences(from: string, existing: Array<unknown>, wanted: Array<string>, packageDirs: ReadonlySet<string>): Array<unknown> {
  const pending = new Set(wanted);
  const kept = existing.filter(reference => {
    const target = referencePath(from, reference);
    if (target === undefined || !packageDirs.has(referenceDir(target))) return true;
    return pending.delete(referenceDir(target));
  });
  const added = [ ...pending ].toSorted((a, b) => a.localeCompare(b))
    .map(dir => ({ path: path.posix.relative(from, dir) }));
  return [ ...kept, ...added ];
}

/** The user's own references that point at nothing, as errors. */
function brokenReferences(from: string, references: Array<unknown>, packageDirs: ReadonlySet<string>): Array<string> {
  return references.flatMap(reference => {
    const target = referencePath(from, reference);
    if (target === undefined || packageDirs.has(referenceDir(target))) return [];
    const config = target.endsWith(".json") ? target : path.posix.join(target, "tsconfig.json");
    if (fs.existsSync(config)) return [];
    const label = path.posix.join(from, "tsconfig.json");
    return [ `${label} references ${String((reference as JsonObject).path)}, but ${config} doesn't exist; fix or remove that reference` ];
  });
}

function existingReferences(file: string, tsconfig: JsonObject, errors: Array<string>): Array<unknown> {
  if (tsconfig.references === undefined) return [];
  if (Array.isArray(tsconfig.references)) return tsconfig.references;
  errors.push(`${file}: references isn't an array; fix it so the generated references can be added`);
  return [];
}

/** `tsconfig` with `references` set, or removed when there are none. */
function withReferences(tsconfig: JsonObject, references: Array<unknown>): JsonObject {
  const rest = { ...tsconfig };
  delete rest.references;
  return references.length > 0 ? { ...rest, references } : rest;
}

function plannedJson(file: string, label: string, current: JsonObject | undefined, next: JsonObject): PlannedFile {
  return { file, label, content: JSON.stringify(next, null, 2) + "\n", created: current === undefined, changed: !isDeepStrictEqual(current, next) };
}

/** A gitignore line for an output location, relative to the package `dir`. */
function ignoreEntry(dir: string, location: string, isDir: boolean): IgnoreEntry {
  const clean = path.posix.normalize(location).replace(/\/$/, "");
  const slash = isDir ? "/" : "";
  // A bare name (dist) is ignored at any depth; anything with a slash is anchored to the root
  if (isDir && !clean.includes("/") && clean !== "..") {
    return { line: `${clean}/`, equivalent: [ clean, `${clean}/`, `**/${clean}`, `**/${clean}/` ] };
  }
  const rooted = `/${path.posix.join(dir, clean)}`;
  return { line: `${rooted}${slash}`, equivalent: [ rooted, `${rooted}/` ] };
}

function outputEntries(dir: string, options: JsonObject): Array<IgnoreEntry> {
  const outDir = outDirOf(options);
  const entries = [ ignoreEntry(dir, outDir, true) ];
  if (typeof options.tsBuildInfoFile === "string" && !path.posix.normalize(options.tsBuildInfoFile).startsWith(`${outDir}/`)) {
    entries.push(ignoreEntry(dir, options.tsBuildInfoFile, false));
  }
  return entries;
}

function plannedGitignore(entries: Array<IgnoreEntry>): PlannedFile | undefined {
  if (entries.length === 0) return undefined;
  const current = fs.existsSync(GITIGNORE) ? fs.readFileSync(GITIGNORE, "utf8") : undefined;
  const present = new Set((current ?? "").split("\n").map(line => line.trim()));
  const missing = [ ...new Set(entries.filter(entry => !entry.equivalent.some(line => present.has(line))).map(entry => entry.line)) ];
  let content = current ?? "";
  if (missing.length > 0) {
    // A blank line before our block, unless the file is empty
    let separator = "";
    if (content !== "") separator = content.endsWith("\n") ? "\n" : "\n\n";
    content = `${content}${separator}${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
  }
  return { file: GITIGNORE, label: `${GITIGNORE} › tsc --build output`, content, created: current === undefined, changed: missing.length > 0 };
}

/** `workspace:` dependencies of `pkg` that no workspace package provides. */
function missingWorkspaceDependencies(pkg: WorkspacePackage, names: ReadonlySet<string>): Array<string> {
  return DEPENDENCY_SECTIONS.flatMap(section => sectionEntries(pkg.manifest, section).flatMap(([ name, spec ]) => {
    // `workspace:<name>@<range>` aliases another workspace package
    const target = /^workspace:((?:@[^@/]+\/)?[^@]+)@/.exec(spec)?.[1] ?? name;
    if (!spec.startsWith("workspace:") || names.has(target)) return [];
    return [ `${pkg.dir} depends on ${name} (${section}: "${spec}"), but no workspace package is named ${target}; add that package or remove the dependency` ];
  }));
}

function dependencyErrors(members: Map<WorkspacePackage, Member>, edges: Array<InternalDependency>, packages: Array<WorkspacePackage>): Array<string> {
  const errors: Array<string> = [];
  for (const { from, to } of edges) {
    const target = members.get(to)!;
    if (target.kind === "left out") errors.push(`${from.dir} depends on ${to.name}, but ${to.dir} can't take part in tsc --build: ${target.reason}`);
  }
  const names = new Set(packages.map(pkg => pkg.name));
  for (const member of members.values()) {
    if (member.kind === "built") errors.push(...missingWorkspaceDependencies(member.pkg, names));
  }
  const dirs = new Map(packages.map(pkg => [ pkg.name, pkg.dir ]));
  for (const cycle of findCycles(edges.filter(edge => members.get(edge.to)?.kind === "built"))) {
    errors.push(`Dependency cycle between ${cycle.map(name => `${name} (${dirs.get(name)})`).join(", ")}: tsc --build needs each package built before its consumers, so remove one of these dependencies`);
  }
  return errors;
}

/**
 * What setup and --update write for project references: each taking-part package's tsconfig (build options and
 * references to the packages it depends on), the root solution tsconfig.json and the root .gitignore. Nothing
 * is written here; `errors` lists what has to be fixed first.
 */
export function planReferences(sharedDir: string, outDir = BUILD_OUT_DIR): ReferencePlan {
  const { packages, unreadable } = readWorkspacePackages(discoverPackages(readWorkspaceGlobs() ?? []));
  const members = new Map(packages.map(pkg => [ pkg, classify(pkg, sharedDir) ]));
  const built = [ ...members.values() ].filter((member): member is Extract<Member, { kind: "built"; }> => member.kind === "built");
  const builtDirs = built.map(member => member.pkg.dir);
  const packageDirs = new Set([ ...packages.map(pkg => pkg.dir), ...unreadable.map(pkg => pkg.dir) ]);
  const edges = internalDependencies(packages).filter(edge => members.get(edge.from)!.kind === "built" && members.get(edge.to)!.kind !== "untyped");

  const notes = [
    ...unreadable.map(({ dir, reason }) => `${dir}: left out of tsc --build (${reason})`),
    ...[ ...members.values() ].flatMap(member => (member.kind === "left out" ? [ `${member.pkg.dir}: left out of tsc --build (${member.reason})` ] : [])),
  ];
  const errors = dependencyErrors(members, edges, packages);
  const declarationsOnly = emitsNothing(sharedDir);
  const files: Array<PlannedFile> = [];
  const ignored: Array<IgnoreEntry> = [];

  for (const { pkg, tsconfig } of built) {
    const file = path.posix.join(pkg.dir, "tsconfig.json");
    const existing = existingReferences(file, tsconfig, errors);
    errors.push(...brokenReferences(pkg.dir, existing, packageDirs));
    const wanted = edges.filter(edge => edge.from === pkg && members.get(edge.to)!.kind === "built").map(edge => edge.to.dir);
    const compilerOptions = withBuildOptions(ownOptions(tsconfig), declarationsOnly, outDir);
    ignored.push(...outputEntries(pkg.dir, compilerOptions));
    const next = withReferences({ ...tsconfig, compilerOptions }, mergeReferences(pkg.dir, existing, wanted, packageDirs));
    files.push(plannedJson(file, `${file} › project references`, tsconfig, next));
  }

  // The root solution: written once a package takes part, and kept in sync after that
  const solutionExists = fs.existsSync(SOLUTION);
  if (built.length > 0 || solutionExists) {
    const solution = solutionExists ? readJsonObject(SOLUTION) : {};
    if (solution) {
      const existing = existingReferences(SOLUTION, solution, errors);
      errors.push(...brokenReferences(".", existing, packageDirs));
      // Without files or include, the solution would compile every .ts file below the root itself
      const scope = solution.files === undefined && solution.include === undefined ? { files: [] } : {};
      const next = withReferences({ ...solution, ...scope }, mergeReferences(".", existing, builtDirs, packageDirs));
      files.push(plannedJson(SOLUTION, `${SOLUTION} › project references`, solutionExists ? solution : undefined, next));
    }
    else errors.push(`${SOLUTION} at the workspace root isn't plain JSON; fix it, or delete it so setup can write the solution config`);
  }
  const gitignore = plannedGitignore(ignored);
  if (gitignore) files.push(gitignore);

  return { built: builtDirs, errors, files, notes };
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Setup: writes the planned files and returns a summary for the task title. Throws, writing nothing, on errors.
 * `outDir` (--ts-outdir) is the output directory for packages that don't set their own.
 */
export function syncReferences(sharedDir: string, outDir = BUILD_OUT_DIR): string {
  const plan = planReferences(sharedDir, outDir);
  if (plan.errors.length > 0) throw new Error(ERRORS_HEADER + plan.errors.join("\n  "));
  const changed = plan.files.filter(file => file.changed);
  for (const file of changed) writeFile(file.file, file.content);
  const summary = plan.built.length === 0
    ? "Project references: no package extends the shared tsconfig, so none are generated"
    : `Project references: ${plan.built.length} packages in ${SOLUTION} for tsc --build; ${changed.length} files updated`;
  return [ summary, ...plan.notes ].join("\n  ");
}

/** --update: one plan item per managed file. Errors stop the update before anything is written. */
export function referenceItems(sharedDir: string): Array<PlanItem> {
  const plan = planReferences(sharedDir);
  if (plan.errors.length > 0) throw new PlanError(ERRORS_HEADER + plan.errors.join("\n  "));
  return plan.files.map(file => {
    if (!file.changed) return { label: file.label, status: "unchanged" };
    return { label: file.label, status: file.created ? "added" : "updated", apply: () => writeFile(file.file, file.content) };
  });
}
