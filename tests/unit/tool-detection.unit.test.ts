import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DETECTABLE_TOOLS, detectTools } from "../../src/tool-detection.ts";

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-detect-"));
  return {
    path: dir,
    [Symbol.dispose]() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const SENTINEL_FIXTURES: Array<[string, (dir: string) => void]> = [
  [ "ts", dir => fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}") ],
  [ "eslint", dir => fs.writeFileSync(path.join(dir, "eslint.config.ts"), "") ],
  [ "husky", dir => fs.mkdirSync(path.join(dir, ".husky")) ],
  [ "commitLint", dir => fs.writeFileSync(path.join(dir, "commitlint.config.js"), "") ],
  [ "lintStaged", dir => fs.writeFileSync(path.join(dir, ".lintstagedrc"), "{}") ],
  [ "knip", dir => fs.writeFileSync(path.join(dir, "knip.json"), "{}") ],
  [ "jscpd", dir => fs.writeFileSync(path.join(dir, ".jscpd.json"), "{}") ],
  [ "githubActions", dir => fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true }) ],
  [ "bumpy", dir => fs.mkdirSync(path.join(dir, ".bumpy")) ],
  [ "workspace", dir => fs.mkdirSync(path.join(dir, "sharedConfig")) ],
];

describe("detectTools", () => {
  it("detects nothing in an empty directory", () => {
    using tmp = tmpDir();
    expect(detectTools(tmp.path)).toEqual([]);
  });

  it.each(SENTINEL_FIXTURES)("detects %s from its sentinel alone", (tool, create) => {
    using tmp = tmpDir();
    create(tmp.path);
    expect(detectTools(tmp.path)).toEqual([ tool ]);
  });

  it("covers every detectable tool, in DETECTABLE_TOOLS order", () => {
    using tmp = tmpDir();
    for (const [ , create ] of SENTINEL_FIXTURES) create(tmp.path);
    expect(detectTools(tmp.path)).toEqual(DETECTABLE_TOOLS);
  });
});
