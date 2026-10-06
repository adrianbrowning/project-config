/**
 * pnpm catalogs: which versions move into the default catalog, how they're written, and the setup and --update flows
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Listr } from "listr2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { createPackageCollector, parseCliArgs } from "../../src/cli-args.ts";
import type { TaskContext } from "../../src/cli-args.ts";
import { applyCatalogMoves, catalogItems, createCatalogTask, isRegistryRange, planCatalog } from "../../src/workspace-catalogs.ts";
import type { CatalogConflict, CatalogMove, CatalogPrompts } from "../../src/workspace-catalogs.ts";

type Manifest = Record<string, Record<string, string> | string>;

const WORKSPACE_YAML = [
  "packages:",
  "  - 'packages/*'",
  "# the team's catalog",
  "catalog:",
  "  zod: ^4.1.0",
  "catalogs:",
  "  legacy:",
  "    react: ^18.0.0",
  "minimumReleaseAge: 4320",
  "",
].join("\n");

// `@demo/b` at a plain range here and in packages/a: repeated, but internal, so it must never move
const ROOT = { name: "root", private: true, devDependencies: { "typescript": "^6.0.3", "left-pad": "latest", "@demo/b": "^1.0.0" } };
const PACKAGE_A = {
  name: "@demo/a",
  dependencies: {
    "@demo/b": "^1.0.0",
    "zod": "^4.1.0",
    "ms": "^2.1.3",
    "alias": "npm:ms@^2.1.3",
    "local": "file:../local",
    "gh": "owner/repo",
    "react": "catalog:legacy",
  },
  devDependencies: { typescript: "^6.0.3" },
  peerDependencies: { "is-number": "^7.0.0" },
};
const PACKAGE_B = {
  name: "@demo/b",
  version: "1.0.0",
  dependencies: { "@demo/a": "workspace:*", "ms": "^2.1.2", "is-number": "^7.0.0" },
  devDependencies: { "typescript": "^6.0.3", "left-pad": "latest" },
};

let dir: string;
let originalCwd: string;

const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file)) as Manifest;
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
};
const workspace = () => YAML.parse(read("pnpm-workspace.yaml")) as Record<string, unknown>;
const snapshot = () => [ "pnpm-workspace.yaml", "package.json", "packages/a/package.json", "packages/b/package.json" ].map(read);
const names = (entries: ReadonlyArray<{ name: string; }>) => entries.map(entry => entry.name);

async function runTask(options: { args?: Array<string>; newWorkspace?: boolean; prompts?: CatalogPrompts | null; queued?: Array<string>; toolchain?: Array<[string, string]>; }): Promise<{ packages: Set<string>; title: string; }> {
  const cliArgs = parseCliArgs([ "--tool=workspace", ...(options.args ?? []) ]);
  const ctx: TaskContext = { cliArgs, packageManager: "pnpm", packages: createPackageCollector() };
  for (const pkg of options.queued ?? []) ctx.packages.add(pkg);
  const task = createCatalogTask(cliArgs, options.toolchain ?? [], () => options.newWorkspace ?? false, options.prompts ?? null);
  const listr = new Listr([ task ], { ctx, renderer: "silent" });
  await listr.run();
  return { packages: ctx.packages.packages, title: listr.tasks.map(entry => String(entry.title)).join("") };
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-unit-catalogs-"));
  write("pnpm-workspace.yaml", WORKSPACE_YAML);
  write("package.json", JSON.stringify(ROOT, null, 2) + "\n");
  write("packages/a/package.json", JSON.stringify(PACKAGE_A, null, 2) + "\n");
  // Tab-indented, without a trailing newline: both are kept
  write("packages/b/package.json", JSON.stringify(PACKAGE_B, null, "\t"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isRegistryRange", () => {
  it.each([ "^1.2.3", "~1.2", "1.2.3", "1.x", "x", ">=1 <2", "*", "v1.0.0", "1.0.0-rc.1" ])("%s is a registry range", spec => {
    expect(isRegistryRange(spec)).toBe(true);
  });

  it.each([ "workspace:*", "catalog:", "catalog:legacy", "file:../x", "link:../x", "npm:ms@^2.1.3", "git+https://x.test/r.git", "github:o/r", "owner/repo", "https://x.test/a.tgz", "latest", "next" ])("%s is not", spec => {
    expect(isRegistryRange(spec)).toBe(false);
  });
});

describe("planCatalog", () => {
  it("moves identical ranges used twice or already in the catalog, reports differing ones and never touches internal, peer or non-registry deps", () => {
    const plan = planCatalog(new Map());

    expect(plan.moves).toEqual([
      {
        name: "typescript",
        spec: "^6.0.3",
        resolved: false,
        consumers: [ ".", "packages/a", "packages/b" ].map(where => ({ dir: where, name: "typescript", section: "devDependencies", spec: "^6.0.3" })),
      },
      { name: "zod", spec: "^4.1.0", resolved: false, consumers: [{ dir: "packages/a", name: "zod", section: "dependencies", spec: "^4.1.0" }] },
    ]);
    // is-number: a peer in a, so used once; @demo/b at ^1.0.0 is internal; the rest aren't registry ranges
    expect(plan.conflicts).toEqual([{ name: "ms", ranges: [{ range: "^2.1.3", where: [ "packages/a" ] }, { range: "^2.1.2", where: [ "packages/b" ] }] }]);
  });

  it("reports a range that differs from the catalog's entry as a conflict", () => {
    write("packages/b/package.json", JSON.stringify({ ...PACKAGE_B, dependencies: { ...PACKAGE_B.dependencies, zod: "^4.2.0" } }));

    expect(planCatalog(new Map()).conflicts.find(conflict => conflict.name === "zod")).toEqual({
      name: "zod",
      ranges: [{ range: "^4.1.0", where: [ "pnpm-workspace.yaml", "packages/a" ] }, { range: "^4.2.0", where: [ "packages/b" ] }],
    });
  });

  it("moves a dependency with differing ranges at the range the user picked", () => {
    const plan = planCatalog(new Map([[ "ms", "^2.1.3" ]]));

    expect(plan.conflicts).toEqual([]);
    expect(plan.moves.find(move => move.name === "ms")).toMatchObject({ spec: "^2.1.3", resolved: true });
  });
});

describe("applyCatalogMoves", () => {
  it("writes each range once, refers to it from the same sections, and keeps the other catalogs, settings and comments", () => {
    applyCatalogMoves(planCatalog(new Map()).moves);

    expect(workspace()).toEqual({
      packages: [ "packages/*" ],
      catalog: { zod: "^4.1.0", typescript: "^6.0.3" },
      catalogs: { legacy: { react: "^18.0.0" } },
      minimumReleaseAge: 4320,
    });
    expect(read("pnpm-workspace.yaml")).toContain("# the team's catalog\ncatalog:\n");
    expect(JSON.stringify(readJson("package.json"))).toBe(JSON.stringify({ ...ROOT, devDependencies: { ...ROOT.devDependencies, typescript: "catalog:" } }));
    expect(JSON.stringify(readJson("packages/a/package.json"))).toBe(JSON.stringify({
      ...PACKAGE_A,
      dependencies: { ...PACKAGE_A.dependencies, zod: "catalog:" },
      devDependencies: { typescript: "catalog:" },
    }));
    expect(read("packages/b/package.json")).toBe(JSON.stringify({ ...PACKAGE_B, devDependencies: { "typescript": "catalog:", "left-pad": "latest" } }, null, "\t"));
  });

  it("writes to catalogs.default when that's where the default catalog is", () => {
    write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\ncatalogs:\n  default:\n    zod: ^4.1.0\n");
    applyCatalogMoves(planCatalog(new Map()).moves);

    expect(workspace()).toEqual({ packages: [ "packages/*" ], catalogs: { default: { zod: "^4.1.0", typescript: "^6.0.3" } } });
  });

  it("finds nothing more to move afterwards", () => {
    applyCatalogMoves(planCatalog(new Map()).moves);
    const before = snapshot();
    const plan = planCatalog(new Map());

    expect(plan.moves).toEqual([]);
    applyCatalogMoves(plan.moves);
    expect(snapshot()).toEqual(before);
  });
});

describe("setup task", () => {
  it("without --workspace-catalog, a non-interactive run reports what it could move and changes nothing", async () => {
    const before = snapshot();
    const { title } = await runTask({});

    expect(snapshot()).toEqual(before);
    expect(title).toContain("not moved typescript@^6.0.3, zod@^4.1.0 (rerun with --workspace-catalog)");
    expect(title).toContain("kept differing ranges for ms (^2.1.3 in packages/a; ^2.1.2 in packages/b)");
  });

  it("--workspace-catalog moves the identical ranges and --workspace-catalog-resolve the picked one", async () => {
    await runTask({ args: [ "--workspace-catalog", "--workspace-catalog-resolve=ms@^2.1.3" ] });

    expect(workspace().catalog).toEqual({ zod: "^4.1.0", typescript: "^6.0.3", ms: "^2.1.3" });
    expect(readJson("packages/b/package.json").dependencies).toEqual({ "@demo/a": "workspace:*", "ms": "catalog:", "is-number": "^7.0.0" });
  });

  it("interactive: asks once about the repeated ranges and then about each conflict; declining changes nothing", async () => {
    const asked: Array<Array<string>> = [];
    const before = snapshot();
    await runTask({
      prompts: {
        confirmMoves: async (_task, moves: ReadonlyArray<CatalogMove>) => {
          asked.push(names(moves));
          return false;
        },
        chooseRange: async (_task, conflict: CatalogConflict) => {
          asked.push([ conflict.name, ...conflict.ranges.map(entry => entry.range) ]);
          return null;
        },
      },
    });

    expect(asked).toEqual([[ "typescript", "zod" ], [ "ms", "^2.1.3", "^2.1.2" ]]);
    expect(snapshot()).toEqual(before);
  });

  it("interactive: accepting and picking a range moves them all", async () => {
    await runTask({ prompts: { confirmMoves: async () => true, chooseRange: async () => "^2.1.2" } });

    expect(workspace().catalog).toEqual({ zod: "^4.1.0", typescript: "^6.0.3", ms: "^2.1.2" });
    expect(readJson("packages/a/package.json").dependencies).toMatchObject({ ms: "catalog:", zod: "catalog:" });
  });

  it("a new workspace keeps the toolchain in the catalog: declared ranges stay, queued installs use catalog:, file: specs and this package are left", async () => {
    write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
    write("package.json", JSON.stringify({ name: "root", devDependencies: { "typescript": "^6.0.3", "@types/node": "file:../types" } }));
    fs.rmSync(path.join(dir, "packages"), { recursive: true });

    const { packages } = await runTask({
      newWorkspace: true,
      toolchain: [[ "typescript", "^6.0.0" ], [ "@types/node", "^24.0.0" ], [ "eslint", "^9.0.0" ], [ "jiti", "^2.0.0" ], [ "@gingacodemonkey/config", "1.0.0" ]],
      queued: [ "eslint@^9.0.0", "jiti@^2.0.0", "@gingacodemonkey/config@1.0.0", "husky@9.0.0" ],
    });

    expect(workspace().catalog).toEqual({ typescript: "^6.0.3", eslint: "^9.0.0", jiti: "^2.0.0" });
    expect(readJson("package.json").devDependencies).toEqual({ "typescript": "catalog:", "@types/node": "file:../types" });
    expect([ ...packages ].toSorted((a, b) => a.localeCompare(b))).toEqual([ "@gingacodemonkey/config@1.0.0", "eslint@catalog:", "husky@9.0.0", "jiti@catalog:" ]);
  });

  it("an existing workspace's toolchain isn't moved into the catalog on its own", async () => {
    const { packages } = await runTask({ toolchain: [[ "eslint", "^9.0.0" ]], queued: [ "eslint@^9.0.0" ] });

    expect([ ...packages ]).toEqual([ "eslint@^9.0.0" ]);
    expect(workspace().catalog).toEqual({ zod: "^4.1.0" });
  });
});

describe("--update items", () => {
  const flags = (args: Array<string> = []) => parseCliArgs([ "--update", ...args ]);

  it("reports repeated ranges as skipped and differing ones as customized without --workspace-catalog", () => {
    const items = catalogItems([], flags());

    expect(items.map(({ label, status }) => [ label, status ])).toEqual([
      [ "pnpm-workspace.yaml › catalog.typescript", "skipped" ],
      [ "pnpm-workspace.yaml › catalog.zod", "skipped" ],
      [ "pnpm-workspace.yaml › catalog.ms", "customized" ],
      [ "pnpm-workspace.yaml › catalogs.legacy.react", "unchanged" ],
    ]);
    expect(items.every(item => item.apply === undefined)).toBe(true);
  });

  it("moves them with --workspace-catalog, and a second run finds every reference unchanged", () => {
    for (const item of catalogItems([], flags([ "--workspace-catalog" ]))) if (item.status === "updated") item.apply?.();
    const second = catalogItems([], flags([ "--workspace-catalog" ]));

    expect(workspace().catalog).toEqual({ zod: "^4.1.0", typescript: "^6.0.3" });
    expect(second.filter(item => item.status !== "unchanged").map(item => item.label)).toEqual([ "pnpm-workspace.yaml › catalog.ms" ]);
  });

  it("adds a missing toolchain entry a reference needs and reports any other missing one", () => {
    write("package.json", JSON.stringify({ name: "root", devDependencies: { eslint: "catalog:", ghost: "catalog:" } }));
    const items = catalogItems([[ "eslint", "^9.0.0" ]], flags());
    const byLabel = new Map(items.map(item => [ item.label, item ]));

    expect(byLabel.get("pnpm-workspace.yaml › catalog.eslint")?.status).toBe("added");
    expect(byLabel.get("pnpm-workspace.yaml › catalog.ghost")).toMatchObject({ status: "skipped", reason: "missing; referenced from root; add a range for it" });
    byLabel.get("pnpm-workspace.yaml › catalog.eslint")?.apply?.();
    expect(workspace().catalog).toEqual({ zod: "^4.1.0", eslint: "^9.0.0" });
  });
});
