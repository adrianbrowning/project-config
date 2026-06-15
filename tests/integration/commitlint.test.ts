/* eslint-disable vitest/expect-expect */
/**
 * CommitLint integration tests
 */

import { describe, it, expect } from "vitest";
import {
  assertFileExists,
  assertFileContains
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("CommitLint Configuration", () => {
  it("generates commitlint.config.js with conventional config", () => {
    using project = new TestProject({ name: "commitlint-config" });
    project.runCli([ "--tool=commitLint", "--yes" ]);

    assertFileExists(project, "commitlint.config.js");
    assertFileContains(project, "commitlint.config.js", "@commitlint/config-conventional");
  });

  it("has subject-case rule configured", () => {
    using project = new TestProject({ name: "commitlint-rules" });
    project.runCli([ "--tool=commitLint", "--yes" ]);

    assertFileContains(project, "commitlint.config.js", "subject-case");
    assertFileContains(project, "commitlint.config.js", "sentence-case");
    assertFileContains(project, "commitlint.config.js", "lower-case");
  });

  describe("commit messages", () => {
    it("rejects non-conventional commit message", () => {
      using project = new TestProject({ name: "commitlint-reject" });
      project.runCli([ "--tool=husky", "--tool=commitLint", "--yes" ]);
      project.writeFile("src/index.ts", "export const x = 1;");

      const result = project.gitCommit("bad commit message", { expectFailure: true });
      expect(result.exitCode).not.toBe(0);
    });

    it("accepts feat: conventional commit", () => {
      using project = new TestProject({ name: "commitlint-feat" });
      project.runCli([ "--tool=husky", "--tool=commitLint", "--yes" ]);
      project.writeFile("src/index.ts", "export const x = 1;");

      const result = project.gitCommit("feat: add new feature");
      expect(result.exitCode).toBe(0);
    });

    it("accepts fix: conventional commit", () => {
      using project = new TestProject({ name: "commitlint-fix" });
      project.runCli([ "--tool=husky", "--tool=commitLint", "--yes" ]);
      project.writeFile("src/index.ts", "export const x = 1;");

      const result = project.gitCommit("fix: resolve bug");
      expect(result.exitCode).toBe(0);
    });

    it("accepts chore: conventional commit", () => {
      using project = new TestProject({ name: "commitlint-chore" });
      project.runCli([ "--tool=husky", "--tool=commitLint", "--yes" ]);
      project.writeFile("src/index.ts", "export const x = 1;");

      const result = project.gitCommit("chore: update dependencies");
      expect(result.exitCode).toBe(0);
    });
  });
});
