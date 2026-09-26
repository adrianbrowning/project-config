---
"@gingacodemonkey/config": minor
---

The styled config now sorts imports, named imports and exports, union types, interfaces, object types and JSX props with `eslint-plugin-perfectionist` (natural, ascending, case-insensitive). `perfectionist/sort-imports` replaces `import/order` and keeps the same group order: builtin, external, internal (including `#…` subpath imports), parent, sibling, index.
