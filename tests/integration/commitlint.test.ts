/**
 * CommitLint integration tests
 */

import { describe, it, expect } from 'vitest';
import { TestProject } from '../utils/test-project.ts';
import {
  assertFileExists,
  assertFileContains,
} from '../utils/file-assertions.ts';
import { gitCommit } from '../utils/command-runner.ts';
import { TARBALL_PATH } from '../setup.ts';

describe('CommitLint Configuration', () => {
  it('generates commitlint.config.js with conventional config', () => {
    using project = new TestProject({ name: 'commitlint-config' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=commitLint', '--yes']);

    assertFileExists(project, 'commitlint.config.js');
    assertFileContains(project, 'commitlint.config.js', '@commitlint/config-conventional');
  });

  it('has subject-case rule configured', () => {
    using project = new TestProject({ name: 'commitlint-subject' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=commitLint', '--yes']);

    assertFileContains(project, 'commitlint.config.js', 'subject-case');
    assertFileContains(project, 'commitlint.config.js', 'sentence-case');
    assertFileContains(project, 'commitlint.config.js', 'lower-case');
  });

  it('rejects non-conventional commit message', () => {
    using project = new TestProject({ name: 'commitlint-reject' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=husky', '--tool=commitLint', '--yes']);

    project.writeFile('src/index.ts', 'export const x = 1;');
    project.install();

    // Invalid commit message should be rejected
    const result = gitCommit(project, 'bad commit message', { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
  });

  it('accepts feat: conventional commit', () => {
    using project = new TestProject({ name: 'commitlint-feat' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=husky', '--tool=commitLint', '--yes']);

    project.writeFile('src/index.ts', 'export const x = 1;');
    project.install();

    // Valid commit should succeed
    const result = gitCommit(project, 'feat: add new feature');
    expect(result.exitCode).toBe(0);
  });

  it('accepts fix: conventional commit', () => {
    using project = new TestProject({ name: 'commitlint-fix' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=husky', '--tool=commitLint', '--yes']);

    project.writeFile('src/index.ts', 'export const x = 1;');
    project.install();

    const result = gitCommit(project, 'fix: resolve bug');
    expect(result.exitCode).toBe(0);
  });

  it('accepts chore: conventional commit', () => {
    using project = new TestProject({ name: 'commitlint-chore' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=husky', '--tool=commitLint', '--yes']);

    project.writeFile('src/index.ts', 'export const x = 1;');
    project.install();

    const result = gitCommit(project, 'chore: update dependencies');
    expect(result.exitCode).toBe(0);
  });
});
