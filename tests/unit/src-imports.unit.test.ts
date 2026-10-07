/**
 * The #src/*.ts package import: mode-specific mappings, merging with the user's imports, conflicts and idempotency
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySrcImports, presetMode, srcImportItems } from "../../src/src-imports.ts";
import type { PlanItem } from "../../src/update/reconcile.ts";

const PKG = "packages/web";
const KEY = "#src/*.ts";
const APP = { "types": "./dist/*.d.ts", "gingacodemonkey:source": "./src/*.ts", "default": "./dist/*.js" };
const LIBRARY = { types: "./dist/*.d.ts", default: "./dist/*.js" };

let dir: string;
let originalCwd: string;

function write(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

function read(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function seed(manifest: Record<string, unknown> = {}, compilerOptions: Record<string, unknown> = {}): void {
  write(`${PKG}/package.json`, { name: "web", ...manifest });
  write(`${PKG}/tsconfig.json`, { extends: "../../sharedConfig/tsconfig.base.json", compilerOptions, include: [ "src" ] });
}

const statuses = (items: Array<PlanItem>) => items.map(item => [ item.label.replace(`${PKG}/`, ""), item.status, item.reason ]);

/** Setup's way: apply what's missing, keep conflicts. Returns its notes. */
const setup = async (mode: "bundler" | "tsc", library = false) => applySrcImports(srcImportItems(PKG, mode, library), null);

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-src-imports-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("presetMode", () => {
  it("reads bundler or tsc from a string or array extends, and nothing from anything else", () => {
    write("a.json", { extends: "@gingacodemonkey/config/tsc/no-dom/app" });
    write("b.json", { extends: [ "./local.json", "@gingacodemonkey/config/bundler/dom/library" ] });
    write("c.json", { extends: "@tsconfig/node24" });
    write("d.json", "{ // comment\n}");
    expect([ "a.json", "b.json", "c.json", "d.json", "missing.json" ].map(file => presetMode(file))).toEqual([ "tsc", "bundler", undefined, undefined, undefined ]);
  });
});

describe("srcImportItems", () => {
  it("bundler mode maps to source and merges into existing imports, keeping other aliases and their order", async () => {
    seed({ imports: { "#config": "./config.json", "#utils/*": "./lib/*.js" } });
    expect(await setup("bundler")).toEqual([]);

    const imports = read(`${PKG}/package.json`).imports;
    expect(imports).toEqual({ "#config": "./config.json", "#utils/*": "./lib/*.js", [KEY]: "./src/*.ts" });
    expect(Object.keys(imports as object)).toEqual([ "#config", "#utils/*", KEY ]);
    // Bundler mode leaves the tsconfig alone
    expect(read(`${PKG}/tsconfig.json`).compilerOptions).toEqual({});
  });

  it("tsc mode points types/default at the output, adds the source condition and rootDir src for an app", async () => {
    seed();
    await setup("tsc");
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: APP });
    expect(read(`${PKG}/tsconfig.json`).compilerOptions).toEqual({ rootDir: "src" });
  });

  it("gives a publishable library no condition whose target is outside its output", async () => {
    seed();
    await setup("tsc", true);
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: LIBRARY });
  });

  it("follows the tsconfig's own outDir, declarationDir and rootDir", () => {
    seed({}, { outDir: "./build/", rootDir: "." });
    expect(srcImportItems(PKG, "tsc", true, "dist").map(item => item.apply?.())).toHaveLength(1);
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: { types: "./build/src/*.d.ts", default: "./build/src/*.js" } });

    seed({}, { outDir: "out", declarationDir: "types", rootDir: "src" });
    for (const item of srcImportItems(PKG, "tsc", false)) item.apply?.();
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: { "types": "./types/*.d.ts", "gingacodemonkey:source": "./src/*.ts", "default": "./out/*.js" } });
  });

  it("uses the default outDir only when the tsconfig sets none", async () => {
    seed();
    for (const item of srcImportItems(PKG, "tsc", true, "lib")) item.apply?.();
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: { types: "./lib/*.d.ts", default: "./lib/*.js" } });
  });

  it("is idempotent: a second run plans nothing and writes nothing", async () => {
    seed({ imports: { "#config": "./config.json" } });
    await setup("tsc");
    const files = [ `${PKG}/package.json`, `${PKG}/tsconfig.json` ].map(file => fs.readFileSync(file, "utf8"));
    expect(srcImportItems(PKG, "tsc", false).map(item => item.status)).toEqual([ "unchanged" ]);
    expect(await setup("tsc")).toEqual([]);
    expect([ `${PKG}/package.json`, `${PKG}/tsconfig.json` ].map(file => fs.readFileSync(file, "utf8"))).toEqual(files);
  });

  it("replaces a mapping it generated for another mode or kind, as an earlier default", () => {
    seed({ imports: { [KEY]: APP } }, { rootDir: "src" });
    expect(statuses(srcImportItems(PKG, "tsc", true))).toEqual([[ `package.json › imports["${KEY}"]`, "updated", undefined ]]);
    seed({ imports: { [KEY]: "./src/*.ts" } }, { rootDir: "src" });
    expect(statuses(srcImportItems(PKG, "tsc", false))).toEqual([[ `package.json › imports["${KEY}"]`, "updated", undefined ]]);
  });
});

