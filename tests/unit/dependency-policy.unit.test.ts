/**
 * Dependency update policy: which versions the scheduled dependency workflow picks, and how peers follow them
 */
import { describe, expect, it } from "vitest";
import { applyUpdates, catalogEntryPath, planUpdates, releasedVersions, resolveCatalogs, splitCatalogUpdates, trackedDependencies, workspaceCatalogs } from "../../scripts/dependency-policy.ts";
import type { Manifest } from "../../scripts/dependency-policy.ts";

const manifest = {
  dependencies: {
    "eslint": "^9.39.5",
    "listr2": "^9.0.5",
    "plugin-rc": "19.1.0-rc.2",
  },
  devDependencies: {
    "knip": "6.26.0",
    "husky": "^9.1.7",
    "rollup": "^4.62.2",
  },
  peerDependencies: {
    "eslint": "^9.39.5",
    "knip": "6.26.0",
    "husky": "9.1.6",
    "@varlock/bumpy": "^1.18.1",
  },
} satisfies Manifest;

const registry = {
  "eslint": [ "9.39.5", "9.40.0", "10.0.0" ],
  "listr2": [ "9.0.5", "9.1.0" ],
  "plugin-rc": [ "19.1.0-rc.2", "19.1.0" ],
  "knip": [ "6.26.0", "6.39.0", "7.0.0" ],
  "husky": [ "9.1.6", "9.1.7" ],
  "rollup": [ "4.62.2", "4.70.0" ],
  "@varlock/bumpy": [ "1.18.1", "1.20.0", "2.0.0" ],
};

describe("planUpdates", () => {
  it("moves runtime, dev and peer specs together within the major, keeping each spec's prefix", () => {
    const { updates, drift } = planUpdates(manifest, registry);
    const updated = applyUpdates(manifest, updates);

    expect(drift).toEqual([]);

    expect(updated).toEqual({
      dependencies: {
        "eslint": "^9.40.0",
        "listr2": "^9.1.0",
        "plugin-rc": "19.1.0-rc.2",
      },
      devDependencies: {
        "knip": "6.39.0",
        "husky": "^9.1.7",
        "rollup": "^4.62.2",
      },
      peerDependencies: {
        "eslint": "^9.40.0",
        "knip": "6.39.0",
        "husky": "9.1.7",
        "@varlock/bumpy": "^1.20.0",
      },
    });
  });

  it("returns no updates when everything is already on its newest compatible version", () => {
    const current = applyUpdates(manifest, planUpdates(manifest, registry).updates);

    expect(planUpdates(current, registry)).toEqual({ updates: [], drift: [] });
  });

  it("keeps a 0.x dependency on its minor, as a caret range would", () => {
    const zero = { dependencies: { "react-refresh": "^0.5.3", "tiny": "0.0.1" } };
    const { updates } = planUpdates(zero, { "react-refresh": [ "0.5.7", "0.6.0" ], "tiny": [ "0.0.2" ] });

    expect(updates).toEqual([{ name: "react-refresh", section: "dependencies", from: "^0.5.3", to: "^0.5.7" }]);
  });

  it("keeps a ~ dependency on its minor", () => {
    const tilde = { dependencies: { tslib: "~2.8.1" } };
    const { updates } = planUpdates(tilde, { tslib: [ "2.8.4", "2.9.0", "3.0.0" ] });

    expect(updates).toEqual([{ name: "tslib", section: "dependencies", from: "~2.8.1", to: "~2.8.4" }]);
  });

  it("never moves a peer to a new major to follow its installed version, and reports the drift instead", () => {
    const split = { devDependencies: { jscpd: "^5.0.12" }, peerDependencies: { jscpd: "^4.0.9" } };
    const { updates, drift } = planUpdates(split, { jscpd: [ "4.0.9", "4.0.12", "5.4.0" ] });

    expect(applyUpdates(split, updates)).toEqual({ devDependencies: { jscpd: "^5.4.0" }, peerDependencies: { jscpd: "^4.0.12" } });
    expect(drift).toEqual([{ name: "jscpd", peer: "^4.0.12", installed: "^5.4.0" }]);
  });
});

