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

- [x] Mutation guards enforced and unit-tested (`convex/lib/skipGuards.ts` +
      `__tests__/skipGuards.test.ts`): non-admin rejected by `requireAdmin`; locked
      (invoiced/settled) entries reject the whole batch with a clear message; batch is
      all-or-nothing. Skip target is server-derived (never client-supplied), so an invalid
      target date can't occur.
- [x] Skip never modifies `date`; the mutation only patches `skippedThrough` (billingScope
      scenario 2 asserts carried entries keep their true date; the mutation touches no date field).
- [x] Skipped entries leave the current scope and appear in the next period as carried-in with
      reason `skipped`. **Browser-verified round-trip**: skipped a June entry → left June scope,
      collapsed with Undo; opened July → arrived as "carried · June 2026" with the checklist line
      "Carried in · Skipped from June 2026".
- [x] Task-level skip = same mutation with the task's in-scope entry ids; a fully-skipped task
      collapses to one line ("skipped → July 2026 · Undo all"). Browser-verified.
- [x] Undo clears the stamp; for a carried entry whose origin period has since closed, I1 still
      resolves it forward structurally (billingScope scenario 6 — story 22). Per-entry + task-level
      Undo both browser-verified to restore the entries.
- [x] Totals, flags, and carried lines recompute live on skip/undo (reactive query — verified
      Logged/Overage/checklist all updated instantly).
- [x] Skips persist across sessions/devices — `skippedThrough` is server state; verified by
      navigating away and back (the skipped row and carried arrival survived reload).
- [x] `npx tsc --noEmit` clean; eslint clean; 110 tests green across 7 suites.

## Blocked by

- Blocked by 03 (`03-workspace-editing.md`). Independent of 04 — may run in parallel with it.

## User stories addressed

- User stories 17, 18, 19, 20, 21, 22, 23.
