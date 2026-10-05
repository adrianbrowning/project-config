/**
 * `--update`: reconcile a project's managed configuration with this release's defaults.
 * No packages are installed; only files and keys listed in registry.ts are compared or written.
 */
import type { CliArgs } from "../cli-args.ts";
import { DETECTABLE_TOOLS, detectTools } from "../tool-detection.ts";
import type { DetectableTool } from "../tool-detection.ts";
import type { PlanItem, Status } from "./reconcile.ts";
import { managedItems } from "./registry.ts";

export type UpdatePrompts = {
  /** Interactive only: which of the detected tools to update. */
  chooseTools: (detected: Array<DetectableTool>) => Promise<Array<DetectableTool>>;
  /** Interactive only: whether to overwrite one conflicting value. */
  confirmOverwrite: (item: PlanItem) => Promise<boolean>;
};

type Log = (line: string) => void;

const STATUS_ORDER: Array<Status> = [ "updated", "added", "conflict", "customized", "skipped", "unchanged" ];
const WRITES: ReadonlySet<Status> = new Set<Status>([ "added", "updated" ]);
const KNOWN_TOOLS: ReadonlySet<string> = new Set(DETECTABLE_TOOLS);

function report(items: Array<PlanItem>, log: Log): void {
  log(`Update: ${STATUS_ORDER.map(status => `${items.filter(item => item.status === status).length} ${status}`).join(", ")}`);
  for (const status of STATUS_ORDER.filter(status => status !== "unchanged")) {
    for (const item of items.filter(entry => entry.status === status)) {
      log(`  ${status.padEnd(10)} ${item.label}${item.reason ? ` (${item.reason})` : ""}`);
    }
  }
  if (!items.some(item => WRITES.has(item.status) || item.status === "conflict")) log("Nothing to update.");
}

async function selectTools(cliArgs: CliArgs, detected: Array<DetectableTool>, prompts: null | UpdatePrompts, log: Log): Promise<Array<DetectableTool>> {
  const present = new Set<string>(detected);
  for (const tool of cliArgs.tools.filter(tool => !present.has(tool))) log(`Skipping ${tool}: not set up in this project`);
  const requested = new Set(cliArgs.tools);
  if (requested.size > 0) return detected.filter(tool => requested.has(tool));
  return prompts ? prompts.chooseTools(detected) : detected;
}

/** The conflicts to overwrite, or null when a non-interactive run must stop instead. */
async function resolveConflicts(conflicts: Array<PlanItem>, cliArgs: CliArgs, prompts: null | UpdatePrompts): Promise<null | Set<PlanItem>> {
  if (cliArgs.overwrite) return new Set(conflicts);
  if (!prompts) return conflicts.length > 0 ? null : new Set();
  const overwrite = new Set<PlanItem>();
  for (const item of conflicts) {
    // One question at a time, in order
    // eslint-disable-next-line no-await-in-loop
    if (await prompts.confirmOverwrite(item)) overwrite.add(item);
  }
  return overwrite;
}

/**
 * Runs update and returns the process exit code. `prompts` is null for non-interactive runs (`--yes` or `--tool`):
 * conflicts then fail the run, with nothing written, unless `--overwrite` is set.
 */
export async function runUpdate(cliArgs: CliArgs, prompts: null | UpdatePrompts, log: Log): Promise<number> {
  const unknown = cliArgs.tools.filter(tool => !KNOWN_TOOLS.has(tool));
  for (const tool of unknown) log(`Skipping ${tool}: update doesn't manage it`);

  const detected = detectTools();
  const selected = await selectTools({ ...cliArgs, tools: cliArgs.tools.filter(tool => KNOWN_TOOLS.has(tool)) }, detected, prompts, log);
  if (selected.length === 0) {
    log("No configured tools to update.");
    return 0;
  }
  log(`Updating: ${selected.join(", ")}`);

  // An explicit --tool subset updates only those tools; otherwise the root pnpm settings and engines come too
  const items = managedItems(selected, detected, cliArgs.tools.length === 0);
  const overwrite = await resolveConflicts(items.filter(item => item.status === "conflict"), cliArgs, prompts);
  if (!overwrite) {
    report(items, log);
    log("Conflicts found: nothing was written. Change those values back, or rerun with --overwrite to replace them.");
    return 1;
  }

  for (const item of items) if (WRITES.has(item.status) || overwrite.has(item)) item.apply?.();
  report(items.map(item => {
    if (item.status !== "conflict") return item;
    return overwrite.has(item)
      ? { ...item, status: "updated" as const, reason: "overwrote your value" }
      : { ...item, status: "customized" as const, reason: "kept your value" };
  }), log);
  return 0;
}
