/**
 * CLI failure handling: a failed setup task must make the CLI exit non-zero.
 */

import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

describe("CLI failure handling", () => {
  it("exits non-zero and names the failed task when a setup task throws", () => {
    using project = new TestProject({ name: "cli-failure" });
    project.writeFile("package.json", "{ not json");

    // Call the bin directly: `pnpm exec` would reject the broken package.json before the CLI runs
    const result = runCommand(project, "./node_modules/.bin/gingacodemonkey-config --tool=knip --yes", { expectFailure: true });

    expect(result.exitCode).not.toBe(0);
    // Listr colours the ✖ when the runner supports colour (GitHub Actions does)
    expect(stripVTControlCharacters(result.stdout + result.stderr)).toContain("✖ Knip [FAILED");
  });
});
