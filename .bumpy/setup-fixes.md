---
"@gingacodemonkey/config": patch
---

Fixed several setup bugs: unknown `--tool` values are rejected, `--yes` never prompts, tsconfig includes `.ts`/`.tsx` files at any depth with `react-jsx` for DOM apps, a `minimumReleaseAge` block names the too-new package, the commit-msg hook puts the branch ticket in a `Refs:` footer, and the Claude PR review workflow is split into read-only and posting jobs.
