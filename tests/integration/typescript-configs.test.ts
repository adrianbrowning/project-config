/**
 * TypeScript configuration integration tests
 * Tests each TS config type: bundler/tsc × dom/no-dom × app/library
 */

import { describe, it, expect } from 'vitest';
import { TestProject } from '../utils/test-project.ts';
import {
  assertFileExists,
  assertFileContains,
  assertPackageJsonScript,
} from '../utils/file-assertions.ts';
import { runCommand } from '../utils/command-runner.ts';
import { TARBALL_PATH } from '../setup.ts';
import fs from 'fs';
import path from 'path';

// Helper to get fixture content
function getFixtureContent(fixturePath: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', fixturePath),
    'utf-8'
  );
}

describe('TypeScript Configurations', () => {
  it('adds lint:ts script to package.json', () => {
    using project = new TestProject({ name: 'ts-lint-ts-script' });
    project.init();

    project.installTarball(TARBALL_PATH);
    project.runCli(['--tool=ts', '--yes', '--ts-no-dom', '--ts-type=library']);

    const pkg = project.readJson<{ scripts?: { 'lint:ts'?: string } }>('package.json');
    expect(pkg.scripts?.['lint:ts']).toBe('tsc --noEmit');
  });

  describe('bundler/dom/app (Vite/React web app)', () => {
    it('generates correct tsconfig and passes type-check', () => {
      using project = new TestProject({ name: 'ts-bundler-dom-app' });
      project.init();

      // Install and run CLI
      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=bundler',
        '--ts-dom',
        '--ts-type=app',
        '--ts-jsx=react-jsx',
      ]);

      // Verify tsconfig
      assertFileExists(project, 'tsconfig.json');
      const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/bundler/dom/app');

      // Verify reset.d.ts created for app type
      assertFileExists(project, 'src/reset.d.ts');
      assertFileContains(project, 'src/reset.d.ts', '@total-typescript/ts-reset');
      assertFileContains(project, 'src/reset.d.ts', 'ts-reset/dom');

      // Add React fixture
      project.writeFile('src/App.tsx', getFixtureContent('react-app/App.tsx'));

      // Install dependencies (need React types)
      project.exec('pnpm add -D @types/react @types/react-dom');
      project.install();

      // Type-check should pass
      assertPackageJsonScript(project, 'type-check');
      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('bundler/dom/library (DOM library)', () => {
    it('generates correct tsconfig without reset.d.ts', () => {
      using project = new TestProject({ name: 'ts-bundler-dom-library' });
      project.init();

      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=bundler',
        '--ts-dom',
        '--ts-type=library',
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/bundler/dom/library');

      // Library type should NOT have reset.d.ts
      expect(project.fileExists('src/reset.d.ts')).toBe(false);

      // Add DOM library code
      project.writeFile('src/index.ts', `
export function getElementById(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function addClass(el: HTMLElement, className: string): void {
  el.classList.add(className);
}
`);

      project.install();

      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('tsc/no-dom/app (Node.js app)', () => {
    it('generates correct tsconfig for Node.js app', () => {
      using project = new TestProject({ name: 'ts-tsc-nodom-app' });
      project.init();

      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string }>('package.json');
      project.writeJson('package.json', { ...pkg, type: 'module' });

      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=tsc',
        '--ts-no-dom',
        '--ts-type=app',
        '--ts-outdir=dist',
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string; compilerOptions: { outDir: string } }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/tsc/no-dom/app');
      expect(tsconfig.compilerOptions.outDir).toBe('dist');

      // Verify reset.d.ts exists (app type) but without DOM
      assertFileExists(project, 'src/reset.d.ts');
      assertFileContains(project, 'src/reset.d.ts', '@total-typescript/ts-reset');
      // Should NOT contain DOM reset
      const resetContent = project.readFile('src/reset.d.ts');
      expect(resetContent).not.toContain('ts-reset/dom');

      // Add Node.js fixture
      project.writeFile('src/index.ts', getFixtureContent('node-library/index.ts'));
      project.install();

      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('tsc/no-dom/library (Node.js library)', () => {
    it('generates correct tsconfig for Node.js library', () => {
      using project = new TestProject({ name: 'ts-tsc-nodom-library' });
      project.init();

      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string }>('package.json');
      project.writeJson('package.json', { ...pkg, type: 'module' });

      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=tsc',
        '--ts-no-dom',
        '--ts-type=library',
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/tsc/no-dom/library');

      // Library type should NOT have reset.d.ts
      expect(project.fileExists('src/reset.d.ts')).toBe(false);

      // Add library code
      project.writeFile('src/index.ts', getFixtureContent('node-library/index.ts'));
      project.install();

      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('bundler/no-dom/app (Bundled Node.js app)', () => {
    it('generates correct tsconfig for bundled Node app', () => {
      using project = new TestProject({ name: 'ts-bundler-nodom-app' });
      project.init();

      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=bundler',
        '--ts-no-dom',
        '--ts-type=app',
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/bundler/no-dom/app');

      // App type should have reset.d.ts
      assertFileExists(project, 'src/reset.d.ts');

      // Add Node.js code
      project.writeFile('src/index.ts', getFixtureContent('node-library/index.ts'));
      project.install();

      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('tsc/no-dom/library-monorepo', () => {
    it('generates correct tsconfig for monorepo library', () => {
      using project = new TestProject({ name: 'ts-tsc-nodom-monorepo' });
      project.init();

      // tsc mode with NodeNext requires ESM - set type: module
      const pkg = project.readJson<{ type?: string }>('package.json');
      project.writeJson('package.json', { ...pkg, type: 'module' });

      project.installTarball(TARBALL_PATH);
      project.runCli([
        '--tool=ts',
        '--yes',
        '--ts-mode=tsc',
        '--ts-no-dom',
        '--ts-type=library-monorepo',
      ]);

      // Verify tsconfig
      const tsconfig = project.readJson<{ extends: string }>('tsconfig.json');
      expect(tsconfig.extends).toBe('@gingacodemonkey/config/tsc/no-dom/library-monorepo');

      // Library type should NOT have reset.d.ts
      expect(project.fileExists('src/reset.d.ts')).toBe(false);

      project.writeFile('src/index.ts', getFixtureContent('node-library/index.ts'));
      project.install();

      const result = runCommand(project, 'pnpm type-check', { expectFailure: true });
      expect(result.exitCode).toBe(0);
    });
  });
});
