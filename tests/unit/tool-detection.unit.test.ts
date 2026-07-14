import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { detectTools } from "../../src/tool-detection.ts";

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-detect-"));
  return {
    path: dir,
    [Symbol.dispose]() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

describe("detectTools", () => {
  it("returns installed:false for all tools when dir is empty", () => {
    using tmp = tmpDir();
    const result = detectTools(tmp.path);
    for (const tool of Object.values(result)) {
      expect(tool.installed).toBe(false);
    }
  });

  it("detects ts via tsconfig.json", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, "tsconfig.json"), "{}");
    expect(detectTools(tmp.path).ts.installed).toBe(true);
  });

  it("detects eslint via eslint.config.ts", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, "eslint.config.ts"), "");
    expect(detectTools(tmp.path).eslint.installed).toBe(true);
  });

  it("detects husky via .husky directory", () => {
    using tmp = tmpDir();
    fs.mkdirSync(path.join(tmp.path, ".husky"));
    expect(detectTools(tmp.path).husky.installed).toBe(true);
  });

  it("detects commitLint via commitlint.config.js", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, "commitlint.config.js"), "");
    expect(detectTools(tmp.path).commitLint.installed).toBe(true);
  });

  it("detects lintStaged via .lintstagedrc", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, ".lintstagedrc"), "{}");
    expect(detectTools(tmp.path).lintStaged.installed).toBe(true);
  });

  it("detects knip via knip.json", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, "knip.json"), "{}");
    expect(detectTools(tmp.path).knip.installed).toBe(true);
  });

  it("detects jscpd via .jscpd.json", () => {
    using tmp = tmpDir();
    fs.writeFileSync(path.join(tmp.path, ".jscpd.json"), "{}");
    expect(detectTools(tmp.path).jscpd.installed).toBe(true);
  });

  it("detects githubActions via .github/workflows directory", () => {
    using tmp = tmpDir();
    fs.mkdirSync(path.join(tmp.path, ".github", "workflows"), { recursive: true });
    expect(detectTools(tmp.path).githubActions.installed).toBe(true);
  });

  it("returns all tool keys", () => {
    using tmp = tmpDir();
    const result = detectTools(tmp.path);
    const expected = [ "ts", "eslint", "husky", "commitLint", "lintStaged", "knip", "jscpd", "githubActions" ];
    expect(Object.keys(result)).toEqual(expect.arrayContaining(expected));
    expect(Object.keys(result)).toHaveLength(expected.length);
  });
});
