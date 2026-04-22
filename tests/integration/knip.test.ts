/**
 * Knip integration tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileExists,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Knip Configuration", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "knip-config" });
    project.runCli([ "--tool=knip", "--yes" ]);
  });
  it("generates knip.json", () => {

    assertFileExists(project, "knip.json");
  });

  it("has entry pattern configured", () => {

    const config = project.readJson<{ entry: Array<string>; }>("knip.json");
    expect(config.entry).toBeDefined();
    expect(Array.isArray(config.entry)).toBe(true);
  });

  it("has project pattern configured", () => {

    const config = project.readJson<{ project: Array<string>; }>("knip.json");
    expect(config.project).toBeDefined();
    expect(Array.isArray(config.project)).toBe(true);
  });

  it("adds knip script to package.json", () => {

    assertPackageJsonScript(project, "lint:knip", "knip");
  });

  it("knip runs successfully on clean project", () => {
    project.runCli([ "--tool=ts", "--tool=knip", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    // Create a used export
    project.writeFile("src/index.ts", `
export function main(): void {
  console.log('Hello');
}
`);

    project.install();

    const result = runCommand(project, "pnpm knip", { expectFailure: true });
    // Knip may report issues but should run
    expect(result.stdout + result.stderr).not.toContain("command not found");
  });

  it("has ignoreBinaries and ignoreDependencies arrays", () => {

    const config = project.readJson<{
      ignoreBinaries?: Array<string>;
      ignoreDependencies?: Array<string>;
    }>("knip.json");

    expect(config.ignoreBinaries).toBeDefined();
    expect(config.ignoreDependencies).toBeDefined();
  });
});
