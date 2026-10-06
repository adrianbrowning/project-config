/**
 * Moves the tracked dependencies in package.json to their newest compatible versions (policy in dependency-policy.ts).
 * A dependency declared as `catalog:`/`catalog:<name>` is updated in that pnpm-workspace.yaml catalog instead, the
 * source of truth for every manifest that refers to it; the manifest keeps its reference.
 *
 *   node scripts/update-dependencies.ts [--summary <file>] [--bump-file <file>]
 *
 * --summary writes a Markdown table of the updates; --bump-file writes a bumpy patch bump file.
 * Neither file is written when nothing changes. Run `pnpm install --no-frozen-lockfile` afterwards to update the lockfile.
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { applyUpdates, catalogEntryPath, planUpdates, releasedVersions, resolveCatalogs, splitCatalogUpdates, trackedDependencies, workspaceCatalogs } from "./dependency-policy.ts";
import type { Manifest, PeerDrift, WorkspaceCatalogSettings } from "./dependency-policy.ts";

const REGISTRY = "https://registry.npmjs.org";

const { values: args } = parseArgs({
  options: {
    "summary": { type: "string" },
    "bump-file": { type: "string" },
  },
});

const manifestText = fs.readFileSync("package.json", "utf8");
const manifest = JSON.parse(manifestText) as Manifest & { name: string; };
const workspaceText = fs.readFileSync("pnpm-workspace.yaml", "utf8");
const workspace = YAML.parse(workspaceText) as WorkspaceCatalogSettings & { minimumReleaseAge?: number; };
const minimumReleaseAge = workspace.minimumReleaseAge ?? 0;

async function fetchReleased(name: string, now: Date): Promise<Array<string>> {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`);
  if (!response.ok) throw new Error(`${name}: registry responded ${response.status}`);
  const packument = await response.json() as { time?: Record<string, string>; };
  return releasedVersions(packument.time ?? {}, now, minimumReleaseAge);
}

/** One change: `where` is the manifest section, or the catalog that holds the version. */
interface ChangeRow {
  from: string;
  name: string;
  to: string;
  where: string;
}

function summaryTable(rows: ReadonlyArray<ChangeRow>): string {
  const lines = rows.map(u => `| \`${u.name}\` | ${u.where} | \`${u.from}\` | \`${u.to}\` |`);
  return [ "| Package | Section | From | To |", "| --- | --- | --- | --- |", ...lines, "" ].join("\n");
}

function driftNotes(drift: ReadonlyArray<PeerDrift>): string {
  if (drift.length === 0) return "";
  const lines = drift.map(d => `- \`${d.name}\`: peer \`${d.peer}\`, installed \`${d.installed}\``);
  return [ "", "These peers are outside the range of the installed version and were not aligned (a peer major change is breaking, so it needs a manual release decision):", "", ...lines, "" ].join("\n");
}

const now = new Date();
// The policy plans on the ranges catalogs hold; splitCatalogUpdates sends each update back to where it's declared
const resolved = resolveCatalogs(manifest, workspaceCatalogs(workspace));
const names = trackedDependencies(resolved);
const available = Object.fromEntries(await Promise.all(names.map(async name => [ name, await fetchReleased(name, now) ] as const)));
const { updates, drift } = planUpdates(resolved, available);
const split = splitCatalogUpdates(manifest, updates);
const notes = driftNotes(drift);
if (updates.length === 0) {
  console.log(`All ${names.length} tracked dependencies are on their newest compatible versions.${notes}`);
  process.exit(0);
}

if (split.manifest.length > 0) {
  const indent = /^\{\n( +)/.exec(manifestText)?.[1] ?? "  ";
  fs.writeFileSync("package.json", `${JSON.stringify(applyUpdates(manifest, split.manifest), null, indent)}\n`);
}
if (split.catalog.length > 0) {
  // Edits the document rather than re-serialising the parsed object, so comments and other settings stay as they are
  const doc = YAML.parseDocument(workspaceText);
  for (const u of split.catalog) doc.setIn(catalogEntryPath(workspace, u.catalog, u.name), u.to);
  fs.writeFileSync("pnpm-workspace.yaml", doc.toString({ lineWidth: 0 }));
}

const rows: Array<ChangeRow> = [
  ...split.manifest.map(u => ({ ...u, where: u.section })),
  ...split.catalog.map(u => ({ ...u, where: u.catalog === "default" ? "catalog" : `catalog:${u.catalog}` })),
];
const summary = `${summaryTable(rows)}${notes}`;
console.log(summary);
if (args.summary) fs.writeFileSync(args.summary, summary);
if (args["bump-file"]) {
  const lines = rows.map(u => `- \`${u.name}\` (${u.where}): \`${u.from}\` → \`${u.to}\``);
  fs.writeFileSync(args["bump-file"], `---\n"${manifest.name}": patch\n---\n\nUpdated dependencies to their newest compatible versions:\n\n${lines.join("\n")}\n`);
}
