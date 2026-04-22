/**
 * Lint-Staged integration tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  assertFileExists,
  assertFileContains
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Lint-Staged Configuration", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "lintstaged-config" });
    project.runCli([ "--tool=lintStaged", "--yes" ]);
  });
  it("generates .lintstagedrc", () => {



    assertFileExists(project, ".lintstagedrc");
  });

  it("config targets JS/TS/TSX files", () => {


    const config = project.readFile(".lintstagedrc");
    expect(config).toContain("*.{js,ts,jsx,tsx}");
  });

  it("uses pnpm lint:fix command", () => {


    // Config delegates to lint:fix script which handles eslint with --fix, --cache, --max-warnings=0
    assertFileContains(project, ".lintstagedrc",
        `{
  "*.{js,ts,jsx,tsx}": [
    "eslint --config eslint.config.style.ts --fix --cache"
  ]
}`);
  });

  it("is valid JSON", () => {


    // Should not throw when parsing as JSON
    const config = project.readJson(".lintstagedrc");
    expect(config).toBeDefined();
    expect(typeof config).toBe("object");
  });
});
