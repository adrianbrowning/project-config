---
"@gingacodemonkey/config": minor
---

Added pnpm catalogs to workspace setup: a new workspace keeps its shared toolchain versions in the default catalog, `--workspace-catalog` (or the interactive offer) moves external versions repeated across manifests into it, `--update` reconciles catalog references, and the dependency updater edits catalog entries instead of manifests.
