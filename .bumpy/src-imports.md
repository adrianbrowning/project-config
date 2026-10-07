---
"@gingacodemonkey/config": minor
---

Generate a `#src/*.ts` package import by default for TypeScript projects and every linked workspace package, mapped to source in bundler mode and to compiled output in tsc mode (with a `gingacodemonkey:source` condition for running tests unbuilt), keeping other aliases and the user's own `#src` mapping and reconciling it with `--update`.
