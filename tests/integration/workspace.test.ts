/**
 * pnpm workspace setup: shared root configs in sharedConfig/, packages linked to them
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

type Manifest = { devDependencies?: Record<string, string>; name?: string; scripts?: Record<string, string>; };
type ShowConfig = { compilerOptions: Record<string, unknown>; };

const PACKAGE_SCRIPTS = {
  "lint": "eslint --config eslint.config.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0",
  "lint:fix": "eslint --config eslint.config.style.ts \"src/**/*.{j,t}s{,x}\" --cache --max-warnings=0 --fix",
  "lint:ts": "tsc --noEmit",
};

const NEGATED_CONJUNCTION = "export function check(a: boolean, b: boolean): boolean {\n  return !(a && b);\n}\n";

/** Every file outside node_modules/.git and build caches, so two runs can be compared */
function snapshot(project: TestProject, dir = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(project.dir, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") Object.assign(files, snapshot(project, rel));
    }
    else if (entry.name !== ".eslintcache" && entry.name !== "pnpm-lock.yaml") {
      files[rel] = project.readFile(rel);
    }
  }
  return files;
}

function showConfig(project: TestProject, packageDir: string): ShowConfig {
  return JSON.parse(project.exec(`cd ${packageDir} && pnpm exec tsc --showConfig`)) as ShowConfig;
}

/** Two packages at different depths, one with a string `extends`, plus an excluded and an unmigratable one */
function writeExistingWorkspace(project: TestProject): void {
  project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - 'apps/*/*'\n  - '!packages/ignored'\ncatalog:\n  zod: ^4.0.0\n");
  project.writeJson("packages/a/package.json", { name: "a", private: true, type: "module", scripts: { build: "echo build", lint: "echo old" } });
  project.writeJson("packages/a/tsconfig.json", { compilerOptions: { noUnusedLocals: false }, include: [ "src" ] });
  project.writeFile("packages/a/src/index.ts", "export const a = 1;\n");
  project.writeJson("apps/web/b/package.json", { name: "b", private: true, type: "module" });
  project.writeJson("apps/web/b/tsconfig.local.json", { compilerOptions: { noUnusedParameters: false } });
  project.writeJson("apps/web/b/tsconfig.json", { extends: "./tsconfig.local.json", include: [ "src" ] });
  project.writeFile("apps/web/b/src/index.ts", "export function f(_x: number, y: number): number {\n  return y;\n}\n");
  project.writeJson("packages/ignored/package.json", { name: "ignored", private: true });
  project.writeJson("packages/broken/package.json", { name: "broken", private: true });
  project.writeFile("packages/broken/tsconfig.json", "{ // a comment, so not plain JSON\n  \"include\": [\"src\"]\n}\n");
}