describe("conflicting #src mappings", () => {
  it("reports a different #src/*.ts mapping and keeps it without a confirmation", async () => {
    seed({ imports: { [KEY]: "./lib/*.ts", "#other": "./other.js" } });
    const [ item ] = srcImportItems(PKG, "bundler", false);
    expect(item).toMatchObject({ status: "conflict", reason: "is \"./lib/*.ts\", expected \"./src/*.ts\"" });

    const notes = await setup("bundler");
    expect(notes).toEqual([ `kept your own ${PKG}/package.json › imports["${KEY}"] (is "./lib/*.ts", expected "./src/*.ts")` ]);
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: "./lib/*.ts", "#other": "./other.js" });
  });

  it("treats a hand-written #src/* as a conflict, since #src/*.ts would take over its .ts imports", async () => {
    seed({ imports: { "#src/*": "./src/*" } });
    expect(statuses(srcImportItems(PKG, "bundler", false))).toEqual([
      [ `package.json › imports["${KEY}"]`, "conflict", "your \"#src/*\" is \"./src/*\"; the generated \"./src/*.ts\" would take over its .ts imports" ],
    ]);
    await setup("bundler");
    expect(read(`${PKG}/package.json`).imports).toEqual({ "#src/*": "./src/*" });
  });

  it("replaces a conflicting mapping only when confirmed, and asks once per conflict", async () => {
    seed({ imports: { [KEY]: "./lib/*.ts", "#other": "./other.js" } });
    const asked: Array<string> = [];
    const declined = await applySrcImports(srcImportItems(PKG, "bundler", false), async item => {
      asked.push(item.label);
      return false;
    });
    expect(declined).toHaveLength(1);
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: "./lib/*.ts", "#other": "./other.js" });

    expect(await applySrcImports(srcImportItems(PKG, "bundler", false), async () => true)).toEqual([]);
    expect(asked).toEqual([ `${PKG}/package.json › imports["${KEY}"]` ]);
    expect(read(`${PKG}/package.json`).imports).toEqual({ [KEY]: "./src/*.ts", "#other": "./other.js" });
  });

  it("never touches imports that aren't an object", () => {
    seed({ imports: "./src/index.ts" });
    expect(srcImportItems(PKG, "bundler", false)).toEqual([{ label: `${PKG}/package.json › imports["${KEY}"]`, status: "customized", reason: "imports isn't an object; left as is" }]);
  });
});

describe("skipped packages", () => {
  it("skips when the build mode is unknown, src/ isn't compiled, or the tsconfig can't be read", () => {
    seed();
    expect(statuses(srcImportItems(PKG, undefined, false))[0]?.[1]).toBe("skipped");
    seed({}, { rootDir: "lib" });
    expect(statuses(srcImportItems(PKG, "tsc", false))).toEqual([[ `package.json › imports["${KEY}"]`, "skipped", "src/ is outside rootDir lib, so it isn't compiled" ]]);
    write(`${PKG}/tsconfig.json`, "{ // comment\n}");
    expect(statuses(srcImportItems(PKG, "tsc", false))[0]?.[1]).toBe("skipped");
  });
});
