# Tasks for #9: Path C — Retainer Overview "Invoice This Month"

Parent issue: Issue 9 in `docs/invoicing-issues.md`
Parent PRD: `docs/invoicing-prd.md`

Codex-reviewed 2026-04-17 (session `019d98a1-d6d9-7820-bcd9-9f6d37ce10b9`).

## Tasks

### 1. Extend `getRetainerData` with per-month invoice linkage

**Type**: WRITE
**Output**: `api.projects.getRetainerData` returns each month with an `invoice?: { id, number, status }` field so the UI can distinguish closed-uninvoiced vs. already-invoiced months.
**Depends on**: none

Touch `convex/projects.ts`. Keep the existing month-building logic untouched; after months are computed, query `invoices` by `by_projectId`, filter by `orgId`, and match retainer invoices by **exact month-boundary equality** on `periodStart` and `periodEnd` — not "falls inside that month." The retainer `createInvoice` mutation (`convex/invoices.ts`) writes exact month boundaries and duplicate-guards on them, so a month has at most one invoice (draft or finalized). Do not implement any "prefer finalized" fallback — the invariant is one invoice per retainer month.

---

### 2. Add "Invoice this month" control to month accordion rows

**Type**: WRITE
**Output**: In `components/projects/retainer-overview.tsx`, each `AccordionContent` for a closed month renders either (a) "Invoice this month" button if uninvoiced, or (b) a "View invoice INV-xxx" link to `/invoices/[id]` if invoiced. Open months render no control. No click behavior yet.
**Depends on**: 1

Place the control at the bottom of `AccordionContent` (below the task table). Use `Button` size="sm" variant="outline" for the CTA, and a `Link` for the "View invoice" case. Optionally include the `InvoiceStatusBadge` beside the link. Hide entirely when `!month.isMonthClosed`.

---

### 3. Wire "Invoice this month" via existing `CreateInvoiceModal` prefill

**Type**: WRITE
**Output**: Clicking "Invoice this month" opens the existing `CreateInvoiceModal` with `initialRetainerYear` and `initialRetainerMonth` set. Modal remounts per target month via `key`. Month dropdown stays editable.
**Depends on**: 2

Reuse the existing modal API (see `components/invoices/ready-to-invoice-card.tsx:103-118` for the exact pattern): `<CreateInvoiceModal key={...} open projectId projectName billingType="retainer" currency initialRetainerYear initialRetainerMonth onCreated=router.push />`. Lift modal open state into `RetainerOverview` as `activeMonth: { year, month } | null`. The month dropdown must remain editable — PRD says "pre-filled," not locked. Use a `key={`${projectId}-${year}-${month}`}` so prefill resets cleanly when switching months.

`RetainerOverview` currently receives only `projectId`; extend its props to also receive `projectName` and `currency` so it can pass them into the modal. Update the one caller in the project detail page.

---

### 4. Wire overage and cycle-end banner "Create Invoice" buttons

**Type**: WRITE
**Output**: The two currently-`disabled` "Create Invoice" buttons in `retainer-overview.tsx` (overage destructive banner ~line 199, overage settlement card ~line 291) open the same `CreateInvoiceModal` pre-filled for the cycle-closing month. The "unused hours forfeited" no-overage settlement card (line 297) also gets a CTA to invoice the cycle-closing month — every closed month needs an invoice, not only overage months.
**Depends on**: 3

Reuse the open-modal handler from task 3. For all three CTAs, preselect `months[months.length - 1]` (the cycle-closing month). If that month is already invoiced (per task 1's `invoice` field), hide or disable the CTA with a tooltip "This month is already invoiced." Overage folds into the closing month's invoice per PRD — a single button per banner is correct.

---

### 5. Fixed overview MetricCard treatment (decision)

**Type**: REVIEW
**Output**: Decision captured here: **add `invoiced / fixedPrice` subline under the Revenue card** in `components/projects/fixed-overview.tsx`. No new 5th card; the Invoices tab (Issue 5) already owns dedicated `Invoiced` / `Remaining` MetricCards.
**Depends on**: none

Resolved. No further action — feeds Task 7.

---

### 6. Update T&M overview "Uninvoiced" metric to use `invoiceId` presence

**Type**: WRITE
**Output**: `api.timeEntries.projectOverview` (the backing query for `tm-overview.tsx`) computes `uninvoicedMinutes` / `uninvoicedAmount` from entries where `isBillable === true && invoiceId === undefined`. The MetricCard and the inline uninvoiced alert reflect post-invoicing values. Alert's disabled "Create Invoice" button stays disabled (T&M entry point is the Invoices tab from Issue 2).
**Depends on**: none

Locate `projectOverview` in `convex/timeEntries.ts`. Verify the uninvoiced math already filters by `invoiceId === undefined`. If not, add the filter. Filter must always include `orgId` per the multi-tenancy rule. This task may be verification-only if Issue 2 already wired it correctly.

---

### 7. Wire Fixed overview Revenue card to show `invoiced / fixedPrice` subline

**Type**: WRITE
**Output**: Revenue MetricCard on the Fixed overview shows `fixedPrice` as the primary value and a subline like `"€5,000 invoiced (50%)"`. Computation: `Σ amount` of `lineType === "fixed"` line items across the project's invoices (same math as Issue 5's Invoiced MetricCard).
**Depends on**: 5

Extend `api.timeEntries.projectOverview` in `convex/timeEntries.ts` (or the fixed-specific query it delegates to) with an `invoicedAmount` field for fixed-fee projects. Update `fixed-overview.tsx` to consume it and render the subline under the Revenue MetricCard. When `fixedPrice` is unset, keep the existing "Not set" copy without a subline.

---

### 8. Manual acceptance-criteria walkthrough

**Type**: REVIEW
**Output**: All 5 Issue 9 acceptance-criteria boxes ticked after running the "How to verify" script. `npx tsc --noEmit` passes.
**Depends on**: 1, 2, 3, 4, 6, 7

Script: closed uninvoiced month → button shows → click → modal opens pre-filled → create → button replaced by "View invoice" link. Already-invoiced month → no button. T&M Overview Uninvoiced MetricCard reflects live invoicing (create & delete invoice). Fixed Overview Revenue subline reflects live invoicing. Overage and cycle-end banners open the modal preselected to the cycle-closing month.

---
