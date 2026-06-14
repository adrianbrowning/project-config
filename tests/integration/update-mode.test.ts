/**
 * Integration tests for --update mode (Phase 1)
 */
import { describe, it, beforeAll } from "vitest";
import { assertFileExists } from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("--update mode: --tool=eslint --yes", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "update-eslint" });
    project.runCli([ "--update", "--tool=eslint", "--yes" ]);
  });

  it("generates eslint.config.ts", () => {
    assertFileExists(project, "eslint.config.ts");
  });
});

describe("--update mode: --tool=knip --yes", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "update-knip" });
    project.runCli([ "--update", "--tool=knip", "--yes" ]);
  });

  it("generates knip.json", () => {
    assertFileExists(project, "knip.json");
  });
});

describe("--update mode: --all --yes --no-release", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "update-all" });
    project.runCli([ "--update", "--all", "--yes", "--no-release" ]);
  });

  it("generates eslint.config.ts", () => {
    assertFileExists(project, "eslint.config.ts");
  });

  it("generates tsconfig.json", () => {
    assertFileExists(project, "tsconfig.json");
  });

  it("generates commitlint.config.js", () => {
    assertFileExists(project, "commitlint.config.js");
  });

  it("generates .lintstagedrc", () => {
    assertFileExists(project, ".lintstagedrc");
  });
});
