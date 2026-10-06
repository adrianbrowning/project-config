/**
 * Which compatible version each tracked dependency moves to, and how peer ranges follow it.
 * Pure: the CLI in update-dependencies.ts supplies registry data and writes the results.
 */

type Section = "dependencies" | "devDependencies" | "peerDependencies";

export type Manifest = Partial<Record<Section, Record<string, string>>>;

export interface DependencyUpdate {
  from: string;
  name: string;
  section: Section;
  to: string;
}

interface Spec {
  prefix: "" | "^" | "~";
  version: [ number, number, number ];
}

const SPEC = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/;
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

function parseSpec(spec: string): Spec | undefined {
  const match = SPEC.exec(spec);
  if (!match) return undefined;
  return {
    prefix: match[1] as Spec["prefix"],
    version: [ Number(match[2]), Number(match[3]), Number(match[4]) ],
  };
}

function compare(a: Spec["version"], b: Spec["version"]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Whether `candidate` satisfies the range the spec already allows, widened to a caret for exact pins:
 * `~` stays on its minor; `^` and exact pins stay on the major (1.x.x on 1, 0.3.x on 0.3, 0.0.x never moves).
 */
function isCompatible(current: Spec, candidate: Spec["version"]): boolean {
  const [ major, minor ] = current.version;
  if (current.prefix === "~") return candidate[0] === major && candidate[1] === minor;
  if (major > 0) return candidate[0] === major;
  if (minor > 0) return candidate[0] === 0 && candidate[1] === minor;
  return false;
}

/**
 * Stable versions published at least `minimumReleaseAgeMinutes` ago, from an npm packument's `time` map.
 * Matches pnpm's `minimumReleaseAge`, so `pnpm install` can resolve every version this picks.
 */
export function releasedVersions(time: Record<string, string>, now: Date, minimumReleaseAgeMinutes: number): Array<string> {
  const cutoff = now.getTime() - minimumReleaseAgeMinutes * 60_000;
  return Object.entries(time)
    .filter(([ version, published ]) => STABLE_VERSION.test(version) && Date.parse(published) <= cutoff)
    .map(([ version ]) => version);
}

/** Highest compatible version above the spec's, keeping its prefix; undefined when the spec isn't a plain version or nothing newer exists. */
function upgradeSpec(spec: string, available: ReadonlyArray<string>): string | undefined {
  const current = parseSpec(spec);
  if (!current) return undefined;
  let best = current.version;
  for (const version of available) {
    const candidate = parseSpec(version)?.version;
    if (candidate && isCompatible(current, candidate) && compare(candidate, best) > 0) best = candidate;
  }
  return best === current.version ? undefined : `${current.prefix}${best.join(".")}`;
}

/**
 * Names whose versions this policy manages: everything in dependencies and peerDependencies,
 * plus devDependencies that are also peers (the version the repo builds and tests against).
 */
export function trackedDependencies(manifest: Manifest): Array<string> {
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const names = new Set([ ...Object.keys(manifest.dependencies ?? {}), ...peers ]);
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    if (peers.includes(name)) names.add(name);
  }
  return [ ...names ].toSorted((a, b) => a.localeCompare(b));
}

/** A peer whose installed counterpart sits outside the peer's compatible range, so the two can't be aligned automatically. */
export interface PeerDrift {
  installed: string;
  name: string;
  peer: string;
}

export interface UpdatePlan {
  drift: Array<PeerDrift>;
  updates: Array<DependencyUpdate>;
}

type Available = Readonly<Record<string, ReadonlyArray<string>>>;

/** Upgrades `dependencies` and the peer-mirroring `devDependencies`; returns each installed name's resulting spec. */
function planInstalled(manifest: Manifest, available: Available, updates: Array<DependencyUpdate>): Record<string, string> {
  const installed: Record<string, string> = {};
  for (const section of [ "dependencies", "devDependencies" ] as const) {
    for (const [ name, from ] of Object.entries(manifest[section] ?? {})) {
      if (section === "devDependencies" && !manifest.peerDependencies?.[name]) continue;
      const to = upgradeSpec(from, available[name] ?? []);
      if (to) updates.push({ name, section, from, to });
      installed[name] ??= to ?? from;
    }
  }
  return installed;
}

/** The installed version with the peer's prefix, when it is inside the peer's compatible range and not older. */
function alignPeer(peerSpec: string, installedSpec: string | undefined): string | undefined {
  const peer = parseSpec(peerSpec);
  const counterpart = installedSpec === undefined ? undefined : parseSpec(installedSpec);
  if (!peer || !counterpart) return undefined;
  if (!isCompatible(peer, counterpart.version) || compare(counterpart.version, peer.version) < 0) return undefined;
  return `${peer.prefix}${counterpart.version.join(".")}`;
}

/**
 * Updates that move every tracked dependency to its newest compatible version.
 * A peer that is also installed (in dependencies or devDependencies) takes the installed version with its own prefix,
 * so the range consumers see, and the `__*_version__` placeholders build.ts fills from it, match what was tested.
 * That only happens when the installed version is inside the peer's own compatible range: moving a peer to a new major
 * is a breaking change for consumers, so such a peer is upgraded on its own and reported as drift for a human to resolve.
 * Peers with no installed counterpart are upgraded on their own.
 */
export function planUpdates(manifest: Manifest, available: Available): UpdatePlan {
  const updates: Array<DependencyUpdate> = [];
  const drift: Array<PeerDrift> = [];
  const installed = planInstalled(manifest, available, updates);

  for (const [ name, from ] of Object.entries(manifest.peerDependencies ?? {})) {
    const installedSpec = installed[name];
    const aligned = alignPeer(from, installedSpec);
    const to = aligned ?? upgradeSpec(from, available[name] ?? []);
    if (to && to !== from) updates.push({ name, section: "peerDependencies", from, to });
    if (installedSpec !== undefined && !aligned) drift.push({ name, peer: to ?? from, installed: installedSpec });
  }

  return { updates, drift };
}

/** Copy of `manifest` with `updates` applied, keeping key order. */
export function applyUpdates<T extends Manifest>(manifest: T, updates: ReadonlyArray<DependencyUpdate>): T {
  const next = structuredClone(manifest);
  for (const { name, section, to } of updates) {
    const deps = next[section];
    if (deps) deps[name] = to;
  }
  return next;
}
