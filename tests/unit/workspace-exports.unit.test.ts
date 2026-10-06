/**
 * Library exports: which packages are libraries, and the publishing fields and tsconfig options planned for them
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanItem } from "../../src/update/reconcile.ts";
import { configureLibraryExports, libraryExportItems, packageKind } from "../../src/workspace-exports.ts";

let dir: string;
let originalCwd: string;

const PKG = "packages/lib";
const ROOT_EXPORT = { types: "./dist/index.d.ts", default: "./dist/index.js" };

function write(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

function read(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function seed(manifest: Record<string, unknown> = {}, preset = "@gingacodemonkey/config/tsc/no-dom/library", tsconfig: Record<string, unknown> = {}): void {
  write("sharedConfig/tsconfig.base.json", { extends: preset });
  write(`${PKG}/package.json`, { name: "lib", version: "1.0.0", ...manifest });
  write(`${PKG}/tsconfig.json`, { extends: "../../sharedConfig/tsconfig.base.json", include: [ "src" ], ...tsconfig });
  write(`${PKG}/src/index.ts`, "export const a = 1;\n");
}

const byLabel = (items: Array<PlanItem>) => Object.fromEntries(items.map(item => [ item.label.replace(`${PKG}/`, ""), [ item.status, item.reason ]]));

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-exports-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("packageKind", () => {
  it("is a library only for a public package with src/index.ts under a tsc library preset", () => {
    seed();
    expect(packageKind(PKG)).toBe("library");
    seed({}, "@gingacodemonkey/config/tsc/dom/library-monorepo");
    expect(packageKind(PKG)).toBe("library");
    seed({}, "@gingacodemonkey/config/bundler/no-dom/library");
    expect(packageKind(PKG)).toBe("bundler-library");
  });

  it("treats app presets, private packages and packages without src/index.ts as applications", () => {
    seed({}, "@gingacodemonkey/config/tsc/no-dom/app");
    expect(packageKind(PKG)).toBe("application");
    seed({ private: true });
    expect(packageKind(PKG)).toBe("application");
    seed();
    fs.rmSync(`${PKG}/src/index.ts`);
    expect(packageKind(PKG)).toBe("application");
    expect(libraryExportItems(PKG)).toEqual([]);
  });
});

describe("libraryExportItems", () => {
  it("plans every field for a fresh library, and nothing on a second pass", () => {
    seed();
    const items = libraryExportItems(PKG);
    expect(items.every(item => item.status === "added")).toBe(true);
    for (const item of items) item.apply?.();

    expect(read(`${PKG}/package.json`)).toMatchObject({
      type: "module",
      exports: { ".": ROOT_EXPORT },
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      files: [ "dist", "!dist/**/*.test.*", "!dist/**/*.spec.*", "!dist/.tsbuildinfo" ],
      scripts: { build: "tsc" },
    });
    expect(read(`${PKG}/tsconfig.json`)).toMatchObject({ compilerOptions: { outDir: "dist", rootDir: "src", tsBuildInfoFile: "dist/.tsbuildinfo" } });
    expect(libraryExportItems(PKG).filter(item => item.status !== "unchanged")).toEqual([]);
  });

  it("follows the package's own outDir and rootDir", () => {
    seed({}, undefined, { compilerOptions: { outDir: "./build/", rootDir: "." } });
    for (const item of libraryExportItems(PKG, "dist")) item.apply?.();
    expect(read(`${PKG}/package.json`)).toMatchObject({
      exports: { ".": { types: "./build/src/index.d.ts", default: "./build/src/index.js" } },
      files: [ "build", "!build/**/*.test.*", "!build/**/*.spec.*", "!build/.tsbuildinfo" ],
    });
    expect(read(`${PKG}/tsconfig.json`)).toMatchObject({ compilerOptions: { outDir: "./build/", rootDir: "." } });
  });

  it("maps configured subpaths, patterns included, to compiled output and skips invalid ones", () => {
    seed({ gingacodemonkey: { subpathExports: {
      "./utils": "./src/utils.ts",
      "./fmt/*": "./src/fmt/*.ts",
      "./missing": "./src/missing.ts",
      "./outside": "./scripts/x.ts",
      "bad": "./src/utils.ts",
      "./two/*": "./src/*/*.ts",
    } } });
    write(`${PKG}/src/utils.ts`, "export {};\n");
    write(`${PKG}/scripts/x.ts`, "export {};\n");
    const items = libraryExportItems(PKG);
    for (const item of items) item.apply?.();

    expect(read(`${PKG}/package.json`).exports).toEqual({
      ".": ROOT_EXPORT,
      "./utils": { types: "./dist/utils.d.ts", default: "./dist/utils.js" },
      "./fmt/*": { types: "./dist/fmt/*.d.ts", default: "./dist/fmt/*.js" },
    });
    expect(byLabel(items)).toMatchObject({
      "package.json › exports[\"./missing\"]": [ "skipped", "./src/missing.ts doesn't exist" ],
      "package.json › exports[\"./outside\"]": [ "skipped", "./scripts/x.ts is outside rootDir src" ],
      "package.json › exports[\"bad\"]": [ "skipped", "subpath must start with ./" ],
      "package.json › exports[\"./two/*\"]": [ "skipped", "subpath and source need the same single * (or none)" ],
    });
  });

  it("keeps a custom root export and the user's values as conflicts, without main/types for someone else's entry", () => {
    seed({ exports: "./lib/index.js", type: "commonjs", files: [ "lib", "README.md" ], scripts: { build: "rollup -c" } });
    const items = byLabel(libraryExportItems(PKG));

    expect(items["package.json › exports[\".\"]"]).toEqual([ "conflict", "is a custom root export; kept" ]);
    expect(items["package.json › type"]).toEqual([ "conflict", "is \"commonjs\", expected \"module\"" ]);
    expect(items["package.json › scripts.build"]).toEqual([ "conflict", "is \"rollup -c\", expected \"tsc\"" ]);
    expect(items).not.toHaveProperty([ "package.json › main" ]);
    expect(items["package.json › files"]).toEqual([ "added", "adds dist, !dist/**/*.test.*, !dist/**/*.spec.*, !dist/.tsbuildinfo" ]);
  });

  it("keeps custom subpaths, adds the root entry first, and reports subpaths that publish TypeScript source", () => {
    seed({ exports: { "./package.json": "./package.json", "./raw": { import: "./src/raw.ts" } } });
    const items = libraryExportItems(PKG);
    for (const item of items) if (item.status === "added") item.apply?.();

    expect(Object.keys(read(`${PKG}/package.json`).exports as object)).toEqual([ ".", "./package.json", "./raw" ]);
    expect(byLabel(items)["package.json › exports[\"./raw\"]"]).toEqual([ "customized", "resolves to ./src/raw.ts, which isn't compiled output; kept" ]);
  });

  it("skips a library in bundler mode", () => {
    seed({}, "@gingacodemonkey/config/bundler/dom/library");
    expect(libraryExportItems(PKG).map(item => item.status)).toEqual([ "skipped" ]);
  });
});

describe("configureLibraryExports", () => {
  it("writes only missing values, keeps the user's, and is idempotent", () => {
    seed({ main: "./lib/custom.js", imports: { "#src/*": "./src/*" } });
    const [ line ] = configureLibraryExports([ PKG ], "dist");
    expect(line).toContain(`${PKG}: updated; kept your own package.json › main`);
    const manifest = read(`${PKG}/package.json`);
    expect(manifest).toMatchObject({ main: "./lib/custom.js", imports: { "#src/*": "./src/*" }, exports: { ".": ROOT_EXPORT } });

    expect(configureLibraryExports([ PKG ], "dist")[0]).toMatch(new RegExp(`^${PKG}: unchanged`));
    expect(read(`${PKG}/package.json`)).toEqual(manifest);
  });

  it("fails for a library in bundler mode, naming the package and the fix", () => {
    seed({}, "@gingacodemonkey/config/bundler/no-dom/library-monorepo");
    expect(() => configureLibraryExports([ PKG ], "dist")).toThrow(/packages\/lib can't be published from a bundler-mode workspace.*--ts-mode=tsc/);
    expect(read(`${PKG}/package.json`)).not.toHaveProperty("exports");
  });
});
