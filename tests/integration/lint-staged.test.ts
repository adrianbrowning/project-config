/**
 * Lint-Staged integration tests
 */

import { describe, it, expect } from 'vitest';
import { TestProject } from '../utils/test-project.ts';
import {
  assertFileExists,
  assertFileContains,
} from '../utils/file-assertions.ts';
import { TARBALL_PATH } from '../setup.ts';

describe('Lint-Staged Configuration', () => {
  it('generates .lintstagedrc', () => {
    using project = new TestProject({ name: 'lintstaged-config' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    assertFileExists(project, '.lintstagedrc');
  });

  it('config targets JS/TS/TSX files', () => {
    using project = new TestProject({ name: 'lintstaged-pattern' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    const config = project.readFile('.lintstagedrc');
    expect(config).toContain('*.{js,ts,tsx}');
  });

  it('uses style config for eslint', () => {
    using project = new TestProject({ name: 'lintstaged-eslint' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    assertFileContains(project, '.lintstagedrc', 'eslint');
    assertFileContains(project, '.lintstagedrc', 'eslint.config.style.ts');
  });

  it('includes --fix and --max-warnings=0 flags', () => {
    using project = new TestProject({ name: 'lintstaged-flags' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    const config = project.readFile('.lintstagedrc');
    expect(config).toContain('--fix');
    expect(config).toContain('--max-warnings=0');
  });

  it('includes --cache flag', () => {
    using project = new TestProject({ name: 'lintstaged-cache' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    assertFileContains(project, '.lintstagedrc', '--cache');
  });

  it('is valid JSON', () => {
    using project = new TestProject({ name: 'lintstaged-json' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=lintStaged', '--yes']);

    // Should not throw when parsing as JSON
    const config = project.readJson('.lintstagedrc');
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });
});
