# Tasks for Issue 1: Foundation — Schema, Org Settings UI, Navigation, Empty States

Parent issue: Issue 1 (`docs/invoicing-issues.md`)
Parent PRD: `docs/invoicing-prd.md`

## Tasks

### 1. Schema — invoices, invoiceLineItems, timeEntries.invoiceId, orgSettings fields, guard fixes

**Type**: WRITE
**Output**: `npx convex dev` deploys without schema errors, `npx tsc --noEmit` passes
**Depends on**: none

Add `invoices` table with all fields from PRD §Data Model and 4 indexes (`by_orgId`, `by_projectId`, `by_clientId`, `by_orgId_status`). Add `invoiceLineItems` table with all fields and `by_invoiceId` index. Add `invoiceId: v.optional(v.id("invoices"))` to `timeEntries` (after `snapshotCategoryId`). Add `nextInvoiceNumber`, `invoicePrefix`, `defaultPaymentTermsDays` (all optional) to `orgSettings`.

Per `billing-badge.md` (validated against PRD): **remove** the edit/delete guards in `convex/timeEntries.ts` (`update` ~L296, `remove` ~L381) — the PRD says entries stay editable after invoicing. **Keep** the `bulkUpdateBillable` guard (~L449) but rename from `invoicedInReportId` to `invoiceId`. Update `projectOverview` uninvoiced calculation (~L564) to filter by `!e.invoiceId`.

---

### 2. OrgSettings — extend update mutation + Invoicing UI section

**Type**: WRITE
**Output**: Settings > General shows Invoicing section; saving prefix/number/terms persists after reload
**Depends on**: 1

Extend `orgSettings.update` mutation in `convex/orgSettings.ts` to accept and patch `invoicePrefix` (string), `nextInvoiceNumber` (number), `defaultPaymentTermsDays` (number). Add "Invoicing" section to `components/settings/settings-general.tsx` following the existing Field/FieldGroup pattern: invoice prefix text input (default `"INV-"`), next invoice number input (editable number), payment terms dropdown (Net 15 / 30 / 45 / 60 / custom number).

---

### 3. InvoiceStatusBadge shared component

**Type**: WRITE
**Output**: `components/invoices/invoice-status-badge.tsx` exists and renders all 4 visual states correctly
**Depends on**: none (parallel with tasks 1-2)

Create `components/invoices/invoice-status-badge.tsx` with 4 states: Draft (gray), Invoiced (blue), Overdue (red/destructive), Paid (green). Use `color-mix` tinted backgrounds matching the existing `StatusBadge` pattern in `components/status-badge.tsx`. Overdue replaces "Invoiced" when `status === "invoiced" && dueDate < today` — accept `timezone` prop for timezone-aware date comparison. Hardcoded colors (not org-configurable).

---

### 4. Navigation, /invoices empty state, project tab updates

**Type**: WRITE
**Output**: `/invoices` shows empty state; billable project shows Invoices tab with empty state + Create Invoice button; non-billable project hides Invoices tab
**Depends on**: 1, 3

Add `{ title: "Invoices", url: "/invoices", icon: ReceiptIcon, adminOnly: true }` to Finance group in `lib/navigation.ts`. Add `"/invoices(.*)"` to `lib/route-access.ts`. Create `app/(dashboard)/invoices/page.tsx` with empty state: "No invoices yet. Create your first invoice from a project's Invoices tab." + "View billable projects" secondary link. Update `app/(dashboard)/projects/[id]/page.tsx`: hide `TabsTrigger value="invoices"` when `billingType === "non_billable"`, replace placeholder `TabsContent` with proper empty state using `EmptyState` component with "Create Invoice" button (non-functional until Issue 2).

---

### 5. TypeScript check + manual verification

**Type**: REVIEW
**Output**: All acceptance criteria confirmed
**Depends on**: 1, 2, 3, 4

Run `npx tsc --noEmit` — 0 errors. Verify: Settings > General Invoicing section works. `/invoices` shows empty state. Billable project shows Invoices tab with empty state. Non-billable project hides Invoices tab. `npx convex dev` deploys cleanly.

---
