/**
 * CLI failure handling: a failed setup task must make the CLI exit non-zero.
 */

import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

describe("CLI failure handling", () => {
  it.each([
    [ "an unknown --tool, naming it and the valid tools", [ "--tool=eslnt", "--yes" ], "Unknown tool: --tool=eslnt. Valid tools: ts, eslint," ],
    [ "an unknown --tool alongside valid ones", [ "--tool=ts", "--tool=eslnt" ], "Unknown tool: --tool=eslnt." ],
    [ "--yes with no tools, instead of prompting", [ "--yes" ], "No tools selected." ],
  ])("exits 1 without changing anything for %s", (_title, flags, message) => {
    using project = new TestProject({ name: "cli-args" });
    const before = project.readFile("package.json");

    // CI=true is set, but a prompt would still hang here, so a non-zero exit also proves nothing prompted
    const result = runCommand(project, `pnpm exec gingacodemonkey-config ${flags.join(" ")} </dev/null`, { expectFailure: true });

    expect(result.exitCode).toBe(1);
    expect(stripVTControlCharacters(result.stdout + result.stderr)).toContain(message);
    expect(project.readFile("package.json")).toBe(before);
    expect(project.fileExists("tsconfig.json")).toBe(false);
  });

  it("exits non-zero and names the failed task when a setup task throws", () => {
    using project = new TestProject({ name: "cli-failure" });
    project.writeFile("package.json", "{ not json");

    // Call the bin directly: `pnpm exec` would reject the broken package.json before the CLI runs
    const result = runCommand(project, "./node_modules/.bin/gingacodemonkey-config --tool=knip --yes", { expectFailure: true });

    expect(result.exitCode).not.toBe(0);
    // Listr colours the ✖ when the runner supports colour (GitHub Actions does)
    expect(stripVTControlCharacters(result.stdout + result.stderr)).toContain("✖ Knip [FAILED");
  });

  it("names each too-new package and when it becomes installable when minimumReleaseAge blocks the install", () => {
    using project = new TestProject({ name: "cli-too-new" });
    // Every version in the lockfile is younger than ~190 years, so pnpm rejects the lockfile the same way it does
    // when one holds a package published in the last three days (#56). pnpm 11+ reads pnpm_config_* from the
    // environment ahead of pnpm-workspace.yaml, so setup's own minimumReleaseAge doesn't replace it.
    const result = runCommand(project, "pnpm exec gingacodemonkey-config --tool=knip --yes", {
      env: { pnpm_config_minimum_release_age: "99999999" },
      expectFailure: true,
    });

    expect(result.exitCode).not.toBe(0);
    const output = stripVTControlCharacters(result.stdout + result.stderr);
    // pnpm 12 names every lockfile entry it rejects: one sentence each, then the --update hint
    const hint = output.indexOf(" To change configs in this project without installing packages, use --update.");
    const first = output.indexOf(" is younger than minimumReleaseAge");
    expect(first).toBeGreaterThan(0);
    expect(hint).toBeGreaterThan(first);
    const sentences = output.slice(output.lastIndexOf(" ", first - 1) + 1, hint).split(/(?<=Z\.) /);
    for (const sentence of sentences) {
      const [ spec = "", reason = "" ] = sentence.split(" is younger than ");
      expect(spec).toMatch(/^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+/); // name@version, e.g. picomatch@2.3.1
      expect(reason).toMatch(/^minimumReleaseAge \(99999999 minutes\), so pnpm won't install it\. It can be installed from \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\.$/);
    }
  });
});
