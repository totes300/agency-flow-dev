# 03 — Workspace editing (live ledger corrections)

## Parent PRD

`docs/prd-month-close.md` — sections: Solution (stage 2), UX Decisions (key interactions),
Implementation Decisions (UI composition — reuse of existing editing).

## What to build

Turn the read-only workspace into the review surface: every in-scope entry editable in place using
the **existing** entry mutations and components — no forked editing logic. Demo: change a duration,
watch the budget line, footer, and (future) commit summary recompute live.

- Inline duration edit (existing hours-cell pattern) and inline note edit on entry rows.
- Hover billable toggle per row.
- Full entry editor (existing modal) reachable from each row for date/task/category changes.
- Add-time (existing modal) reachable from the workspace header for missed work.
- All totals recompute reactively on every mutation.

## Acceptance criteria

- [ ] Duration, note, and billable are editable inline; date/task/category via the existing entry
      modal; a new entry can be added from the workspace.
- [ ] Every mutation call has error handling with toasts; optimistic states roll back on failure.
- [ ] Budget summary, task subtotals, and footer recompute live after each edit (reactive query —
      no manual refresh).
- [ ] Scope only ever contains open entries; if an entry becomes locked concurrently (e.g. another
      admin commits), the row leaves the view on the next reactive update without crashing.
- [ ] Leaving and returning to the workspace preserves all edits (mutations are real; no
      local-only state).
- [ ] No duplicated interaction logic vs. the project Time tab — shared hooks/components only.
- [ ] `npx tsc --noEmit` clean; existing time-entry tests pass.

## Blocked by

- Blocked by 02 (`02-close-workspace-readonly.md`).

## User stories addressed

- User stories 10, 12, 16, 34 (client-side aspect).
