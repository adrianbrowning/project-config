/**
 * Project references: the plan setup and --update write for `tsc --build`, derived from workspace dependencies
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli-args.ts";
import { PlanError } from "../../src/update/reconcile.ts";
import { runUpdate } from "../../src/update/run-update.ts";
import { planReferences, referenceItems, syncReferences } from "../../src/workspace-references.ts";

type Tsconfig = { compilerOptions?: Record<string, unknown>; extends?: unknown; files?: Array<string>; include?: Array<string>; references?: Array<{ path: string; }>; };

const BUNDLER_BASE = "@gingacodemonkey/config/bundler/no-dom/app";
const TSC_BASE = "@gingacodemonkey/config/tsc/no-dom/app";

let dir: string;
let originalCwd: string;

function write(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

function readJson<T = Tsconfig>(file: string): T {
  return JSON.parse(read(file)) as T;
}

/** A linked package: its manifest, and a tsconfig extending the shared base plus `tsconfig` */
function linkedPackage(pkgDir: string, manifest: Record<string, unknown>, tsconfig: Tsconfig = {}): void {
  write(`${pkgDir}/package.json`, manifest);
  const base = `${path.posix.relative(pkgDir, "sharedConfig")}/tsconfig.base.json`;
  write(`${pkgDir}/tsconfig.json`, { extends: base, include: [ "src" ], ...tsconfig });
}

