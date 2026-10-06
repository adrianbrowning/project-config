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
| `githubActions` | CI workflows (test, lint, knip, ts-check, Claude PR review). In a pnpm workspace, one root `ci.yml` replaces test, lint and ts-check |
| `bumpy` | Versioning and releases via [Bumpy](https://github.com/dmno-dev/bumpy) (see [Releases](#releases-bumpy)) |
| `workspace` | A pnpm workspace with TS and ESLint configs shared from `sharedConfig/` (see [pnpm workspaces](#pnpm-workspaces)). Not part of `--all`. |

---

## CLI Reference

```
pnpm exec gingacodemonkey-config [options]

  --all, -a                   Select all tools (except workspace)
  --yes, -y                   Accept all defaults (non-interactive; setup needs --all or --tool)
  --no-release                Exclude bumpy when using --all
  --release-npm               Also publish to npm (default: GitHub releases only)
  --tool=<name>               Select a specific tool (repeatable; an unknown name is an error)
  --update, -u                Reconcile existing configs with this release's defaults (see below)
  --overwrite                 With --update: replace values you changed in files the CLI owns

TypeScript options (used with --yes):
  --ts-mode=bundler|tsc       Default: bundler
  --ts-dom / --ts-no-dom      Default: dom
  --ts-type=app|library|library-monorepo  Default: app
  --ts-jsx=react|react-jsx|preserve|none  Default: react-jsx for a DOM app, otherwise none
  --ts-outdir=<dir>           Default: dist
  --ts-type-module            Add "type": "module" to package.json

GitHub Actions options (used with --yes):
  --claude-runner=anthropic|bedrock  Claude PR review auth. Default: anthropic

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
package.json                  lint / lint:ts / lint:fix / test / build run across packages; check runs them all
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

**New workspace.** Without a `packages:` list in `pnpm-workspace.yaml` (or with no `package.json` at all), setup creates the workspace with the globs from `--workspace-packages` (default `packages/*`) and adds a sample package (`packages/example`) with a source file and a `node --test` test. `pnpm check` passes straight away.

**Root scripts.** These are the commands to run from the workspace root, locally and in CI. With `githubActions` selected (or run later in an existing workspace), setup writes `.github/workflows/ci.yml`, which installs once with the frozen lockfile and runs `pnpm lint`, `pnpm lint:ts`, `pnpm test` and `pnpm build` on pull requests and pushes to `main`. It's read-only, and a newer push cancels the run it supersedes. `--update` keeps `ci.yml` current like the other workflows, and in a workspace doesn't look for the single-package `ci_test.yml`, `lint.yml` or `ts-check.yml`.

| Script | Runs |
|---|---|
| `lint`, `lint:fix`, `lint:ts`, `test`, `build` | `pnpm -r --if-present <script>`: every package that has the script, once each; packages without it are skipped |
| `check` | `pnpm lint && pnpm lint:ts && pnpm test && pnpm build` |

A failure in any package fails the root command. `pnpm -r` never includes the workspace root, so these can't call themselves. If the root already has one of these scripts with your own command, setup keeps it and says so; an earlier generated value (`pnpm -r lint`) is replaced.

**Existing workspace.** Setup writes the shared configs and root scripts, keeps your globs and pnpm settings, then offers to link every discovered package. In interactive mode it asks once. With `--tool=workspace` it only links them when you pass `--workspace-update-all`; otherwise it reports them as skipped. For each linked package:

- Missing `lint`, `lint:fix` and `lint:ts` scripts are added. A script with your own command is kept and reported; other scripts stay.
- `tsconfig.json` gets the shared base as its first `extends`, so the package's own `extends` and `compilerOptions` still win.
- `eslint.config.ts` and `eslint.config.style.ts` are overwritten with re-exports of the shared configs. Put package-specific rules in `sharedConfig/eslint.config.ts` or restore your own file from git.

Setup prints each package as `updated`, `unchanged`, `skipped` or `could not be migrated`. A package is left untouched and reported when its `package.json` or `tsconfig.json` isn't plain JSON (for example, a `tsconfig.json` with comments). Rerunning setup changes nothing.

**Internal dependencies (`workspace:` protocol).** A linked package's dependencies on other packages of the workspace use pnpm's [workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace), so install always links the local package and fails, rather than downloading a registry copy, when it's missing. Setup and `--update` apply this to `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies`, and never move an entry to another section:

- A plain version range the local package's version satisfies (`^1.0.0`, `~1.2.0`, `*`) becomes `workspace:^`. An `npm:` alias of a workspace package becomes `workspace:<name>@^`.
- An existing `workspace:` spec of any form (`workspace:*`, `workspace:~`, `workspace:^1.2.0`) is kept.
- Anything else is reported and left as is: a range the local version doesn't satisfy (rewriting it would change which version you asked for, so fix the range or the local version), a dist-tag such as `latest`, a `file:`, `link:` or git spec, or a local package without a valid `version`.
- Only exact names count, so a registry package `@acme/lib-extra` is never mistaken for the workspace's `@acme/lib`.

`pnpm pack` and `pnpm publish` turn `workspace:^` into a caret range on the local version, for example `"@acme/lib": "^1.2.0"`, so published packages carry ordinary semver ranges.

**Undeclared imports.** Setup and `--update` also scan each linked package's source files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; not `node_modules/`, `dist/`, dot-directories or nested packages) for `import`, `export … from`, `import()` and `require()` of another workspace package, including subpaths such as `@acme/lib/utils`. Each one the package declares in no dependency section is reported as `<importer> imports <imported> but doesn't declare it`. Nothing is added for you, since whether it's a dependency, dev dependency or peer is your call: add it with `workspace:^`.

**Library packages.** A linked package is a library when the shared base extends a `library` or `library-monorepo` preset (`--ts-type`), its `package.json` isn't `"private": true` and it has `src/index.ts`. Everything else is an application and never gets publishing fields, so mark apps `"private": true`. Libraries need `--ts-mode=tsc`: bundler mode type-checks with `noEmit` and leaves building to a bundler the CLI doesn't choose, so setup fails and names the library packages instead of writing exports that point at nothing (`--update` reports them as `skipped`). For each library, setup and `--update` manage:

| Where | Value |
|---|---|
| `tsconfig.json` | `outDir` (`--ts-outdir`, default `dist`), `rootDir: "src"`, `tsBuildInfoFile: "<outDir>/.tsbuildinfo"`; values already set are the package's own and are used as is |
| `package.json` | `"type": "module"`, `exports["."]` (`types` → `dist/index.d.ts`, `default` → `dist/index.js`), `main` and `types` (the same files, for resolvers that ignore `exports`), `files` (`dist` without compiled tests or the build state), `scripts.build: "tsc"` |

Nothing points at `src/`, so `pnpm pack` ships compiled JavaScript and declarations only. Further entry points are opt-in, as source paths that are exported as their compiled output (`*` patterns work):

```json
"gingacodemonkey": { "subpathExports": { "./utils": "./src/utils.ts", "./icons/*": "./src/icons/*.ts" } }
```

Subpaths you add to `exports` yourself, a custom root export (a string or conditions object), `imports` (such as `#src/*`) and extra `files` entries are kept; one of your exports that resolves to TypeScript source is reported. A value of yours that differs from a managed one (say your own `main` or `build`) is kept and reported by setup, and is a `conflict` for `--update`. With a custom root export, `main` and `types` are left to you.

---

## Updating an existing project

`--update` brings a project set up by an older release up to the current defaults. It doesn't run setup and doesn't install packages; it only compares and rewrites the files and keys the CLI manages.

```bash
pnpm exec gingacodemonkey-config --update                # pick from the tools it detects
pnpm exec gingacodemonkey-config --update --yes          # every detected tool
pnpm exec gingacodemonkey-config --update --tool=husky --yes
```

**Rerunning setup to add a tool** installs packages again, and the `minimumReleaseAge: 4320` setting written by the first run applies. If the lockfile holds a dependency published less than three days ago (often a peer installed with this package), pnpm refuses the install. Setup then fails and names the package. When pnpm can look up the publish time and your `minimumReleaseAge`, it also says when the package becomes installable. Wait until then, or use `--update` for config-only changes, since it installs nothing.

A tool counts as set up when its main file exists (`tsconfig.json`, `eslint.config.ts`, `.husky/`, `commitlint.config.js`, `.lintstagedrc`, `knip.json`, `.jscpd.json`, `.github/workflows/`, `.bumpy/`, `sharedConfig/`). Without `--tool`, the pnpm settings in `pnpm-workspace.yaml` and `engines` in `package.json` are updated too; an explicit `--tool` updates only those tools.

Each managed value ends up as one of:

| Result | When | What happens |
|---|---|---|
| `unchanged` | Already the current default (ignoring trailing newlines) | Nothing |
| `updated` | Matches a default an earlier release wrote, or sits in the old ignored `pnpm:` block. Also an internal dependency with a plain range the local version satisfies | Replaced with the current default (`workspace:^` for an internal dependency) |
| `added` | Missing | Written |
| `customized` | A starter file you're expected to edit has your changes: `eslint.config.ts`, `sharedConfig/eslint.config.ts`, `commitlint.config.js`, `.lintstagedrc`, `knip.json`, `.jscpd.json`, `.bumpy/_config.json`. Also a workspace package `tsconfig.json` that no longer extends the shared base, a `sharedConfig/tsconfig.base.json` that doesn't extend a preset, an internal dependency the [`workspace:` policy](#pnpm-workspaces) leaves as is, or an undeclared internal import | Kept as is, even with `--overwrite` |
| `conflict` | You changed a file or value the CLI owns: hooks, workflows, the setup action, `eslint.config.style.ts`, package ESLint re-exports, generated scripts, pnpm settings | See below |
| `skipped` | An optional file is missing, such as a workflow you deleted | Left missing |

Files are replaced only when they match, byte for byte apart from trailing whitespace, a version this CLI wrote (hashes in `src/update/known-versions.ts`). JSON files are compared by value. Scripts and `engines` are compared entry by entry, and `allowBuilds` entries you added are kept.

**Conflicts.** In interactive mode, update asks about each conflict and keeps your value unless you say yes. With `--yes` or `--tool`, a conflict stops the run with a report and nothing is written; rerun with `--overwrite` to replace those values. Running update twice in a row changes nothing the second time.

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

### Explicit `.ts` imports

Every preset accepts relative imports that end in `.ts`, `.tsx`, `.mts` or `.cts`:

```ts
import { value } from "./value.ts";
```

The base config sets `rewriteRelativeImportExtensions`, so `tsc` presets emit `./value.js` in the JavaScript output and Node runs it as-is. Bundler presets don't emit, and the bundler resolves the `.ts` file itself.

Declaration files keep the `.ts` specifier (`export { value } from "./value.ts"` in `dist/index.d.ts`). That's fine: TypeScript resolves `./value.ts` in a `.d.ts` to the `./value.d.ts` next to it, so consumers get the real types.

Limitations:
- Needs TypeScript 5.7 or later.
- Only relative specifiers are rewritten. A `.ts` path that reaches `tsc` through an alias (`paths`, or a `package.json#imports` entry that points at `.ts` files) stays as `.ts` in the output.

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
