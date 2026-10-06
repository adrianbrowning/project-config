# CLAUDE.md

`@gingacodemonkey/config` ships TypeScript presets and ESLint flat configs, plus a CLI (`gingacodemonkey-config`) that sets up and updates tooling in a project.

## Where things are

- **CLI entry:** `src/setup.ts` parses flags (`src/cli-args.ts`) and runs one Listr2 task module per tool (`src/*-tasks.ts`). `--update` goes to `src/update/` instead, and its registry of managed files and values is `src/update/registry.ts`.
- **Shipped configs:** ESLint in `src/eslint.ts` and `src/eslint.styled.ts`. TS presets in `tsc/tsc/` and `tsc/bundler/`, with the subpaths mapped in `package.json` `exports`.
- **Templates:** workflow files come from `github_actions_examples/` and are inlined by `build.ts`, which also replaces the `__*_version__` placeholders. A changed template needs its new hash in `src/update/known-versions.ts`, or `update.unit.test.ts` fails.
- **Build:** `pnpm build` runs `node build.ts` (esbuild) and packs the tarball. Only `pnpm start` (watch mode) still uses `rollup.config.ts`.
- **Tests:** `tests/` is a separate workspace package. Unit tests: `pnpm vitest run --config vitest.unit.config.ts` from `tests/`. Integration tests run the built tarball, so `pnpm build` first.
- **Checks:** `pnpm lint` runs type-check, ESLint, the style pass and Knip, the same checks CI runs before tests.
- **Dependency updates:** `.github/workflows/dependency-updates.yml` runs `scripts/update-dependencies.ts` weekly. Peer ranges follow the installed `dependencies`/`devDependencies` versions, and `build.ts` copies them into the CLI. Policy in `docs/dependency-updates.md`.

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at root). See `docs/agents/domain.md`.
