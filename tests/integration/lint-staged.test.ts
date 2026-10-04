/**
 * Lint-Staged integration tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFileExists
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Lint-Staged Configuration", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "lintstaged-config" });
    project.runCli([ "--tool=lintStaged", "--yes" ]);
  });
  afterAll(() => project.cleanup());

  it("generates .lintstagedrc", () => {

    assertFileExists(project, ".lintstagedrc");
  });

  it("config targets JS/TS/TSX files", () => {

    const config = project.readFile(".lintstagedrc");
    expect(config).toContain("*.{js,ts,jsx,tsx}");
  });

  it("runs pnpm lint:fix for JS/TS files", () => {
    const config = project.readJson<Record<string, Array<string>>>(".lintstagedrc");
    const tsGlob = Object.keys(config).find(k => k.includes("ts"));
    expect(tsGlob).toBeDefined();
    const commands = config[tsGlob!] ?? [];

    expect(commands.some(c => c.includes("pnpm lint:fix"))).toBe(true);
  });
});
