/* eslint-disable vitest/expect-expect */
/**
 * Integration tests for --update mode (Phase 1)
 */
import { describe, it } from "vitest";
import { assertFileExists } from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("--update mode", () => {
  it("generates eslint.config.ts for --tool=eslint", () => {
    using project = new TestProject({ name: "update-eslint" });
    project.runCli([ "--update", "--tool=eslint", "--yes" ]);
    assertFileExists(project, "eslint.config.ts");
  });

  it("generates knip.json for --tool=knip", () => {
    using project = new TestProject({ name: "update-knip" });
    project.runCli([ "--update", "--tool=knip", "--yes" ]);
    assertFileExists(project, "knip.json");
  });

  describe("--all --yes --no-release", () => {
    it("generates all expected config files", () => {
      using project = new TestProject({ name: "update-all" });
      project.runCli([ "--update", "--all", "--yes", "--no-release" ]);

      assertFileExists(project, "eslint.config.ts");
      assertFileExists(project, "tsconfig.json");
      assertFileExists(project, "commitlint.config.js");
      assertFileExists(project, ".lintstagedrc");
    });
  });
});
