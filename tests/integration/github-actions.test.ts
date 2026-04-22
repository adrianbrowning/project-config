/**
 * GitHub Actions integration tests
 */

import {describe, it, expect, beforeAll, beforeEach} from "vitest";
import {
  assertFileExists,
  assertFileNotExists,
  assertFileContains
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("GitHub Actions Workflows", () => {
  let project: TestProject;
  beforeAll(()=> {
    project = new TestProject({ name: "github-actions" });
  });
  beforeEach(() => {
    project.rmDir(".github/workflows");
  })
  it("creates .github/workflows directory", () => {
    project.runCli([ "--all", "--yes", "--no-release" ]);

    expect(project.fileExists(".github/workflows")).toBe(true);
  });

  it("generates cache.yml (always included)", () => {
    project.runCli([ "--all", "--yes", "--no-release" ]);

    assertFileExists(project, ".github/workflows/cache.yml");
    assertFileContains(project, ".github/workflows/cache.yml", "pnpm");
  });

  it("generates ci_test.yml (always included)", () => {
    project.runCli([ "--all", "--yes", "--no-release" ]);

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

  it("does NOT generate release.yml with --no-release flag", () => {
    project.runCli([ "--all", "--yes", "--no-release" ]);

    assertFileNotExists(project, ".github/workflows/release.yml");
  });

  it("lint.yml has bot check to prevent infinite loops", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const lintYml = project.readFile(".github/workflows/lint.yml");
    expect(lintYml).toContain("github-actions[bot]");
  });

  it("workflows use pnpm action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const lintYml = project.readFile(".github/workflows/lint.yml");
    expect(lintYml).toContain("pnpm/action-setup");
  });

  it("workflows use Node.js setup action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const lintYml = project.readFile(".github/workflows/lint.yml");
    expect(lintYml).toContain("actions/setup-node");
  });

  it("workflows use checkout action", () => {
    project.runCli([ "--tool=eslint", "--tool=githubActions", "--yes" ]);

    const lintYml = project.readFile(".github/workflows/lint.yml");
    expect(lintYml).toContain("actions/checkout");
  });

  it("generates release.yml when semantic-release is selected", () => {
    project.runCli([ "--tool=semanticReleaseNotes", "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".github/workflows/release.yml");
  });

  it("generates claude-pr-review.yml when githubActions is selected with --yes", () => {
    project.runCli([ "--tool=githubActions", "--yes" ]);

    assertFileExists(project, ".github/workflows/claude-pr-review.yml");
  });

  it("generates all cc-pr-review-ci skill reference files", () => {
    project.runCli([ "--tool=githubActions", "--yes" ]);

    const refs = [ "devops", "duplication", "format", "holistic", "performance", "react-ts", "security", "testing" ];
    for (const ref of refs) {
      assertFileExists(project, `.claude/skills/cc-pr-review-ci/references/${ref}.md`);
    }
    assertFileExists(project, ".claude/skills/cc-pr-review-ci/SKILL.md");
  });
});
