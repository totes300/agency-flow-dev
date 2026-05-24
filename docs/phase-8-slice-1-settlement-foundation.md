# Phase 8 — Slice 1: Settlement foundation + invoice transitions

> **Type:** AFK
> **Blocked by:** None — can start immediately (parallelizable with Slice 2)
> **Blocks:** Slice 3, Slice 4

## Parent PRD

[`docs/phase-8-time-entry-settlement.md`](./phase-8-time-entry-settlement.md)

## What to build

The end-to-end **invoice-anchored** settlement path (T&M and Fixed). After this slice, finalizing any invoice stamps its linked entries with `settledAt` + `settledReason`, the entry-edit guards key on the new field, all consumer code uses the renamed `projectOverview` shape, and a one-shot backfill brings existing dummy data forward. No retainer period-close UI yet — that's Slice 3.

This is the tracer bullet for the T&M ✅ / Fixed ⚠️ / void ❌ rows of the PRD's Problem Statement table. Demoable: finalize a T&M invoice → its entries render `Closed`, edit/delete are blocked, the "Uninvoiced" stat is now "Open". Void → entries unsettled and editable again. Fixed invoice → `settledReason: "fixed_included"`.

Reference: parent PRD § Schema Changes (timeEntries block), § Mutations (`settleEntries.ts` + invoice transition wiring + `timeEntries` guard updates), § Derived Status, § Reporting Changes, § Data Migration.

## Acceptance criteria

### Schema & helpers
- [ ] `timeEntries` schema adds the **4** new optional fields (`settledAt`, `settledReason` 3-value enum, `settledPeriodStart`, `settledPeriodEnd`) — no `settledByUserId`, no `"manual_close"` enum value. `npx tsc --noEmit` clean.
- [ ] `convex/lib/settleEntries.ts` exists with `settleInvoiceEntries(ctx, invoiceId, orgId, periodStart?, periodEnd?, reason="invoiced")` and `unsettleInvoiceEntries(ctx, invoiceId, orgId, { clearInvoiceId? })`. Both walk via `invoiceLineItems.by_invoiceId` (no new index). The canonical-set invariant from the PRD's Decisions table is enforced (only entries referenced by a line item AND carrying matching `invoiceId` are touched).
- [ ] `entryStatus(e)` helper exists, matches the spec in § Derived Status: `!e.isBillable → "non_billable"` (settled or not), `invoiceId && !settledAt → "draft"`, `settledAt → "closed"`, else `"open"`. Unit-tested across all three `settledReason` values + a settled non-billable case.

### Invoice transition wiring
- [ ] `applyStatusTransition` in `convex/invoices.ts` calls the helpers per the PRD's transition table. `paid → void` remains disallowed (existing validation untouched).
- [ ] `draft → invoiced` resolves `project.billingType` from `invoice.projectId` and passes `"fixed_included"` for Fixed invoices, `"invoiced"` otherwise.
- [ ] `deleteInvoice` replaces its inline entry-unlink with `unsettleInvoiceEntries({ clearInvoiceId: true })`.
- [ ] `invoiced → draft` and `paid → draft` use `unsettleInvoiceEntries({ clearInvoiceId: false })` so entries fall back to `draft` (still linked to the now-draft invoice).

### Entry-level guards (write-side)
- [ ] `timeEntries.update` rejects when `entry.invoiceId !== undefined || entry.settledAt !== undefined` with distinct error messages for the invoice-link case vs the settled-no-invoice case (per PRD code sample).
- [ ] `timeEntries.remove` applies the same guard.
- [ ] Any bulk billable-flag mutation that exists in this codebase applies the same guard.

### Read-side surface
- [ ] `listProjectEntries` accepts the extended `billingStatus` enum: `open` / `draft` / `closed` / `non_billable` (collapsed UI vocabulary — not `settled`).
- [ ] `projectOverview` renames `uninvoicedMinutes/Amount` → `openMinutes/Amount`, `invoicedBillableMinutes/Amount` → `invoicedMinutes/Amount`, and **adds** `settledMinutes/Amount` (sum of `retainer_included` + `fixed_included`). All 7 consumer files updated in the same PR:
  - `convex/timeEntries.ts`
  - `convex/lib/__tests__/projectOverview.test.ts`
  - `components/projects/tm-overview.tsx` (T&M label "Uninvoiced" → "Open")
  - `lib/invoice-banner-view.ts`
  - `lib/invoice-banner-view.test.ts`
  - `components/invoices/project-invoices.tsx`
  - `components/invoices/project-invoices-payment-cards.tsx`

### Invoice-predicate audit (Revision Pass #4)
- [ ] Every `invoiceId` billing predicate audited and reclassified as one of: `!invoiceId && !settledAt` (open) · `invoiceId || settledAt` (locked) · invoice-only (unchanged). Audit recorded as a short comment block in `docs/backlog.md` so future readers can see what was checked.
- [ ] `convex/lib/readyToInvoice.ts:213` adds `|| e.settledAt` to its "skip locked" predicate.
- [ ] `convex/lib/projectSummary.ts:192` updated equivalently.
- [ ] `convex/timeEntries.ts:708,710` (`listProjectEntries` filter) reclassified.
- [ ] Component-side consumers checked: `components/projects/project-time-stats.tsx`, `project-time-selection-toolbar.tsx`, `time-entry-modal.tsx`.

### Data migration
- [ ] `convex/settleEntries.ts` (or wherever the internalMutation lives) exports `backfillSettledFromInvoiceId` per the PRD code sample, including the per-project `billingType` cache so Fixed-project entries get `fixed_included` instead of `invoiced`.
- [ ] Run once on the dummy dataset: `npx convex run internal:settleEntries:backfillSettledFromInvoiceId`. Log the count.

### Tests
- [ ] Unit test for `entryStatus()` covering all three `settledReason` values + settled non-billable.
- [ ] Convex test: `draft → invoiced` on a T&M invoice settles its entries with `reason="invoiced"`.
- [ ] Convex test: `draft → invoiced` on a Fixed invoice settles its entries with `reason="fixed_included"`.
- [ ] Convex test: `invoiced → void` unsettles entries and clears `invoiceId`.
- [ ] Convex test: `invoiced → draft` unsettles entries and keeps `invoiceId`.
- [ ] Convex test: `timeEntries.update`/`remove` reject settled entries with the right error string.

### Hygiene
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `docs/backlog.md` updated with Phase 8 Slice 1 entry + the deferred items it touches.

## Blocked by

None — can start immediately. Runs in parallel with Slice 2.

## User stories addressed

From [parent PRD](./phase-8-time-entry-settlement.md) § Problem Statement:

- T&M invoice finalize ✅ — explicitly stamps `settledAt` (no longer only `invoiceId`).
- Fixed invoice ⚠️ — now stamps `settledReason: "fixed_included"` so the row badge truthfully reads "covered by fixed price", not "billed hourly".
- Retainer + overage ⚠️ — overage invoice still stamps `invoiceId` AND now stamps `settledReason: "invoiced"`; conflation no longer a single-field problem.
- Void (not delete) invoice ❌ — void now clears `invoiceId` and `settledAt`, fixing the bug where voided invoices left entries locked forever.

Plus the **entry-edit/delete guard** story: a settled entry cannot be silently mutated.

Plus the foundation that Slices 3 and 4 build on (Slice 3 stamps `retainer_included`; Slice 4's drill-down reads `settledReason`).
