/**
 * Command execution utilities for tests
 */

import { execSync } from 'child_process';
import type { TestProject } from './test-project.ts';

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/**
 * Run a command and capture output/exit code
 */
export function runCommand(
  project: TestProject,
  command: string,
  options?: { expectFailure?: boolean }
): CommandResult {
  try {
    const stdout = execSync(command, {
      cwd: project.dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    if (options?.expectFailure) {
      return {
        exitCode: err.status ?? 1,
        stdout: typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '',
        stderr: typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '',
      };
    }
    throw error;
  }
}

/**
 * Run lint command
 */
export function runLint(project: TestProject): CommandResult {
  return runCommand(project, 'pnpm lint', { expectFailure: true });
}

/**
 * Run lint:fix command
 */
export function runLintFix(project: TestProject): CommandResult {
  return runCommand(project, 'pnpm lint:fix', { expectFailure: true });
}

/**
 * Run type-check command
 */
export function runTypeCheck(project: TestProject): CommandResult {
  return runCommand(project, 'pnpm type-check', { expectFailure: true });
}

/**
 * Run knip command
 */
export function runKnip(project: TestProject): CommandResult {
  return runCommand(project, 'pnpm knip', { expectFailure: true });
}

/**
 * Run commitlint on a message
 */
export function runCommitLint(project: TestProject, message: string): CommandResult {
  return runCommand(project, `echo "${message}" | pnpm exec commitlint`, { expectFailure: true });
}

/**
 * Make a git commit
 */
export function gitCommit(
  project: TestProject,
  message: string,
  options?: { expectFailure?: boolean }
): CommandResult {
  project.exec('git add -A');
  return runCommand(project, `git commit -m "${message}"`, options);
}
