/**
 * The workspace: protocol policy for dependencies between packages of one pnpm workspace. A `workspace:` spec only
 * ever resolves to the local package (install fails instead of falling back to the registry), and `pnpm pack` /
 * `pnpm publish` turn it into a normal semver range. Setup applies this policy and --update reconciles it.
 */
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { manifestEntry } from "./update/reconcile.ts";
import type { PlanItem } from "./update/reconcile.ts";
import { DEPENDENCY_SECTIONS, internalDependencies, readWorkspacePackages, sectionEntries } from "./workspace-graph.ts";
import type { InternalDependency, WorkspacePackage } from "./workspace-graph.ts";

/**
 * What an internal dependency becomes: always the local package, and `^<local version>` once packed. Any existing
 * `workspace:` spec (`workspace:*`, `workspace:~`, `workspace:^1.2.0`…) is already compliant and kept.
 */
export const WORKSPACE_RANGE = "workspace:^";

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRS: Record<string, true> = { node_modules: true, dist: true };
// A string right after one of these is a module specifier: `from "x"` (import and export), `import "x"`,
// `import("x")`, `require("x")`. `obj.require("x")` reads as the word `obj.require`, so it doesn't count.
const SPECIFIER_AFTER: Record<string, true> = { "from": true, "import": true, "import(": true, "require(": true };
const WORD = /[\w$.]+/y;

/** The normalised spec, or why the existing one is left as is. */
function normalise(edge: InternalDependency): { reason: string; } | { spec: string; } {
  // `npm:<name>@<range>` aliasing a workspace package keeps its alias as `workspace:<name>@^`
  const alias = edge.spec.startsWith("npm:");
  const range = alias ? edge.spec.slice(`npm:${edge.to.name}@`.length) || "*" : edge.spec;
  const version = edge.to.manifest.version;
  if (semver.validRange(range) === null) return { reason: `${JSON.stringify(edge.spec)} isn't a version range; left as is` };
  if (typeof version !== "string" || semver.valid(version) === null) return { reason: `${edge.to.name} has no valid version; left as is` };
  if (!semver.satisfies(version, range, { includePrerelease: true })) {
    return { reason: `${JSON.stringify(edge.spec)} doesn't match the local ${edge.to.name}@${version}; left as is` };
  }
  return { spec: alias ? `workspace:${edge.to.name}@^` : WORKSPACE_RANGE };
}

function protocolItem(edge: InternalDependency): PlanItem {
  const file = path.join(edge.from.dir, "package.json");
  if (edge.spec.startsWith("workspace:")) return manifestEntry(file, edge.section, edge.name, edge.spec);
  const result = normalise(edge);
  if ("reason" in result) return { label: `${file} › ${edge.section}.${edge.name}`, status: "customized", reason: result.reason };
  // The spec being replaced counts as a known earlier value, so it's updated rather than a conflict
  const item = manifestEntry(file, edge.section, edge.name, result.spec, [ edge.spec ]);
  return { ...item, reason: `${JSON.stringify(edge.spec)} → ${JSON.stringify(result.spec)}` };
}

/** Source files of a package, skipping node_modules, dist, dot-directories and nested workspace packages. */
function sourceFiles(dir: string, packageDirs: ReadonlySet<string>): Array<string> {
  const files: Array<string> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!Object.hasOwn(SKIPPED_DIRS, entry.name) && !entry.name.startsWith(".") && !packageDirs.has(full)) files.push(...sourceFiles(full, packageDirs));
    }
    else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(full);
  }
  return files;
}

