# Tasks for Issue 3: T&M Invoice Editor

Parent issue: Issue 3 (`docs/invoicing-issues.md`)
Parent PRD: `docs/invoicing-prd.md`

## Tasks

### 1. Backend: getInvoice query + updateInvoice mutation

**Type**: WRITE
**Output**: Both functions deploy and return correct data
**Depends on**: none

Added `getInvoice` query (full invoice + line items grouped by category + project/client/brand info) and `updateInvoice` mutation (patches subject, issueDate, dueDate, note on draft invoices).

---

### 2. Backend: line item mutations (update, add, remove)

**Type**: WRITE
**Output**: All 3 mutations deploy; line items editable on draft invoices
**Depends on**: none

Added `updateInvoiceLineItem` (with auto-compute amount + manual override + total recalc), `addInvoiceLineItem` (manual type, appends to end), `removeInvoiceLineItem` (deletes + recalc totals).

---

### 3. UI: Editor page shell + contextual back link

**Type**: WRITE
**Output**: `/invoices/[id]` renders two-column layout with back navigation
**Depends on**: 1

Created `app/(dashboard)/invoices/[id]/page.tsx` with two-column layout (paper flex-1 + sidebar w-80 sticky), contextual back link from `?from=` params, loading skeleton, 404 redirect.

---

### 4. UI: InvoiceDocument — FROM/TO, meta, subject

**Type**: WRITE
**Output**: Document renders with editable subject, FROM/TO parties, date pickers
**Depends on**: 1, 3

Created `invoice-document.tsx` (subject blur-save, date pickers in draft, static text in read-only) and `invoice-parties.tsx` (FROM brand info, TO client billing info, muted placeholders for missing fields).

---

### 5. UI: InvoiceWorkBreakdown — editable line items table

**Type**: WRITE
**Output**: Work breakdown renders category headers + editable task rows + add/remove + totals
**Depends on**: 2, 3

Created `invoice-work-breakdown.tsx` with: CategoryBadge headers with subtotal hours, editable task rows (description, hours, rate, amount via blur-save), auto-compute amount on hours/rate change, manual amount override, "+ Add line item" button, row delete on hover, subtotal + total.

---

### 6. UI: InvoiceSidebar — status, amount, note, action placeholder

**Type**: WRITE
**Output**: Sidebar renders with status badge, amount, dates, editable note
**Depends on**: 1, 3

Created `invoice-sidebar.tsx` with InvoiceStatusBadge, large amount display, issue/due dates, editable note textarea (blur-save), action buttons placeholder for Issue 4. Sticky positioning via parent wrapper.

---

### 7. TypeScript check + manual verification

**Type**: REVIEW
**Output**: 0 TypeScript errors, Convex deploys clean
**Depends on**: 1-6

`npx tsc --noEmit` = 0 errors, `npx convex dev --once` deploys successfully.

---
