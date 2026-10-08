# Changelog

## 0.1.0
<sub>2026-10-07</sub>

- [#73](https://github.com/adrianbrowning/project-config/pull/73)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Generate publish-safe `exports`, `main`, `types`, `files` and a `tsc` build for workspace library packages, keeping custom exports and reporting conflicts in setup and `--update`.
- [#72](https://github.com/adrianbrowning/project-config/pull/72)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Enforced pnpm's `workspace:` protocol for dependencies between workspace packages during setup and `--update`, and reported internal imports a package doesn't declare.
- [#75](https://github.com/adrianbrowning/project-config/pull/75)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Enforce public package boundaries in pnpm workspaces with the `gingacodemonkey/workspace-boundaries` ESLint rule, so a package reaches another only through that package's `exports`.
- [#74](https://github.com/adrianbrowning/project-config/pull/74)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Generate TypeScript project references for pnpm workspaces, so `tsc --build` builds each package after the workspace packages it depends on, and keep them in sync with `--update`.
- [#76](https://github.com/adrianbrowning/project-config/pull/76)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Added pnpm catalogs to workspace setup: a new workspace keeps its shared toolchain versions in the default catalog, `--workspace-catalog` (or the interactive offer) moves external versions repeated across manifests into it, `--update` reconciles catalog references, and the dependency updater edits catalog entries instead of manifests.
- [#78](https://github.com/adrianbrowning/project-config/pull/78)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Generate a `#src/*.ts` package import by default for TypeScript projects and every linked workspace package, mapped to source in bundler mode and to compiled output in tsc mode (with a `gingacodemonkey:source` condition for running tests unbuilt), keeping other aliases and the user's own `#src` mapping and reconciling it with `--update`.
- [#81](https://github.com/adrianbrowning/project-config/pull/81)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)! - `--update` now reconciles existing configs with the current defaults instead of only adding missing files.
- [#81](https://github.com/adrianbrowning/project-config/pull/81)  *(minor)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Added a `workspace` tool that shares TypeScript and ESLint configs across pnpm packages, with workspace-wide root scripts (lint, type-check, test, build, check) and a root CI workflow that `--update` keeps in sync.
- [#68](https://github.com/adrianbrowning/project-config/pull/68)  *(patch)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Documented explicit `.ts` import support in every TypeScript preset and added tests that cover type-checking, emitted `.js` specifiers and declaration resolution.
- [#81](https://github.com/adrianbrowning/project-config/pull/81)  *(patch)* Thanks [@adrianbrowning](https://github.com/adrianbrowning)!
  Fixed several setup bugs: unknown `--tool` values are rejected, `--yes` never prompts, tsconfig includes `.ts`/`.tsx` files at any depth with `react-jsx` for DOM apps, a `minimumReleaseAge` block names the too-new package, the commit-msg hook puts the branch ticket in a `Refs:` footer, and the Claude PR review workflow is split into read-only and posting jobs.
