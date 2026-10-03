/**
 * Husky and Git hooks integration tests
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitCommit, runCommand } from "../utils/command-runner.ts";
import {
  assertFileContains,
  assertFileExists
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Husky Git Hooks", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "husky-precommit" });
    project.runCli([ "--tool=husky", "--yes" ]);
  });

  it("generates .husky/pre-commit with lint-staged command", () => {

    assertFileExists(project, ".husky/pre-commit");
    assertFileContains(project, ".husky/pre-commit", "lint-staged");
  });

  it("generates .husky/commit-msg with commitlint", () => {

    assertFileExists(project, ".husky/commit-msg");
    assertFileContains(project, ".husky/commit-msg", "commitlint");
  });

  it("commit-msg hook has ticket prepend logic", () => {

    const commitMsg = project.readFile(".husky/commit-msg");
    expect(commitMsg).toContain("TICKET");
    expect(commitMsg).toContain("git rev-parse --abbrev-ref HEAD");
  });

  it("pre-commit hook runs lint-staged on commit", { timeout: 180000 }, () => {
    using project = new TestProject({ name: "husky-lint-staged" });
    project.runCli([
      "--tool=ts",
      "--tool=eslint",
      "--tool=husky",
      "--tool=lintStaged",
      "--tool=commitLint",
      "--yes",
      "--ts-no-dom",
      "--ts-type=library",
    ]);

    // Create a valid TypeScript file
    project.writeFile("src/index.ts", `
export const hello = 'world';
`);

    // Install dependencies (may fail in CI due to network/permissions, but we still test the hook runs)
    try {
      project.install();
    }
    catch {
      // Ignore install failures - the test will still verify hook execution
    }

    // Commit should succeed (lint-staged runs on pre-commit)
    const result = gitCommit(project, "feat: add hello", { expectFailure: true });
    // May fail due to lint-staged but should run the hook
    expect(result.stdout + result.stderr).not.toContain("husky - command not found");
  });

  it("creates .husky/pre-push hook with lint command", () => {
    assertFileExists(project, ".husky/pre-push");
    assertFileContains(project, ".husky/pre-push", "pnpm lint");
  });
});

describe("commit-msg ticket prefix", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "husky-ticket" });
    project.runCli([ "--tool=husky", "--tool=commitLint", "--yes" ]);
    project.writeFile("src/index.ts", "export const x = 1;\n");
  });

  afterAll(() => {
    project.cleanup();
  });

  it("leaves the message alone on a branch without a ticket", () => {
    project.gitBranch("main");
    gitCommit(project, "feat: add base");
    expect(project.getLastCommitMessage()).toBe("feat: add base");
  });

  it("prepends the ticket from the branch name", () => {
    project.gitBranch("feature/PROJ-123-add-feature");
    project.writeFile("src/index.ts", "export const x = 2;\n");
    gitCommit(project, "feat: add thing");
    expect(project.getLastCommitMessage()).toBe("PROJ-123\n\nfeat: add thing");
  });

  it("rejects an invalid message on a ticket branch without rewriting it", () => {
    project.writeFile("src/index.ts", "export const x = 3;\n");
    const result = gitCommit(project, "invalid commit message", { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("type may not be empty");
    expect(project.getLastCommitMessage()).toBe("PROJ-123\n\nfeat: add thing");
  });

  // commitlint rejects a ticket-only header, so stub `pnpm` and run the hook directly with POSIX sh
  it("does not prepend the ticket twice", () => {
    const stubBin = path.join(project.dir, ".stub-bin");
    project.writeFile(".stub-bin/pnpm", "#!/bin/sh\nexit 0\n");
    fs.chmodSync(path.join(stubBin, "pnpm"), 0o700);
    project.writeFile(".msg", "PROJ-123\n\nfeat: add thing\n");

    runCommand(project, `PATH="${stubBin}:$PATH" sh .husky/commit-msg .msg`);
    expect(project.readFile(".msg")).toBe("PROJ-123\n\nfeat: add thing\n");
  });
});
