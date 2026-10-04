/**
 * Reconciliation primitives for `--update`: each one compares a managed value on disk with the current default
 * and returns what update would do with it. Nothing is written until the caller runs `apply`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";
import { updateWorkspaceYaml } from "../utils.ts";
import { KNOWN_TEMPLATE_HASHES } from "./known-versions.ts";

/**
 * - unchanged: already the current default
 * - updated / added: a known earlier default, or missing; update writes the current default
 * - customized: a starter file the user edited; left alone, never a conflict
 * - conflict: a value the user changed in a file or key the CLI owns; written only on --overwrite or when confirmed
 * - skipped: an optional file that isn't there (e.g. a workflow the user deleted)
 */
export type Status = "added" | "conflict" | "customized" | "skipped" | "unchanged" | "updated";

export type PlanItem = {
  apply?: () => void;
  label: string;
  reason?: string;
  status: Status;
};

type FileOptions = {
  /** Other exact contents the CLI has written to this path (e.g. a placeholder hook). */
  alsoKnown?: Array<string>;
  /** Key into KNOWN_TEMPLATE_HASHES, when the same template lands at more than one path. */
  knownKey?: string;
  /** Skip, rather than add, when the file is missing. */
  optional?: boolean;
  /** A starter file users are expected to edit: edits are kept and never reported as conflicts. */
  userEditable?: boolean;
};

const sha256 = (content: string) => crypto.createHash("sha256").update(content)
  .digest("hex");

function readFile(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function differs(label: string, userEditable: boolean | undefined, apply: () => void): PlanItem {
  return userEditable
    ? { label, status: "customized", reason: "edited; left as is" }
    : { label, status: "conflict", reason: "differs from every version this CLI has written", apply };
}

/**
 * A whole file written from a template: replaced only when it matches a version the CLI wrote. Trailing
 * whitespace is ignored, so an editor adding or trimming final newlines doesn't make a template user content.
 */
export function templateFile(file: string, current: string, options: FileOptions = {}): PlanItem {
  const content = readFile(file);
  const apply = () => writeFile(file, current);
  if (content === undefined) {
    return options.optional ? { label: file, status: "skipped", reason: "not present" } : { label: file, status: "added", apply };
  }
  const body = content.trimEnd();
  if (body === current.trimEnd()) return { label: file, status: "unchanged" };
  const known = KNOWN_TEMPLATE_HASHES[options.knownKey ?? file] ?? [];
  if (known.includes(sha256(body)) || options.alsoKnown?.some(other => other.trimEnd() === body)) {
    return { label: file, status: "updated", apply };
  }
  return differs(file, options.userEditable, apply);
}

/** A JSON config file, compared by value so formatting changes don't count. */
export function jsonFile(file: string, current: unknown, previous: Array<unknown>, options: FileOptions = {}): PlanItem {
  const content = readFile(file);
  const apply = () => writeFile(file, JSON.stringify(current, null, 2));
  if (content === undefined) {
    return options.optional ? { label: file, status: "skipped", reason: "not present" } : { label: file, status: "added", apply };
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  }
  catch {
    return differs(file, options.userEditable, apply);
  }
  if (isDeepStrictEqual(value, current)) return { label: file, status: "unchanged" };
  if (previous.some(old => isDeepStrictEqual(value, old))) return { label: file, status: "updated", apply };
  return differs(file, options.userEditable, apply);
}

function readManifest(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} is not a JSON object`);
  return value as Record<string, unknown>;
}

/** Writes `manifest[section][key] = value`, keeping the file's trailing newline (or lack of one). */
function setManifestEntry(file: string, section: string, key: string, value: string): void {
  const manifest = readManifest(file);
  const entries = (manifest[section] ?? {}) as Record<string, unknown>;
  const trailing = fs.readFileSync(file, "utf8").endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, JSON.stringify({ ...manifest, [section]: { ...entries, [key]: value } }, null, 2) + trailing);
}

/** One entry of a package.json object such as `scripts` or `engines`. */
export function manifestEntry(file: string, section: string, key: string, current: string, previous: Array<string> = []): PlanItem {
  const label = `${file} › ${section}.${key}`;
  const entries = readManifest(file)[section] as Record<string, unknown> | undefined;
  const value = entries?.[key];
  const apply = () => setManifestEntry(file, section, key, current);
  if (value === undefined) return { label, status: "added", apply };
  if (value === current) return { label, status: "unchanged" };
  if (typeof value === "string" && previous.includes(value)) return { label, status: "updated", apply };
  return { label, status: "conflict", reason: `is ${JSON.stringify(value)}, expected ${JSON.stringify(current)}`, apply };
}

function readWorkspaceDoc(): Record<string, unknown> {
  const content = readFile("pnpm-workspace.yaml");
  const doc: unknown = content === undefined ? null : YAML.parse(content);
  return doc !== null && typeof doc === "object" ? doc as Record<string, unknown> : {};
}

/** A top-level pnpm-workspace.yaml setting. Maps (allowBuilds) are compared entry by entry; user entries are kept. */
export function pnpmSetting(key: string, current: unknown): PlanItem {
  const label = `pnpm-workspace.yaml › ${key}`;
  const doc = readWorkspaceDoc();
  const value = doc[key];
  const legacy = (doc.pnpm as Record<string, unknown> | undefined)?.[key];
  const apply = () => updateWorkspaceYaml({ [key]: current } as Parameters<typeof updateWorkspaceYaml>[0]);

  // Older releases nested settings under `pnpm:`, where pnpm ignores them
  if (legacy !== undefined) return { label, status: "updated", reason: "moved out of the ignored pnpm: block", apply };
  if (value === undefined) return { label, status: "added", apply };

  if (current !== null && typeof current === "object" && !Array.isArray(current) && value !== null && typeof value === "object") {
    const existing = value as Record<string, unknown>;
    const entries = Object.entries(current);
    if (entries.some(([ child, childValue ]) => existing[child] !== undefined && !isDeepStrictEqual(existing[child], childValue))) {
      return { label,
        status: "conflict",
        reason: `has entries that differ from ${JSON.stringify(current)}`,
        apply: () => {
          const yaml = readFile("pnpm-workspace.yaml") ?? "";
          const doc2 = YAML.parseDocument(yaml);
          doc2.setIn([ key ], { ...existing, ...current });
          fs.writeFileSync("pnpm-workspace.yaml", doc2.toString());
        } };
    }
    return entries.every(([ child ]) => existing[child] !== undefined) ? { label, status: "unchanged" } : { label, status: "updated", apply };
  }

  if (isDeepStrictEqual(value, current)) return { label, status: "unchanged" };
  return { label, status: "conflict", reason: `is ${JSON.stringify(value)}, expected ${JSON.stringify(current)}`, apply };
}
