/**
 * Command execution utilities for tests
 */

import { spawnSync } from "node:child_process";
import type { TestProject } from "./test-project.ts";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

/**
 * Run a command and capture stdout, stderr and the exit code.
 * Throws on a non-zero exit unless `expectFailure` is set.
 */
export function runCommand(
  project: TestProject,
  command: string,
  options?: { expectFailure?: boolean; }
): CommandResult {
  const result = spawnSync(command, {
    cwd: project.dir,
    encoding: "utf-8",
    shell: true,
    env: { ...process.env, CI: "true" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  const commandResult = { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  if (commandResult.exitCode !== 0 && !options?.expectFailure) {
    throw new Error(`Command failed (exit ${commandResult.exitCode}): ${command}\n${commandResult.stderr || commandResult.stdout}`);
  }
  return commandResult;
}

/**
 * Make a git commit
 */
export function gitCommit(
  project: TestProject,
  message: string,
  options?: { expectFailure?: boolean; }
): CommandResult {
  project.exec("git add -A");
  return runCommand(project, `git commit -m "${message}"`, options);
}
