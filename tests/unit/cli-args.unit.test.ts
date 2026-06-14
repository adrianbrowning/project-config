/**
 * Tests for --update flag in CLI args
 */
import { describe, it, expect } from "vitest";
import { parseCliArgs, isInteractiveMode } from "../../src/cli-args.ts";

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