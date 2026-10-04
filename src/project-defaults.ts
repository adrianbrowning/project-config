/** Root defaults written on every setup run, shared with `--update` so both use the same values. */

// pnpm supply-chain settings, written as top-level keys in pnpm-workspace.yaml.
// strictDepBuilds fails installs on unreviewed build scripts. unrs-resolver (via eslint-plugin-import-x) is
// already installed with its build ignored; pnpm 10 keeps failing on that recorded state under `false`, so
// approve it (napi-postinstall only checks for its prebuilt native binding).
export const PNPM_SETTINGS = {
  minimumReleaseAge: 4320,
  blockExoticSubdeps: true,
  trustPolicy: "no-downgrade",
  trustPolicyIgnoreAfter: 43200,
  minimumReleaseAgeExclude: [ "@gingacodemonkey/config" ],
  strictDepBuilds: true,
  allowBuilds: { "unrs-resolver": true },
};

export const ENGINES = { node: ">=24.0.0", pnpm: ">=10.0.0" };

export const E18E_SCRIPT = "pnpm dlx @e18e/cli analyze";

/** The root `lint` script for a single-package project: type-check, lint, then style-fix. */
export function combinedLintScript(hasTs: boolean, hasEslint: boolean): string {
  return [
    ...(hasTs ? [ "pnpm lint:ts" ] : []),
    ...(hasEslint ? [ "pnpm lint:esl", "pnpm lint:fix" ] : []),
  ].join(" && ");
}
