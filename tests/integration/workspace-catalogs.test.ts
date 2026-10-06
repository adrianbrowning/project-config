/**
 * pnpm catalogs in a workspace: the toolchain a new workspace keeps in its catalog, and moving repeated external
 * versions of a seeded multi-package workspace into it
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Manifest = Record<string, Record<string, string> | string>;
type WorkspaceYaml = { catalog: Record<string, string>; };

const TOOLCHAIN = [ "typescript", "@types/node", "eslint", "jiti" ];

const NODE_TEST = [
  "import assert from \"node:assert/strict\";",
  "import { test } from \"node:test\";",
  "import { double } from \"./index.ts\";",
  "",
  "await test(\"double\", () => {",
  "  assert.equal(double(2), 4);",
  "});",
  "",
].join("\n");

/** Every file outside node_modules/.git and caches, so two runs can be compared */
function snapshot(project: TestProject, dir = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(project.dir, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") Object.assign(files, snapshot(project, rel));
    }
    else if (entry.name !== ".eslintcache") {
      files[rel] = project.readFile(rel);
    }
  }
  return files;
}

/** The ranges the test template's root declares; `pnpm add` saved them as the versions it resolved */
function rootToolchain(project: TestProject): Record<string, string> {
  const { devDependencies } = project.readJson<{ devDependencies: { "@types/node": string; "typescript": string; }; }>("package.json");
  return { "typescript": devDependencies.typescript, "@types/node": devDependencies["@types/node"] };
}

/**
 * A library and an app that repeat the root's typescript and @types/node and share `ms`, disagree on `is-number`,
 * and link to each other with workspace:. The library's peer range and a named catalog must survive.
 */
function seedWorkspace(project: TestProject, devDependencies: Record<string, string>): void {
  project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n# ranges for the legacy apps\ncatalogs:\n  legacy:\n    left-pad: ^1.3.0\n");
  const tsconfig = { compilerOptions: { types: [ "node" ] }, include: [ "src" ] };
  project.writeJson("packages/lib/package.json", {
    name: "@demo/lib",
    version: "1.0.0",
    type: "module",
    // The library layer manages a publishable library's build (`tsc`, with outDir/rootDir in its tsconfig)
    scripts: { build: "tsc", test: "node --test" },
    dependencies: { "ms": "^2.1.3", "is-number": "^7.0.0" },
    devDependencies,
    peerDependencies: { ms: "^2.1.0" },
  });
  project.writeJson("packages/lib/tsconfig.json", tsconfig);
  project.writeFile("packages/lib/src/index.ts", "export function double(value: number): number {\n  return value * 2;\n}\n");
  project.writeFile("packages/lib/src/index.test.ts", NODE_TEST);
  project.writeJson("packages/app/package.json", {
    name: "@demo/app",
    private: true,
    type: "module",
    scripts: { build: "tsc --rootDir src --outDir dist" },
    dependencies: { "@demo/lib": "workspace:^", "ms": "^2.1.3", "is-number": "^6.0.0" },
    devDependencies,
  });
  project.writeJson("packages/app/tsconfig.json", tsconfig);
  project.writeFile("packages/app/src/index.ts", "export const name = \"app\";\n");
}

/** The manifest `pnpm pack` puts in the package's tarball */
function packedManifest(project: TestProject, packageDir: string): Manifest {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-pack-"));
  try {
    project.exec(`cd ${packageDir} && pnpm pack --pack-destination ${destination}`);
    const tarball = fs.readdirSync(destination).find(file => file.endsWith(".tgz"));
    return JSON.parse(project.exec(`tar -xzOf ${path.join(destination, tarball ?? "missing.tgz")} package/package.json`)) as Manifest;
  }
  finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
}

