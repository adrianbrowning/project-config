/**
 * GitHub Actions integration tests
 */

import { describe, it, expect } from 'vitest';
import { TestProject } from '../utils/test-project.ts';
import {
  assertFileExists,
  assertFileNotExists,
  assertFileContains,
} from '../utils/file-assertions.ts';
import { TARBALL_PATH } from '../setup.ts';

describe('GitHub Actions Workflows', () => {
  it('creates .github/workflows directory', () => {
    using project = new TestProject({ name: 'ga-directory' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--all', '--yes', '--no-release']);

    expect(project.fileExists('.github/workflows')).toBe(true);
  });

  it('generates cache.yml (always included)', () => {
    using project = new TestProject({ name: 'ga-cache' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--all', '--yes', '--no-release']);

    assertFileExists(project, '.github/workflows/cache.yml');
    assertFileContains(project, '.github/workflows/cache.yml', 'pnpm');
  });

  it('generates ci_test.yml (always included)', () => {
    using project = new TestProject({ name: 'ga-ci-test' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--all', '--yes', '--no-release']);

    assertFileExists(project, '.github/workflows/ci_test.yml');
  });

  it('generates lint.yml when ESLint is selected', () => {
    using project = new TestProject({ name: 'ga-lint' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=eslint', '--yes']);

    assertFileExists(project, '.github/workflows/lint.yml');
    assertFileContains(project, '.github/workflows/lint.yml', 'ESLint');
  });

  it('generates knip.yml when Knip is selected', () => {
    using project = new TestProject({ name: 'ga-knip' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=knip', '--yes']);

    assertFileExists(project, '.github/workflows/knip.yml');
    assertFileContains(project, '.github/workflows/knip.yml', 'knip');
  });

  it('generates ts-check.yml when TypeScript is selected', () => {
    using project = new TestProject({ name: 'ga-ts-check' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=ts', '--yes', '--ts-no-dom', '--ts-type=library']);

    assertFileExists(project, '.github/workflows/ts-check.yml');
    assertFileContains(project, '.github/workflows/ts-check.yml', 'TypeScript');
  });

  it('does NOT generate release.yml with --no-release flag', () => {
    using project = new TestProject({ name: 'ga-no-release' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--all', '--yes', '--no-release']);

    assertFileNotExists(project, '.github/workflows/release.yml');
  });

  it('lint.yml has bot check to prevent infinite loops', () => {
    using project = new TestProject({ name: 'ga-bot-check' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=eslint', '--yes']);

    const lintYml = project.readFile('.github/workflows/lint.yml');
    expect(lintYml).toContain('github-actions[bot]');
  });

  it('workflows use pnpm action', () => {
    using project = new TestProject({ name: 'ga-pnpm-action' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=eslint', '--yes']);

    const lintYml = project.readFile('.github/workflows/lint.yml');
    expect(lintYml).toContain('pnpm/action-setup');
  });

  it('workflows use Node.js setup action', () => {
    using project = new TestProject({ name: 'ga-node-action' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=eslint', '--yes']);

    const lintYml = project.readFile('.github/workflows/lint.yml');
    expect(lintYml).toContain('actions/setup-node');
  });

  it('workflows use checkout action', () => {
    using project = new TestProject({ name: 'ga-checkout-action' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=eslint', '--yes']);

    const lintYml = project.readFile('.github/workflows/lint.yml');
    expect(lintYml).toContain('actions/checkout');
  });
});
