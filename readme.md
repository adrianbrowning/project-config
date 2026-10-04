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
| `knip` | Dead code & unused dependency detection |
| `jscpd` | Copy-paste detection |
| `githubActions` | CI workflows (test, lint, knip, ts-check, Claude PR review) |
| `bumpy` | Versioning and releases via [Bumpy](https://github.com/dmno-dev/bumpy) (see [Releases](#releases-bumpy)) |
| `workspace` | A pnpm workspace with TS and ESLint configs shared from `sharedConfig/` (see [pnpm workspaces](#pnpm-workspaces)). Not part of `--all`. |

---

## CLI Reference

```
pnpm exec gingacodemonkey-config [options]

  --all, -a                   Select all tools (except workspace)
  --yes, -y                   Accept all defaults (non-interactive)
  --no-release                Exclude bumpy when using --all
  --release-npm               Also publish to npm (default: GitHub releases only)
  --tool=<name>               Select a specific tool (repeatable)

TypeScript options (used with --yes):
  --ts-mode=bundler|tsc       Default: bundler
  --ts-dom / --ts-no-dom      Default: dom
  --ts-type=app|library|library-monorepo  Default: app
  --ts-jsx=react|react-jsx|preserve|none  Default: none
  --ts-outdir=<dir>           Default: dist
  --ts-type-module            Add "type": "module" to package.json

Workspace options (with --tool=workspace):
  --workspace-packages=<glob> Package glob for a new workspace (repeatable, default: packages/*)
  --workspace-update-all      Existing workspace: link every package without asking

  --help, -h                  Show help
```

### Examples

```bash
# All tools, accept defaults, no release tooling
pnpm exec gingacodemonkey-config --all --no-release --yes

# Specific tools only
pnpm exec gingacodemonkey-config --tool=ts --tool=eslint --yes

# Full TypeScript + React app
pnpm exec gingacodemonkey-config --all --yes --ts-mode=bundler --ts-dom --ts-type=app --ts-jsx=react-jsx

# Releases to GitHub and npm
pnpm exec gingacodemonkey-config --tool=bumpy --release-npm --yes

# New pnpm workspace, or link every package in an existing one
pnpm exec gingacodemonkey-config --tool=workspace --yes --workspace-update-all
```

---

## pnpm workspaces

`--tool=workspace` puts the TypeScript and ESLint rules in one place, `sharedConfig/` at the workspace root, and links every package to it. It replaces the single-package `ts` and `eslint` setup, so selecting those tools alongside it does nothing extra.

```
package.json                  lint / lint:ts / lint:fix run `pnpm -r …` across packages
pnpm-workspace.yaml           packages globs + pnpm settings
sharedConfig/
  tsconfig.base.json          extends the preset chosen with the --ts-* flags
  eslint.config.ts            the shared rules; add your own to extraRules
  eslint.config.style.ts
packages/<name>/
  tsconfig.json               extends ../../sharedConfig/tsconfig.base.json
  eslint.config.ts            re-exports ../../sharedConfig/eslint.config.ts
  eslint.config.style.ts
```

Run it from the workspace root. TypeScript, ESLint and `@gingacodemonkey/config` are installed there, not in each package. Paths are relative, so packages at any depth (`apps/web/site`) resolve the shared configs.

**New workspace.** Without a `packages:` list in `pnpm-workspace.yaml` (or with no `package.json` at all), setup creates the workspace with the globs from `--workspace-packages` (default `packages/*`) and adds a sample package (`packages/example`) with a source file. `pnpm lint` and `pnpm lint:ts` pass straight away.

**Existing workspace.** Setup writes the shared configs and root scripts, keeps your globs and pnpm settings, then offers to link every discovered package. In interactive mode it asks once. With `--tool=workspace` it only links them when you pass `--workspace-update-all`; otherwise it reports them as skipped. For each linked package:

- `lint`, `lint:fix` and `lint:ts` scripts are added or replaced; other scripts stay.
- `tsconfig.json` gets the shared base as its first `extends`, so the package's own `extends` and `compilerOptions` still win.
- `eslint.config.ts` and `eslint.config.style.ts` are overwritten with re-exports of the shared configs. Put package-specific rules in `sharedConfig/eslint.config.ts` or restore your own file from git.

Setup prints each package as `updated`, `unchanged`, `skipped` or `could not be migrated`. A package is left untouched and reported when its `package.json` or `tsconfig.json` isn't plain JSON (for example, a `tsconfig.json` with comments). Rerunning setup changes nothing.

---

## Releases (Bumpy)

The `bumpy` tool installs `@varlock/bumpy`, adds `bump` (`bumpy add`) and `bump:status` (`bumpy status`) scripts, and writes `.bumpy/_config.json` plus three workflows: `bumpy-check.yml`, `bumpy-comment.yml` and `release.yml`. It also writes `.github/actions/setup/action.yml` if it doesn't exist yet.

The flow: each PR adds a bump file (`pnpm bump`, or label the PR `no-bump`). Merging to `main` opens or updates a `bumpy/version-packages` PR. Merging that PR tags the release and creates a GitHub release.

**GitHub releases (default).** Nothing is published to npm. The release packs the package with `pnpm pack` and attaches the tarball to the GitHub release.

**npm (opt-in).** Answer yes to the npm prompt, or pass `--release-npm`. The release also publishes to npm with provenance. Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) for `release.yml`. If your package needs a build before publishing, run it from a `prepack` script.

**RC releases (npm only).** Add the `release-rc` label to the version PR to publish a snapshot of `main`'s pending release to the `@next` dist-tag, e.g. `1.4.0-rc-a1b2c3d`. Bumpy comments the install command on the PR. Snapshots create no git tags, GitHub releases or commits. To publish another rc, remove the label and add it again.

**`BUMPY_GH_TOKEN` (recommended).** Without it, CI does not run on the version PR. Run `pnpm exec bumpy ci setup` for guidance.

---

## Claude PR Review Skill

The Claude PR review skill (`cc-pr-review-ci`) is installed from [adrianbrowning/agent-skills](https://github.com/adrianbrowning/agent-skills). It's automatically installed when you select the GitHub Actions PR review option during setup.

To manually install or update to the latest version:

```bash
pnpm dlx skills add adrianbrowning/agent-skills --skill cc-pr-review-ci -a claude-code --copy -y
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
| `eslint-plugin-jsx-a11y` | Accessibility — the full recommended set, with `anchor-is-valid`, `click-events-have-key-events`, `no-static-element-interactions` as errors |

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
| `eslint-plugin-perfectionist` | Natural, case-insensitive sorting of imports (builtin → external → internal/`#…` → parent → sibling → index), named imports/exports, union types, interfaces, object types and JSX props |
| `typescript-eslint` | `consistent-type-imports` (separate type imports) |
