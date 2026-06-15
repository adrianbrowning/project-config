/* eslint-disable sonarjs/no-os-command-from-path, sonarjs/os-command */
/**
 * Test project management utility
 * Clones the pre-installed template dir (via fs.cpSync) so each instance is isolated.
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./command-runner.ts";

type ProjectOptions = {
  name: string;
};

export class TestProject implements Disposable {
  readonly dir: string;

  constructor(options: ProjectOptions) {
    const templateDir = process.env.TEMPLATE_DIR;
    if (!templateDir) throw new Error("TEMPLATE_DIR not set — globalSetup may not have run");
    this.dir = path.join(os.tmpdir(), `gcm-test-${options.name}-${Date.now()}`);
    // ponytail: cpSync with hardlinks — fast clone without re-running pnpm install
    fs.cpSync(templateDir, this.dir, { recursive: true });
    execFileSync("git", [ "init" ], { cwd: this.dir, stdio: "pipe" });
  }

  /**
   * Execute a shell command in the project directory
   */
  exec(command: string, options?: { stdio?: "pipe" | "inherit"; expectFailure?: boolean; }): string {
    try {
      return execSync(command, {
        cwd: this.dir,
        stdio: options?.stdio ?? "pipe",
        encoding: "utf-8",
        env: { ...process.env, CI: "true" },
        maxBuffer: 10 * 1024 * 1024,
      });
    }
    catch (error) {
      const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; };
      const stderr = err.stderr?.toString() ?? "";
      const stdout = err.stdout?.toString() ?? "";
      if (options?.expectFailure) {
        return stderr || stdout;
      }
      // Include stderr in error message for debugging
      const details = stderr || stdout;
      throw new Error(`Command failed: ${command}\n${details}`);
    }
  }

  /**
   * Read a file from the project
   */
  readFile(filePath: string): string {
    return fs.readFileSync(path.join(this.dir, filePath), "utf-8");
  }

  /**
   * Check if a file exists in the project
   */
  fileExists(filePath: string): boolean {
    return fs.existsSync(path.join(this.dir, filePath));
  }

  /**
   * Write a file to the project
   */
  writeFile(filePath: string, content: string): void {
    const fullPath = path.join(this.dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  /**
   * Read and parse a JSON file from the project
   */
  readJson<T = unknown>(filePath: string): T {
    return JSON.parse(this.readFile(filePath)) as T;
  }

  /**
   * Write JSON to a file in the project
   */
  writeJson(filePath: string, data: unknown): void {
    this.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Install the config package from tarball
   */
  installTarball(tarballPath: string): void {
    this.exec(`pnpm add -D ${tarballPath}`);
  }

  /**
   * Run the CLI with specified flags
   */
  runCli(flags: Array<string> = []): string {
    const flagStr = flags.join(" ");
    return this.exec(`pnpm exec gingacodemonkey-config ${flagStr}`);
  }

  /**
   * Install project dependencies
   * Uses --no-frozen-lockfile because test projects have no lockfile
   */
  install(): void {
    this.exec("pnpm install --no-frozen-lockfile");
  }

  /**
   * Stage all files for git
   */
  gitAdd(): void {
    this.exec("git add -A");
  }

  /**
   * Commit with a message
   */
  gitCommit(message: string, options?: { expectFailure?: boolean; }) {
    this.gitAdd();
    return runCommand(this, `git commit -m "${message}"`, options);
  }

  /**
   * Create a git branch
   */
  gitBranch(name: string): void {
    this.exec(`git checkout -b ${name}`);
  }

  /**
   * Get latest commit message
   */
  getLastCommitMessage(): string {
    return this.exec("git log -1 --format=%B").trim();
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }

  rmDir(dir: string) {
    fs.rmSync(path.join(this.dir, dir), { recursive: true, force: true });
  }
}

