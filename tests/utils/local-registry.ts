/**
 * A throwaway npm registry serving one tarball, for tests that install a version not yet on npm.
 * The server runs in a child process: the tests run commands with spawnSync, which blocks this event loop.
 */

import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER = path.join(import.meta.dirname, "registry-server.ts");
const STARTUP_TIMEOUT_MS = 10_000;

export class LocalRegistry implements Disposable {
  /** Point a scope at this registry, e.g. `{ [`npm_config_${scope}:registry`]: url }`. */
  readonly url: string;
  private readonly child: ChildProcess;
  private readonly dir: string;

  constructor(tarball: string) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcm-registry-"));
    const manifestFile = path.join(this.dir, "package.json");
    const portFile = path.join(this.dir, "port");
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- tar is a test prerequisite, like git
    fs.writeFileSync(manifestFile, execFileSync("tar", [ "-xzOf", tarball, "package/package.json" ]));

    this.child = spawn(process.execPath, [ SERVER, tarball, manifestFile, portFile ], { stdio: "inherit" });
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (!fs.existsSync(portFile) || fs.readFileSync(portFile, "utf8") === "") {
      if (Date.now() > deadline || this.child.exitCode !== null) {
        this[Symbol.dispose]();
        throw new Error("local registry did not start");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    this.url = `http://127.0.0.1:${fs.readFileSync(portFile, "utf8")}/`;
  }

  [Symbol.dispose](): void {
    this.child.kill();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
