/**
 * Full workflow integration test
 * Tests the complete CLI workflow: setup, lint, lint:ts, commit
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileContains,
  assertFileExists,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Complete CLI workflow", () => {
  let project: TestProject;
  let cliOutput: string;

  beforeAll(() => {
    project = new TestProject({ name: "full-workflow" });
    cliOutput = project.runCli([
      "--all",
      "--yes",
      "--ts-mode=bundler",
      "--ts-dom",
      "--ts-type=app",
    ]);
  });

  afterAll(() => {
    project.cleanup();
  });

  it("sets up all tools with --all --yes flags", () => {
    expect(cliOutput).toContain("Running in non-interactive mode");
  });

  it("generates TypeScript configuration", () => {
    assertFileExists(project, "tsconfig.json");
    assertFileContains(project, "tsconfig.json", "@gingacodemonkey/config");

    // Verify tsconfig extends correct base
    const tsconfig = project.readJson<{ extends: string; }>("tsconfig.json");
    expect(tsconfig.extends).toContain("bundler");
    expect(tsconfig.extends).toContain("dom");
    expect(tsconfig.extends).toContain("app");

    // Verify lint:ts script added
    assertPackageJsonScript(project, "lint:ts", "tsc --noEmit");
  });

  it("generates ESLint configuration", () => {
    assertFileExists(project, "eslint.config.ts");
    assertFileExists(project, "eslint.config.style.ts");

    assertFileContains(project, "eslint.config.ts", "@gingacodemonkey/config/eslint");
    assertFileContains(project, "eslint.config.style.ts", "@gingacodemonkey/config/styled");

    // Verify lint scripts added
    assertPackageJsonScript(project, "lint");
    assertPackageJsonScript(project, "lint:fix");
  });

  it("generates Husky git hooks", () => {
    assertFileExists(project, ".husky/pre-commit");
    assertFileExists(project, ".husky/commit-msg");

    expect(project.readFile(".husky/pre-commit")).toMatch(/^pnpm exec lint-staged$/m);
    assertFileContains(project, ".husky/commit-msg", "commitlint");
  });

  it("generates CommitLint configuration", () => {
    assertFileExists(project, "commitlint.config.js");
    assertFileContains(project, "commitlint.config.js", "@commitlint/config-conventional");
  });

  it("generates Lint-Staged configuration", () => {
    assertFileExists(project, ".lintstagedrc");
    assertFileContains(project, ".lintstagedrc", "pnpm lint:fix");
  });

  it("generates Knip configuration", () => {
    assertFileExists(project, "knip.json");
    assertPackageJsonScript(project, "lint:knip", "knip");
  });

  it("generates GitHub Actions workflows", () => {
    assertFileExists(project, ".github/actions/setup/action.yml");
    assertFileExists(project, ".github/workflows/ci_test.yml");
    assertFileExists(project, ".github/workflows/lint.yml");
    assertFileExists(project, ".github/workflows/knip.yml");
    assertFileExists(project, ".github/workflows/ts-check.yml");
  });

  it("sets up Bumpy releases", () => {
    assertFileExists(project, ".bumpy/_config.json");
    assertFileExists(project, ".github/workflows/release.yml");
  });

  it("adds pnpm settings that pnpm actually reads", () => {
    assertFileExists(project, "pnpm-workspace.yaml");
    const configGet = (key: string) => project.exec(`pnpm config get ${key}`).trim();
    expect(configGet("minimumReleaseAge")).toBe("4320");
    expect(configGet("trustPolicy")).toBe("no-downgrade");
    expect(configGet("strictDepBuilds")).toBe("true");
    expect(project.readFile("pnpm-workspace.yaml")).not.toMatch(/^pnpm:/m);
  });

  it("migrates settings nested under a legacy pnpm: key to the top level", () => {
    using legacy = new TestProject({ name: "pnpm-legacy-yaml" });
    legacy.writeFile("pnpm-workspace.yaml", "packages:\n  - '.'\npnpm:\n  minimumReleaseAge: 10\n  strictDepBuilds: false\n");
    legacy.runCli([ "--tool=knip", "--yes" ]);

    const yaml = legacy.readFile("pnpm-workspace.yaml");
    expect(yaml).not.toMatch(/^pnpm:/m);
    expect(yaml).toMatch(/^packages:\n {2}- '\.'$/m);
    expect(legacy.exec("pnpm config get minimumReleaseAge").trim()).toBe("4320");
  });

  it("sets the packageManager field to the running pnpm version", () => {
    const pkg = project.readJson<{ packageManager?: string; }>("package.json");
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it("adds engines field to package.json", () => {
    const pkg = project.readJson<{ engines?: { node?: string; pnpm?: string; }; }>("package.json");
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines?.node).toMatch(/^>=\d+/);
    expect(pkg.engines?.pnpm).toMatch(/^>=\d+/);
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests
  it("installs dependencies successfully", () => {
    project.install();
    // Should complete without errors
  });

  it("creates valid source file that passes lint", () => {
    // Create a simple TypeScript file
    project.writeFile("src/index.ts", `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`);

    // Run lint - should pass
    const lintResult = runCommand(project, "pnpm lint", { expectFailure: true });
    expect(lintResult.exitCode, lintResult.stdout + lintResult.stderr).toBe(0);
  });

  it("lint:ts passes", () => {
    const result = runCommand(project, "pnpm lint:ts", { expectFailure: true });
    expect(result.exitCode).toBe(0);
  });

  it("accepts valid conventional commit", () => {
    const result = project.gitCommit("feat: initial project setup");
    expect(result.exitCode).toBe(0);

    // Verify commit was created
    const lastCommit = project.getLastCommitMessage();
    expect(lastCommit).toContain("feat: initial project setup");
  });

  it("rejects invalid commit message", () => {
    // Make a small change
    project.writeFile("src/another.ts", "export const x = 1;");

    const result = project.gitCommit("invalid commit message", { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("type may not be empty");
  });
});
