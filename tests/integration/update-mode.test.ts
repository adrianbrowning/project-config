/**
 * --update: reconcile a project set up by an older release with the current defaults
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runCommand } from "../utils/command-runner.ts";
import { TestProject } from "../utils/test-project.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/update");
const EXAMPLES = path.resolve(import.meta.dirname, "../../github_actions_examples");
const OLD_COMMIT_MSG = fs.readFileSync(path.join(FIXTURES, "commit-msg.2abe477"), "utf8");
const OLD_LINT_WORKFLOW = fs.readFileSync(path.join(FIXTURES, "lint.yml.8c7e2a6"), "utf8");
const TOOLS = [ "--tool=ts", "--tool=eslint", "--tool=husky", "--tool=commitLint", "--tool=lintStaged", "--tool=githubActions" ];

type Manifest = { scripts: Record<string, string>; };

/** A current setup rolled back to what older releases wrote, plus the user's own changes. */
function olderProject(name: string): TestProject {
  const project = new TestProject({ name });
  project.runCli([ ...TOOLS, "--yes", "--ts-no-dom", "--ts-type=library" ]);

  project.writeFile(".husky/commit-msg", OLD_COMMIT_MSG);
  project.writeFile(".github/workflows/lint.yml", OLD_LINT_WORKFLOW);
  project.writeJson(".lintstagedrc", { "*.{js,ts,tsx}": [ "pnpm lint:fix" ] });
  const workspace = project.readFile("pnpm-workspace.yaml").replace(/^(?:minimumReleaseAge|strictDepBuilds):.*\n/gm, "");
  project.writeFile("pnpm-workspace.yaml", `pnpm:\n  minimumReleaseAge: 4320\n  strictDepBuilds: true\n${workspace}`);

  // The user's own changes, which update must keep
  const manifest = project.readJson<Manifest>("package.json");
  project.writeJson("package.json", { ...manifest, scripts: { ...manifest.scripts, build: "tsc -p ." } });
  project.writeFile("commitlint.config.js", `${project.readFile("commitlint.config.js")}\n// team tweak\n`);
  return project;
}

function update(project: TestProject, ...flags: Array<string>) {
  const result = runCommand(project, `pnpm exec gingacodemonkey-config --update ${flags.join(" ")}`, { expectFailure: true });
  return { ...result, output: result.stdout + result.stderr };
}

describe("--update", () => {
  it("--update --yes migrates older defaults and keeps the user's changes", () => {
    using project = olderProject("update-migrate");
    const result = update(project, "--yes");

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("updated    .husky/commit-msg");
    expect(project.readFile(".husky/commit-msg")).toContain("Refs: %s");
    expect(project.readFile(".github/workflows/lint.yml")).toBe(fs.readFileSync(path.join(EXAMPLES, "lint.yml"), "utf8"));
    expect(project.readJson(".lintstagedrc")).toEqual({ "src/**/*.{js,ts,jsx,tsx}": [ "pnpm lint:fix" ] });

    const workspace: Record<string, unknown> = YAML.parse(project.readFile("pnpm-workspace.yaml"));
    expect(workspace).not.toHaveProperty("pnpm");
    expect(workspace).toMatchObject({ minimumReleaseAge: 4320, strictDepBuilds: true });

    expect(project.readJson<Manifest>("package.json").scripts.build).toBe("tsc -p .");
    expect(project.readFile("commitlint.config.js")).toContain("// team tweak");
    expect(result.output).toContain("customized commitlint.config.js");
  });

  it("--update --tool=ts --yes leaves ESLint, GitHub Actions and the root pnpm settings alone", () => {
    using project = olderProject("update-ts-only");
    const before = [ ".github/workflows/lint.yml", ".husky/commit-msg", "eslint.config.ts", "pnpm-workspace.yaml" ].map(file => project.readFile(file));
    const result = update(project, "--tool=ts", "--yes");

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("Updating: ts\n");
    const after = [ ".github/workflows/lint.yml", ".husky/commit-msg", "eslint.config.ts", "pnpm-workspace.yaml" ].map(file => project.readFile(file));
    expect(after).toEqual(before);
  });

  it("fails on a value the user changed in a file the CLI owns, writing nothing, until --overwrite", () => {
    using project = olderProject("update-conflict");
    project.writeFile(".husky/pre-push", "#!/bin/sh\npnpm lint && pnpm test\n");

    const refused = update(project, "--yes");
    expect(refused.exitCode).not.toBe(0);
    expect(refused.output).toContain("conflict   .husky/pre-push");
    expect(refused.output).toContain("nothing was written");
    expect(project.readFile(".husky/commit-msg")).toBe(OLD_COMMIT_MSG);

    const forced = update(project, "--yes", "--overwrite");
    expect(forced.exitCode, forced.output).toBe(0);
    expect(project.readFile(".husky/pre-push")).toBe("#!/bin/sh\npnpm lint");
    expect(project.readFile(".husky/commit-msg")).toContain("Refs: %s");
  });

  it("a second update changes nothing and says so", () => {
    using project = olderProject("update-twice");
    expect(update(project, "--yes").exitCode).toBe(0);
    const files = [ "package.json", "pnpm-workspace.yaml", ".husky/commit-msg", ".lintstagedrc", ".github/workflows/lint.yml" ];
    const first = files.map(file => project.readFile(file));

    const second = update(project, "--yes");
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("Nothing to update.");
    expect(files.map(file => project.readFile(file))).toEqual(first);
  });

  it("--overwrite never rewrites a workspace package tsconfig that dropped the shared link", () => {
    using project = new TestProject({ name: "update-workspace-tsconfig" });
    project.runCli([ "--tool=workspace", "--yes" ]);
    const unlinked = JSON.stringify({ extends: "./local.json", include: [ "src" ] }, null, 2);
    project.writeFile("packages/example/tsconfig.json", unlinked);

    const result = update(project, "--tool=workspace", "--yes", "--overwrite");
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("customized packages/example/tsconfig.json");
    expect(project.readFile("packages/example/tsconfig.json")).toBe(unlinked);
  });

  it("reconciles a workspace's ci.yml and leaves out the single-package workflows", () => {
    using project = new TestProject({ name: "update-workspace-ci" });
    // Seeded rather than set up: GitHub Actions setup installs the review skill over the network (#59).
    // The built CLI's template is this file byte for byte, so update must see it as current.
    const ci = fs.readFileSync(path.join(EXAMPLES, "workspace-ci.yml"), "utf8");
    project.writeFile("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
    project.writeFile(".github/workflows/ci.yml", ci);
    project.writeFile(".github/actions/setup/action.yml", fs.readFileSync(path.join(EXAMPLES, "actions/setup/action.yml"), "utf8"));

    const current = update(project, "--tool=githubActions", "--yes");
    expect(current.exitCode, current.output).toBe(0);
    expect(current.output).not.toMatch(/ci_test\.yml|lint\.yml|ts-check\.yml/);
    expect(project.readFile(".github/workflows/ci.yml")).toBe(ci);

    const edited = `${ci}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    project.writeFile(".github/workflows/ci.yml", edited);
    const conflict = update(project, "--tool=githubActions", "--yes");
    expect(conflict.exitCode).toBe(1);
    expect(conflict.output).toContain("conflict   .github/workflows/ci.yml");
    expect(project.readFile(".github/workflows/ci.yml")).toBe(edited);
  });
});
