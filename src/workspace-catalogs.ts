/**
 * pnpm catalogs: one root-owned range per external dependency, in pnpm-workspace.yaml, that manifests use with
 * `catalog:`. A new workspace keeps its shared toolchain there; an existing one can move versions it repeats.
 * pnpm swaps `catalog:` for the catalog's range when it packs or publishes, so consumers see ordinary ranges.
 *
 * Eligibility (see readme.md, "Catalogs"):
 * - only registry ranges (`^1.2.3`, `~1.2`, `1.x`, `>=1 <2`) move; protocols (`workspace:`, `file:`, `link:`,
 *   `npm:` aliases, git and tarball URLs), `owner/repo` shorthands and dist-tags are left as declared,
 * - a dependency on another workspace package never moves, whatever its spec,
 * - peerDependencies never move: a peer range is a promise to consumers, often wider than what's installed,
 * - a range moves when it's identical in every manifest that declares it and at least two manifests use it (or the
 *   default catalog already holds that exact range). Differing ranges, including one that differs from the
 *   catalog's, are reported and kept until the user picks one.
 * Existing catalogs, named catalogs and every other pnpm-workspace.yaml setting are kept; only entries are added.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask, ListrTaskWrapper } from "listr2";
import YAML from "yaml";
import type { CliArgs, PackageCollector, TaskContext } from "./cli-args.ts";
import type { YES_ANY_IS_OK_HERE } from "./types.ts";
import type { PlanItem } from "./update/reconcile.ts";
import { getPackageJson } from "./utils.ts";
import { DEPENDENCY_SECTIONS, discoverPackages, readWorkspaceGlobs, readWorkspacePackages, sectionEntries } from "./workspace-graph.ts";
import type { DependencySection } from "./workspace-graph.ts";

type CatalogTask = ListrTaskWrapper<TaskContext, YES_ANY_IS_OK_HERE, YES_ANY_IS_OK_HERE>;
type JsonObject = Record<string, unknown>;
type Catalog = Record<string, string>;

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const ROOT_MANIFEST = "package.json";
const CATALOG_REF = "catalog:";
const DEFAULT_CATALOG = "default";

const MOVABLE_SECTIONS = DEPENDENCY_SECTIONS.filter(section => section !== "peerDependencies");

// This package is pinned to the CLI release that wrote sharedConfig/ and only ever installed at the root
const OUTSIDE_TOOLCHAIN_CATALOG = new Set([ "@gingacodemonkey/config" ]);

/** One dependency as a manifest declares it. `dir` is the package directory, `.` for the root. */
export interface Declaration {
  dir: string;
  name: string;
  section: DependencySection;
  spec: string;
}

/** A dependency whose range moves into the default catalog. `resolved`: the range is the user's pick between differing ones. */
export interface CatalogMove {
  consumers: Array<Declaration>;
  name: string;
  resolved: boolean;
  spec: string;
}

/** A dependency declared with different ranges; `ranges` maps each range to where it's declared. */
export interface CatalogConflict {
  name: string;
  ranges: Array<{ range: string; where: Array<string>; }>;
}

export interface CatalogPlan {
  conflicts: Array<CatalogConflict>;
  moves: Array<CatalogMove>;
}

/** The `--workspace-catalog*` choices: move identical repeated ranges, and the range picked for differing ones. */
export type CatalogFlags = Pick<CliArgs, "workspaceCatalog" | "workspaceCatalogResolve">;

/**
 * A registry version or range. Not protocols (`workspace:`, `catalog:`, `file:`, `link:`, `npm:`, git/tarball
 * URLs), `owner/repo` shorthands or dist-tags such as `latest`.
 */
