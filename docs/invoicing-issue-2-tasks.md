# Tasks for Issue 2: T&M Invoice Creation (Path A)

Parent issue: Issue 2 (`docs/invoicing-issues.md`)
Parent PRD: `docs/invoicing-prd.md`

## Tasks

### 1. Backend: `convex/invoices.ts` — queries + T&M creation mutation

**Type**: WRITE
**Output**: `npx convex dev` deploys; `listInvoices`, `getInvoicePreview`, `createInvoice` available
**Depends on**: none (Issue 1 schema already deployed)

Created `convex/invoices.ts` with `listInvoices` (optional projectId filter, denormalized client/project names), `getProjectInvoiceMetrics` (totals for MetricCards), `getInvoicePreview` (live preview for modal), and `createInvoice` mutation (T&M variant with grouping, rounding, numbering, entry stamping).

---

### 2. UI: InvoiceList shared table component

**Type**: WRITE
**Output**: `components/invoices/invoice-list.tsx` renders table with all required columns
**Depends on**: 1

Created reusable table with Number, Subject, Client (optional), BillingType badge, Status badge, Total, Issue Date, Due Date. Row click navigates to `/invoices/[id]` with optional `?from=project` params.

---

### 3. UI: Project Invoices Tab — MetricCards + list + Create Invoice button

**Type**: WRITE
**Output**: Project Invoices tab shows MetricCards + list + Create Invoice button
**Depends on**: 1, 2

Created `components/invoices/project-invoices.tsx` with billing-type-aware MetricCards (T&M: Total Invoiced + Uninvoiced), InvoiceList, and Create Invoice button. Updated project detail page to render this instead of the old empty state. Updated `ProjectInvoicesEmpty` to accept `onCreateInvoice` callback.

---

### 4. UI: CreateInvoiceModal (T&M)

**Type**: WRITE
**Output**: Modal with date presets, rounding, live preview, create flow
**Depends on**: 1, 3

Created `components/invoices/create-invoice-modal.tsx` with: preset pill chips (All uninvoiced, This month, Previous month, Custom), date pickers, rounding dropdown with tooltip, live preview card (reactive via `getInvoicePreview`), and full-width CTA with spinner + error handling. Success navigates to `/invoices/[id]` with toast.

---

### 5. TypeScript check + manual verification

**Type**: REVIEW
**Output**: All acceptance criteria confirmed
**Depends on**: 1, 2, 3, 4

- `npx tsc --noEmit` — 0 errors
- `npx convex dev --once` — deploys cleanly

---
