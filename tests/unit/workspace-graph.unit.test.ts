/**
 * Workspace graph: which packages exist, which of their dependencies are internal, and where the cycles are
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverPackages, findCycles, internalDependencies, readWorkspaceGlobs, readWorkspacePackages } from "../../src/workspace-graph.ts";

let dir: string;
let originalCwd: string;

function writePackage(pkgDir: string, manifest: Record<string, unknown> | string): void {
  fs.mkdirSync(path.join(dir, pkgDir), { recursive: true });
  fs.writeFileSync(path.join(dir, pkgDir, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-graph-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("internalDependencies", () => {
  it("finds edges by exact name in every section, ignoring look-alike external packages", () => {
    writePackage("packages/utils", { name: "@scope/utils" });
    writePackage("apps/nested/web", {
      name: "@scope/web",
      dependencies: { "@scope/utils": "workspace:^", "@scope/utils-extra": "^1.0.0" },
      devDependencies: { "utils": "^2.0.0" },
      peerDependencies: { "@scope/utils": "^1.0.0" },
    });

    const { packages } = readWorkspacePackages([ "packages/utils", "apps/nested/web" ]);
    const edges = internalDependencies(packages).map(e => [ e.from.name, e.section, e.to.name, e.spec ]);

    expect(edges).toEqual([
      [ "@scope/web", "dependencies", "@scope/utils", "workspace:^" ],
      [ "@scope/web", "peerDependencies", "@scope/utils", "^1.0.0" ],
    ]);
  });

  it("treats an npm: or workspace: alias as internal only when it aliases a workspace package", () => {
    writePackage("packages/utils", { name: "@scope/utils" });
    writePackage("packages/app", {
      name: "app",
      dependencies: { "u": "npm:@scope/utils@^1.0.0", "@scope/utils": "npm:lodash@^4.0.0" },
      devDependencies: { "w": "workspace:@scope/utils@^", "lodash": "workspace:^" },
    });

    const { packages } = readWorkspacePackages([ "packages/utils", "packages/app" ]);

    expect(internalDependencies(packages).map(e => [ e.name, e.to.name, e.spec ])).toEqual([
      [ "u", "@scope/utils", "npm:@scope/utils@^1.0.0" ],
      [ "w", "@scope/utils", "workspace:@scope/utils@^" ],
    ]);
  });
});

describe("readWorkspacePackages", () => {
  it("reports packages it can't read instead of failing", () => {
    writePackage("packages/ok", { name: "ok" });
    writePackage("packages/broken", "{ nope");
    writePackage("packages/anonymous", { version: "1.0.0" });

    const { packages, unreadable } = readWorkspacePackages([ "packages/ok", "packages/broken", "packages/anonymous" ]);

    expect(packages.map(p => p.name)).toEqual([ "ok" ]);
    expect(unreadable).toEqual([
      { dir: "packages/broken", reason: "package.json is not valid JSON" },
      { dir: "packages/anonymous", reason: "package.json has no name" },
    ]);
  });
});

describe("findCycles", () => {
  it("lists the packages in each cycle and nothing for an acyclic graph", () => {
    writePackage("a", { name: "a", dependencies: { b: "workspace:*" } });
    writePackage("b", { name: "b", devDependencies: { c: "workspace:*" } });
    writePackage("c", { name: "c", dependencies: { a: "workspace:*" } });
    writePackage("d", { name: "d", dependencies: { a: "workspace:*" } });

    const { packages } = readWorkspacePackages([ "a", "b", "c", "d" ]);
    const edges = internalDependencies(packages);

    expect(findCycles(edges)).toEqual([[ "a", "b", "c" ]]);
    expect(findCycles(edges.filter(e => e.section !== "devDependencies"))).toEqual([]);
  });
});

describe("discoverPackages", () => {
  it("reads the globs and finds packages relative to another root", () => {
    fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - \"apps/**\"\n  - \"!apps/skip\"\n");
    writePackage("apps/web/nested", { name: "nested" });
    writePackage("apps/skip", { name: "skip" });
    writePackage("apps/node_modules/dep", { name: "dep" });
    process.chdir(os.tmpdir());

    const globs = readWorkspaceGlobs(dir);

    expect(globs).toEqual([ "apps/**", "!apps/skip" ]);
    expect(discoverPackages(globs!, dir)).toEqual([ "apps/web/nested" ]);
    expect(readWorkspaceGlobs()).toBeNull();
  });
});
