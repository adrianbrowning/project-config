/**
 * The `gingacodemonkey/workspace-boundaries` ESLint rule: a pnpm workspace package may reach another one only by
 * name, through that package's `exports`. Boundaries come from the `pnpm-workspace.yaml` above the linted file, so
 * nested and custom globs need no configuration. Every specifier is resolved to where it really goes (segment by
 * segment on disk, following symlinks and the file system's case) before it's judged, so `./../`, `//`, `/./`,
 * trailing slashes, `..` that re-enters a package, extensions and index files can't sneak past.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ESLint, Rule } from "eslint";
import { discoverPackages, readWorkspaceGlobs, readWorkspacePackages } from "./workspace-graph.ts";

type JsonObject = Record<string, unknown>;

interface BoundaryPackage {
  /** Absolute and real (symlinks resolved, on-disk case) */
  dir: string;
  manifest: JsonObject;
  name: string;
}

type MessageId = "aliasEscape" | "crossPackage" | "nonCanonical" | "privateExport";

interface Violation {
  data: Record<string, string>;
  messageId: MessageId;
  /** What the import reaches, as `<package name>/<path in the package>`: the string `allow` globs match */
  target: string;
}

interface Checker {
  importer: BoundaryPackage;
  packages: ReadonlyArray<BoundaryPackage>;
}

const SEGMENT_SEPARATOR = path.sep === "\\" ? /[/\\]/ : /\//;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ESLint servers in editors live for the whole session: adding a package or changing `exports` needs a restart
const rootByDir = new Map<string, null | string>();
const packagesByRoot = new Map<string, Array<BoundaryPackage>>();

function workspaceRoot(dir: string): null | string {
  const cached = rootByDir.get(dir);
  if (cached !== undefined) return cached;
  let root: null | string = dir;
  while (!fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(root);
    if (parent === root) {
      root = null;
      break;
    }
    root = parent;
  }
  rootByDir.set(dir, root);
  return root;
}

/** The workspace's packages, deepest directory first so a nested package owns its files, not the one around it. */
function workspacePackages(root: string): Array<BoundaryPackage> {
  const cached = packagesByRoot.get(root);
  if (cached) return cached;
  const { packages } = readWorkspacePackages(discoverPackages(readWorkspaceGlobs(root) ?? [], root), root);
  const boundaries = packages
    .map(pkg => ({ dir: fs.realpathSync.native(path.join(root, pkg.dir)), manifest: pkg.manifest, name: pkg.name }))
    .toSorted((a, b) => b.dir.length - a.dir.length);
  packagesByRoot.set(root, boundaries);
  return boundaries;
}

/**
 * Where `specifier` lands from the real directory `from`, resolved a segment at a time like the file system does:
 * each existing step is replaced by its real path, so a `..` after a symlink and a differently-cased name on a
 * case-insensitive file system end up where the import really goes. Missing steps are kept as written.
 */
function resolveOnDisk(from: string, specifier: string): string {
  let current = path.isAbsolute(specifier) ? path.parse(specifier).root : from;
  for (const segment of specifier.split(SEGMENT_SEPARATOR)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      current = path.dirname(current);
      continue;
    }
    current = path.join(current, segment);
    if (fs.existsSync(current)) current = fs.realpathSync.native(current);
  }
  return current;
}

function ownerOf(packages: ReadonlyArray<BoundaryPackage>, file: string): BoundaryPackage | undefined {
  return packages.find(pkg => file === pkg.dir || file.startsWith(pkg.dir + path.sep));
}

/**
 * The `exports`/`imports` entry for `key` by Node's matching: an exact key wins, otherwise the single-`*` pattern
 * with the longest prefix (then the longest key). `match` is what the `*` stood for.
 */
function matchSubpath(map: JsonObject, key: string): undefined | { match: string; target: unknown; } {
  if (Object.hasOwn(map, key) && !key.includes("*")) return { match: "", target: map[key] };
  let best: undefined | { match: string; pattern: string; prefix: string; target: unknown; };
  for (const [ pattern, target ] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star === -1 || pattern.includes("*", star + 1)) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key === prefix || !key.startsWith(prefix) || !key.endsWith(suffix) || key.length < pattern.length) continue;
    const better = !best || prefix.length > best.prefix.length || (prefix.length === best.prefix.length && pattern.length > best.pattern.length);
    if (better) best = { match: key.slice(prefix.length, key.length - suffix.length), pattern, prefix, target };
  }
  return best && { match: best.match, target: best.target };
}

