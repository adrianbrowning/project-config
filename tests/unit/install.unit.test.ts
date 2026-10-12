/**
 * Install failures: pnpm's minimumReleaseAge refusal names the package and when it becomes installable
 */
import { describe, expect, it } from "vitest";
import { tooNewPackageMessage } from "../../src/utils.ts";

// Verbatim pnpm 10 output (stdout) from a rerun whose lockfile holds a too-new typescript@next
const NO_MATURE = ` ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 7.1.0-dev.20261005.1 (released 11 hours ago) of @typescript/typescript-linux-arm does not meet the minimumReleaseAge constraint

This error happened while installing the dependencies of typescript@7.1.0-dev.20261005.1

If you want to install the matched version ignoring the time it was published, you can add the package name to the minimumReleaseAgeExclude setting.
`;

// Verbatim pnpm 12 output (stderr): one line per package, wrapped at 80 columns
const NO_MATURE_V12 = `Error: ERR_PNPM_NO_MATURE_MATCHING_VERSION

  × adding a new package
  ╰─▶ 3 versions do not meet the minimumReleaseAge constraint:
        @types/is-number@7.0.0 was published at 2019-07-01T18:13:17.839Z,
      within the minimumReleaseAge cutoff (1836-08-21T05:03:36.280Z)
        is-number@6.0.0 was published at 2018-03-31T17:02:39.953Z, within the
      minimumReleaseAge cutoff (1836-08-21T05:03:36.280Z)
        is-odd@3.0.1 was published at 2018-05-31T20:04:53.306Z, within the
      minimumReleaseAge cutoff (1836-08-21T05:03:36.280Z)
  help: Run the install interactively to approve these picks, add them to
        minimumReleaseAgeExclude in pnpm-workspace.yaml, or wait for the
        packages to mature.
`;

describe("tooNewPackageMessage", () => {
  it("names the package and the moment it clears minimumReleaseAge", () => {
    const asked: Array<string> = [];
    const message = tooNewPackageMessage(NO_MATURE, {
      minimumReleaseAge: () => 4320,
      publishedAt: (name, version) => {
        asked.push(`${name}@${version}`);
        return new Date("2026-10-05T09:22:09.000Z");
      },
    });

    expect(asked).toEqual([ "@typescript/typescript-linux-arm@7.1.0-dev.20261005.1" ]);
    expect(message).toBe("@typescript/typescript-linux-arm@7.1.0-dev.20261005.1 is younger than minimumReleaseAge (4320 minutes), "
      + "so pnpm won't install it. It can be installed from 2026-10-08T09:22:09.000Z. "
      + "To change configs in this project without installing packages, use --update.");
  });

  it.each([
    [ "can't be looked up", null ],
    [ "is not a valid date", new Date("not a date") ],
  ])("still names the package when the publish time %s", (_title, published) => {
    const message = tooNewPackageMessage(NO_MATURE, { minimumReleaseAge: () => 4320, publishedAt: () => published });
    expect(message).toContain("@typescript/typescript-linux-arm@7.1.0-dev.20261005.1 is younger than minimumReleaseAge (4320 minutes)");
    expect(message).not.toContain("It can be installed from");
  });

  it("falls back to the package name and --update when pnpm can't report minimumReleaseAge", () => {
    const message = tooNewPackageMessage(NO_MATURE, {
      minimumReleaseAge: () => null,
      publishedAt: () => { throw new Error("must not be called without an age"); },
    });
    expect(message).toBe("@typescript/typescript-linux-arm@7.1.0-dev.20261005.1 is younger than minimumReleaseAge, "
      + "so pnpm won't install it. To change configs in this project without installing packages, use --update.");
  });

  it("names every package pnpm 12 refuses, using the publish times it reports", () => {
    const message = tooNewPackageMessage(NO_MATURE_V12, {
      minimumReleaseAge: () => 4320,
      publishedAt: () => { throw new Error("pnpm 12 reports publish times, so the registry isn't asked"); },
    });
    expect(message).toBe("@types/is-number@7.0.0 is younger than minimumReleaseAge (4320 minutes), so pnpm won't install it. "
      + "It can be installed from 2019-07-04T18:13:17.839Z. "
      + "is-number@6.0.0 is younger than minimumReleaseAge (4320 minutes), so pnpm won't install it. "
      + "It can be installed from 2018-04-03T17:02:39.953Z. "
      + "is-odd@3.0.1 is younger than minimumReleaseAge (4320 minutes), so pnpm won't install it. "
      + "It can be installed from 2018-06-03T20:04:53.306Z. "
      + "To change configs in this project without installing packages, use --update.");
  });

  it("names lockfile entries pnpm 12 rejects, joining timestamps it wrapped at a hyphen", () => {
    // Verbatim pnpm 12 output (stderr) for an install whose existing lockfile holds too-new versions
    const violation = `Error: ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION

  × installing dependencies
  ╰─▶ 2 lockfile entries failed verification:
        @babel/helpers@7.29.10 was published at 2026-10-07T09:51:46.135Z,
      within the minimumReleaseAge cutoff (2026-10-05T16:03:23.567Z)
        @conventional-changelog/git-client@3.2.0 was published at 2026-10-
      05T18:13:08.948Z, within the minimumReleaseAge cutoff (2026-10-
      05T16:03:23.567Z)
`;
    expect(tooNewPackageMessage(violation, { minimumReleaseAge: () => 4320, publishedAt: () => null })).toBe(
      "@babel/helpers@7.29.10 is younger than minimumReleaseAge (4320 minutes), so pnpm won't install it. "
      + "It can be installed from 2026-10-10T09:51:46.135Z. "
      + "@conventional-changelog/git-client@3.2.0 is younger than minimumReleaseAge (4320 minutes), so pnpm won't install it. "
      + "It can be installed from 2026-10-08T18:13:08.948Z. "
      + "To change configs in this project without installing packages, use --update."
    );
  });

  it("leaves other install failures alone, without querying pnpm", () => {
    const lookup = {
      minimumReleaseAge: () => { throw new Error("must not be called"); },
      publishedAt: () => { throw new Error("must not be called"); },
    };
    const noMatch = " ERR_PNPM_NO_MATCHING_VERSION  No matching version found for is-odd@latest while fetching it from https://registry.npmjs.org/";
    expect(tooNewPackageMessage(noMatch, lookup)).toBeNull();
    expect(tooNewPackageMessage(" ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/nope: Not Found - 404", lookup)).toBeNull();
  });
});
