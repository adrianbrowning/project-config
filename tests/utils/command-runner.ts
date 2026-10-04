/**
 * Command execution utilities for tests
 */

import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import type { TestProject } from "./test-project.ts";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type RunOptions = { expectFailure?: boolean; };

function spawnOptions(project: TestProject) {
  return {
    cwd: project.dir,
    encoding: "utf-8" as const,
    env: { ...process.env, CI: "true" },
    maxBuffer: 10 * 1024 * 1024,
  };
}

/** Both streams and the exit code; throws on a non-zero exit unless `expectFailure` is set. */
function toResult(result: SpawnSyncReturns<string>, label: string, options?: RunOptions): CommandResult {
  if (result.error) throw result.error;
  const commandResult = { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  if (commandResult.exitCode !== 0 && !options?.expectFailure) {
    throw new Error(`Command failed (exit ${commandResult.exitCode}): ${label}\n${commandResult.stderr || commandResult.stdout}`);
  }
  return commandResult;
}

/**
 * Run a shell command line (pipes, globs and `&&` work) and capture stdout, stderr and the exit code.
 */
export function runCommand(project: TestProject, command: string, options?: RunOptions): CommandResult {
  return toResult(spawnSync(command, { ...spawnOptions(project), shell: true }), command, options);
}

/**
 * Stage everything and commit. The message goes to git as an argument, so quotes, `$` and backticks are kept as-is.
 */
export function gitCommit(project: TestProject, message: string, options?: RunOptions): CommandResult {
  project.exec("git add -A");
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- tests run git from PATH, as test-project.ts does
  return toResult(spawnSync("git", [ "commit", "-m", message ], spawnOptions(project)), `git commit -m ${JSON.stringify(message)}`, options);
}
