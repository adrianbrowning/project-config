/**
 * ESLint integration tests
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../utils/command-runner.ts";
import {
  assertFileContains,
  assertFileExists,
  assertPackageJsonScript
} from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

describe("ESLint Configuration", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "eslint-config" });
    project.runCli([ "--tool=eslint", "--yes" ]);
  });
  afterAll(() => project.cleanup());

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
    using project = new TestProject({ name: "eslint-clean" });
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
    using project = new TestProject({ name: "eslint-fix" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

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

  it("de-morgan: flags negated conjunction", () => {
    using project = new TestProject({ name: "eslint-de-morgan-conjunction" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    project.writeFile("src/index.ts", `
export function check(a: boolean, b: boolean): boolean {
  return !(a && b);
}
`);
    project.install();

    const result = runCommand(project, "pnpm lint", { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("de-morgan/no-negated-conjunction");
  });

  it("de-morgan: flags negated disjunction", () => {
    using project = new TestProject({ name: "eslint-de-morgan-disjunction" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    project.writeFile("src/index.ts", `
export function check(a: boolean, b: boolean): boolean {
  return !(a || b);
}
`);
    project.install();

    const result = runCommand(project, "pnpm lint", { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("de-morgan/no-negated-disjunction");
  });

  it("de-morgan: auto-fixes negated boolean expressions", () => {
    using project = new TestProject({ name: "eslint-de-morgan-fix" });
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-no-dom", "--ts-type=library" ]);

    project.writeFile("src/index.ts", `
export function check(a: boolean, b: boolean): boolean {
  return !(a && b);
}
`);
    project.install();
    runCommand(project, "pnpm lint:esl:fix", { expectFailure: true });

    const fixed = project.readFile("src/index.ts");
    expect(fixed).not.toContain("!(a && b)");
    expect(fixed).toContain("!a || !b");
  });

  it("jsx-a11y: keeps the recommended rules alongside the overrides", () => {
    using project = new TestProject({ name: "eslint-jsx-a11y" });
    // Add React before setup, as in a real React project; later `pnpm add` runs under minimumReleaseAge
    project.exec("pnpm add -D react @types/react");
    project.runCli([ "--tool=ts", "--tool=eslint", "--yes", "--ts-mode=bundler", "--ts-dom", "--ts-type=app" ]);
    // The generated tsconfig only includes src/**.ts and has no JSX option, so opt the fixture into TSX
    const tsconfig = project.readJson<{ compilerOptions?: Record<string, unknown>; include: Array<string>; }>("tsconfig.json");
    project.writeJson("tsconfig.json", {
      ...tsconfig,
      compilerOptions: { ...tsconfig.compilerOptions, jsx: "react-jsx" },
      include: [ ...tsconfig.include, "./src/**/*.tsx" ],
    });

    project.writeFile("src/app.tsx", `
export function App() {
  return <img src="x.png" />;
}
`);

    const result = runCommand(project, "pnpm lint:esl", { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("jsx-a11y/alt-text");
  });
});
