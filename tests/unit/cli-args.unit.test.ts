/**
 * Tests for --update flag in CLI args
 */
import { describe, expect, it } from "vitest";
import { isInteractiveMode, parseCliArgs } from "../../src/cli-args.ts";

describe("--update flag", () => {
  it("parses --update flag", () => {
    const args = parseCliArgs([ "--update" ]);
    expect(args.update).toBe(true);
  });

  it("defaults update to false", () => {
    const args = parseCliArgs([]);
    expect(args.update).toBe(false);
  });

  it("isInteractiveMode is true when only --update set", () => {
    const args = parseCliArgs([ "--update" ]);
    expect(isInteractiveMode(args)).toBe(true);
  });

  it("isInteractiveMode is false when --update + --tool set", () => {
    const args = parseCliArgs([ "--update", "--tool=eslint" ]);
    expect(isInteractiveMode(args)).toBe(false);
  });

  it("isInteractiveMode is false when --update + --all set", () => {
    const args = parseCliArgs([ "--update", "--all" ]);
    expect(isInteractiveMode(args)).toBe(false);
  });
});

describe("release flags", () => {
  it("accepts --tool=bumpy", () => {
    expect(parseCliArgs([ "--tool=bumpy" ]).tools).toEqual([ "bumpy" ]);
  });

  it("--all includes bumpy", () => {
    expect(parseCliArgs([ "--all" ]).tools).toContain("bumpy");
  });

  it("--all --no-release excludes only bumpy", () => {
    const all = parseCliArgs([ "--all" ]).tools;
    const noRelease = parseCliArgs([ "--all", "--no-release" ]).tools;
    expect(noRelease).toEqual(all.filter(tool => tool !== "bumpy"));
  });

  it("--no-release works before --all", () => {
    expect(parseCliArgs([ "--no-release", "--all" ]).tools).not.toContain("bumpy");
  });

  it("defaults to GitHub-only releases", () => {
    expect(parseCliArgs([ "--tool=bumpy", "--yes" ]).releaseNpm).toBe(false);
  });

  it("--release-npm opts into npm publishing", () => {
    expect(parseCliArgs([ "--tool=bumpy", "--release-npm" ]).releaseNpm).toBe(true);
  });
});