/** A library in packages/lib and an app one level deeper that depends on it */
function libAndApp(appTsconfig: Tsconfig = {}): void {
  linkedPackage("packages/lib", { name: "@demo/lib" });
  linkedPackage("apps/web/site", { name: "site", dependencies: { "@demo/lib": "workspace:*" } }, appTsconfig);
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-unit-references-"));
  process.chdir(dir);
  write("package.json", { name: "root", private: true });
  write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*/*'\n");
  write("sharedConfig/tsconfig.base.json", { extends: BUNDLER_BASE });
  write(".gitignore", "node_modules\n");
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("planReferences", () => {
  it("references each package from the root and each dependency from its consumer, at any depth", () => {
    libAndApp();
    syncReferences("sharedConfig");

    expect(readJson("tsconfig.json")).toEqual({ files: [], references: [{ path: "apps/web/site" }, { path: "packages/lib" }] });
    expect(readJson("apps/web/site/tsconfig.json").references).toEqual([{ path: "../../../packages/lib" }]);
    expect(readJson("packages/lib/tsconfig.json").references).toBeUndefined();
  });

  it("adds build options next to a package's own, and keeps every option it sets itself", () => {
    libAndApp({ compilerOptions: { noUnusedLocals: false, outDir: "build" } });
    syncReferences("sharedConfig");

    expect(readJson("packages/lib/tsconfig.json").compilerOptions).toEqual({
      composite: true, outDir: "dist", tsBuildInfoFile: "dist/.tsbuildinfo", noEmit: false, emitDeclarationOnly: true,
    });
    // The package's own outDir wins, and the build info follows it
    expect(readJson("apps/web/site/tsconfig.json").compilerOptions).toEqual({
      noUnusedLocals: false, outDir: "build", composite: true, tsBuildInfoFile: "build/.tsbuildinfo", noEmit: false, emitDeclarationOnly: true,
    });
    expect(read(".gitignore")).toBe("node_modules\n\n# TypeScript build output (tsc --build)\nbuild/\ndist/\n");
  });

  it("emits JavaScript with a tsc preset: no noEmit or emitDeclarationOnly is added", () => {
    write("sharedConfig/tsconfig.base.json", { extends: TSC_BASE });
    libAndApp();
    syncReferences("sharedConfig");
    expect(readJson("packages/lib/tsconfig.json").compilerOptions).toEqual({ composite: true, outDir: "dist", tsBuildInfoFile: "dist/.tsbuildinfo" });
  });

  it("uses setup's --ts-outdir for packages without their own outDir", () => {
    libAndApp({ compilerOptions: { outDir: "build" } });
    syncReferences("sharedConfig", "out");
    expect(readJson("packages/lib/tsconfig.json").compilerOptions).toMatchObject({ outDir: "out", tsBuildInfoFile: "out/.tsbuildinfo" });
    expect(readJson("apps/web/site/tsconfig.json").compilerOptions).toMatchObject({ outDir: "build", tsBuildInfoFile: "build/.tsbuildinfo" });
  });

  it("accepts an existing ignore line for the output in any equivalent form", () => {
    write(".gitignore", "node_modules\n**/dist\n");
    libAndApp();
    syncReferences("sharedConfig");
    expect(read(".gitignore")).toBe("node_modules\n**/dist\n");
  });

  it("anchors an output location with a slash to its package, and a build info file outside outDir too", () => {
    linkedPackage("packages/lib", { name: "lib" }, { compilerOptions: { outDir: "out/types", tsBuildInfoFile: ".cache/lib.tsbuildinfo" } });
    syncReferences("sharedConfig");
    expect(read(".gitignore")).toContain("\n/packages/lib/out/types/\n/packages/lib/.cache/lib.tsbuildinfo\n");
  });

  it("changes nothing on a second run", () => {
    libAndApp();
    syncReferences("sharedConfig");
    const files = [ "tsconfig.json", ".gitignore", "packages/lib/tsconfig.json", "apps/web/site/tsconfig.json" ];
    const first = files.map(read);

    expect(planReferences("sharedConfig").files.filter(file => file.changed)).toEqual([]);
    syncReferences("sharedConfig");
    expect(files.map(read)).toEqual(first);
  });

  it("removes a reference when the dependency goes, and adds it once when it comes back", () => {
    libAndApp();
    syncReferences("sharedConfig");

    write("apps/web/site/package.json", { name: "site" });
    syncReferences("sharedConfig");
    expect(readJson("apps/web/site/tsconfig.json").references).toBeUndefined();

    // Back as a devDependency, with a stale duplicate reference in the file: one reference remains
    write("apps/web/site/package.json", { name: "site", devDependencies: { "@demo/lib": "workspace:^" } });
    const tsconfig = readJson("apps/web/site/tsconfig.json");
    write("apps/web/site/tsconfig.json", { ...tsconfig, references: [{ path: "../../../packages/lib/tsconfig.json" }, { path: "../../../packages/lib" }] });
    syncReferences("sharedConfig");
    expect(readJson("apps/web/site/tsconfig.json").references).toEqual([{ path: "../../../packages/lib/tsconfig.json" }]);
  });

  it("keeps the user's references to configs that aren't workspace packages", () => {
    write("tools/tsconfig.json", "{}");
    libAndApp({ references: [{ path: "../../../tools" }] });
    syncReferences("sharedConfig");
    expect(readJson("apps/web/site/tsconfig.json").references).toEqual([{ path: "../../../tools" }, { path: "../../../packages/lib" }]);
  });

  it("keeps an existing root tsconfig's own scope and references", () => {
    write("scripts/tsconfig.json", "{}");
    write("tsconfig.json", { include: [ "scripts" ], references: [{ path: "scripts" }] });
    libAndApp();
    syncReferences("sharedConfig");
    expect(readJson("tsconfig.json")).toEqual({ include: [ "scripts" ], references: [{ path: "scripts" }, { path: "apps/web/site" }, { path: "packages/lib" }] });
  });

  it("writes nothing when no package is linked to the shared tsconfig", () => {
    write("packages/a/package.json", { name: "a" });
    write("packages/a/tsconfig.json", { include: [ "src" ] });
    const plan = planReferences("sharedConfig");
    expect(plan.files).toEqual([]);
    expect(plan.notes).toEqual([ "packages/a: left out of tsc --build (its tsconfig.json doesn't extend ../../sharedConfig/tsconfig.base.json; link it with --tool=workspace --workspace-update-all)" ]);
  });

  it("leaves out a package that disables emit or composite, and reports why", () => {
    libAndApp();
    write("apps/web/site/package.json", { name: "site" });
    linkedPackage("packages/lib", { name: "@demo/lib" }, { compilerOptions: { noEmit: true } });
    linkedPackage("packages/other", { name: "other" }, { compilerOptions: { composite: false } });
    const plan = planReferences("sharedConfig");

    expect(plan.errors).toEqual([]);
    expect(plan.built).toEqual([ "apps/web/site" ]);
    expect(plan.notes).toEqual([
      "packages/lib: left out of tsc --build (its tsconfig.json sets noEmit: true, and a referenced project must emit declarations)",
      "packages/other: left out of tsc --build (its tsconfig.json sets composite: false)",
    ]);
  });

  it("ignores a dependency on a workspace package without a tsconfig", () => {
    write("packages/js-only/package.json", { name: "js-only" });
    linkedPackage("packages/app", { name: "app", dependencies: { "js-only": "workspace:*" } });
    const plan = planReferences("sharedConfig");
    expect(plan.errors).toEqual([]);
    expect(plan.files.find(file => file.file === "packages/app/tsconfig.json")?.content).not.toContain("references");
  });
});