/** The index just past the string literal opening at `start`, honouring backslash escapes. */
function stringEnd(code: string, start: number): number {
  let index = start + 1;
  while (index < code.length && code[index] !== code[start]) index += code[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The index just past the comment at `start`, or `start` when no comment starts there. */
function commentEnd(code: string, start: number): number {
  const [ open, close ] = code.startsWith("//", start) ? [ "//", "\n" ] : [ "/*", "*/" ];
  if (!code.startsWith(open, start)) return start;
  const end = code.indexOf(close, start + 2);
  return end === -1 ? code.length : end + close.length;
}

/**
 * Every module specifier a source file imports, exports from, dynamically imports or requires. A small tokenizer
 * rather than a regex, so specifier-like text inside comments and other strings is never picked up.
 */
function importedSpecifiers(file: string): Array<string> {
  const code = fs.readFileSync(file, "utf8");
  const specifiers: Array<string> = [];
  let previous = "";
  let index = 0;
  while (index < code.length) {
    const char = code[index]!;
    const afterComment = commentEnd(code, index);
    WORD.lastIndex = index;
    const word = WORD.exec(code)?.[0];
    if (afterComment !== index) index = afterComment;
    else if (char === "\"" || char === "'" || char === "`") {
      const end = stringEnd(code, index);
      if (char !== "`" && Object.hasOwn(SPECIFIER_AFTER, previous)) specifiers.push(code.slice(index + 1, end - 1));
      previous = "";
      index = end;
    }
    else if (word) {
      previous = word;
      index += word.length;
    }
    else {
      if (char === "(" && (previous === "import" || previous === "require")) previous += "(";
      else if (char.trim() !== "") previous = char;
      index++;
    }
  }
  return specifiers;
}

/**
 * Imports of another workspace package that the importer declares in none of its dependency sections. A subpath
 * (`@scope/lib/utils`) counts as its package; relative, `#` subpath and `node:` imports never match a package name.
 */
function undeclaredImports(packages: ReadonlyArray<WorkspacePackage>, importers: ReadonlyArray<WorkspacePackage>, packageDirs: ReadonlySet<string>): Array<PlanItem> {
  const names = new Set(packages.map(pkg => pkg.name));
  const items: Array<PlanItem> = [];
  for (const importer of importers) {
    const declared = new Set(DEPENDENCY_SECTIONS.flatMap(section => sectionEntries(importer.manifest, section).map(([ name ]) => name)));
    const reported = new Set<string>();
    for (const file of sourceFiles(importer.dir, packageDirs)) {
      for (const specifier of importedSpecifiers(file)) {
        const [ first, second ] = specifier.split("/");
        const imported = first!.startsWith("@") ? `${first}/${second}` : first!;
        if (!names.has(imported) || imported === importer.name || declared.has(imported) || reported.has(imported)) continue;
        reported.add(imported);
        items.push({
          label: `${importer.name} imports ${imported} but doesn't declare it`,
          status: "customized",
          reason: `in ${file}; add it to ${importer.dir}/package.json as "${WORKSPACE_RANGE}"`,
        });
      }
    }
  }
  return items;
}

/**
 * The workspace: protocol plan for the packages in `managed` (setup and --update only touch linked packages);
 * `dirs` is every workspace package, so dependencies on unlinked ones still count as internal. A plain range the
 * local version satisfies is updated, any other spec is reported and left, and so is an undeclared import:
 * which section it belongs in is the package author's call.
 */
export function workspaceProtocolItems(dirs: ReadonlyArray<string>, managed: ReadonlyArray<string>): Array<PlanItem> {
  const { packages } = readWorkspacePackages(dirs);
  const managedDirs = new Set(managed);
  const importers = packages.filter(pkg => managedDirs.has(pkg.dir));
  return [
    ...internalDependencies(packages).filter(edge => managedDirs.has(edge.from.dir))
      .map(edge => protocolItem(edge)),
    ...undeclaredImports(packages, importers, new Set(dirs)),
  ];
}

/** Applies the plan during setup and returns the task title reporting it. */
export function enforceWorkspaceProtocol(dirs: ReadonlyArray<string>, managed: ReadonlyArray<string>): string {
  const items = workspaceProtocolItems(dirs, managed).filter(item => item.status !== "unchanged");
  for (const item of items) if (item.status === "updated") item.apply?.();
  if (items.length === 0) return "Internal dependencies use the workspace: protocol";
  const updated = items.filter(item => item.status === "updated").length;
  const lines = items.map(item => `${item.label}${item.reason ? ` (${item.reason})` : ""}`);
  return `Internal dependencies: ${updated} set to ${WORKSPACE_RANGE}, ${items.length - updated} to check\n  ${lines.join("\n  ")}`;
}
