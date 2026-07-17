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

- [x] Duration, note, and billable are editable inline (`TimeEntryHoursCell`, `InlineEditable`, a
      hover billable toggle); date/task/category via the existing `TimeEntryModal`; a new entry can
      be added from the workspace header ("Add time"). Browser-verified: duration 20:30→5:00 and
      back; edit modal opens pre-filled.
- [x] Every mutation call has error handling with toasts (`toastError`); the billable toggle carries
      an Undo toast (mirrors the Time tab's `runToggle` pattern).
- [x] Budget summary, task subtotals, and footer recompute live after each edit (reactive
      `getCloseWorkspace` — no manual refresh). Verified: editing one entry flipped
      Logged 33h20m→17h50m, Overage $1,867→$627, and the group subtotal 20h50m→5h20m instantly.
- [x] Scope only ever contains open entries; a row locked concurrently (invoiceId/settledAt set)
      drops from scope on the next reactive update. `editable` is also gated per-row so a locked
      entry can never take an inline edit.
- [x] Leaving and returning preserves all edits (every edit is a real Convex mutation; the component
      holds no local ledger state).
- [x] No duplicated interaction logic vs. the project Time tab — reuses `TimeEntryHoursCell`,
      `InlineEditable`, `TimeEntryModal`, `updateEntry`, and the same Undo-toast pattern.
- [x] `npx tsc --noEmit` clean; eslint clean; existing settle/invoice/billingScope suites pass
      (86 tests across 5 files green).

## Blocked by

- Blocked by 02 (`02-close-workspace-readonly.md`).

## User stories addressed

- User stories 10, 12, 16, 34 (client-side aspect).
