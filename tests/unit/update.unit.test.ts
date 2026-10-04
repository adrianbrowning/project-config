/**
 * --update reconciliation: statuses for each kind of managed value, and runUpdate's conflict handling
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseCliArgs } from "../../src/cli-args.ts";
import { COMMITLINT_CONFIG } from "../../src/convential-tasks.ts";
import { eslintConfigContent } from "../../src/eslint-tasks.ts";
import { COMMIT_MSG_HOOK, PRE_PUSH_HOOK } from "../../src/husky-tasks.ts";
import { KNOWN_TEMPLATE_HASHES } from "../../src/update/known-versions.ts";
import { jsonFile, manifestEntry, pnpmSetting, templateFile } from "../../src/update/reconcile.ts";
import { runUpdate } from "../../src/update/run-update.ts";
import type { UpdatePrompts } from "../../src/update/run-update.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/update");
const EXAMPLES = path.resolve(import.meta.dirname, "../../github_actions_examples");
const OLD_COMMIT_MSG = fs.readFileSync(path.join(FIXTURES, "commit-msg.2abe477"), "utf8");

let dir: string;
let originalCwd: string;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-unit-update-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("known template versions", () => {
  const sha = (content: string) => crypto.createHash("sha256").update(content.trimEnd())
    .digest("hex");

  it.each([
    [ ".husky/commit-msg", COMMIT_MSG_HOOK ],
    [ ".husky/pre-push", PRE_PUSH_HOOK ],
    [ "eslint.config.ts", eslintConfigContent("eslint") ],
    [ "eslint.config.style.ts", eslintConfigContent("styled") ],
    [ "commitlint.config.js", COMMITLINT_CONFIG ],
    ...[ "ci_test", "lint", "knip", "ts-check" ].map(name => [ `.github/workflows/${name}.yml`, fs.readFileSync(path.join(EXAMPLES, `${name}.yml`), "utf8") ]),
    [ ".github/workflows/claude-pr-review.yml", fs.readFileSync(path.join(EXAMPLES, "claude-pr-review.yml"), "utf8") ],
    [ ".github/workflows/claude-pr-review.yml", fs.readFileSync(path.join(EXAMPLES, "claude-pr-review-bedrock.yml"), "utf8") ],
    [ ".github/actions/setup/action.yml", fs.readFileSync(path.join(EXAMPLES, "actions/setup/action.yml"), "utf8") ],
  ])("lists the current %s template (add its hash when a template changes)", (file, content) => {
    expect(KNOWN_TEMPLATE_HASHES[file]).toContain(sha(content));
  });
});

describe("templateFile", () => {
  it("leaves the current template alone, even with different trailing newlines", () => {
    write(".husky/commit-msg", COMMIT_MSG_HOOK.trimEnd() + "\n\n");
    expect(templateFile(".husky/commit-msg", COMMIT_MSG_HOOK).status).toBe("unchanged");
  });

  it("replaces a version an earlier release wrote", () => {
    write(".husky/commit-msg", OLD_COMMIT_MSG);
    const item = templateFile(".husky/commit-msg", COMMIT_MSG_HOOK);
    expect(item.status).toBe("updated");
    item.apply?.();
    expect(read(".husky/commit-msg")).toBe(COMMIT_MSG_HOOK);
  });

  it("reports an edited template as a conflict, and an edited starter file as customized", () => {
    write(".husky/commit-msg", OLD_COMMIT_MSG + "echo extra\n");
    write("eslint.config.ts", eslintConfigContent("eslint").replace("[]", "[ { rules: {} } ]"));
    expect(templateFile(".husky/commit-msg", COMMIT_MSG_HOOK).status).toBe("conflict");
    expect(templateFile("eslint.config.ts", eslintConfigContent("eslint"), { userEditable: true }).status).toBe("customized");
  });

  it("adds a missing required file and skips a missing optional one", () => {
    expect(templateFile(".husky/commit-msg", COMMIT_MSG_HOOK).status).toBe("added");
    expect(templateFile(".github/workflows/lint.yml", "x", { optional: true }).status).toBe("skipped");
  });
});

describe("jsonFile", () => {
  it("compares by value, and replaces a known earlier value", () => {
    write("knip.json", "{\"a\":1}");
    expect(jsonFile("knip.json", { a: 1 }, []).status).toBe("unchanged");

    write(".lintstagedrc", JSON.stringify({ old: true }));
    const item = jsonFile(".lintstagedrc", { new: true }, [{ old: true }]);
    expect(item.status).toBe("updated");
    item.apply?.();
    expect(JSON.parse(read(".lintstagedrc"))).toEqual({ new: true });
  });
});

describe("manifestEntry", () => {
  it("adds a missing script without touching the others or the trailing newline", () => {
    write("package.json", "{\n  \"scripts\": {\n    \"build\": \"tsc\"\n  }\n}\n");
    const item = manifestEntry("package.json", "scripts", "lint:ts", "tsc --noEmit");
    expect(item.status).toBe("added");
    item.apply?.();
    expect(read("package.json")).toBe("{\n  \"scripts\": {\n    \"build\": \"tsc\",\n    \"lint:ts\": \"tsc --noEmit\"\n  }\n}\n");
  });

  it("reports a changed value as a conflict", () => {
    write("package.json", JSON.stringify({ scripts: { "lint:ts": "tsc -b" } }));
    expect(manifestEntry("package.json", "scripts", "lint:ts", "tsc --noEmit")).toMatchObject({ status: "conflict" });
  });
});

describe("pnpmSetting", () => {
  it("moves a setting out of the legacy pnpm: block", () => {
    write("pnpm-workspace.yaml", "packages:\n  - '.'\npnpm:\n  minimumReleaseAge: 4320\n");
    const item = pnpmSetting("minimumReleaseAge", 4320);
    expect(item.status).toBe("updated");
    item.apply?.();
    expect(YAML.parse(read("pnpm-workspace.yaml"))).toEqual({ packages: [ "." ], minimumReleaseAge: 4320 });
  });

  it("reports a changed value as a conflict, but keeps extra allowBuilds entries", () => {
    write("pnpm-workspace.yaml", "minimumReleaseAge: 1440\nallowBuilds:\n  esbuild: true\n  'unrs-resolver': true\n");
    expect(pnpmSetting("minimumReleaseAge", 4320).status).toBe("conflict");
    expect(pnpmSetting("allowBuilds", { "unrs-resolver": true }).status).toBe("unchanged");
  });
});

describe("runUpdate", () => {
  const lines: Array<string> = [];
  const log = (line: string) => lines.push(line);
  beforeEach(() => {
    lines.length = 0;
    // husky detected, with one hook from an older release and one the user edited
    write("package.json", "{}\n");
    write(".husky/commit-msg", OLD_COMMIT_MSG);
    write(".husky/pre-push", PRE_PUSH_HOOK + "\npnpm test\n");
  });

  it("non-interactive: fails on a conflict and writes nothing", async () => {
    expect(await runUpdate(parseCliArgs([ "--update", "--yes" ]), null, log)).toBe(1);
    expect(read(".husky/commit-msg")).toBe(OLD_COMMIT_MSG);
    expect(lines.join("\n")).toContain("conflict   .husky/pre-push");
  });

  it("--overwrite replaces the conflict and reports it as updated", async () => {
    expect(await runUpdate(parseCliArgs([ "--update", "--yes", "--overwrite" ]), null, log)).toBe(0);
    expect(read(".husky/pre-push")).toBe(PRE_PUSH_HOOK);
    expect(lines.join("\n")).toContain("updated    .husky/pre-push (overwrote your value)");
  });

  it("interactive: updates the chosen tools and keeps a conflict the user declines", async () => {
    const asked: Array<string> = [];
    const prompts: UpdatePrompts = {
      chooseTools: async detected => detected,
      confirmOverwrite: async item => {
        asked.push(item.label);
        return false;
      },
    };
    expect(await runUpdate(parseCliArgs([ "--update" ]), prompts, log)).toBe(0);
    expect(asked).toEqual([ ".husky/pre-push" ]);
    expect(read(".husky/commit-msg")).toBe(COMMIT_MSG_HOOK);
    expect(read(".husky/pre-push")).toBe(PRE_PUSH_HOOK + "\npnpm test\n");
  });

  it("an explicit --tool subset leaves the root pnpm settings alone", async () => {
    write(".husky/pre-push", PRE_PUSH_HOOK);
    expect(await runUpdate(parseCliArgs([ "--update", "--tool=husky", "--yes" ]), null, log)).toBe(0);
    expect(fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))).toBe(false);

    expect(await runUpdate(parseCliArgs([ "--update", "--yes" ]), null, log)).toBe(0);
    expect(YAML.parse(read("pnpm-workspace.yaml"))).toMatchObject({ minimumReleaseAge: 4320 });
  });

  it("reports nothing to update on a second run", async () => {
    write(".husky/pre-push", PRE_PUSH_HOOK);
    await runUpdate(parseCliArgs([ "--update", "--yes" ]), null, log);
    lines.length = 0;
    expect(await runUpdate(parseCliArgs([ "--update", "--yes" ]), null, log)).toBe(0);
    expect(lines.at(-1)).toBe("Nothing to update.");
  });
});