export function isRegistryRange(spec: string): boolean {
  return !/[:/]/.test(spec) && /^\s*(?:[\d<=>^~*]|v\d|[xX](?:\.|$))/.test(spec);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readWorkspaceDocument(): YAML.Document {
  return YAML.parseDocument(fs.existsSync(WORKSPACE_FILE) ? fs.readFileSync(WORKSPACE_FILE, "utf8") : "");
}

/** Every catalog the workspace defines by name. pnpm's default catalog is `catalog:` or, the same thing, `catalogs.default`. */
function readCatalogs(doc: YAML.Document): Record<string, Catalog> {
  const value: unknown = doc.toJS();
  const workspace = isObject(value) ? value : {};
  const catalogs: Record<string, Catalog> = {};
  for (const [ name, entries ] of Object.entries(isObject(workspace.catalogs) ? workspace.catalogs : {})) {
    if (isObject(entries)) catalogs[name] = entries as Catalog;
  }
  if (isObject(workspace.catalog)) catalogs[DEFAULT_CATALOG] = workspace.catalog as Catalog;
  return catalogs;
}

/** Sets default-catalog entries in pnpm-workspace.yaml, keeping its comments and every other key. */
function writeCatalogEntries(entries: ReadonlyArray<readonly [string, string]>): void {
  const doc = readWorkspaceDocument();
  const base = doc.hasIn([ "catalogs", DEFAULT_CATALOG ]) ? [ "catalogs", DEFAULT_CATALOG ] : [ "catalog" ];
  const changed = entries.filter(([ name, spec ]) => doc.getIn([ ...base, name ]) !== spec);
  for (const [ name, spec ] of changed) doc.setIn([ ...base, name ], spec);
  if (changed.length > 0) fs.writeFileSync(WORKSPACE_FILE, doc.toString({ lineWidth: 0 }));
}

/** Replaces the given declarations of one manifest with `catalog:`, keeping its sections, key order and indentation. */
function setCatalogRefs(dir: string, refs: ReadonlyArray<Pick<Declaration, "name" | "section">>): void {
  const file = path.join(dir, ROOT_MANIFEST);
  const text = fs.readFileSync(file, "utf8");
  const manifest = JSON.parse(text) as Record<string, Record<string, string>>;
  for (const { name, section } of refs) manifest[section]![name] = CATALOG_REF;
  const indent = /^\{\r?\n([ \t]+)/.exec(text)?.[1] ?? "  ";
  fs.writeFileSync(file, JSON.stringify(manifest, null, indent) + (text.endsWith("\n") ? "\n" : ""));
  // Later setup tasks write the root manifest from utils' cached copy; keep it in step so they don't undo this
  if (dir === ".") Object.assign(getPackageJson(), manifest);
}

function readRootManifest(): JsonObject | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(ROOT_MANIFEST, "utf8"));
    return isObject(value) ? value : null;
  }
  catch {
    return null;
  }
}

/** The root and every readable workspace package, plus the names that are internal to the workspace. */
function workspaceManifests(): { internal: Set<string>; manifests: Array<{ dir: string; manifest: JsonObject; }>; } {
  const { packages } = readWorkspacePackages(discoverPackages(readWorkspaceGlobs() ?? []));
  const root = readRootManifest();
  const internal = new Set(packages.map(pkg => pkg.name));
  if (typeof root?.name === "string") internal.add(root.name);
  return { internal, manifests: [ ...(root ? [{ dir: ".", manifest: root }] : []), ...packages ] };
}

/** How reports name a manifest's directory. */
function placeName(dir: string): string {
  return dir === "." ? "root" : dir;
}

/**
 * External registry-range declarations in the sections that can move, by dependency, and the manifests that already
 * refer to the default catalog for each.
 */
function collectDeclarations(): { literals: Map<string, Array<Declaration>>; references: Map<string, Set<string>>; } {
  const { internal, manifests } = workspaceManifests();
  const literals = new Map<string, Array<Declaration>>();
  const references = new Map<string, Set<string>>();
  for (const { dir, manifest } of manifests) {
    for (const section of MOVABLE_SECTIONS) {
      for (const [ name, spec ] of sectionEntries(manifest, section)) {
        if (internal.has(name)) continue;
        if (spec === CATALOG_REF) references.set(name, (references.get(name) ?? new Set()).add(dir));
        else if (isRegistryRange(spec)) literals.set(name, [ ...(literals.get(name) ?? []), { dir, name, section, spec }]);
      }
    }
  }
  return { literals, references };
}

