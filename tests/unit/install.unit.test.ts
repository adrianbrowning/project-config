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
