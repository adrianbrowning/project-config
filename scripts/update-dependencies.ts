/**
 * Moves the tracked dependencies in package.json to their newest compatible versions (policy in dependency-policy.ts).
 *
 *   node scripts/update-dependencies.ts [--summary <file>] [--bump-file <file>]
 *
 * --summary writes a Markdown table of the updates; --bump-file writes a bumpy patch bump file.
 * Neither file is written when nothing changes. Run `pnpm install --no-frozen-lockfile` afterwards to update the lockfile.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { applyUpdates, planUpdates, releasedVersions, trackedDependencies } from "./dependency-policy.ts";
import type { DependencyUpdate, Manifest, PeerDrift } from "./dependency-policy.ts";

const REGISTRY = "https://registry.npmjs.org";

const { values: args } = parseArgs({
  options: {
    "summary": { type: "string" },
    "bump-file": { type: "string" },
  },
});

const manifestText = fs.readFileSync("package.json", "utf8");
const manifest = JSON.parse(manifestText) as Manifest & { name: string; };
const workspace = YAML.parse(fs.readFileSync("pnpm-workspace.yaml", "utf8")) as { minimumReleaseAge?: number; };
const minimumReleaseAge = workspace.minimumReleaseAge ?? 0;

async function fetchReleased(name: string, now: Date): Promise<Array<string>> {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`);
  if (!response.ok) throw new Error(`${name}: registry responded ${response.status}`);
  const packument = await response.json() as { time?: Record<string, string>; };
  return releasedVersions(packument.time ?? {}, now, minimumReleaseAge);
}

function summaryTable(updates: ReadonlyArray<DependencyUpdate>): string {
  const rows = updates.map(u => `| \`${u.name}\` | ${u.section} | \`${u.from}\` | \`${u.to}\` |`);
  return [ "| Package | Section | From | To |", "| --- | --- | --- | --- |", ...rows, "" ].join("\n");
}

function driftNotes(drift: ReadonlyArray<PeerDrift>): string {
  if (drift.length === 0) return "";
  const lines = drift.map(d => `- \`${d.name}\`: peer \`${d.peer}\`, installed \`${d.installed}\``);
  return [ "", "These peers are outside the range of the installed version and were not aligned (a peer major change is breaking, so it needs a manual release decision):", "", ...lines, "" ].join("\n");
}

const now = new Date();
const names = trackedDependencies(manifest);
const available = Object.fromEntries(await Promise.all(names.map(async name => [ name, await fetchReleased(name, now) ] as const)));
const { updates, drift } = planUpdates(manifest, available);
const notes = driftNotes(drift);

if (updates.length === 0) {
  console.log(`All ${names.length} tracked dependencies are on their newest compatible versions.${notes}`);
  process.exit(0);
}

const indent = /^\{\n( +)/.exec(manifestText)?.[1] ?? "  ";
fs.writeFileSync("package.json", `${JSON.stringify(applyUpdates(manifest, updates), null, indent)}\n`);

const summary = `${summaryTable(updates)}${notes}`;
console.log(summary);
if (args.summary) fs.writeFileSync(args.summary, summary);
if (args["bump-file"]) {
  const lines = updates.map(u => `- \`${u.name}\` (${u.section}): \`${u.from}\` → \`${u.to}\``);
  fs.writeFileSync(args["bump-file"], `---\n"${manifest.name}": patch\n---\n\nUpdated dependencies to their newest compatible versions:\n\n${lines.join("\n")}\n`);
}
