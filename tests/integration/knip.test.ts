/**
 * Knip integration tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  afterAll(() => project.cleanup());

  it("generates knip.json", () => {

    assertFileExists(project, "knip.json");
  });

  it("has entry and project patterns configured", () => {
    const config = project.readJson<{ entry: Array<string>; project: Array<string>; }>("knip.json");
    expect(config.entry).toEqual([ "src/**/*.{js,ts}" ]);
    expect(config.project).toEqual([ "**/*.{js,ts}" ]);
  });

  it("adds knip script to package.json", () => {

    assertPackageJsonScript(project, "lint:knip", "knip");
  });

  it("knip runs successfully on clean project", () => {
    using isolated = new TestProject({ name: "knip-run" });
    isolated.runCli([ "--tool=ts", "--tool=knip", "--yes", "--ts-no-dom", "--ts-type=library" ]);
    isolated.writeFile("src/index.ts", `
export function main(): void {
  console.log('Hello');
}
`);
    isolated.install();
    const result = runCommand(isolated, "pnpm lint:knip", { expectFailure: true });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  });

  it("starts with empty ignoreBinaries and ignoreDependencies", () => {
    const config = project.readJson<{
      ignoreBinaries?: Array<string>;
      ignoreDependencies?: Array<string>;
    }>("knip.json");

    expect(config.ignoreBinaries).toEqual([]);
    expect(config.ignoreDependencies).toEqual([]);
  });
});
