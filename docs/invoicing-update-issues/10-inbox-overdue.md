# 10 — Inbox: Overdue section + bulk mark-paid + undo

**Type**: HITL
**Blocked by**: none (independent of #09; both feed into #11)
**Unblocks**: #11 (Inbox shell composes this)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #3, #8 · § Concurrency rules · User stories 5–11, 48
**Visual reference**: `docs/invoicing-update.md` § Inbox · `prototypes/invoicing-final.html`

## What to build

### Backend mutations (admin-only, tested)

**`markInvoicesPaid({ invoiceIds: Id<"invoices">[] })`**

Returns:
```ts
{
  updated: number,
  skipped: Array<{ id: Id<"invoices">; reason: string }>,
  priorStates: Array<{ id: Id<"invoices">; status: string; paidAt: number | null }>,
}
```

Behavior:
- Idempotent — if an invoice is already `paid`, no-op for that row (counted in `updated`, not `skipped`).
- Last-write wins. No version check, no conflict UI.
- Returns `priorStates` snapshot so the undo mutation can revert exactly what changed.

**`undoMarkInvoicesPaid({ priorStates: Array<{id, status, paidAt}> })`**

Returns:
```ts
{ reverted: number, skipped: Array<{id: Id<"invoices">, reason: string}> }
```

Behavior:
- For each invoice, compares current `(status, paidAt)` against the snapshot. If they no longer match, **skip** that one (someone else modified it during the undo window).
- Reverts only matching rows back to the snapshot's `status` and `paidAt`.

### Tests (mandatory)

`markInvoicesPaid`:
- Happy path: 3 overdue invoices marked paid, returns correct `updated` count and `priorStates`.
- Idempotent: calling on an already-paid invoice no-ops cleanly.
- Authorization: member call rejected.

`undoMarkInvoicesPaid`:
- Happy path: revert exactly matches the prior snapshot.
- Partial undo: one invoice mutated by another admin between mark and undo — that one is skipped, others reverted, `skipped` array carries it.
- Authorization: member call rejected.

### UI

**Component: `components/invoices/inbox-overdue-section.tsx`**

Owns its own selection state (per-component `useState`, not URL).

- **Red header**: `"Overdue"` with count.
- Rows sorted **oldest first** — most-late at top.
- Per-row: `[ checkbox ] · invoice number · client · days overdue · amount · [Mark paid]`
- **In bulk-select mode (≥1 row checked)**: per-row `[Mark paid]` buttons are **hidden**. Sticky bar appears at the bottom: `{N} selected · [Mark as paid] · [Clear]`.
- Click sticky-bar `[Mark as paid]`: commits **immediately** (no confirmation dialog). Calls `markInvoicesPaid`. On success, holds `priorStates` for 5 seconds.
- Toast: `"{N} marked as paid"` with `[Undo]` action visible for 5 seconds.
- Click `[Undo]`: calls `undoMarkInvoicesPaid({ priorStates })`. If `skipped.length > 0`, toast: `"Reverted {X} · {Y} skipped (modified by other users)"`. Else: `"Undo done"`.
- After 5s with no undo click, drop the snapshot.
- Unchecking the last row → bulk mode exits, per-row buttons return.

## Acceptance criteria

- [ ] `markInvoicesPaid` + `undoMarkInvoicesPaid` implemented + admin-only + all tests pass.
- [ ] `<InboxOverdueSection />` renders overdue list, oldest-first.
- [ ] Bulk-select mode toggle works correctly (per-row buttons hide ≥1 checked, return at 0).
- [ ] No confirmation dialog on bulk mark-paid.
- [ ] Undo toast appears for 5 seconds with working `[Undo]` button.
- [ ] Undo correctly reverts unchanged rows; correctly skips and reports modified rows.
- [ ] All mutation calls wrapped in `.catch(toastError)`.
- [ ] `npx tsc --noEmit` clean.

## Verification

1. Seed dummy data with 3 overdue invoices (different ages).
2. Visit `/invoices` → Overdue section at top, red header, sorted oldest first.
3. Single-row mark-paid (per-row button) → marks paid, shows undo toast.
4. Check 2 rows → per-row buttons disappear, sticky bar appears with `2 selected`.
5. Click sticky `Mark as paid` → both marked, undo toast appears.
6. Click `Undo` within 5s → both reverted.
7. Repeat the bulk mark, but in another browser tab modify one of the affected invoices (e.g. void it) → click Undo → toast says "Reverted 1 · 1 skipped".
8. Wait 5s after marking → undo button disappears.

## User stories addressed

- 5 (overdue at top, red header, oldest first)
- 6 (bulk select via checkbox, sticky bar)
- 7 (immediate commit, no confirm)
- 8 (5-second undo toast)
- 9 (skip modified rows on undo, surface skipped via toast)
- 10 (per-row buttons hidden in bulk mode)
- 11 (per-row buttons return on uncheck-last)
- 48 (mark-paid race: last-write wins, idempotent no-op)

## Notes

- Per `CLAUDE.md`: this section component is the only place selection state lives. Page file (#11) doesn't know about selection.
- Use `shadcn` skill for Checkbox + Sonner toast APIs.
- Use existing `listAllInvoices({status:"overdue"})` if it fits; if too coupled, add a thin admin-only `getOverdueInvoices` query.
- The 5-second window is intentional — long enough to cancel a misclick, short enough that another admin's edit during the window is unlikely. Snapshot-based undo handles the rare race.
- Use `frontend-design` skill for polish.
