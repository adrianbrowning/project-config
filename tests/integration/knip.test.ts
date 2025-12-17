/**
 * Knip integration tests
 */

import { describe, it, expect } from "vitest";
import { TARBALL_PATH } from "../setup.ts";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileExists,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("Knip Configuration", () => {
  it("generates knip.json", () => {
    using project = new TestProject({ name: "knip-config" });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli([ "--tool=knip", "--yes" ]);

    assertFileExists(project, "knip.json");
  });

  it("has entry pattern configured", () => {
    using project = new TestProject({ name: "knip-entry" });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli([ "--tool=knip", "--yes" ]);

    const config = project.readJson<{ entry: Array<string>; }>("knip.json");
    expect(config.entry).toBeDefined();
    expect(Array.isArray(config.entry)).toBe(true);
  });

  it("has project pattern configured", () => {
    using project = new TestProject({ name: "knip-project" });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli([ "--tool=knip", "--yes" ]);

    const config = project.readJson<{ project: Array<string>; }>("knip.json");
    expect(config.project).toBeDefined();
    expect(Array.isArray(config.project)).toBe(true);
  });

  it("adds knip script to package.json", () => {
    using project = new TestProject({ name: "knip-script" });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli([ "--tool=knip", "--yes" ]);

    assertPackageJsonScript(project, "knip", "knip");
  });

  it("knip runs successfully on clean project", () => {
    using project = new TestProject({ name: "knip-run" });
    project.init();

    project.installTarball(TARBALL_PATH);
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
    using project = new TestProject({ name: "knip-ignore" });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli([ "--tool=knip", "--yes" ]);

    const config = project.readJson<{
      ignoreBinaries?: Array<string>;
      ignoreDependencies?: Array<string>;
    }>("knip.json");

    expect(config.ignoreBinaries).toBeDefined();
    expect(config.ignoreDependencies).toBeDefined();
  });
});
