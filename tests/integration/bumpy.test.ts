/**
 * Bumpy release tool integration tests
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { assertFileExists, assertFileNotExists, assertPackageJsonScript } from "../utils/file-assertions.ts";
import { TestProject } from "../utils/test-project.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const examplesDir = path.join(repoRoot, "github_actions_examples");
const { peerDependencies } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as { peerDependencies: Record<string, string>; };

type BumpyConfig = {
  baseBranch: string;
  changelog: string;
  include: Array<string>;
  access?: string;
  publish?: { provenance?: boolean; };
  packages?: Record<string, { publishCommand?: Array<string>; }>;
};

function readExample(file: string): string {
  return fs.readFileSync(path.join(examplesDir, file), "utf-8");
}

describe("Bumpy (GitHub releases, default)", () => {
  let project: TestProject;
  let pkgName: string;
  beforeAll(() => {
    project = new TestProject({ name: "bumpy-github" });
    pkgName = project.readJson<{ name: string; }>("package.json").name;
    project.runCli([ "--tool=bumpy", "--yes" ]);
  });
  afterAll(() => project.cleanup());

  it("installs @varlock/bumpy at the injected version", () => {
    const pkg = project.readJson<{ devDependencies?: Record<string, string>; }>("package.json");
    expect(pkg.devDependencies?.["@varlock/bumpy"]).toBe(peerDependencies["@varlock/bumpy"]);
  });

  it("adds bump scripts", () => {
    assertPackageJsonScript(project, "bump", "bumpy add");
    assertPackageJsonScript(project, "bump:status", "bumpy status");
  });

  it("writes a GitHub-only config for the package", () => {
    const config = project.readJson<BumpyConfig>(".bumpy/_config.json");
    expect(config.baseBranch).toBe("main");
    expect(config.changelog).toBe("github");
    expect(config.include).toEqual([ pkgName ]);
    expect(config.access).toBeUndefined();
    expect(config.publish).toBeUndefined();
  });

  it("writes the Bumpy workflows and the GitHub-only release workflow", () => {
    expect(project.readFile(".github/workflows/bumpy-check.yml")).toBe(readExample("bumpy-check.yml"));
    expect(project.readFile(".github/workflows/bumpy-comment.yml")).toBe(readExample("bumpy-comment.yml"));
    expect(project.readFile(".github/workflows/release.yml")).toBe(readExample("release-github.yml"));
    expect(project.readFile(".github/actions/setup/action.yml")).toBe(readExample("actions/setup/action.yml"));
  });

  it("publishing attaches the packed tarball to the package's GitHub release", () => {
    // Fake `gh` records calls so the release lifecycle runs without GitHub
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
    const log = path.join(bin, "gh.log");
    fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1" = "--version" ] && echo "gh version 2.0.0"\nexit 0\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: bin, CI: "", GITHUB_ACTIONS: "" };
    const run = (cmd: string) => execSync(cmd, { cwd: project.dir, env, encoding: "utf-8", stdio: "pipe" });
    const gitCommit = "git add -A && git -c user.email=t@t -c user.name=t commit -qm";

    try {
      run(`git checkout -q -b main && ${gitCommit} init`);
      run(`pnpm exec bumpy add --packages "${pkgName}:minor" --message "Add feature" --name add-feature`);
      run(`pnpm exec bumpy version && ${gitCommit} "Version packages"`);
      run("pnpm exec bumpy publish --no-push");

      const version = project.readJson<{ version: string; }>("package.json").version;
      const tag = `${pkgName}@${version}`;
      const calls = fs.readFileSync(log, "utf-8");
      expect(calls).toContain(`release create ${tag}`);
      expect(calls).toContain(`release upload ${tag} ${path.join(bin, "bumpy-pack", `${pkgName}-${version}.tgz`)}`);
      expect(run(`git tag -l "${tag}"`).trim()).toBe(tag);
    }
    finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("Bumpy with --release-npm", () => {
  let project: TestProject;
  beforeAll(() => {
    project = new TestProject({ name: "bumpy-npm" });
    project.runCli([ "--tool=bumpy", "--release-npm", "--yes" ]);
  });
  afterAll(() => project.cleanup());

  it("writes an npm config with provenance and no custom publish target", () => {
    const config = project.readJson<BumpyConfig>(".bumpy/_config.json");
    expect(config.access).toBe("public");
    expect(config.publish?.provenance).toBe(true);
    expect(config.packages).toBeUndefined();
  });

  it("writes the npm release workflow", () => {
    expect(project.readFile(".github/workflows/release.yml")).toBe(readExample("release-npm.yml"));
  });
});

describe("Bumpy tool selection", () => {
  it("keeps an existing reusable setup action", () => {
    using project = new TestProject({ name: "bumpy-keep-action" });
    project.writeFile(".github/actions/setup/action.yml", "name: Custom\n");
    project.runCli([ "--tool=bumpy", "--yes" ]);
    expect(project.readFile(".github/actions/setup/action.yml")).toBe("name: Custom\n");
  });

  it("--all --no-release skips bumpy", () => {
    using project = new TestProject({ name: "bumpy-no-release" });
    project.runCli([ "--all", "--no-release", "--yes" ]);
    assertFileExists(project, "tsconfig.json");
    assertFileNotExists(project, ".bumpy");
    assertFileNotExists(project, ".github/workflows/release.yml");
  });
});
