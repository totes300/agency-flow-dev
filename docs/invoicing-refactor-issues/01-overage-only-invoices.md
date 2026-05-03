# 01 — Overage-only invoices + clean Ready feed

**Type**: AFK
**Blocked by**: none
**Unblocks**: #03 (cutover)

## Parent PRD

[`docs/invoicing-refactor.md`](../invoicing-refactor.md) — § Solution, D1, D2, D3, D5, D10, D11, Schema changes, Module Design (`computeRetainerBalance`, Ready feed builders, `isInvoiceable`, `createInvoice`, `InvoiceDocument`, `MonthlyBreakdownCard`)

## What to build

The unified rule for the **invoice side** of the refactor: every closed retainer period with overage > $0 produces exactly one overage-only invoice; every within-budget period produces no invoice and no Ready row. The invoice document itself carries the activity context so the client receives a single document.

End-to-end vertical:

### Schema
- Drop `v.literal("retainer_fee")` from the `lineType` union on `invoiceLineItems` (DB wipe in #03 makes this safe).

### Backend (Convex)
- `computeRetainerBalance`: `total = overageAmount` (no longer `monthlyFee + overageAmount`). `monthlyFee` is still returned as a separate context field.
- `buildRetainerMonthlyReadyRows`: emit only over-budget closed months. Drop `invoiceTotal` and `monthlyFee` plumbing fields — `amount` is the canonical billable amount.
- `buildRetainerCycleReadyRows`: emit only cycle-end months with cycle overage > 0. Period spans the full cycle range (`cycleStart → cycleEnd`). Drop the per-month chain (start-balance + cascade + sequential guard).
- `isInvoiceable`: simplifies to `row.amount > 0`.
- `createInvoice` retainer branch:
  - Throw early with `"This period has no overage. Download the monthly report instead."` when called for a within-budget retainer period.
  - For rollover projects: throw on out-of-position cycle calls (must be cycle-end); scope the time-entry query to the entire cycle and write a single Overage line item with period = cycle range.
  - No `retainer_fee` line item written under any branch.
- `getRetainerInvoicePreview`: `total` returns overage only; `monthlyFee` returned as a separate context field.
- Delete dead code: `getRetainerStartBalance` rollover-ON branch, `cascadeRetainerChain`, sequential guard in `createInvoice`, `total === 0` finalize guard.

### Frontend
- `InvoiceDocument`: drop the "Retainer fee" line item entirely; add a prominent activity summary block (hours used / included / balance, plus cycle-to-date for rollover); add the Stripe disclaimer context line ("Monthly retainer fee — $X/mo — billed separately via Stripe").
- `MonthlyBreakdownCard`: exactly one primary action per row per the rules — "Generate invoice" if overage > 0 and no invoice yet, "Download report" if within budget or in-progress, invoice number link if billed. Render the Stripe disclaimer line below the card title (sources `monthlyFee` and `currency` from project config — no Stripe API).
- Delete `CreateInvoiceModal`. Wire the Ready row "Generate invoice" button + the Monthly Breakdown "Generate invoice" button to call `createInvoice` directly and navigate to the draft invoice page.
- `/invoices` Ready empty-state copy already references monthly reports — verify it still renders correctly when zero rows.

### Tests
- `convex/lib/__tests__/retainerBalance.test.ts`: assert `total === overageAmount` across monthly + rollover, within-budget + over-budget cases. Add rollover cycle math case.
- `convex/lib/__tests__/readyToInvoice.test.ts`: drop `invoiceTotal` assertions; add "within-budget month produces no row" (the contract the entire UX depends on); assert cycle row period = cycle range; assert `isInvoiceable` is now `amount > 0`.
- `convex/lib/__tests__/invoiceCreation.test.ts`: single Overage line item, no `retainer_fee`; new test for cycle invoice covers full cycle range; new "no overage throws with exact message"; new "rollover non-cycle-end throws". T&M and Fixed branch tests unchanged.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run` — all updated and new tests pass.
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` clean.
- [ ] No `retainer_fee` literal anywhere in the codebase (schema or runtime). `rg "retainer_fee"` returns zero matches.
- [ ] Within-budget retainer rows are absent from `/invoices` Ready (manual: with seeded data, no zero-amount retainer rows appear).
- [ ] Click "Generate invoice" on an overage Ready row → lands directly on the draft invoice page (no modal).
- [ ] `CreateInvoiceModal` component file is deleted.
- [ ] Invoice document for an overage retainer period shows: brand/parties, single Overage line, AMOUNT DUE block, activity summary (hours used / included / balance), Stripe disclaimer context line. No "Retainer fee" line item.
- [ ] Monthly Breakdown card row shows exactly one primary action button per the rules. Stripe disclaimer line is visible below the card title.
- [ ] `createInvoice` rejects a within-budget retainer period with the exact PRD message; rejects a non-cycle-end call on a rollover project.
- [ ] T&M and Fixed Price flows demonstrate no behavioral change.

## User stories addressed

- 1 (overage row in Ready)
- 2 (no row when within budget)
- 3 (click → draft page, no modal)
- 4 (single primary action on Monthly Breakdown)
- 5 (rollover Ready emits only cycle-end overage)
- 6 (cycle invoice covers full cycle range)
- 8 (invoice document shows activity summary)
- 9 (Stripe disclaimer on project page)
- 10 (refuse $0 invoice with clear message)
- 11 (Generate-invoice button absent on within-budget rows)
- 21 (Ready tab content rules)
- 22 (Ready empty-state)
- 23 (T&M and Fixed unchanged)
- 24 (T&M and Fixed Ready unchanged)
- 25 (client receives one document with activity context)
- 28 (Stripe disclaimer on documents)

## Notes

- This slice is large but cohesive — it is the unified rule applied to the invoice surface. Per `feedback_one_pr_refactors.md`, do not split artificially; merge as one PR.
- DB wipe + reseed is **not** part of this slice — it is #03. During development, hand-clean any `retainer_fee` line items in the dev DB, or let the schema-validator failure trigger #03.
- Stripe disclaimer text is hardcoded from project config (`monthlyFee`, `currency`). No Stripe API integration. Per D11.
- Pro-rated months get the full bucket — acknowledged limitation per D12. Backlog entry lands in #03.