/** The moves and conflicts for the workspace as it is on disk. `resolutions` are the ranges the user picked. */
export function planCatalog(resolutions: ReadonlyMap<string, string>): CatalogPlan {
  const catalog = readCatalogs(readWorkspaceDocument())[DEFAULT_CATALOG] ?? {};
  const { literals, references } = collectDeclarations();
  const plan: CatalogPlan = { conflicts: [], moves: [] };

  for (const [ name, consumers ] of [ ...literals ].toSorted(([ a ], [ b ]) => a.localeCompare(b))) {
    const picked = resolutions.get(name);
    if (picked !== undefined) {
      plan.moves.push({ name, spec: picked, consumers, resolved: true });
      continue;
    }
    // Range → where it's declared; the catalog's own entry counts as one of the ranges
    const ranges = new Map<string, Array<string>>(catalog[name] === undefined ? [] : [[ catalog[name], [ WORKSPACE_FILE ]]]);
    for (const { dir, spec } of consumers) ranges.set(spec, [ ...new Set([ ...(ranges.get(spec) ?? []), placeName(dir) ]) ]);

    const used = new Set([ ...consumers.map(consumer => consumer.dir), ...(references.get(name) ?? []) ]).size;
    if (ranges.size > 1) plan.conflicts.push({ name, ranges: [ ...ranges ].map(([ range, places ]) => ({ range, where: places })) });
    else if (used >= 2 || catalog[name] !== undefined) plan.moves.push({ name, spec: consumers[0]!.spec, consumers, resolved: false });
  }
  return plan;
}

/** Writes each move's range to the default catalog and points its consumers at it. */
export function applyCatalogMoves(moves: ReadonlyArray<CatalogMove>): void {
  writeCatalogEntries(moves.map(move => [ move.name, move.spec ] as const));
  const byDir = new Map<string, Array<Declaration>>();
  for (const consumer of moves.flatMap(move => move.consumers)) byDir.set(consumer.dir, [ ...(byDir.get(consumer.dir) ?? []), consumer ]);
  for (const [ dir, refs ] of byDir) setCatalogRefs(dir, refs);
}

/**
 * A new workspace keeps its shared toolchain (typescript, @types/node, eslint, jiti) in the default catalog. A
 * dependency the root already declares keeps its range and section and refers to the catalog; one setup is about
 * to install is queued as `<name>@catalog:`, so `pnpm add` writes the reference. A catalog entry already there is
 * kept, and a non-registry spec (say `file:`) is left alone. Returns the names now in the catalog, and whether the
 * root manifest was rewritten.
 */
function catalogToolchain(toolchain: ReadonlyArray<readonly [string, string]>, packages: PackageCollector): { names: Array<string>; rewrote: boolean; } {
  const catalog = readCatalogs(readWorkspaceDocument())[DEFAULT_CATALOG] ?? {};
  const root = getPackageJson() as JsonObject;
  const entries: Array<readonly [string, string]> = [];
  const refs: Array<Pick<Declaration, "name" | "section">> = [];
  const names: Array<string> = [];

  for (const [ name, version ] of toolchain.filter(([ name ]) => !OUTSIDE_TOOLCHAIN_CATALOG.has(name))) {
    const declared = MOVABLE_SECTIONS.flatMap(section => sectionEntries(root, section).filter(([ dep ]) => dep === name)
      .map(([ , spec ]) => ({ section, spec })))[0];
    const literal = declared?.spec === CATALOG_REF ? undefined : declared;
    if (literal && !isRegistryRange(literal.spec)) continue;

    if (catalog[name] === undefined) entries.push([ name, literal?.spec ?? version ]);
    if (literal) refs.push({ name, section: literal.section });
    if (!declared && packages.packages.delete(`${name}@${version}`)) packages.add(`${name}@${CATALOG_REF}`);
    names.push(name);
  }
  writeCatalogEntries(entries);
  if (refs.length > 0) setCatalogRefs(".", refs);
  return { names, rewrote: refs.length > 0 };
}

function describeConflict(conflict: CatalogConflict): string {
  return `${conflict.name} (${conflict.ranges.map(({ range, where: places }) => `${range} in ${places.join(", ")}`).join("; ")})`;
}

