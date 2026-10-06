/**
 * CLI argument parsing: flags, tool selection, interactive mode and TypeScript options
 */
import { describe, expect, it } from "vitest";
import { isInteractiveMode, parseCliArgs, resolveTsJsx } from "../../src/cli-args.ts";
import type { CliArgs, TsJsx } from "../../src/cli-args.ts";

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

describe("workspace flags", () => {
  it("--all leaves out workspace", () => {
    const tools = parseCliArgs([ "--all" ]).tools;
    expect(tools).not.toContain("workspace");
    expect(tools).toContain("ts");
  });

  it("accepts --tool=workspace", () => {
    expect(parseCliArgs([ "--tool=workspace" ]).tools).toEqual([ "workspace" ]);
  });

  it("collects repeated --workspace-packages globs once each", () => {
    const args = parseCliArgs([ "--workspace-packages=apps/*", "--workspace-packages=libs/*", "--workspace-packages=apps/*" ]);
    expect(args.workspacePackages).toEqual([ "apps/*", "libs/*" ]);
  });

  it("--workspace-update-all opts into linking existing packages", () => {
    expect(parseCliArgs([]).workspaceUpdateAll).toBe(false);
    expect(parseCliArgs([ "--workspace-update-all" ]).workspaceUpdateAll).toBe(true);
  });

  it("ignores arguments that name Object.prototype members", () => {
    expect(() => parseCliArgs([ "constructor", "toString" ])).not.toThrow();
    expect(parseCliArgs([ "constructor" ]).all).toBe(false);
  });
});

describe("--claude-runner", () => {
  it("defaults to the Anthropic API", () => {
    expect(parseCliArgs([ "--tool=githubActions", "--yes" ]).claudeRunner).toBe("anthropic");
  });

  it("accepts bedrock and ignores unknown runners", () => {
    expect(parseCliArgs([ "--claude-runner=bedrock" ]).claudeRunner).toBe("bedrock");
    expect(parseCliArgs([ "--claude-runner=vertex" ]).claudeRunner).toBe("anthropic");
  });
});

describe("tool selection", () => {
  it("collects unknown --tool values instead of dropping them", () => {
    const args = parseCliArgs([ "--tool=eslnt", "--tool=ts", "--tool=" ]);
    expect(args.tools).toEqual([ "ts" ]);
    expect(args.unknownTools).toEqual([ "eslnt", "" ]);
  });

  it("is case-sensitive, matching the names in --help", () => {
    expect(parseCliArgs([ "--tool=ESLint" ]).unknownTools).toEqual([ "ESLint" ]);
  });
});

describe("isInteractiveMode", () => {
  it.each([
    [[], true ],
    [[ "--update" ], true ],
    [[ "--yes" ], false ],
    [[ "-y" ], false ],
    [[ "--update", "--yes" ], false ],
    [[ "--all" ], false ],
    [[ "-a" ], false ],
    [[ "--tool=eslint" ], false ],
    // A typo'd tool selects nothing; setup rejects unknownTools before this matters
    [[ "--tool=eslnt" ], true ],
  ])("%j → %s", (argv, interactive) => {
    expect(isInteractiveMode(parseCliArgs(argv))).toBe(interactive);
  });
});

describe("short flags", () => {
  it.each([
    [ "-a", "all" ],
    [ "-y", "yes" ],
    [ "-u", "update" ],
    [ "-h", "help" ],
  ] as const)("%s sets %s", (flag, field) => {
    expect(parseCliArgs([])[field]).toBe(false);
    expect(parseCliArgs([ flag ])[field]).toBe(true);
  });
});

describe("TypeScript options", () => {
  const defaults = parseCliArgs([]);

  it.each<[string, Partial<CliArgs>]>([
    [ "--ts-dom=false", { tsDom: false }],
    [ "--ts-dom=dom", { tsDom: true }],
    [ "--ts-no-dom", { tsDom: false }],
    [ "--ts-type=LIBRARY", { tsType: "library" }],
    [ "--ts-type=Library-Monorepo", { tsType: "library-monorepo" }],
    [ "--ts-type=service", { tsType: defaults.tsType }],
    [ "--ts-mode=tsc", { tsMode: "tsc" }],
    [ "--ts-mode=webpack", { tsMode: defaults.tsMode }],
    [ "--ts-jsx=react", { tsJsx: "react" }],
    [ "--ts-jsx=none", { tsJsx: null }],
    [ "--ts-jsx=false", { tsJsx: null }],
    [ "--ts-jsx=vue", { tsJsx: undefined }],
    [ "--ts-outdir=build", { tsOutdir: "build" }],
    [ "--ts-outdir=", { tsOutdir: defaults.tsOutdir }],
  ])("%s", (flag, expected) => {
    expect(parseCliArgs([ flag ])).toMatchObject(expected);
  });

  it.each<[Array<string>, null | TsJsx]>([
    [[], "react-jsx" ],
    [[ "--ts-no-dom" ], null ],
    [[ "--ts-type=library" ], null ],
    [[ "--ts-jsx=none" ], null ],
    [[ "--ts-no-dom", "--ts-jsx=preserve" ], "preserve" ],
  ])("resolveTsJsx(%j) → %s", (argv, jsx) => {
    expect(resolveTsJsx(parseCliArgs(argv))).toBe(jsx);
  });
});