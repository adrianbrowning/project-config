The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the CLAUDE.MD file to help prevent future agents from having the same issue.

## Surprises found so far

- `.claude/CLAUDE.md` is out of date. It describes `src/setup.js` and `src/*-tasks.js`, but the source is TypeScript (`src/setup.ts`, `src/*-tasks.ts`). It also lists Semantic Release as a selectable tool, which commit `c292d28` removed (a copy is kept on branch `semantic-release-changelog`).
- `readme.md` still documents the `semanticReleaseNotes` tool and the `--no-release` flag. Neither exists in `src/cli-args.ts` or `src/setup.ts` any more.
- `.changeset/` holds this repo's own changesets. The CLI does not install changesets or any other release tool for consuming projects.
- In `src/eslint.ts`, the JSX A11y block spreads `jsxA11y.flatConfigs.recommended` and then sets its own `rules`, which replaces the recommended rules instead of extending them. Only the three override rules run, so `jsx-a11y/alt-text` and the rest of the recommended set are off.