function describeMove(move: CatalogMove): string {
  return `${move.name}@${move.spec}`;
}

export type CatalogPrompts = {
  /** The range to catalog a dependency at whose manifests disagree, or null to keep them as declared. */
  chooseRange: (task: CatalogTask, conflict: CatalogConflict) => Promise<null | string>;
  /** Whether to move the identical repeated ranges into the catalog. */
  confirmMoves: (task: CatalogTask, moves: ReadonlyArray<CatalogMove>) => Promise<boolean>;
};

const KEEP = "keep";

export const promptCatalog: CatalogPrompts = {
  chooseRange: async (task, conflict) => {
    const answer = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
      type: "select",
      name: "range",
      message: `${conflict.name} has different ranges. Catalog it at one of them, or keep each as declared?`,
      choices: [
        { name: KEEP, message: "Keep them as they are" },
        ...conflict.ranges.map(({ range, where: places }) => ({ name: range, message: `${range} (${places.join(", ")})` })),
      ],
    });
    return answer === KEEP ? null : answer;
  },
  confirmMoves: async (task, moves) => task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
    type: "confirm",
    name: "catalog",
    message: `Move ${moves.length} repeated versions (${moves.map(describeMove).join(", ")}) into the pnpm catalog?`,
    initial: true,
  }),
};

/** Asks about each conflict in turn and returns the ranges picked, on top of the ones passed as flags. */
async function chooseRanges(task: CatalogTask, conflicts: ReadonlyArray<CatalogConflict>, prompts: CatalogPrompts, picked: Map<string, string>): Promise<Map<string, string>> {
  for (const conflict of conflicts) {
    // One question at a time, in order
    // eslint-disable-next-line no-await-in-loop
    const range = await prompts.chooseRange(task, conflict);
    if (range !== null) picked.set(conflict.name, range);
  }
  return picked;
}

/**
 * Brings pnpm-lock.yaml in line with manifests whose specs became `catalog:`. The `pnpm add` at the end of setup
 * only re-resolves what it adds, so without this the lockfile keeps the old specifiers and a frozen install fails.
 */
function refreshLockfile(): void {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFileSync("pnpm", [ "install", "--no-frozen-lockfile" ], { stdio: "pipe", encoding: "utf8" });
  }
  catch (error: unknown) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
    throw new Error(`pnpm install failed after moving versions into the catalog\n${stdout.trim().slice(-2000)}`);
  }
}

/**
 * The setup task. `isNewWorkspace` is read when the task runs, after the globs are written. `prompts` is null for
 * non-interactive runs: repeated ranges then move only with `--workspace-catalog`, and differing ones only with
 * `--workspace-catalog-resolve`.
 */
export function createCatalogTask(cliArgs: CatalogFlags, toolchain: ReadonlyArray<readonly [string, string]>, isNewWorkspace: () => boolean, prompts: CatalogPrompts | null): ListrTask<TaskContext> {
  return {
    title: "Centralizing shared dependency versions in the pnpm catalog",
    task: async (ctx, task) => {
      const lines: Array<string> = [];
      let rewrote = false;
      if (isNewWorkspace()) {
        const toolchainResult = catalogToolchain(toolchain, ctx.packages);
        rewrote = toolchainResult.rewrote;
        if (toolchainResult.names.length > 0) lines.push(`toolchain: ${toolchainResult.names.join(", ")}`);
      }

      const plan = planCatalog(cliArgs.workspaceCatalogResolve);
      const repeated = plan.moves.filter(move => !move.resolved);
      const migrate = cliArgs.workspaceCatalog || (prompts !== null && repeated.length > 0 && await prompts.confirmMoves(task, repeated));
      const picked = prompts ? await chooseRanges(task, plan.conflicts, prompts, new Map(cliArgs.workspaceCatalogResolve)) : cliArgs.workspaceCatalogResolve;
      const final = picked.size > cliArgs.workspaceCatalogResolve.size ? planCatalog(picked) : plan;

      const moves = final.moves.filter(move => move.resolved || migrate);
      applyCatalogMoves(moves);
      if (moves.length > 0) lines.push(`moved ${moves.map(describeMove).join(", ")}`);
      if (!migrate && repeated.length > 0) lines.push(`not moved ${repeated.map(describeMove).join(", ")} (rerun with --workspace-catalog)`);
      if (final.conflicts.length > 0) lines.push(`kept differing ranges for ${final.conflicts.map(describeConflict).join(", ")} (pick one with --workspace-catalog-resolve=<name>@<range>)`);
      if ((rewrote || moves.length > 0) && fs.existsSync("pnpm-lock.yaml")) {
        refreshLockfile();
        lines.push("pnpm-lock.yaml updated");
      }

      task.title = lines.length > 0 ? `Catalog:\n  ${lines.join("\n  ")}` : "Catalog: nothing to centralize";
    },
  };
}

