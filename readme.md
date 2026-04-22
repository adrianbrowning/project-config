# `@gingacodemonkey/config`

Opinionated config bundle for TypeScript + ESLint + git tooling. Bundles decisions from [Total TypeScript's TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet) and [@epic-web/config](https://github.com/epicweb-dev/config).

**Requires**: Node ≥ 24, pnpm ≥ 10

---

## Quickstart

```bash
pnpm add -D @gingacodemonkey/config
pnpm exec gingacodemonkey-config
```

The interactive CLI prompts you to select tools and generates all config files automatically.

For CI / non-interactive use:

```bash
pnpm exec gingacodemonkey-config --all --yes
```

---

## Tools

The CLI can set up any combination of:

| Tool | What it sets up |
|------|-----------------|
| `ts` | `tsconfig.json` with preset selection |
| `eslint` | `eslint.config.ts` |
| `husky` | Git hooks via Husky |
| `commitLint` | Conventional commit linting |
| `lintStaged` | `.lintstagedrc` — run ESLint on staged files |
| `semanticReleaseNotes` | `.releaserc.json` for automated releases |
| `knip` | Dead code & unused dependency detection |
| `jscpd` | Copy-paste detection |
| `githubActions` | CI/CD workflows (cache, test, lint, release, PR review) |

---

## CLI Reference

```
pnpm exec gingacodemonkey-config [options]

  --all, -a                   Select all tools
  --yes, -y                   Accept all defaults (non-interactive)
  --no-release                Exclude semanticReleaseNotes when using --all
  --tool=<name>               Select a specific tool (repeatable)

TypeScript options (used with --yes):
  --ts-mode=bundler|tsc       Default: bundler
  --ts-dom / --ts-no-dom      Default: dom
  --ts-type=app|library|library-monorepo  Default: app
  --ts-jsx=react|react-jsx|preserve|none  Default: none
  --ts-outdir=<dir>           Default: dist
  --ts-type-module            Add "type": "module" to package.json

  --help, -h                  Show help
```

### Examples

```bash
# All tools, accept defaults, no semantic release
pnpm exec gingacodemonkey-config --all --no-release --yes

# Specific tools only
pnpm exec gingacodemonkey-config --tool=ts --tool=eslint --yes

# Full TypeScript + React app
pnpm exec gingacodemonkey-config --all --yes --ts-mode=bundler --ts-dom --ts-type=app --ts-jsx=react-jsx
```

---

## TypeScript Config Reference

If you need to extend a tsconfig manually rather than using the CLI:

```jsonc
{
  "extends": "@gingacodemonkey/config/<mode>/<dom>/<type>"
}
```

**`<mode>`** — how TypeScript compiles your files:
- `tsc` — TypeScript transpiles `.ts` → `.js` directly
- `bundler` — an external bundler (Vite, Rollup, esbuild, etc.) handles transpilation

**`<dom>`**:
- `dom` — code runs in the browser
- `no-dom` — Node.js / server-only code

**`<type>`**:
- `app` — standalone application
- `library` — published package
- `library-monorepo` — published package inside a monorepo

### All available presets

```
@gingacodemonkey/config/tsc/dom/app
@gingacodemonkey/config/tsc/dom/library
@gingacodemonkey/config/tsc/dom/library-monorepo
@gingacodemonkey/config/tsc/no-dom/app
@gingacodemonkey/config/tsc/no-dom/library
@gingacodemonkey/config/tsc/no-dom/library-monorepo

@gingacodemonkey/config/bundler/dom/app
@gingacodemonkey/config/bundler/dom/library
@gingacodemonkey/config/bundler/dom/library-monorepo
@gingacodemonkey/config/bundler/no-dom/app
@gingacodemonkey/config/bundler/no-dom/library
@gingacodemonkey/config/bundler/no-dom/library-monorepo
```

### Overrides

```jsonc
// Add JSX support
{
  "extends": "@gingacodemonkey/config/bundler/dom/app",
  "compilerOptions": { "jsx": "react-jsx" }
}

// Custom output directory
{
  "extends": "@gingacodemonkey/config/tsc/no-dom/library",
  "compilerOptions": { "outDir": "dist" }
}
```

---

## ESLint

Two exports:

| Export | Use for |
|--------|---------|
| `@gingacodemonkey/config/eslint` | Logic & correctness — run in CI |
| `@gingacodemonkey/config/styled` | Formatting — run pre-commit via lint-staged |

### `eslint.config.ts`

```ts
import defaultConfig from "@gingacodemonkey/config/eslint";
export default [...defaultConfig];
```

### `eslint.config.style.ts`

```ts
import styledConfig from "@gingacodemonkey/config/styled";
export default [...styledConfig];
```

> Customizing: see [ESLint's shareable config docs](https://eslint.org/docs/latest/extend/shareable-configs#overriding-settings-from-shareable-configs).

---

## ESLint Plugins Included

Rules are auto-enabled based on what's installed in your project.

### Always enabled

| Plugin | Rules |
|--------|-------|
| `@eslint/js` | `recommended` |
| `eslint-plugin-sonarjs` | `recommended` — code quality & bug detection |
| `eslint-plugin-depend` | Detects redundant polyfills and bloated deps |
| `eslint-plugin-no-barrel-files` | Prevents barrel/index re-export anti-pattern |
| `eslint-plugin-promise` | Promise best practices (`always-return`, `catch-or-return`) |
| `eslint-plugin-unicorn` | `unicorn/prefer-node-protocol` |

### When `typescript` is installed

| Plugin | Key rules |
|--------|-----------|
| `typescript-eslint` | `no-explicit-any`, `no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition`, `await-thenable`, `promise-function-async`, `method-signature-style`, `array-type: generic` |

### When `react` is installed

| Plugin | Key rules |
|--------|-----------|
| `@eslint-react/eslint-plugin` | `no-nested-component-definitions`, `no-array-index-key`, `no-unstable-context-value`, DOM safety rules |
| `eslint-plugin-react` | `jsx-props-no-spreading`, `jsx-no-bind` |
| `eslint-plugin-react-hooks` | `rules-of-hooks`, `exhaustive-deps` + compiler silent failure detection |
| `eslint-plugin-react-compiler` | React Compiler compatibility |
| `eslint-plugin-react-refresh` | Fast Refresh compatibility |
| `eslint-plugin-react-you-might-not-need-an-effect` | Warns on avoidable `useEffect` patterns |
| `eslint-plugin-jsx-a11y` | Accessibility — `anchor-is-valid`, `click-events-have-key-events`, `no-static-element-interactions` |

### When `vitest` / `@testing-library` / `@testing-library/jest-dom` are installed

| Plugin | Applied to |
|--------|------------|
| `@vitest/eslint-plugin` | Test files |
| `eslint-plugin-testing-library` | Test files |
| `eslint-plugin-jest-dom` | Test files |

### `/styled` export — additional formatting rules

| Plugin | Rules |
|--------|-------|
| `@stylistic/eslint-plugin` | Indent (2), quotes (double), semi, trailing commas, brace style (stroustrup), max-len (400) |
| `eslint-plugin-unused-imports` | Removes unused imports on fix |
| `eslint-plugin-import-x` | Enforces import order (builtins → external → internal → relative) |
| `typescript-eslint` | `consistent-type-imports` (separate type imports) |