import fs from 'fs';
import path from 'path';
import esbuild from 'esbuild';
import { execSync } from 'child_process';

// Read package.json to extract versions from peerDependencies
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8'));
const peerDeps = packageJson.peerDependencies || {};

// Build version replacement map (replacements need to match what's in the source strings)
const versionReplacements = {
  '__eslint_version__': peerDeps.eslint || '^9.8.0',
  '__commitlint_version__': peerDeps['@commitlint/cli'] || '20.0.0',
  '__husky_version__': peerDeps.husky || '9.0.6',
  '__knip_version__': peerDeps.knip || '5.70.1',
  '__lintstaged_version__': peerDeps['lint-staged'] || '15.2.10',
  '__semanticrelease_version__': peerDeps['@gingacodemonkey/semantic-release-unsquash'] || '0.2.7',
  '__ts_version__': '',
};

// Create a plugin for text replacements
const textReplacementPlugin = {
  name: 'text-replacement',
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, (args) => {
      let contents = fs.readFileSync(args.path, 'utf8');

      // Replace all version placeholders
      for (const [placeholder, replacement] of Object.entries(versionReplacements)) {
        // Replace as bare identifiers in string assignments
        contents = contents.replace(
          new RegExp(`\\b${placeholder}\\b`, 'g'),
          replacement
        );
      }

      return { contents, loader: 'js' };
    });
  }
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

// Build using esbuild with plugins
esbuild.build({
    entryPoints: ['src/setup.js'],
    bundle: true,
    outfile: 'dist/setup.js',
    platform: 'node',
    packages: 'external',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    plugins: [textReplacementPlugin, ...aliasPlugins],
}).then(() => {
    // Make the file executable
    execSync('chmod +x dist/setup.js');
    console.log('✓ Build complete');
}).catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
