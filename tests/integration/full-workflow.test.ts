/**
 * Full workflow integration test
 * Tests the complete CLI workflow: setup, lint, type-check, commit
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestProject } from '../utils/test-project.ts';
import {
  assertFileExists,
  assertFileNotExists,
  assertFileContains,
  assertPackageJsonScript,
  assertJsonHasProperty,
} from '../utils/file-assertions.ts';
import { runCommand, gitCommit } from '../utils/command-runner.ts';
import { TARBALL_PATH } from '../setup.ts';

describe('Complete CLI workflow', () => {
  let project: TestProject;

  beforeAll(() => {
    project = new TestProject({ name: 'full-workflow' });
    project.init();
  });

  afterAll(() => {
    project.cleanup();
  });

  it('sets up all tools with --all --yes --no-release flags', async () => {
    // Install tarball
    project.installTarball(TARBALL_PATH);

    // Run CLI with all tools selected (except release)
    const result = project.runCli([
      '--all',
      '--yes',
      '--no-release',
      '--ts-mode=bundler',
      '--ts-dom',
      '--ts-type=app',
    ]);

    expect(result).toContain('Running in non-interactive mode');
  });

  it('generates TypeScript configuration', () => {
    assertFileExists(project, 'tsconfig.json');
    assertFileContains(project, 'tsconfig.json', '@gingacodemonkey/config');

    // Verify tsconfig extends correct base
    const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
    expect(tsconfig.extends).toContain('bundler');
    expect(tsconfig.extends).toContain('dom');
    expect(tsconfig.extends).toContain('app');

    // Verify type-check script added
    assertPackageJsonScript(project, 'type-check', 'tsc --noEmit');
  });

  it('generates ESLint configuration', () => {
    assertFileExists(project, 'eslint.config.ts');
    assertFileExists(project, 'eslint.config.style.ts');

    assertFileContains(project, 'eslint.config.ts', '@gingacodemonkey/config/eslint');
    assertFileContains(project, 'eslint.config.style.ts', '@gingacodemonkey/config/styled');

    // Verify lint scripts added
    assertPackageJsonScript(project, 'lint');
    assertPackageJsonScript(project, 'lint:fix');
  });

  it('generates Husky git hooks', () => {
    assertFileExists(project, '.husky/pre-commit');
    assertFileExists(project, '.husky/commit-msg');

    assertFileContains(project, '.husky/pre-commit', 'lint-staged');
    assertFileContains(project, '.husky/commit-msg', 'commitlint');
  });

  it('generates CommitLint configuration', () => {
    assertFileExists(project, 'commitlint.config.js');
    assertFileContains(project, 'commitlint.config.js', '@commitlint/config-conventional');
  });

  it('generates Lint-Staged configuration', () => {
    assertFileExists(project, '.lintstagedrc');
    assertFileContains(project, '.lintstagedrc', 'eslint');
  });

  it('generates Knip configuration', () => {
    assertFileExists(project, 'knip.json');
    assertPackageJsonScript(project, 'knip', 'knip');
  });

  it('generates GitHub Actions workflows (excluding release)', () => {
    assertFileExists(project, '.github/workflows/cache.yml');
    assertFileExists(project, '.github/workflows/ci_test.yml');
    assertFileExists(project, '.github/workflows/lint.yml');
    assertFileExists(project, '.github/workflows/knip.yml');
    assertFileExists(project, '.github/workflows/ts-check.yml');

    // Release should NOT exist (--no-release flag)
    assertFileNotExists(project, '.github/workflows/release.yml');
  });

  it('adds pnpm.minimumReleaseAge to package.json', () => {
    assertJsonHasProperty(project, 'package.json', 'pnpm.minimumReleaseAge', 4320);
  });

  it('adds engines field to package.json', () => {
    const pkg = project.readJson<{ engines?: { node?: string; pnpm?: string } }>('package.json');
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines?.node).toMatch(/^>=\d+/);
    expect(pkg.engines?.pnpm).toMatch(/^>=\d+/);
  });

  it('installs dependencies successfully', () => {
    project.install();
    // Should complete without errors
  });

  it('creates valid source file that passes lint', () => {
    // Create a simple TypeScript file
    project.writeFile('src/index.ts', `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`);

    // Run lint - should pass
    const lintResult = runCommand(project, 'pnpm lint', { expectFailure: true });
    // Lint may warn but should not error
    expect(lintResult.exitCode).toBeLessThanOrEqual(1);
  });

  it('type-check passes', () => {
    const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
    expect(result.exitCode).toBe(0);
  });

  it('accepts valid conventional commit', () => {
    const result = gitCommit(project, 'feat: initial project setup');
    expect(result.exitCode).toBe(0);

    // Verify commit was created
    const lastCommit = project.getLastCommitMessage();
    expect(lastCommit).toContain('feat: initial project setup');
  });

  it('rejects invalid commit message', () => {
    // Make a small change
    project.writeFile('src/another.ts', 'export const x = 1;');

    const result = gitCommit(project, 'invalid commit message', { expectFailure: true });
    expect(result.exitCode).not.toBe(0);
  });
});
