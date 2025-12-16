/**
 * Test project management utility
 * Creates and manages isolated test project directories
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export type ProjectOptions = {
  name: string;
  baseDir?: string;
};

export class TestProject implements Disposable {
  readonly dir: string;
  private _cleaned = false;

  constructor(options: ProjectOptions) {
    const baseDir = options.baseDir ?? os.tmpdir();
    this.dir = path.join(baseDir, `test-${options.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Initialize as a new npm/pnpm project with git
   */
  init(): void {
    this.exec('pnpm init');
    this.exec('git init');
  }

  /**
   * Execute a shell command in the project directory
   */
  exec(command: string, options?: { stdio?: 'pipe' | 'inherit'; expectFailure?: boolean }): string {
    try {
      return execSync(command, {
        cwd: this.dir,
        stdio: options?.stdio ?? 'pipe',
        encoding: 'utf-8',
        env: { ...process.env, CI: 'true' },
      });
    } catch (error) {
      if (options?.expectFailure) {
        const err = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
        return err.stderr?.toString() ?? err.stdout?.toString() ?? '';
      }
      throw error;
    }
  }

  /**
   * Read a file from the project
   */
  readFile(filePath: string): string {
    return fs.readFileSync(path.join(this.dir, filePath), 'utf-8');
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
    return JSON.parse(this.readFile(filePath));
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
  runCli(flags: string[] = []): string {
    const flagStr = flags.join(' ');
    return this.exec(`pnpm exec gingacodemonkey-config ${flagStr}`);
  }

  /**
   * Install project dependencies
   */
  install(): void {
    this.exec('pnpm install');
  }

  /**
   * Stage all files for git
   */
  gitAdd(): void {
    this.exec('git add -A');
  }

  /**
   * Commit with a message
   */
  gitCommit(message: string, options?: { expectFailure?: boolean }): string {
    this.gitAdd();
    return this.exec(`git commit -m "${message}"`, options);
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
    return this.exec('git log -1 --format=%s').trim();
  }

  /**
   * Clean up the project directory
   */
  cleanup(): void {
    if (this._cleaned) return;
    this._cleaned = true;
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Disposable interface for `using` keyword
   */
  [Symbol.dispose](): void {
    this.cleanup();
  }
}

/**
 * Create a test project with automatic cleanup using `using`
 */
export function createTestProject(name: string): TestProject {
  return new TestProject({ name });
}
