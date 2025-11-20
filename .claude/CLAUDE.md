# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@gingacodemonkey/config` is a configuration package that bundles TypeScript configs (based on Total TypeScript's TSConfig Cheat Sheet) and ESLint rules (based on @epic-web/config). It provides an interactive CLI setup tool that generates configuration files for projects and manages multiple dev tools.

## Build & Development Commands

```bash
# Development mode with live reload
pnpm start

# Build for distribution (bundles setup.js, creates tarball)
pnpm build

# Build & bump version patch, create tarball
pnpm build:bump

# Prepare Git hooks
pnpm prepare
```

## Architecture

### Entry Point & CLI Flow
- **`src/setup.js`** - Interactive CLI using Listr2 and Enquirer. Prompts user to select tools (TS, ESLint, Husky, CommitLint, Lint-Staged, Semantic Release, Knip), then runs corresponding task chains
- **Task modules** (`src/*-tasks.js`) - Each tool has a task module defining setup steps as Listr2 tasks
  - `ts-tasks.js` - TypeScript version check, tsconfig generation
  - `eslint-tasks.js` - ESLint config setup
  - `husky-tasks.js`, `convential-tasks.js`, `lintstaged-tasks.js`, etc.
- **`src/utils.js`** - Utilities for package manager detection, version comparison, config file writes, package.json manipulation

### Config Distribution
- **`tsc/` & `bundler/` directories** - Pre-configured TypeScript configs exported as npm subpaths. Structure:
  - `tsc/dom/` & `tsc/no-dom/` - TSC transpilation mode (app/library/library-monorepo variants)
  - `bundler/dom/` & `bundler/no-dom/` - External bundler mode (app/library/library-monorepo variants)
  - Base configs: `base.tsconfig.json`, `base.tsconfig.dom.json`, `base.tsconfig.no-dom.json`
- **`eslint.js` & `eslint.styled.js`** - ESLint flat configs exported as npm subpaths

### Build Process
- **`rollup.config.ts`** - Bundles setup.js into CommonJS for distribution. Uses version replacement from peerDependencies to inject tool versions into bundled output
- Build output: `dist/setup.js` (installed as `gingacodemonkey-config` bin command)
- Outputs tarball for distribution

## Key Dependencies & Patterns

- **Listr2** - Task runner with progress visualization
- **Enquirer** - Interactive CLI prompts
- **ESBuild + Rollup** - Bundle Node.js entry point
- **Zod** - Parse & validate package.json peerDependencies in build
- **TypeScript ESM** - Uses `import.meta` for ESM-native paths

## Notes

- Supported Node environment only (no DOM in setup.js itself, though configs support DOM)
- Task modules use `debugger` statements throughout (remove or conditionally execute in production)
- Version string `"__ts_version__"` is replaced during build via Rollup (currently empty, needs configuration)
- Package manager detection order: npm → yarn → pnpm → bun (or user prompt)
