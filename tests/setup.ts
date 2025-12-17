/**
 * Global test setup for @gingacodemonkey/config tests
 */

import fs from "node:fs";
import path from "node:path";

// Get tarball path from environment or find it
export function findTarball(): string {
  // Check environment variable first
  const envPath = process.env.TARBALL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Check /pkg directory (Docker)
  const pkgDir = "/pkg";
  if (fs.existsSync(pkgDir)) {
    const files = fs.readdirSync(pkgDir);
    const tarball = files.find(f => f.endsWith(".tgz"));
    if (tarball) {
      return path.join(pkgDir, tarball);
    }
  }

  // Check project root (local development)
  const projectRoot = path.resolve(__dirname, "..");
  const files = fs.readdirSync(projectRoot);
  const tarball = files.find(f => f.startsWith("gingacodemonkey-config-") && f.endsWith(".tgz"));
  if (tarball) {
    return path.join(projectRoot, tarball);
  }

  throw new Error("No tarball found. Run `pnpm build` first.");
}

// Export tarball path for use in tests
export const TARBALL_PATH = findTarball();