/** A manifest's `exports` as a subpath map. Without `exports`, only the bare package name is public. */
function exportsMap(manifest: JsonObject): JsonObject {
  const { exports } = manifest;
  if (exports === undefined) return { ".": true };
  if (isObject(exports) && Object.keys(exports).some(key => key.startsWith("."))) return exports;
  return { ".": exports };
}

/** Whether an exports/imports target resolves to anything: `null`, or conditions that are all `null`, don't. */
function hasTarget(target: unknown): boolean {
  if (Array.isArray(target)) return target.some(hasTarget);
  if (isObject(target)) return Object.values(target).some(hasTarget);
  return target !== null && target !== undefined;
}

/** Every path an `imports` target can map to, across its conditions and fallbacks. */
function targetPaths(target: unknown): Array<string> {
  if (typeof target === "string") return [ target ];
  if (Array.isArray(target)) return target.flatMap(targetPaths);
  return isObject(target) ? Object.values(target).flatMap(targetPaths) : [];
}

function publicSpecifiers(pkg: BoundaryPackage): string {
  const specifiers = Object.entries(exportsMap(pkg.manifest))
    .filter(([ , target ]) => hasTarget(target))
    .map(([ key ]) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`));
  return specifiers.length > 0 ? specifiers.map(specifier => `\`${specifier}\``).join(", ") : "none";
}

/** A relative or absolute import: judged by which package directory it lands in. */
function checkPath(checker: Checker, specifier: string, from: string): null | Violation {
  const file = resolveOnDisk(from, specifier);
  const owner = ownerOf(checker.packages, file);
  if (!owner || owner === checker.importer) return null;
  const inside = path.relative(owner.dir, file).split(path.sep)
    .join("/");
  return {
    messageId: "crossPackage",
    data: { specifier, name: owner.name, exports: publicSpecifiers(owner) },
    target: inside === "" ? owner.name : `${owner.name}/${inside}`,
  };
}

/**
 * A bare import: judged by the package it names after normalising, so `@scope/own/../other/src` counts as
 * `@scope/other/src`. Names compare case-insensitively (npm names are lower case, but a case-insensitive file
 * system would still resolve `@Scope/Other`). Any spelling other than the canonical one is rejected outright.
 */
function checkBare(checker: Checker, specifier: string): null | Violation {
  const normalised = path.posix.normalize(specifier);
  const canonical = normalised.endsWith("/") ? normalised.slice(0, -1) : normalised;
  const parts = canonical.split("/");
  const nameLength = canonical.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/")
    .toLowerCase();
  const pkg = checker.packages.find(candidate => candidate.name.toLowerCase() === name);
  if (!pkg || pkg === checker.importer) return null;

  const rest = parts.slice(nameLength).join("/");
  const subpath = rest === "" ? "." : `./${rest}`;
  const written = rest === "" ? pkg.name : `${pkg.name}/${rest}`;
  const data = { specifier, name: pkg.name, canonical: written, exports: publicSpecifiers(pkg) };
  if (!hasTarget(matchSubpath(exportsMap(pkg.manifest), subpath)?.target)) return { messageId: "privateExport", data, target: written };
  if (written !== specifier) return { messageId: "nonCanonical", data, target: written };
  return null;
}

/**
 * A `#` import: its target in the importing package's own `imports` field must stay inside that package or go
 * through another package's exports. `#src/*` is private to the package declaring it, so no other package can use
 * it to reach that package's source. Without a matching `imports` entry there is nothing to check.
 */
function checkAlias(checker: Checker, specifier: string): null | Violation {
  const { imports } = checker.importer.manifest;
  const entry = isObject(imports) ? matchSubpath(imports, specifier) : undefined;
  if (!entry) return null;
  for (const target of targetPaths(entry.target)) {
    const mapped = target.replaceAll("*", entry.match);
    const violation = /^\.{0,2}\//.test(mapped) ? checkPath(checker, mapped, checker.importer.dir) : checkBare(checker, mapped);
    if (violation) return { ...violation, messageId: "aliasEscape", data: { ...violation.data, specifier, mapped } };
  }
  return null;
}