describe("pnpm catalogs", () => {
  it("a new workspace keeps its shared toolchain versions once, in the default catalog, and builds from them", () => {
    using project = new TestProject({ name: "catalog-new" });
    const declared = rootToolchain(project);
    project.runCli([ "--tool=workspace", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    const { catalog } = YAML.parse(project.readFile("pnpm-workspace.yaml")) as WorkspaceYaml;
    expect(Object.keys(catalog).toSorted((a, b) => a.localeCompare(b))).toEqual(TOOLCHAIN.toSorted((a, b) => a.localeCompare(b)));
    // The root's own ranges are kept; pnpm saves what it resolved for the ones setup installs
    expect(catalog).toMatchObject(declared);
    expect(catalog.eslint).toMatch(/^\^9\./);
    expect(catalog.jiti).toMatch(/^\^2\./);
    const devDependencies = project.readJson<{ devDependencies: Record<string, string>; }>("package.json").devDependencies;
    for (const name of TOOLCHAIN) expect(devDependencies[name], name).toBe("catalog:");
    // Pinned to the CLI release that wrote sharedConfig/, so it stays out of the catalog
    expect(devDependencies["@gingacodemonkey/config"]).toMatch(/^file:/);

    // The lockfile already matches the catalog references, and everything resolves through them
    const install = runCommand(project, "pnpm install --frozen-lockfile", { expectFailure: true });
    expect(install.exitCode, install.stdout + install.stderr).toBe(0);
    const check = runCommand(project, "pnpm check", { expectFailure: true });
    expect(check.exitCode, check.stdout + check.stderr).toBe(0);
  });

  it("moves repeated versions of an existing workspace into the catalog, keeps differing ranges, peers and workspace: links, and packs real ranges", () => {
    using project = new TestProject({ name: "catalog-migrate" });
    const toolchain = rootToolchain(project);
    seedWorkspace(project, toolchain);
    const flags = [ "--tool=workspace", "--yes", "--workspace-update-all", "--workspace-catalog", "--ts-mode=tsc", "--ts-no-dom", "--ts-type=library" ];
    const output = project.runCli(flags);

    const workspace = YAML.parse(project.readFile("pnpm-workspace.yaml")) as Record<string, unknown>;
    expect(workspace).toMatchObject({
      packages: [ "packages/*" ],
      catalog: { ms: "^2.1.3", ...toolchain },
      catalogs: { legacy: { "left-pad": "^1.3.0" } },
    });
    expect(workspace.catalog).not.toHaveProperty("is-number");
    expect(workspace.catalog).not.toHaveProperty("@demo/lib");
    expect(project.readFile("pnpm-workspace.yaml")).toContain("# ranges for the legacy apps\n");
    expect(output).toContain("kept differing ranges for is-number (^6.0.0 in packages/app; ^7.0.0 in packages/lib)");

    const lib = project.readJson<Manifest>("packages/lib/package.json");
    const app = project.readJson<Manifest>("packages/app/package.json");
    expect(lib).toMatchObject({
      dependencies: { "ms": "catalog:", "is-number": "^7.0.0" },
      devDependencies: { "typescript": "catalog:", "@types/node": "catalog:" },
      peerDependencies: { ms: "^2.1.0" },
    });
    expect(app).toMatchObject({
      dependencies: { "@demo/lib": "workspace:^", "ms": "catalog:", "is-number": "^6.0.0" },
      devDependencies: { "typescript": "catalog:", "@types/node": "catalog:" },
    });
    expect(project.readJson<Manifest>("package.json").devDependencies).toMatchObject({ "typescript": "catalog:", "@types/node": "catalog:" });

    expect(runCommand(project, "pnpm install --frozen-lockfile", { expectFailure: true }).exitCode).toBe(0);
    for (const script of [ "lint", "lint:ts", "test", "build" ]) {
      const result = runCommand(project, `pnpm ${script}`, { expectFailure: true });
      expect(result.exitCode, `${script}: ${result.stdout}${result.stderr}`).toBe(0);
    }

    // Consumers of the published package get the catalog's ranges, and workspace: links as versions
    expect(packedManifest(project, "packages/lib")).toMatchObject({
      dependencies: { "ms": "^2.1.3", "is-number": "^7.0.0" },
      devDependencies: toolchain,
      peerDependencies: { ms: "^2.1.0" },
    });

    const first = snapshot(project);
    project.runCli(flags);
    expect(snapshot(project)).toEqual(first);
    const update = project.runCli([ "--update", "--yes", "--workspace-catalog" ]);
    expect(update).not.toMatch(/^ {2}updated /m);
    expect(snapshot(project)).toEqual(first);
  });
});
