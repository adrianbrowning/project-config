/* eslint-disable sonarjs/no-os-command-from-path */
/**
 * Global test setup — runs once for the entire suite.
 * Creates a pre-installed template project so each test can clone it
 * via hardlinks (~100ms) instead of running `pnpm add` (~15s).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function findTarball(): string {
  const isFile = (p: string) => fs.statSync(p).isFile();

  const envPath = process.env.TARBALL_PATH;
  if (envPath && fs.existsSync(envPath) && isFile(envPath)) return envPath;

  const pkgDir = "/pkg";
  if (fs.existsSync(pkgDir)) {
    const tarball = fs.readdirSync(pkgDir).find(f => f.endsWith(".tgz") && isFile(path.join(pkgDir, f)));
    if (tarball) return path.join(pkgDir, tarball);
  }

  const projectRoot = path.resolve(import.meta.dirname, "..");
  const tarball = fs.readdirSync(projectRoot)
    .find(f => f.startsWith("gingacodemonkey-config-") && f.endsWith(".tgz") && isFile(path.join(projectRoot, f)));
  if (tarball) return path.join(projectRoot, tarball);

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
  execFileSync("pnpm", [
    "add", "-D",
    tarball,
    "typescript@^6.0.3", "@types/node@^24.0.0",
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
