# 05 — Timesheet AI columns + timesheet-format skill

**Type:** HITL — first real-output review gate
**Blocked by:** 03, 04
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Timesheet agent specifics*, *D1*, *Module 6*

## What to build

Complete the Timesheet agent: the two AI prose columns ("what was requested", "what we delivered") produced by the existing Phase 9 bounded-concurrency summarizer over the per-task AI inputs already collected in slice 03, plus the default `timesheet-format` skill.

Scope:
- Wire the summarizer as the agent's summarize step (BYOK key resolution via the existing pipeline; concurrency bounds as-is). The model writes ONLY these two columns; code merges them into the table rows.
- Seed the `timesheet-format` skill: tone guidance + the stop-condition "a task has logged time but no description or comments → flag the row, never invent what was delivered" (renders as a flagged cell, run continues per-row).
- Degradation: summarizer unavailable (no key, upstream failure) → deterministic columns still delivered; AI columns marked "[summary unavailable]"; a clear block explains why.
- AI prose cells render in standard prose styling, visually distinct from the deterministic tabular-nums cells (slice 02 token).

**Exit gate:** Adam reviews the first real client timesheet output (accuracy of prose, flag behavior, visual split) before this becomes the reference pattern for future agents.

## Acceptance criteria

- [ ] A full run produces the complete per-task table: AI requested/delivered + deterministic hours/totals; the stream shows "summarized N tasks".
- [ ] AI output contains only the two text columns — verifiably no model-produced number anywhere in the table or artifact (audit one run's raw messages).
- [ ] A task with time but no description/comments shows a flagged cell, not invented prose.
- [ ] With the org AI key removed, the run still yields the deterministic table with "[summary unavailable]" prose cells and an explanatory block.
- [ ] AI cells and deterministic cells are visually distinguishable per the slice-02 token.
- [ ] `npx tsc --noEmit` clean.
- [ ] **Gate:** Adam signs off on the first real timesheet output.

## User stories addressed

- US 19 (prose vs facts distinguishable), US 20 (flag, never invent), US 29 (full timesheet), US 33 (Phase 9 summarizer reused)
