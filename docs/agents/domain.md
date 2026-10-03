# Domain Docs

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-*.md
│   └── ...
└── src/
```

## Use the glossary's vocabulary

When `CONTEXT.md` defines a term, use that term in code, issues, and conversation. Don't invent synonyms. If you encounter an undefined concept that feels domain-specific, flag it for the maintainer rather than guessing.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-NNNN (title) — but worth reopening because..._
