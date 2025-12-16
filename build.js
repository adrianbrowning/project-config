import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';
import { execSync } from 'child_process';

// Read package.json to extract versions from peerDependencies
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
const peerDeps = packageJson.peerDependencies || {};

// Build version replacement map
const versionReplacements = {
  '__eslint_version__': peerDeps.eslint || '^9.8.0',
  '__commitlint_version__': peerDeps['@commitlint/cli'] || '20.0.0',
  '__husky_version__': peerDeps.husky || '9.0.6',
  '__knip_version__': peerDeps.knip || '5.70.1',
  '__lintstaged_version__': peerDeps['lint-staged'] || '15.2.10',
  '__semanticrelease_version__': peerDeps['semantic-release-unsquash'] || '0.4.0',
  '__ts_version__': '',
};

// Extract the imports object
const importMap = packageJson.imports || {};

// Configure esbuild to use path aliases based on the imports map
const aliasPlugins = Object.keys(importMap).map((alias) => {
    return {
        name: 'alias-plugin',
        setup(build) {
            build.onResolve({ filter: new RegExp(`^${alias}/`) }, (args) => {
                const aliasPath = importMap[alias];
                const resolvedPath = path.resolve(aliasPath, args.path.slice(alias.length));
                return { path: resolvedPath };
            });
        },
    };
});

// Build the main setup.cjs
// Use CommonJS format to avoid issues with enquirer's dynamic require() calls
// Use .cjs extension because package.json has "type": "module"
const setupBuild = esbuild.build({
    entryPoints: ['src/setup.ts'],
    bundle: true,
    outfile: 'dist/setup.cjs',
    platform: 'node',
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
    plugins: [...aliasPlugins],
});

// Build ESLint configs (.ts to .js) - bundle to inline local imports
const eslintBuild = esbuild.build({
    entryPoints: ['eslint.ts', 'eslint.styled.ts'],
    outdir: 'dist',
    platform: 'node',
    bundle: true,
    packages: 'external',
    format: 'esm',
    minifySyntax: false,  // Preserve exact syntax including operator precedence
    minifyWhitespace: false,
    minifyIdentifiers: false,
});

Promise.all([setupBuild, eslintBuild]).then(() => {
    // Replace version placeholders in the bundled output
    let setupContent = fs.readFileSync('dist/setup.cjs', 'utf8');
    for (const [placeholder, replacement] of Object.entries(versionReplacements)) {
        setupContent = setupContent.replace(
            new RegExp(placeholder, 'g'),
            replacement
        );
    }
    fs.writeFileSync('dist/setup.cjs', setupContent);

    // Generate type declaration files for ESLint configs
    fs.writeFileSync('dist/eslint.d.ts', `import type { Linter } from 'eslint';

export declare const nodeRules: Array<Linter.Config>;
export declare const config: Array<Linter.Config>;
export default config;
`);
    fs.writeFileSync('dist/eslint.styled.d.ts', `import type { Linter } from 'eslint';

export declare const config: Array<Linter.Config>;
export default config;
`);

    // Make the file executable
    execSync('chmod +x dist/setup.cjs');
    console.log('✓ Build complete');
}).catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