describe("pnpm workspace setup", () => {
  describe("blank project", () => {
    it("creates a workspace with shared configs and a sample package that lints and type-checks", () => {
      using project = new TestProject({ name: "workspace-blank" });
      const output = project.runCli([ "--tool=workspace", "--yes", "--ts-no-dom", "--ts-type=library" ]);

      expect(project.readFile("pnpm-workspace.yaml")).toMatch(/^packages:\n {2}- 'packages\/\*'$/m);
      expect(project.readJson("sharedConfig/tsconfig.base.json")).toEqual({ extends: "@gingacodemonkey/config/bundler/no-dom/library" });
      expect(project.readFile("sharedConfig/eslint.config.ts")).toContain("@gingacodemonkey/config/eslint");
      expect(project.readJson<Manifest>("package.json").scripts).toMatchObject({ "lint": "pnpm -r lint", "lint:ts": "pnpm -r lint:ts", "lint:fix": "pnpm -r lint:fix" });

      expect(project.readJson<Manifest>("packages/example/package.json").scripts).toEqual(PACKAGE_SCRIPTS);
      expect(project.readJson("packages/example/tsconfig.json")).toEqual({ extends: "../../sharedConfig/tsconfig.base.json", include: [ "src" ] });
      expect(project.readFile("packages/example/eslint.config.ts")).toBe("import config from \"../../sharedConfig/eslint.config.ts\";\n\nexport default config;\n");
      expect(output).toContain("Packages: 1 updated");

      expect(runCommand(project, "pnpm --recursive lint", { expectFailure: true }).exitCode).toBe(0);
      expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
    });

    it("lints the sample package with the shared rules and its tsconfig inherits the shared preset", () => {
      using project = new TestProject({ name: "workspace-shared-rules" });
      project.runCli([ "--tool=workspace", "--yes", "--ts-no-dom", "--ts-type=library" ]);
      project.writeFile("packages/example/src/check.ts", NEGATED_CONJUNCTION);
      const lint = runCommand(project, "pnpm --recursive lint", { expectFailure: true });
      expect(lint.exitCode).not.toBe(0);
      expect(lint.stdout + lint.stderr).toContain("de-morgan/no-negated-conjunction");
      expect(showConfig(project, "packages/example").compilerOptions.strict).toBe(true);
    });

    it("bootstraps an empty directory via pnpm dlx, pinning this package's version", () => {
      using project = new TestProject({ name: "workspace-empty-dir" });
      const tarballSpec = project.readJson<Manifest>("package.json").devDependencies?.["@gingacodemonkey/config"] ?? "";
      expect(tarballSpec).toMatch(/^file:/);
      const tarball = path.resolve(project.dir, tarballSpec.replace(/^file:/, ""));
      const ownManifest: unknown = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"));
      const ownVersion = ownManifest !== null && typeof ownManifest === "object" && "version" in ownManifest ? ownManifest.version : undefined;
      expect(ownVersion).toEqual(expect.any(String));

      // Nothing but .git: no manifest, no node_modules, no installed CLI
      for (const entry of fs.readdirSync(project.dir)) {
        if (entry !== ".git") fs.rmSync(path.join(project.dir, entry), { recursive: true, force: true });
      }

      // Resolve the pinned version to this build's tarball, so the test doesn't depend on it being published
      const overrides = JSON.stringify(JSON.stringify({ "@gingacodemonkey/config": `file:${tarball}` }));
      runCommand(project, `npm_config_overrides=${overrides} pnpm dlx ${tarball} --tool=workspace --yes`);

      const manifest = project.readJson<Manifest & { private?: boolean; type?: string; }>("package.json");
      expect(manifest).toMatchObject({ private: true, type: "module" });
      expect(manifest.devDependencies?.["@gingacodemonkey/config"]).toBe(ownVersion);
      expect(project.fileExists("packages/example/tsconfig.json")).toBe(true);
      expect(runCommand(project, "pnpm --recursive lint", { expectFailure: true }).exitCode).toBe(0);
      expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
    });

    it("uses --workspace-packages for the globs and the sample package location", () => {
      using project = new TestProject({ name: "workspace-custom-glob" });
      project.runCli([ "--tool=workspace", "--yes", "--workspace-packages=libs/*" ]);

      expect(project.readFile("pnpm-workspace.yaml")).toMatch(/^packages:\n {2}- 'libs\/\*'$/m);
      expect(project.fileExists("libs/example/tsconfig.json")).toBe(true);
    });

    it("changes nothing when setup runs a second time", () => {
      using project = new TestProject({ name: "workspace-rerun" });
      project.runCli([ "--tool=workspace", "--yes" ]);
      const first = snapshot(project);

      project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all" ]);
      expect(snapshot(project)).toEqual(first);
    });
  });

  describe("existing workspace", () => {
    it("links every discovered package with --workspace-update-all and keeps their overrides", () => {
      using project = new TestProject({ name: "workspace-update-all" });
      writeExistingWorkspace(project);
      const output = project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all" ]);

      expect(output).toContain("Packages: 2 updated, 0 unchanged, 0 skipped, 1 could not be migrated");
      expect(project.readFile("pnpm-workspace.yaml")).toMatch(/^packages:\n {2}- 'packages\/\*'\n {2}- 'apps\/\*\/\*'\n {2}- '!packages\/ignored'\ncatalog:\n {2}zod: \^4\.0\.0$/m);

      expect(project.readJson<Manifest>("packages/a/package.json").scripts).toEqual({ build: "echo build", ...PACKAGE_SCRIPTS });
      expect(project.readJson("packages/a/tsconfig.json")).toEqual({
        compilerOptions: { noUnusedLocals: false },
        include: [ "src" ],
        extends: "../../sharedConfig/tsconfig.base.json",
      });
      expect(project.readJson("apps/web/b/tsconfig.json")).toEqual({
        extends: [ "../../../sharedConfig/tsconfig.base.json", "./tsconfig.local.json" ],
        include: [ "src" ],
      });
      expect(project.readFile("apps/web/b/eslint.config.ts")).toContain("\"../../../sharedConfig/eslint.config.ts\"");
      expect(project.fileExists("packages/ignored/eslint.config.ts")).toBe(false);

      // Shared preset applies, and each package's own overrides still win
      const a = showConfig(project, "packages/a").compilerOptions;
      const b = showConfig(project, "apps/web/b").compilerOptions;
      expect([ a.strict, a.noUnusedLocals ]).toEqual([ true, false ]);
      expect([ b.strict, b.noUnusedParameters ]).toEqual([ true, false ]);
      expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
      expect(runCommand(project, "pnpm --recursive lint", { expectFailure: true }).exitCode).toBe(0);
    });

    it("leaves a package it cannot migrate untouched and reports it", () => {
      using project = new TestProject({ name: "workspace-broken" });
      writeExistingWorkspace(project);
      const before = snapshot(project);
      const output = project.runCli([ "--tool=workspace", "--yes", "--workspace-update-all" ]);

      expect(output).toContain("packages/broken: could not be migrated (tsconfig.json is not plain JSON");
      const after = snapshot(project);
      for (const file of [ "packages/broken/package.json", "packages/broken/tsconfig.json" ]) expect(after[file]).toBe(before[file]);
      expect(project.fileExists("packages/broken/eslint.config.ts")).toBe(false);
    });

    // No --yes either: a --tool run is non-interactive, so this must not prompt (a prompt would hang the test)
    it("without --workspace-update-all, writes only the root configs and reports packages skipped", () => {
      using project = new TestProject({ name: "workspace-decline" });
      writeExistingWorkspace(project);
      const before = snapshot(project);
      const output = project.runCli([ "--tool=workspace" ]);

      expect(output).toContain("Packages: 0 updated, 0 unchanged, 3 skipped, 0 could not be migrated");
      const after = snapshot(project);
      const changed = Object.keys({ ...before, ...after }).filter(file => before[file] !== after[file]);
      expect(changed.filter(file => !/^(?:package\.json|pnpm-workspace\.yaml|sharedConfig\/)/.test(file))).toEqual([]);
      expect(project.fileExists("sharedConfig/tsconfig.base.json")).toBe(true);
    });
  });
});