describe("trackedDependencies", () => {
  it("covers runtime deps, peers and the devDependencies that mirror a peer, not other dev tooling", () => {
    expect(trackedDependencies(manifest)).toEqual([ "@varlock/bumpy", "eslint", "husky", "knip", "listr2", "plugin-rc" ]);
  });
});

describe("releasedVersions", () => {
  it("drops prereleases and versions younger than the minimum release age", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const time = {
      "created": "2020-01-01T00:00:00Z",
      "modified": "2026-10-06T00:00:00Z",
      "1.0.0": "2026-10-01T12:00:00Z",
      "1.1.0-beta.1": "2026-10-01T12:00:00Z",
      "1.1.0": "2026-10-03T12:00:00Z",
      "1.2.0": "2026-10-05T12:00:00Z",
    };

    expect(releasedVersions(time, now, 3 * 24 * 60)).toEqual([ "1.0.0", "1.1.0" ]);
  });
});

describe("catalogs", () => {
  const workspace = { catalog: { eslint: "^9.39.5", husky: "^9.1.6" }, catalogs: { tools: { knip: "6.26.0" } } };
  const catalogs = workspaceCatalogs(workspace);
  const cataloged = {
    dependencies: { "eslint": "catalog:", "listr2": "^9.0.5", "ghost": "catalog:" },
    devDependencies: { husky: "catalog:", knip: "catalog:tools" },
    peerDependencies: { eslint: "catalog:", husky: "9.1.6" },
  } satisfies Manifest;
  const plan = () => planUpdates(resolveCatalogs(cataloged, catalogs), registry);

  it("plans on the catalog's ranges and leaves a reference to a missing entry alone", () => {
    expect(resolveCatalogs(cataloged, catalogs)).toEqual({
      dependencies: { "eslint": "^9.39.5", "listr2": "^9.0.5", "ghost": "catalog:" },
      devDependencies: { husky: "^9.1.6", knip: "6.26.0" },
      peerDependencies: { eslint: "^9.39.5", husky: "9.1.6" },
    });
    expect(trackedDependencies(resolveCatalogs(cataloged, catalogs))).toEqual(trackedDependencies(cataloged));
  });

  it("updates a catalog entry once, keeps the manifest's references, and edits the manifest only for literal specs", () => {
    const { catalog, manifest } = splitCatalogUpdates(cataloged, plan().updates);

    expect(catalog).toEqual([
      { catalog: "default", name: "eslint", from: "^9.39.5", to: "^9.40.0" },
      { catalog: "default", name: "husky", from: "^9.1.6", to: "^9.1.7" },
    ]);
    expect(applyUpdates(cataloged, manifest)).toEqual({ ...cataloged, dependencies: { ...cataloged.dependencies, listr2: "^9.1.0" }, peerDependencies: { eslint: "catalog:", husky: "9.1.7" } });
  });

  it("updates a named catalog's entry", () => {
    const devOnly = { devDependencies: { knip: "catalog:tools" }, peerDependencies: { knip: "catalog:tools" } } satisfies Manifest;
    const { catalog, manifest } = splitCatalogUpdates(devOnly, planUpdates(resolveCatalogs(devOnly, catalogs), registry).updates);

    expect(catalog).toEqual([{ catalog: "tools", name: "knip", from: "6.26.0", to: "6.39.0" }]);
    expect(manifest).toEqual([]);
  });

  it("finds the default catalog under catalog: or catalogs.default, and named ones under catalogs", () => {
    expect(workspaceCatalogs({ catalogs: { default: { a: "^1.0.0" } } })).toEqual({ default: { a: "^1.0.0" } });
    expect(catalogEntryPath(workspace, "default", "eslint")).toEqual([ "catalog", "eslint" ]);
    expect(catalogEntryPath({ catalogs: { default: {} } }, "default", "eslint")).toEqual([ "catalogs", "default", "eslint" ]);
    expect(catalogEntryPath(workspace, "tools", "knip")).toEqual([ "catalogs", "tools", "knip" ]);
  });
});
