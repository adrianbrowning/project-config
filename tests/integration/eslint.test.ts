/**
 * ESLint integration tests
 */

import {describe, it, expect, beforeAll} from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileExists,
  assertFileContains,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("ESLint Configuration", () => {
    let project: TestProject;
    beforeAll(() => {
        project = new TestProject({name: "commit-lint-config"});
        project.runCli([ "--tool=eslint", "--yes" ]);
    });

  it("generates eslint.config.ts with correct import", () => {

    assertFileExists(project, "eslint.config.ts");
    assertFileContains(project, "eslint.config.ts", "@gingacodemonkey/config/eslint");
    assertFileContains(project, "eslint.config.ts", "defaultConfig");
  });

  it("generates eslint.config.style.ts with styled import", () => {

    assertFileExists(project, "eslint.config.style.ts");
    assertFileContains(project, "eslint.config.style.ts", "@gingacodemonkey/config/styled");
  });

  it("adds lint scripts to package.json", () => {
    assertPackageJsonScript(project, "lint");
    assertPackageJsonScript(project, "lint:fix");
    assertPackageJsonScript(project, "lint:s");
  });

  it("lint passes on clean code", () => {
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    // Create clean TypeScript file
    project.writeFile("src/index.ts", `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`);

    project.install();

    const result = runCommand(project, "pnpm lint", { expectFailure: true });
    expect(result.exitCode).toBe(0);
  });

  it("lint:fix modifies files with fixable issues", () => {
    const project = new TestProject({ name: "eslint-fix" });    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    // Create file with fixable issues (extra semicolons, spacing)
    const badCode = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;;
}
`;
    project.writeFile("src/index.ts", badCode);

    project.install();

    // Run lint:fix
    runCommand(project, "pnpm lint:fix", { expectFailure: true });

    // File should be modified (double semicolon should be fixed)
    const fixedCode = project.readFile("src/index.ts");
    expect(fixedCode).not.toContain(";;");
  });
});
