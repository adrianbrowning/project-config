/**
 * TypeScript configuration integration tests
 * Tests each TS config type: bundler/tsc × dom/no-dom × app/library
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileContains,
  assertFileExists,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

// Helper to get fixture content
function getFixtureContent(fixturePath: string): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "fixtures", fixturePath),
    "utf-8"
  );
}

/** Writes `file`, expects `pnpm lint:ts` to fail on it with one of `codes`, then removes it again. */
function expectTypeCheckFailure(project: TestProject, file: string, content: string, codes: RegExp): void {
  project.writeFile(file, content);
  try {
    const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
    expect(result.exitCode, result.stdout).not.toBe(0);
    expect(result.stdout).toContain(file);
    expect(result.stdout).toMatch(codes);
  }
  finally {
    // Even when an assertion fails, so later checks in the same project aren't tripped by the probe
    fs.rmSync(path.join(project.dir, file), { force: true });
  }
}

/** Proves tsc checks files under src/: a deliberate type error must fail. */
function expectTypeErrorsCaught(project: TestProject, file = "src/type-error.ts"): void {
  expectTypeCheckFailure(project, file, "export const n: number = \"x\";\n", /TS2322/);
}

/** Proves a no-dom config has no DOM lib: `document` must not exist. */
function expectDomGlobalsRejected(project: TestProject): void {
  expectTypeCheckFailure(project, "src/dom-probe.ts", "export const b = document.body;\n", /TS2584|TS2304/);
}

