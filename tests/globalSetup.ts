/* eslint-disable sonarjs/no-os-command-from-path */
/**
 * Global test setup — runs once for the entire suite.
 * Creates a pre-installed template project so each test can copy it (~9s on macOS, ~29k files)
 * instead of running `pnpm add`. The copy is most of a test's runtime; share one project across cases where they can't interfere.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { PNPM_SETTINGS } from "../src/project-defaults.ts";

/** Newest matching `.tgz` in `dir` by mtime, so a stale build from an older version is never picked. */
function newestTarball(dir: string, prefix = ""): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith(".tgz"))
    .map(f => path.join(dir, f))
    .filter(p => fs.statSync(p).isFile())
    .toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function findTarball(): string {
  const envPath = process.env.TARBALL_PATH;
  if (envPath && fs.existsSync(envPath) && fs.statSync(envPath).isFile()) return envPath;

  const tarball = newestTarball("/pkg")
    ?? newestTarball(path.resolve(import.meta.dirname, ".."), "gingacodemonkey-config-");
  if (tarball) return tarball;

  throw new Error("No tarball found. Run `pnpm build` first.");
}

let templateDir: string;

function createTemplate(tarball: string): string {
  const dir = path.join(os.tmpdir(), `gcm-template-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test-template", version: "1.0.0", private: true, "type": "module" }, null, 2)
  );
  // A project after setup: its pnpm settings come first, so the lockfile only holds versions pnpm 11+ accepts
  fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), YAML.stringify(PNPM_SETTINGS));
  execFileSync("pnpm", [
    "add", "-D",
    tarball,
    "typescript@^6.0.3", "@types/node@^24.0.0",
    "-w",
  ], { cwd: dir, stdio: "pipe" });

  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\ndist\n.cache\n");

  return dir;
}

export async function setup() {
  const tarball = findTarball();
  templateDir = createTemplate(tarball);
  process.env.TEMPLATE_DIR = templateDir;
}

export async function teardown() {
  if (templateDir) fs.rmSync(templateDir, { recursive: true, force: true });
}
