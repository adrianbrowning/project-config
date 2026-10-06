# Coding standards

Read during review. Each rule is a judgement call that no lint rule can check; mechanical rules belong in `eslint.config.ts` or `pnpm lint`.

## Integration tests

- **Seed, don't set up.** Create the files a test needs directly (`project.writeFile`, copies from `github_actions_examples/`), and run the CLI only for the behaviour under test. Setting up unrelated tools pulls in their side effects; GitHub Actions setup, for example, installs the review skill over the network (#59).
- **Deterministic.** A test's outcome depends only on what it writes. Registry state, publish dates and "whatever the lockfile resolves this week" stay out; when the behaviour depends on them, force the outcome with config (see `cli-failure.test.ts`, which sets `minimumReleaseAge: 99999999`).
- **Red without the fix.** A new test must fail when the change it covers is reverted. The PR states how that was checked (a reverted line, a mutated config).
- **Cleanup survives failure.** Files a test creates mid-test for a probe are removed in `finally`, so a failed assertion can't leak into the next check.

## Steering files

- A `CLAUDE.md` surprise that cites the issue a PR closes is removed in that PR.
