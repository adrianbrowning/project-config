/**
 * GitHub Actions integration tests
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  assertFileExists,
  assertFileContains
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("GitHub Actions Workflows", () => {
  let project: TestProject;
  beforeAll(()=> {
    project = new TestProject({ name: "github-actions" });
  });
  beforeEach(() => {
    project.rmDir(".github");
  });
  it("creates .github/workflows directory", () => {
    project.runCli([ "--all", "--yes" ]);

    expect(project.fileExists(".github/workflows")).toBe(true);
  });

  it("generates reusable setup action (always included)", () => {
    project.runCli([ "--all", "--yes" ]);

    assertFileExists(project, ".github/actions/setup/action.yml");
    assertFileContains(project, ".github/actions/setup/action.yml", "pnpm");
  });

  it("generates ci_test.yml (always included)", () => {
    project.runCli([ "--all", "--yes" ]);

    assertFileExists(project, ".github/workflows/ci_test.yml");
  });

  it("generates lint.yml when ESLint is selected", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".github/workflows/lint.yml");
    assertFileContains(project, ".github/workflows/lint.yml", "ESLint");
  });

  it("generates knip.yml when Knip is selected", () => {
    project.runCli([ "--tool=knip", "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".github/workflows/knip.yml");
    assertFileContains(project, ".github/workflows/knip.yml", "knip");
  });

  it("generates ts-check.yml when TypeScript is selected", () => {
    project.runCli([ "--tool=ts", "--yes", "--ts-no-dom", "--ts-type=library", "--tool=githubActions" ]);

    assertFileExists(project, ".github/workflows/ts-check.yml");
    assertFileContains(project, ".github/workflows/ts-check.yml", "TypeScript");
  });

  it("setup action has bot check to prevent infinite loops", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const setupAction = project.readFile(".github/actions/setup/action.yml");
    expect(setupAction).toContain("github-actions[bot]");
  });

  it("setup action uses pnpm action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const setupAction = project.readFile(".github/actions/setup/action.yml");
    expect(setupAction).toContain("pnpm/action-setup");
  });

  it("setup action uses Node.js setup action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const setupAction = project.readFile(".github/actions/setup/action.yml");
    expect(setupAction).toContain("actions/setup-node");
  });

  it("workflows use checkout action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const lintYml = project.readFile(".github/workflows/lint.yml");
    expect(lintYml).toContain("actions/checkout");
  });

  it("generates claude-pr-review.yml when githubActions is selected with --yes", () => {
    project.runCli([ "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".github/workflows/claude-pr-review.yml");
  });

  it("installs cc-pr-review-ci skill from agent-skills repo", () => {
    project.runCli([ "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".claude/skills/cc-pr-review-ci/SKILL.md");
  });
});