describe("TypeScript Configurations", () => {

  let project: TestProject;
  beforeEach(() => {
    project = new TestProject({ name: "ts-config" });
  });
  afterEach(() => {
    project.cleanup();
  });

  it("adds lint:ts script to package.json", () => {
    project.runCli([ "--tool=ts", "--yes", "--ts-no-dom", "--ts-type=library" ]);
    const pkg = project.readJson<{ scripts?: { "lint:ts"?: string; }; }>("package.json");
    expect(pkg.scripts?.["lint:ts"]).toBe("tsc --noEmit");
  });

  describe("bundler/dom/app (Vite/React web app)", () => {
    it("generates correct tsconfig and passes lint:ts", () => {
      // Add React before setup, as in a real React project; later `pnpm add` runs under minimumReleaseAge
      project.exec("pnpm add -D react @types/react");
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=bundler",
        "--ts-dom",
        "--ts-type=app",
        "--ts-jsx=react-jsx",
      ]);

      // Verify tsconfig
      assertFileExists(project, "tsconfig.json");
      const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/bundler/dom/app");

      // Verify reset.d.ts created for app type
      assertFileExists(project, "src/reset.d.ts");
      assertFileContains(project, "src/reset.d.ts", "@total-typescript/ts-reset");
      assertFileContains(project, "src/reset.d.ts", "ts-reset/dom");

      // Add React fixture
      project.writeFile("src/App.tsx", getFixtureContent("react-app/App.tsx"));

      // Type-check should pass
      assertPackageJsonScript(project, "lint:ts");
      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectTypeErrorsCaught(project, "src/type-error.tsx");
    });

    it("with --yes and no --ts-jsx, type-checks and lints nested .tsx and .ts without editing tsconfig.json", () => {
      project.exec("pnpm add -D react @types/react");
      project.runCli([ "--tool=ts", "--tool=eslint", "--yes" ]);
      const tsconfig = project.readJson<{ compilerOptions: { jsx?: string; }; }>("tsconfig.json");
      expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");

      project.writeFile("src/components/App.tsx", getFixtureContent("react-app/App.tsx"));
      expect(runCommand(project, "pnpm lint:ts", { expectFailure: true }).exitCode).toBe(0);
      const lint = runCommand(project, "pnpm lint", { expectFailure: true });
      expect(lint.exitCode, lint.stdout).toBe(0);

      // Two directories below src/ is still part of the project
      project.writeFile("src/a/b/deep.ts", "export const n: number = \"x\";\n");
      const broken = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(broken.exitCode).not.toBe(0);
      expect(broken.stdout).toContain("src/a/b/deep.ts");
    });
  });

  describe("bundler/dom/library (DOM library)", () => {
    it("generates correct tsconfig without reset.d.ts", () => {
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=bundler",
        "--ts-dom",
        "--ts-type=library",
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/bundler/dom/library");

      // Library type should NOT have reset.d.ts
      expect(project.fileExists("src/reset.d.ts")).toBe(false);

      // Add DOM library code
      project.writeFile("src/index.ts", `
export function getElementById(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function addClass(el: HTMLElement, className: string): void {
  el.classList.add(className);
}
`);

      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectTypeErrorsCaught(project);
    });
  });

  describe("tsc/no-dom/app (Node.js app)", () => {
    it("generates correct tsconfig for Node.js app", () => {
      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      project.writeJson("package.json", { ...pkg, type: "module" });

      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=app",
        "--ts-outdir=dist",
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ compilerOptions: { outDir: string; }; extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/tsc/no-dom/app");
      expect(tsconfig.compilerOptions.outDir).toBe("dist");

      // Verify reset.d.ts exists (app type) but without DOM
      assertFileExists(project, "src/reset.d.ts");
      assertFileContains(project, "src/reset.d.ts", "@total-typescript/ts-reset");
      // Should NOT contain DOM reset
      const resetContent = project.readFile("src/reset.d.ts");
      expect(resetContent).not.toContain("ts-reset/dom");

      // Add Node.js fixture
      project.writeFile("src/index.ts", getFixtureContent("node-library/index.ts"));

      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectDomGlobalsRejected(project);
      expectTypeErrorsCaught(project);
    });
  });

  describe("tsc/no-dom/library (Node.js library)", () => {
    it("generates correct tsconfig for Node.js library", () => {
      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      project.writeJson("package.json", { ...pkg, type: "module" });

      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=library",
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/tsc/no-dom/library");

      // Library type should NOT have reset.d.ts
      expect(project.fileExists("src/reset.d.ts")).toBe(false);

      // Add library code
      project.writeFile("src/index.ts", getFixtureContent("node-library/index.ts"));

      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectDomGlobalsRejected(project);
      expectTypeErrorsCaught(project);
    });
  });

  describe("bundler/no-dom/app (Bundled Node.js app)", () => {
    it("generates correct tsconfig for bundled Node app", () => {
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=bundler",
        "--ts-no-dom",
        "--ts-type=app",
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/bundler/no-dom/app");

      // App type should have reset.d.ts
      assertFileExists(project, "src/reset.d.ts");

      // Add Node.js code
      project.writeFile("src/index.ts", getFixtureContent("node-library/index.ts"));

      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectDomGlobalsRejected(project);
      expectTypeErrorsCaught(project);
    });
  });

  describe("tsc/no-dom/library-monorepo", () => {
    it("generates correct tsconfig for monorepo library", () => {
      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      project.writeJson("package.json", { ...pkg, type: "module" });

      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=library-monorepo",
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
      expect(tsconfig.extends).toBe("@gingacodemonkey/config/tsc/no-dom/library-monorepo");

      // Library type should NOT have reset.d.ts
      expect(project.fileExists("src/reset.d.ts")).toBe(false);

      project.writeFile("src/index.ts", getFixtureContent("node-library/index.ts"));

      const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
      expect(result.exitCode).toBe(0);

      expectDomGlobalsRejected(project);
      expectTypeErrorsCaught(project);
    });
  });

  describe("package.json type: module", () => {
    beforeEach(function removeTypeFromPackageJson(){
      const p = project.readJson<{ type?: string; }>("package.json");
      project.writeJson("package.json", { ...p, type: undefined });
    });
    it("adds type: module when --ts-type-module flag is passed", () => {
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=library",
        "--ts-type-module",
      ]);

      // Verify package.json has type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      expect(pkg.type).toBe("module");
    });

    it("does NOT add type: module when --ts-type-module flag is not passed", () => {
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=library",
      ]);

      // Verify package.json does NOT have type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      expect(pkg.type).toBeUndefined();
    });

    it("does NOT add type: module when --no-ts-type-module flag is passed", () => {
      project.runCli([
        "--tool=ts",
        "--yes",
        "--ts-mode=tsc",
        "--ts-no-dom",
        "--ts-type=library",
        "--no-ts-type-module",
      ]);

      // Verify package.json does NOT have type: module
      const pkg = project.readJson<{ type?: string; }>("package.json");
      expect(pkg.type).toBeUndefined();
    });
  });
});
