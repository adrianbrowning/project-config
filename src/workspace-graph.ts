/**
 * The packages in a pnpm workspace and the dependency edges between them. Setup, --update and the shared
 * ESLint config all derive workspace policy (workspace: protocol, project references, boundaries, catalogs) from this.
 */
import fs from "node:fs";
import path from "node:path";

export const DEPENDENCY_SECTIONS = [ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" ] as const;
export type DependencySection = typeof DEPENDENCY_SECTIONS[number];

type JsonObject = Record<string, unknown>;

export interface WorkspacePackage {
  /** Relative to the workspace root, `/`-separated (as returned by `discoverPackages`) */
  dir: string;
  manifest: JsonObject;
  name: string;
}

export interface UnreadablePackage {
  dir: string;
  reason: string;
}

export interface InternalDependency {
  from: WorkspacePackage;
  section: DependencySection;
  /** The spec as declared, e.g. `workspace:^` or `^1.0.0` */
  spec: string;
  to: WorkspacePackage;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Package globs from `<root>/pnpm-workspace.yaml`, or null when it's missing or has no `packages` key. */
export function readWorkspaceGlobs(root = "."): Array<string> | null {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n");
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

/**
 * Package directories matched by the workspace globs, honouring `!` exclusions. The globs and the returned dirs
 * (`/`-separated) are relative to `root`.
 */
export function discoverPackages(globs: Array<string>, root = "."): Array<string> {
  const normalise = (glob: string) => {
    const normalised = path.posix.normalize(glob);
    return normalised.endsWith("/") ? normalised.slice(0, -1) : normalised;
  };
  const include = globs.filter(glob => !glob.startsWith("!")).map(normalise);
  const exclude = globs.filter(glob => glob.startsWith("!")).map(glob => normalise(glob.slice(1)));
  if (include.length === 0) return [];

  return [ ...new Set(fs.globSync(include, { cwd: root }).map(match => match.split(path.sep).join("/"))) ]
    .filter(dir => dir !== "." && !/(?:^|\/)node_modules(?:\/|$)/.test(dir))
    .filter(dir => fs.existsSync(path.join(root, dir, "package.json")))
    .filter(dir => !exclude.some(glob => path.matchesGlob(dir, glob)))
    .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Reads each package directory's manifest. A package without valid JSON or a `name` can't take part in
 * dependency edges, so it's returned in `unreadable` with the reason instead of failing the whole workspace.
 */
export function readWorkspacePackages(dirs: ReadonlyArray<string>): { packages: Array<WorkspacePackage>; unreadable: Array<UnreadablePackage>; } {
  const packages: Array<WorkspacePackage> = [];
  const unreadable: Array<UnreadablePackage> = [];
  for (const dir of dirs) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    }
    catch {
      unreadable.push({ dir, reason: "package.json is not valid JSON" });
      continue;
    }
    if (!isObject(manifest)) unreadable.push({ dir, reason: "package.json is not a JSON object" });
    else if (typeof manifest.name !== "string" || manifest.name === "") unreadable.push({ dir, reason: "package.json has no name" });
    else packages.push({ dir, manifest, name: manifest.name });
  }
  return { packages, unreadable };
}

/** The dependencies one manifest section declares, or an empty object when it's missing or malformed. */
export function sectionEntries(manifest: JsonObject, section: DependencySection): Array<[ string, string ]> {
  const deps = manifest[section];
  if (!isObject(deps)) return [];
  return Object.entries(deps).filter((entry): entry is [ string, string ] => typeof entry[1] === "string");
}

/** The package a dependency installs: its own name, or for `npm:<name>@<range>` the aliased name. */
function installedName(name: string, spec: string): string {
  if (!spec.startsWith("npm:")) return name;
  const alias = spec.slice(4);
  const versionAt = alias.indexOf("@", 1);
  return versionAt === -1 ? alias : alias.slice(0, versionAt);
}

/**
 * Dependencies on another package of the same workspace, in every section. Only an exact name match counts, so
 * `@scope/utils-extra` is never mistaken for `@scope/utils`. An `npm:` alias resolves to the registry package it
 * names, so it's internal only when it aliases a workspace package.
 */
export function internalDependencies(packages: ReadonlyArray<WorkspacePackage>): Array<InternalDependency> {
  const byName = new Map(packages.map(pkg => [ pkg.name, pkg ]));
  const edges: Array<InternalDependency> = [];
  for (const from of packages) {
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [ name, spec ] of sectionEntries(from.manifest, section)) {
        const to = byName.get(installedName(name, spec));
        if (to && to !== from) edges.push({ from, section, spec, to });
      }
    }
  }
  return edges;
}

/**
 * Every dependency cycle among `edges`, each as the package names in the cycle (sorted, so output is stable).
 * Uses Tarjan's strongly connected components: any component with more than one package is a cycle.
 */
export function findCycles(edges: ReadonlyArray<InternalDependency>): Array<Array<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    adjacency.set(from.name, (adjacency.get(from.name) ?? new Set()).add(to.name));
    if (!adjacency.has(to.name)) adjacency.set(to.name, new Set());
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: Array<string> = [];
  const onStack = new Set<string>();
  const cycles: Array<Array<string>> = [];

  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
    }
    if (low.get(node) !== index.get(node)) return;
    const component: Array<string> = [];
    let member: string | undefined;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) cycles.push(component.toSorted((a, b) => a.localeCompare(b)));
  };

  for (const node of [ ...adjacency.keys() ].toSorted((a, b) => a.localeCompare(b))) {
    if (!index.has(node)) visit(node);
  }
  return cycles.toSorted((a, b) => a[0]!.localeCompare(b[0]!));
}
