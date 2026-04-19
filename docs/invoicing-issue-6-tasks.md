# Tasks for Issue 6: Retainer Invoice — Creation + Editor + Balance Chaining

Parent issue: docs/invoicing-issues.md — Issue 6
Parent PRD: docs/invoicing-prd.md

## Tasks

### 1. Extend createInvoice for Retainer

**Type**: WRITE
**Output**: `createInvoice` accepts `retainerYear`/`retainerMonth`, creates retainer invoice with balance chaining, retainer_fee + overage line items, snapshot fields, stamped time entries
**Depends on**: none

Added retainer branch: accepts optional `retainerYear`/`retainerMonth` args. Duplicate guard checks for any existing invoice (any status) for the same project-month. Balance derivation queries latest finalized retainer invoice (`status !== "draft"`, `periodEnd < thisMonth`), sorted by `periodEnd` DESC. Groups time entries by `(workCategoryId, taskId)` — no rate key. Computes `usedMinutes` from rounded task hours, `endBalance = start + included - used`. Overage: rollover OFF → overage on any negative month; rollover ON → overage only on cycle-closing month (position in cycle = cycleLength - 1). Creates `lineType:"retainer_fee"` + optional `lineType:"overage"` items. Snapshots all balance/rate fields on invoice.

**Status**: ✅ Complete

---

### 2. Add getRetainerInvoicePreview + closedUninvoicedMonths helper

**Type**: WRITE
**Output**: `getRetainerInvoicePreview` query returns balance/fee/overage/total for a month; shared `getClosedUninvoicedMonths` helper enumerates all closed uninvoiced months
**Depends on**: none

New shared helper function enumerates all months from project start to today, filters out months that already have invoices (any status). New query accepts `{projectId, year, month, roundingMinutes}`, returns: totalMinutes, retainerFee, startBalance, included, used, endBalance, overageAmount, total, currency, closedUninvoicedMonths. Same balance derivation logic as createInvoice but read-only.

**Status**: ✅ Complete

---

### 3. Extend getProjectInvoiceMetrics for Retainer

**Type**: WRITE
**Output**: Metrics return `uninvoicedMonthCount` and `uninvoicedMonthLabels` using shared helper
**Depends on**: none

Uses `getClosedUninvoicedMonths` helper. Returns count + month labels for MetricCards.

**Status**: ✅ Complete

---

### 4. Add retainer draft recalculation in mutations

**Type**: WRITE
**Output**: `updateInvoiceLineItem` and `removeInvoiceLineItem` recalculate retainer balance when time rows change on draft retainer invoices
**Depends on**: none

New `recalcRetainerBalance` helper function: sums `lineType:"time"` hours → usedMinutes, recalcs endBalance, updates/creates/removes overage line item based on overage rules, recalculates subtotal/total from billing items. Called from `updateInvoiceLineItem` (when retainer + time row changed) and `removeInvoiceLineItem` (when retainer + time row removed). Frozen snapshot fields (startBalance, included, fee, overageRate) never change.

**Status**: ✅ Complete

---

### 5. Update CreateInvoiceModal for Retainer

**Type**: WRITE
**Output**: Modal shows month dropdown for retainers, retainer-specific preview (Time + Fee + Overage + Total), CTA disabled until month selected
**Depends on**: 1, 2

Restructured modal with billing-type branching. Retainer: month dropdown from `closedUninvoicedMonths`, uses `getRetainerInvoicePreview` for live preview. Preview shows Total Time, Retainer Fee, Overage (if any), separator, Total. T&M/Fixed path unchanged. Friendly billing type labels via lookup map.

**Status**: ✅ Complete

---

### 6. Add balance section to BillingSummary + wire in editor

**Type**: WRITE
**Output**: `InvoiceBillingSummary` renders balance section (start/included/used/ending) for retainer invoices; wired from invoice snapshot fields
**Depends on**: none

Added optional `balanceData` prop with `BalanceData` type. When present, renders "Budget" section: Starting balance, Included, Used, Ending balance (negative in red). Below it: billing line items + "+ Add line item" + total. `InvoiceDocument` passes balance data from invoice retainer snapshot fields when `billingType === "retainer"`.

**Status**: ✅ Complete

---

### 7. Wire Retainer MetricCards + Create button + fix LIFO sort

**Type**: WRITE
**Output**: `canCreateInvoice` includes retainer, MetricCards show real data, LIFO guard uses sorted collection
**Depends on**: 3, 5

`project-invoices.tsx`: `canCreateInvoice` includes `"retainer"`. Retainer MetricCards: Total Invoiced (with "{n} invoices" subline), Uninvoiced Months (count + first 3 month names, "+N more" overflow). LIFO guard in `deleteInvoice`: changed `.find()` to `.filter().sort()` to reference the nearest blocking invoice (latest period).

**Status**: ✅ Complete

---

### 8. TypeScript verification

**Type**: REVIEW
**Output**: `npx tsc --noEmit` passes with 0 errors
**Depends on**: 6, 7

**Status**: ✅ Complete — 0 errors
