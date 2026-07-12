# 05 — Skip to next close

## Parent PRD

`docs/prd-month-close.md` — sections: Definitions (skip stamp), Core invariants (I1, I2),
Implementation Decisions (Schema — skip mutation), User Stories (Skip block), UX Decisions.

## What to build

The deferral mechanism. Demo: skip a single entry and a whole task out of the June close, watch
totals shrink live; open the July workspace and see them arrive as carried-in with reason
`skipped`; undo restores them while June is open.

- Admin-only batch mutation to set/clear `skippedThrough` with all guards (org-scoped, entries must
  be open, target date must equal the entry's current effective-period end, all-or-nothing batch,
  typed errors). Guard logic as a pure, unit-tested helper.
- Row hover action "Skip → <next period label>"; task-header hover action "Skip all → <next>".
- A fully skipped task collapses to a single header line ("skipped → <next> close" + Undo).
- Undo per entry and per task while the origin period is open.

## Acceptance criteria

- [ ] Mutation guards enforced and unit-tested: non-admin rejected; locked (invoiced/settled)
      entries rejected with a clear message; invalid target date rejected; batch is atomic.
- [ ] Skip never modifies `date`; only `skippedThrough` (verified by test).
- [ ] Skipped entries leave the current scope and appear in the next period's scope as carried-in
      with reason `skipped` (billingScope already proves this; here the UI round-trip is demoed).
- [ ] Task-level skip = same mutation with the task's visible in-scope entry ids; collapsed header
      row with Undo per UX Decisions.
- [ ] Undo clears the stamp; for a carried entry whose origin period has since closed, clearing
      still resolves forward to the first open period (I1) — asserted by test and reflected in UI.
- [ ] Totals, flags, and carried lines recompute live on skip/undo.
- [ ] Skips persist across sessions/devices (server state, not client state).
- [ ] `npx tsc --noEmit` clean.

## Blocked by

- Blocked by 03 (`03-workspace-editing.md`). Independent of 04 — may run in parallel with it.

## User stories addressed

- User stories 17, 18, 19, 20, 21, 22, 23.
