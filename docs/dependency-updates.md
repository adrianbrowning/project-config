# Dependency updates

`.github/workflows/dependency-updates.yml` keeps this package's runtime, bundled and peer dependencies current. It runs every Monday at 06:00 UTC and on demand. When an update passes every check, it opens one pull request. If an earlier run's PR is still open, it updates that PR instead.

## What it updates

`scripts/update-dependencies.ts` reads `package.json`, and `scripts/dependency-policy.ts` decides the versions. It tracks:

- everything in `dependencies`: the packages the published ESLint configs import, plus the CLI's runtime packages that `build.ts` bundles into `dist/setup.cjs` (`listr2`, `enquirer`, …),
- everything in `peerDependencies`. `build.ts` copies these ranges into the CLI through the `__*_version__` placeholders, and they become the versions the CLI installs into consumer projects,
- the `devDependencies` that are also peers (`knip`, `lint-staged`, `@commitlint/*`, …), because those are the versions this repo builds and tests against.

Other dev tooling (`rollup`, `@types/*`, …) and `tests/package.json` aren't tracked. Dependabot's root config still opens version PRs for every direct dependency, including the tracked ones. Close a Dependabot PR that duplicates the automation PR.

## Update policy

- **Compatible only.** Each spec moves to the newest version its range already accepts. An exact pin is treated as a caret range. So `^1.2.3` and `1.2.3` stay on major 1, `^0.5.3` stays on 0.5, `0.0.x` never moves, and `~1.2.3` stays on 1.2. A major update is a manual decision.
- **The prefix is kept.** `^9.39.5` becomes `^9.40.0`, and the exact pin `6.26.0` becomes the exact pin `6.39.0`.
- **Stable releases only.** Prerelease versions are never picked, and prerelease specs (`19.1.0-rc.2`) and non-version specs are left alone.
- **Release age.** A version must be older than `minimumReleaseAge` in `pnpm-workspace.yaml`, which is the same rule pnpm applies, so `pnpm install` can always resolve what the script picks.
- **Peers follow the installed version.** A peer that is also in `dependencies` or `devDependencies` takes that version, with the peer's own prefix (dev `^9.1.7` gives peer `9.1.7`). This applies only when the installed version is inside the peer's compatible range. Moving a peer to a new major breaks consumers, so a peer that would need one is upgraded on its own and listed in the PR as drift for a human to resolve. A peer with no installed counterpart (`@varlock/bumpy`) is upgraded on its own.
- **Catalogs are the source of truth.** A tracked dependency declared as `catalog:` or `catalog:<name>` is planned on the range its catalog in `pnpm-workspace.yaml` holds, and the new range is written to that catalog entry (`catalog:` or `catalogs.<name>:`), not to `package.json`. Every manifest that refers to the entry, `tests/package.json` included, moves with it, and the manifest keeps its `catalog:` reference. When a dependency and its peer share one entry, the entry gets the installed version. The PR summary lists such changes with `catalog` (or `catalog:<name>`) as the section.

Each update PR also adds a patch bump file (`.bumpy/dependency-updates-<run id>.md`) that lists the changes, because changes to peer and runtime ranges ship to consumers.

## What runs before a PR

The `update` job applies the new versions, regenerates `pnpm-lock.yaml` with `pnpm install --no-frozen-lockfile`, and saves the diff of `package.json`, `pnpm-workspace.yaml` (catalog entries), `pnpm-lock.yaml` and the bump file. It then runs `pnpm build` (which also packs the tarball), `pnpm lint`, the unit tests and the native integration tests against that tarball. `dist/` is ignored by git, so the lockfile is the only generated file in the PR.

The `pull-request` job runs only if all of those pass. A failed check fails the run, and no PR is opened or updated. A run with no updates stops after the version check and succeeds without a PR. An open automation PR stays as it is in that case.

## Avoiding duplicate PRs

Every run rebuilds the `automation/dependency-updates` branch from `main`, applies its own diff and force-pushes. If an open PR from that branch exists, the run replaces its body. Otherwise the run opens one. The `dependency-updates` concurrency group stops two runs from pushing at once.

## Credentials and permissions

The workflow's default permissions are empty. The `update` job installs and runs third-party code, so it gets only `contents: read`. The `pull-request` job, which runs no dependency code, gets `contents: write` (to push the branch) and `pull-requests: write` (to open or edit the PR).

The workflow works with the default `GITHUB_TOKEN`. However, GitHub doesn't trigger workflows for pushes made with `GITHUB_TOKEN`, so the PR's own CI won't start until someone pushes to the branch or closes and reopens the PR. To have CI start automatically, add a repository secret named `DEPENDENCY_UPDATE_TOKEN` holding a fine-grained PAT or GitHub App token scoped to this repo, with **Contents: read and write** and **Pull requests: read and write**. The workflow uses that secret whenever it exists.

## Running it manually

- **GitHub UI:** Actions → *Dependency updates* → *Run workflow*.
- **CLI:** `gh workflow run dependency-updates.yml`, then follow the run with `gh run watch`.
- **Locally:** `node scripts/update-dependencies.ts` rewrites `package.json` and prints the updates. Then run `pnpm install --no-frozen-lockfile`. `--summary <file>` and `--bump-file <file>` write the PR summary and bump file.

Every run, including a manual run started from another branch, checks out `main`, so the PR always holds `main` plus the updates.
