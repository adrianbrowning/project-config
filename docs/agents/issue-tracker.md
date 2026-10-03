# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- One issue per feature/bug. Reference issues by `#number`.
- Labels are applied via `gh issue edit <number> --add-label <label>` and `--remove-label <label>`.
- Close issues via `gh issue close <number>` with a `--comment` explaining why.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --comments`

## Wayfinding operations

| Intent | Command |
|--------|---------|
| List open issues | `gh issue list --state open` |
| List issues by label | `gh issue list --label <label>` |
| Search issues | `gh issue list --search "<query>"` |
| Read an issue | `gh issue view <number> --comments` |
| Create an issue | `gh issue create --title "..." --body "..." --label "..."` |
| Add a label | `gh issue edit <number> --add-label <label>` |
| Remove a label | `gh issue edit <number> --remove-label <label>` |
| Close an issue | `gh issue close <number> --comment "..."` |
| Comment on an issue | `gh issue comment <number> --body "..."` |