/** Each `catalog:`/`catalog:<name>` reference in any section, keyed by catalog and dependency, with where it's used. */
function catalogReferences(): Map<string, { catalog: string; dirs: Array<string>; name: string; }> {
  const references = new Map<string, { catalog: string; dirs: Array<string>; name: string; }>();
  for (const { dir, manifest } of workspaceManifests().manifests) {
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [ name, spec ] of sectionEntries(manifest, section)) {
        if (!spec.startsWith(CATALOG_REF)) continue;
        const catalog = spec.slice(CATALOG_REF.length) || DEFAULT_CATALOG;
        const key = `${catalog}\0${name}`;
        const entry = references.get(key) ?? { catalog, name, dirs: [] };
        if (!entry.dirs.includes(placeName(dir))) entry.dirs.push(placeName(dir));
        references.set(key, entry);
      }
    }
  }
  return references;
}

function catalogLabel(catalog: string, name: string): string {
  return `${WORKSPACE_FILE} › ${catalog === DEFAULT_CATALOG ? "catalog" : `catalogs.${catalog}`}.${name}`;
}

/**
 * `--update` items. A move is written only with `--workspace-catalog` (or a `--workspace-catalog-resolve` pick),
 * and otherwise reported as skipped; differing ranges are reported and kept. Each catalog reference must resolve:
 * a missing toolchain entry is added with this release's range, any other missing entry is reported.
 */
export function catalogItems(toolchain: ReadonlyArray<readonly [string, string]>, flags: CatalogFlags): Array<PlanItem> {
  const plan = planCatalog(flags.workspaceCatalogResolve);
  const items: Array<PlanItem> = [];

  for (const move of plan.moves) {
    const places = [ ...new Set(move.consumers.map(consumer => placeName(consumer.dir))) ].join(", ");
    items.push(move.resolved || flags.workspaceCatalog
      ? { label: catalogLabel(DEFAULT_CATALOG, move.name), status: "updated", reason: `moved ${move.spec} from ${places}`, apply: () => applyCatalogMoves([ move ]) }
      : { label: catalogLabel(DEFAULT_CATALOG, move.name), status: "skipped", reason: `${move.spec} repeated in ${places}; move it with --workspace-catalog` });
  }
  for (const conflict of plan.conflicts) {
    items.push({
      label: catalogLabel(DEFAULT_CATALOG, conflict.name),
      status: "customized",
      reason: `differing ranges kept: ${describeConflict(conflict)}; pick one with --workspace-catalog-resolve=${conflict.name}@<range>`,
    });
  }

  const catalogs = readCatalogs(readWorkspaceDocument());
  const defaults = new Map(toolchain);
  const planned = new Set([ ...plan.moves, ...plan.conflicts ].map(entry => entry.name));
  for (const { catalog, dirs, name } of catalogReferences().values()) {
    const label = catalogLabel(catalog, name);
    if (catalog === DEFAULT_CATALOG && planned.has(name)) continue;
    const version = defaults.get(name);
    if (catalogs[catalog]?.[name] !== undefined) items.push({ label, status: "unchanged" });
    else if (catalog === DEFAULT_CATALOG && version !== undefined) items.push({ label, status: "added", apply: () => writeCatalogEntries([[ name, version ]]) });
    else items.push({ label, status: "skipped", reason: `missing; referenced from ${dirs.join(", ")}; add a range for it` });
  }
  return items;
}
