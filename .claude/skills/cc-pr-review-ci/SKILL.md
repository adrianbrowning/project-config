---
name: cc-pr-review-ci
description: Comprehensive TypeScript/React PR review with structured format, severity-based categorization (Critical/High/Observations), security/performance/SOLID checks, and AI-friendly fix prompts for all issues.
---

# PR Review (single-agent, CI-safe)

Review a PR across 7 domains sequentially, then synthesize into one comment.

*If no PR number provided, diff against `origin/main` instead.*

## Step 1 — Get the diff

- PR number given → `gh pr diff <N>`
- No PR number → `git diff origin/main`

## Step 2 — Run 7 domain reviews sequentially

For each domain, read the reference file then analyze the diff against its checklist. Note findings before moving to the next.

1. **Security**         — `Read .claude/skills/cc-pr-review-ci/references/security.md`
2. **Performance**      — `Read .claude/skills/cc-pr-review-ci/references/performance.md`
3. **React/TypeScript** — `Read .claude/skills/cc-pr-review-ci/references/react-ts.md`
4. **Testing**          — `Read .claude/skills/cc-pr-review-ci/references/testing.md`
5. **DevOps/CI**        — `Read .claude/skills/cc-pr-review-ci/references/devops.md`
6. **Holistic**         — `Read .claude/skills/cc-pr-review-ci/references/holistic.md`
7. **Duplication**      — `Read .claude/skills/cc-pr-review-ci/references/duplication.md`

## Step 3 — Synthesize and post

1. Read `references/format.md` for the exact comment template.
2. Merge all domain findings:
   - Sum counts: total Critical / High / Observations / Positives
   - Combine all Critical issues across domains
   - Combine all High issues
   - Combine all Observations
   - Deduplicate and merge Positives
3. Determine verdict:
   - Any Critical → ❌ Changes Required
   - High only → ⚠️ Approved with Suggestions
   - Observations only → ✅ Approved
4. Post single comment:
   - If PR number: `gh pr comment <N> --body "$(cat <<'EOF' ... EOF)"`
   - If local diff: print review to stdout
