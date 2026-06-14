import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectTools } from "../../src/tool-detection.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectTools", () => {
  it("returns installed:false for all tools when dir is empty", () => {
    const result = detectTools(tmpDir);
    for (const tool of Object.values(result)) {
      expect(tool.installed).toBe(false);
    }
  });

  it("detects ts via tsconfig.json", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), "{}");
    expect(detectTools(tmpDir).ts.installed).toBe(true);
  });

  it("detects eslint via eslint.config.ts", () => {
    fs.writeFileSync(path.join(tmpDir, "eslint.config.ts"), "");
    expect(detectTools(tmpDir).eslint.installed).toBe(true);
  });

  it("detects husky via .husky directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".husky"));
    expect(detectTools(tmpDir).husky.installed).toBe(true);
  });

  it("detects commitLint via commitlint.config.js", () => {
    fs.writeFileSync(path.join(tmpDir, "commitlint.config.js"), "");
    expect(detectTools(tmpDir).commitLint.installed).toBe(true);
  });

  it("detects lintStaged via .lintstagedrc", () => {
    fs.writeFileSync(path.join(tmpDir, ".lintstagedrc"), "{}");
    expect(detectTools(tmpDir).lintStaged.installed).toBe(true);
  });

  it("detects semanticReleaseNotes via .releaserc.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".releaserc.json"), "{}");
    expect(detectTools(tmpDir).semanticReleaseNotes.installed).toBe(true);
  });

  it("detects knip via knip.json", () => {
    fs.writeFileSync(path.join(tmpDir, "knip.json"), "{}");
    expect(detectTools(tmpDir).knip.installed).toBe(true);
  });

  it("detects jscpd via .jscpd.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".jscpd.json"), "{}");
    expect(detectTools(tmpDir).jscpd.installed).toBe(true);
  });

  it("detects githubActions via .github/workflows directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    expect(detectTools(tmpDir).githubActions.installed).toBe(true);
  });

  it("returns all tool keys", () => {
    const result = detectTools(tmpDir);
    const expected = [ "ts", "eslint", "husky", "commitLint", "lintStaged", "semanticReleaseNotes", "knip", "jscpd", "githubActions" ];
    expect(Object.keys(result)).toEqual(expect.arrayContaining(expected));
    expect(Object.keys(result)).toHaveLength(expected.length);
  });
});
