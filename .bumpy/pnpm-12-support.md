---
"@gingacodemonkey/config": minor
---

Added pnpm 12 support: setup approves `unrs-resolver`'s build before installing, explains pnpm 12's `minimumReleaseAge` refusals, and the GitHub Actions setup template uses `pnpm/action-setup@v6`. Generated projects now require pnpm 10.26 or later, the first release that reads `allowBuilds`.
