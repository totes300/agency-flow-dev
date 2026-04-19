# Tasks for Issue 5: Fixed Fee Invoice — Creation + Editor

Parent issue: docs/invoicing-issues.md — Issue 5
Parent PRD: docs/invoicing-prd.md

## Tasks

### 1. Extract editable cells to shared file

**Type**: WRITE
**Output**: `components/invoices/editable-cells.tsx` exports `EditableTextCell` and `EditableNumberCell`; `invoice-work-breakdown.tsx` imports from shared file
**Depends on**: none

Extracted `EditableTextCell` and `EditableNumberCell` from `invoice-work-breakdown.tsx` to `components/invoices/editable-cells.tsx` for reuse by `InvoiceBillingSummary`.

**Status**: ✅ Complete

---

### 2. Extend createInvoice + getInvoicePreview for Fixed Fee

**Type**: WRITE
**Output**: `createInvoice` supports Fixed projects; `getInvoicePreview` returns `billingAmount` and `billingType`
**Depends on**: none

Removed T&M-only guard. Added Fixed branch: calculates `alreadyInvoiced` from sum of `lineType:"fixed"` amounts across all project invoices (drafts included). Creates one `lineType:"fixed"` item with remaining balance + `lineType:"time"` items with `unitPrice:0, amount:0` for work breakdown. Allows zero time entries for Fixed (milestone billing). Subject auto-prefills to project name only. Preview returns `billingAmount` for Fixed.

**Status**: ✅ Complete

---

### 3. Extend getProjectInvoiceMetrics + getInvoice for Fixed Fee data

**Type**: WRITE
**Output**: Metrics return `fixedPrice`, `fixedBilled`, `fixedRemaining`, `fixedPercentInvoiced`; `getInvoice` returns `fixedBilled`
**Depends on**: none

`getProjectInvoiceMetrics` now computes Fixed-specific metrics from `lineType:"fixed"` items only (excludes manual rows for accurate remaining balance). `getInvoice` also computes `fixedBilled` for sidebar progress display.

**Status**: ✅ Complete

---

### 4. Create InvoiceBillingSummary component

**Type**: WRITE
**Output**: `components/invoices/invoice-billing-summary.tsx` renders billing card with editable line items, "+ Add line item", total
**Depends on**: 1

New component using extracted editable cells. Renders a bordered card with billing line items (fixed fee + manual rows). Descriptions and amounts editable in draft. Remove button only on manual rows. "+ Add line item" button for manual rows. Total computed from billing items.

**Status**: ✅ Complete

---

### 5. Wire Fixed Fee in InvoiceDocument + filter work breakdown

**Type**: WRITE
**Output**: Fixed invoices show hours-only work breakdown (no billing rows) + billing summary card below
**Depends on**: 4

Added `BILLING_LINE_TYPES` set to filter `lineType:"fixed"`, `"retainer_fee"`, `"overage"`, `"manual"` out of the work breakdown for non-T&M invoices. `workBreakdownGroups` uses `useMemo` to filter. `billingItems` collected separately and passed to `InvoiceBillingSummary`. T&M rendering unchanged.

**Status**: ✅ Complete

---

### 6. Update CreateInvoiceModal for Fixed Fee

**Type**: WRITE
**Output**: Modal shows "Billing Amount" label for Fixed, enables CTA when billing amount > 0, shows friendly billing type label
**Depends on**: 2

Preview card: T&M shows "Total Billed", Fixed shows "Billing Amount" with value from `preview.billingAmount`. CTA enablement: Fixed allows create when `billingAmount > 0` (even with zero time entries for milestone billing). Dialog description shows "Fixed Fee" instead of raw `"fixed"`. Empty state message hidden for Fixed.

**Status**: ✅ Complete

---

### 7. Wire Fixed MetricCards + sidebar progress + enable Create button

**Type**: WRITE
**Output**: Project Invoices tab shows real Fixed MetricCards, sidebar shows progress, Create button enabled for Fixed
**Depends on**: 3, 6

`project-invoices.tsx`: `canCreateInvoice` now includes `"fixed"`. Fixed MetricCards wired to real data: Invoiced card shows `fixedBilled` with `"{pct}% of {fixedPrice}"` subline, Remaining card shows `fixedRemaining`. Sidebar: shows "Invoiced: €X / €Y (Z%)" for Fixed projects. Editor page passes `fixedBilled` from `getInvoice` to sidebar.

**Status**: ✅ Complete

---

### 8. TypeScript verification

**Type**: REVIEW
**Output**: `npx tsc --noEmit` passes with 0 errors
**Depends on**: 5, 7

**Status**: ✅ Complete — 0 errors