describe("planReferences errors", () => {
  it("fails on a dependency cycle, listing every package in it, and writes nothing", () => {
    libAndApp();
    write("packages/lib/package.json", { name: "@demo/lib", devDependencies: { site: "workspace:*" } });
    const before = read("apps/web/site/tsconfig.json");

    expect(() => syncReferences("sharedConfig")).toThrow("Dependency cycle between @demo/lib (packages/lib), site (apps/web/site)");
    expect(read("apps/web/site/tsconfig.json")).toBe(before);
    expect(fs.existsSync(path.join(dir, "tsconfig.json"))).toBe(false);
  });

  it("fails on a workspace: dependency that no package provides", () => {
    linkedPackage("packages/app", { name: "app", dependencies: { "@demo/gone": "workspace:^" } });
    expect(planReferences("sharedConfig").errors).toEqual([
      "packages/app depends on @demo/gone (dependencies: \"workspace:^\"), but no workspace package is named @demo/gone; add that package or remove the dependency",
    ]);
  });

  it("fails when a consumer depends on a package that can't take part", () => {
    libAndApp();
    linkedPackage("packages/lib", { name: "@demo/lib" }, { compilerOptions: { noEmit: true } });
    expect(planReferences("sharedConfig").errors).toEqual([
      "apps/web/site depends on @demo/lib, but packages/lib can't take part in tsc --build: its tsconfig.json sets noEmit: true, and a referenced project must emit declarations",
    ]);
  });

  it("fails on a reference to a config that doesn't exist", () => {
    libAndApp({ references: [{ path: "../../../tools" }] });
    expect(planReferences("sharedConfig").errors).toEqual([
      "apps/web/site/tsconfig.json references ../../../tools, but tools/tsconfig.json doesn't exist; fix or remove that reference",
    ]);
  });

  it("fails on a root tsconfig.json that isn't plain JSON", () => {
    libAndApp();
    write("tsconfig.json", "{ // comment\n}\n");
    expect(planReferences("sharedConfig").errors).toEqual([
      "tsconfig.json at the workspace root isn't plain JSON; fix it, or delete it so setup can write the solution config",
    ]);
  });
});

describe("--update", () => {
  it("plans one item per managed file, unchanged once in sync", () => {
    libAndApp();
    const first = referenceItems("sharedConfig");
    expect(first.map(item => [ item.label, item.status ])).toEqual([
      [ "apps/web/site/tsconfig.json › project references", "updated" ],
      [ "packages/lib/tsconfig.json › project references", "updated" ],
      [ "tsconfig.json › project references", "added" ],
      [ ".gitignore › tsc --build output", "updated" ],
    ]);
    for (const item of first) item.apply?.();
    expect(referenceItems("sharedConfig").map(item => item.status)).toEqual([ "unchanged", "unchanged", "unchanged", "unchanged" ]);
  });

  it("stops on a dependency cycle with the packages named, writing nothing", async () => {
    libAndApp();
    write("packages/lib/package.json", { name: "@demo/lib", peerDependencies: { site: "workspace:*" } });
    write("sharedConfig/eslint.config.ts", "");
    expect(() => referenceItems("sharedConfig")).toThrow(PlanError);

    const log: Array<string> = [];
    expect(await runUpdate(parseCliArgs([ "--update", "--tool=workspace", "--yes" ]), null, line => log.push(line))).toBe(1);
    expect(log.join("\n")).toContain("Dependency cycle between @demo/lib (packages/lib), site (apps/web/site)");
    expect(fs.existsSync(path.join(dir, "tsconfig.json"))).toBe(false);
  });
});