function checkSpecifier(checker: Checker, raw: string, fromDir: string): null | Violation {
  const query = raw.indexOf("?");
  let specifier = query === -1 ? raw : raw.slice(0, query);
  if (specifier.startsWith("file:")) {
    try {
      specifier = fileURLToPath(specifier);
    }
    catch {
      return null;
    }
  }
  if (specifier.startsWith("#")) return checkAlias(checker, specifier);
  if (specifier === "." || specifier === ".." || /^\.{1,2}\//.test(specifier) || path.isAbsolute(specifier)) {
    return checkPath(checker, specifier, fromDir);
  }
  return checkBare(checker, specifier);
}

function property(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

/** The string a module source node holds: a literal or a template literal without expressions. */
function sourceText(node: unknown): string | undefined {
  const type = property(node, "type");
  const value = property(node, "value");
  if (type === "Literal" && typeof value === "string") return value;
  const quasis = property(node, "quasis");
  if (type === "TemplateLiteral" && Array.isArray(quasis) && quasis.length === 1) {
    const cooked = property(property(quasis[0], "value"), "cooked");
    return typeof cooked === "string" ? cooked : undefined;
  }
  // TSImportType: import("x").T, whose argument is a literal type
  return type === "TSLiteralType" ? sourceText(property(node, "literal")) : undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Import other pnpm workspace packages only through their public package.json exports" },
    schema: [{
      type: "object",
      properties: { allow: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    }],
    messages: {
      privateExport: "`{{specifier}}` is not a public export of {{name}}. Import one of its exports ({{exports}}) or add the path to its package.json `exports`.",
      nonCanonical: "`{{specifier}}` reaches {{name}} through a non-canonical path. Write it as `{{canonical}}`.",
      crossPackage: "`{{specifier}}` reaches into {{name}}'s files. Import {{name}} by name through its exports ({{exports}}).",
      aliasEscape: "`{{specifier}}` maps to `{{mapped}}`, which reaches into {{name}}. `#` imports are private to their own package; import {{name}} through its exports ({{exports}}).",
    },
  },
  create(context) {
    const file = context.filename;
    if (!path.isAbsolute(file)) return {};
    const root = workspaceRoot(path.dirname(file));
    if (!root) return {};
    const packages = workspacePackages(root);
    const fromDir = resolveOnDisk(path.parse(file).root, path.dirname(file));
    const importer = ownerOf(packages, fromDir);
    // Files outside every package (root tooling, sharedConfig/) aren't part of any package's API
    if (!importer) return {};
    const allowOption = property(context.options[0], "allow");
    const allow = Array.isArray(allowOption) ? allowOption.filter(glob => typeof glob === "string") : [];
    const checker: Checker = { importer, packages };

    const check = (node: Rule.Node, source: unknown) => {
      const specifier = sourceText(source);
      if (specifier === undefined) return;
      const violation = checkSpecifier(checker, specifier, fromDir);
      if (!violation || allow.some(glob => path.posix.matchesGlob(violation.target, glob))) return;
      context.report({ node, messageId: violation.messageId, data: violation.data });
    };

    return {
      ImportDeclaration: node => check(node, node.source),
      ExportAllDeclaration: node => check(node, node.source),
      ExportNamedDeclaration: node => check(node, node.source),
      ImportExpression: node => check(node, node.source),
      CallExpression: node => {
        if (node.callee.type === "Identifier" && node.callee.name === "require") check(node, node.arguments[0]);
      },
      // import x = require("…") and import("…").Type in TypeScript
      TSExternalModuleReference: (node: Rule.Node) => check(node, property(node, "expression")),
      // typescript-eslint 8 names the specifier `source`; earlier versions only have `argument`
      TSImportType: (node: Rule.Node) => check(node, property(node, "source") ?? property(node, "argument")),
    };
  },
};

/** Registers `workspace-boundaries`; the default config in `src/eslint.ts` turns it on for every code file. */
export const workspaceBoundariesPlugin: ESLint.Plugin = { meta: { name: "@gingacodemonkey/config" }, rules: { "workspace-boundaries": rule } };
