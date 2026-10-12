/** This package's own version, so generated configs match the CLI that wrote them. build.ts fills it in. */
export const CONFIG_VERSION = "__config_version__";

/** Root defaults written on every setup run, shared with `--update` so both use the same values. */

// pnpm supply-chain settings, written as top-level keys in pnpm-workspace.yaml before setup installs anything.
// strictDepBuilds fails installs on unreviewed build scripts (pnpm 11+ does this by default). unrs-resolver (via
// eslint-plugin-import-x) needs approval, and pnpm 10 keeps failing on a build it recorded as ignored under
// `false` (napi-postinstall only checks for its prebuilt native binding).
export const PNPM_SETTINGS = {
  minimumReleaseAge: 4320,
  blockExoticSubdeps: true,
  trustPolicy: "no-downgrade",
  trustPolicyIgnoreAfter: 43200,
  minimumReleaseAgeExclude: [ "@gingacodemonkey/config" ],
  strictDepBuilds: true,
  allowBuilds: { "unrs-resolver": true },
};

// pnpm 10.26 is the first release that reads `allowBuilds`; older ones ignore it and fail strictDepBuilds
export const ENGINES = { node: ">=24.0.0", pnpm: ">=10.26.0" };

/** `engines` values earlier releases wrote, which update replaces without asking. */
export const PREVIOUS_ENGINES: Record<string, Array<string>> = { pnpm: [ ">=10.0.0" ] };

export const E18E_SCRIPT = "pnpm dlx @e18e/cli analyze";

/** The root `lint` script for a single-package project: type-check, lint, then style-fix. */
export function combinedLintScript(hasTs: boolean, hasEslint: boolean): string {
  return [
    ...(hasTs ? [ "pnpm lint:ts" ] : []),
    ...(hasEslint ? [ "pnpm lint:esl", "pnpm lint:fix" ] : []),
  ].join(" && ");
}
