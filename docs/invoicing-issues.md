# Invoicing — Issues

> Generated from `docs/invoicing-prd.md` (2026-04-15)
> Reviewed by Codex for coverage and accuracy
> 9 vertical slices, dependency-ordered

---

## Issue 1: Foundation — Schema, Org Settings UI, Navigation, Empty States

**Type**: AFK
**Blocked by**: None — can start immediately

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The foundational layer that every subsequent invoicing issue depends on. This is a schema + settings + routing slice — no invoice creation or editing logic yet.

**Schema changes** (PRD §Data Model):
- Add `invoices` table with all fields and indexes (`by_orgId`, `by_projectId`, `by_clientId`, `by_orgId_status`)
- Add `invoiceLineItems` table with all fields and `by_invoiceId` index
- Add `invoiceId: v.optional(v.id("invoices"))` to `timeEntries` schema
- Rename all `invoicedInReportId` guard checks in `convex/timeEntries.ts` to `invoiceId` (3 locations: `update`, `remove`, `bulkUpdateBillable`)
- Add `nextInvoiceNumber`, `invoicePrefix`, `defaultPaymentTermsDays` to `orgSettings` schema (all optional)

**Org Settings UI** (PRD §Org Settings — Invoicing Section):
- New "Invoicing" section in Settings > General tab
- Invoice prefix field (default `"INV-"`)
- Next invoice number field (editable number input)
- Default payment terms dropdown (Net 15 / 30 / 45 / 60 / custom number)
- Extend existing `orgSettings.update()` mutation to handle the three new fields

**Navigation** (PRD §Navigation Changes):
- Add `{ title: "Invoices", url: "/invoices", icon: ReceiptIcon, adminOnly: true }` to Finance group in `lib/navigation.ts`
- Add `"/invoices(.*)"` pattern to admin routes in `lib/route-access.ts`

**Empty states** (PRD §UX Addendum — Empty States):
- Create `/invoices` page route with empty state: "No invoices yet. Create your first invoice from a project's Invoices tab." + "View billable projects" secondary link
- Project Invoices tab: replace "coming soon" placeholder with empty state: "No invoices" + "Create Invoice" button (button is non-functional until Issue 2)
- Non-billable projects: hide Invoices tab entirely (PRD §Non-billable — No invoicing)

**Shared components** (built now, used by all subsequent issues):
- `InvoiceStatusBadge` component at `components/invoices/invoice-status-badge.tsx` — draft (gray), invoiced (blue), overdue (red/destructive), paid (green). Uses `color-mix` tinted backgrounds. Overdue replaces "Invoiced" when `status === "invoiced" && dueDate < today` (timezone-aware via `orgSettings.timezone`). (PRD §UX Addendum — Status Badge)

### How to verify

- **Manual**: Visit Settings > General → see Invoicing section → set prefix to "AF-", next number to 100, payment terms to Net 45 → save → reload → values persist. Visit `/invoices` → see empty state with link. Visit a billable project → see Invoices tab with empty state. Visit a non-billable project → Invoices tab is hidden.
- **Automated**: `npx convex dev` deploys without schema errors. `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given the `invoices` and `invoiceLineItems` tables are defined in schema, when `npx convex dev` runs, then deployment succeeds
- [ ] Given a time entry exists, when the `update` mutation is called with `invoiceId` set on the entry, then it throws "Cannot edit an invoiced time entry"
- [ ] Given the Settings page, when an admin edits invoice prefix / next number / payment terms, then the values persist after page reload
- [ ] Given a non-billable project, when viewing the project detail page, then the Invoices tab is not rendered
- [ ] Given a billable project with no invoices, when viewing the Invoices tab, then the empty state is shown with a "Create Invoice" button
- [ ] Given no invoices in the org, when visiting `/invoices`, then the empty state is shown with a "View billable projects" link

### User stories addressed

- Goal 1: Mark time as invoiced (schema foundation for `invoiceId`)
- Goal 4: Track invoice status (schema + status badge)

---

## Issue 2: T&M Invoice Creation (Path A)

**Type**: AFK
**Blocked by**: Issue 1

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The first end-to-end invoice creation flow. A user can create a T&M invoice from a project's Invoices tab, see it in the list, and confirm time entries are marked as invoiced.

**Backend** (PRD §Shared Backend, §T&M Pre-fill Logic, §Invoice Numbering, §Rounding, §Concurrency):
- `createInvoice` mutation — T&M variant accepting `{ projectId, dateRange, roundingMinutes }`:
  1. Query billable, uninvoiced entries in date range (`isBillable === true && invoiceId === undefined`)
  2. Throw `"No uninvoiced time entries found for this period."` if zero entries after server recheck
  3. Group by `(snapshotCategoryId, taskId, billableRate)` — one `lineType: "time"` line item per unique (task, rate) pair
  4. Apply rounding: sum all entry minutes per task, round the total once per rounding setting (per-task-total, not per-entry). Round to 2 decimal places for money amounts.
  5. Auto-prefill subject: `"April 2026 — Website Redesign"` (period month + project name)
  6. Set `periodStart` / `periodEnd` from min/max entry dates
  7. Auto-fill `dueDate` as `issueDate + defaultPaymentTermsDays` (from orgSettings, default 30)
  8. Read and increment `nextInvoiceNumber` atomically (Convex OCC). Format: `{prefix}{number}` zero-padded to 3 digits minimum. Numbers never recycle on delete.
  9. Set `invoiceId` on all included time entries
  10. Denormalize `clientId` and `currency` from project/client
- `getInvoicePreview` query — returns computed totals (total time + total billed) for the modal live preview, reacting to date range and rounding changes

**UI — CreateInvoiceModal** (PRD §CreateInvoiceModal UI Guidelines, §UX Addendum — Feedback & States):
- Modal width `max-w-lg`, sections in bordered cards with `p-6` and `gap-6`
- **Period card**: Horizontal pill/chip row for presets (`All uninvoiced` default, `This month`, `Previous month`, `Custom`). Active preset filled, others outline. Below: side-by-side Start/End date pickers (disabled when non-Custom preset, enabled for Custom).
- **Options card**: Rounding dropdown (Don't round / 5 min / 15 min / 30 min / 1 hour). Info icon tooltip: "Rounding only affects hours on this invoice. Original tracked time is not modified."
- **Preview card**: Visually distinct (muted bg). Shows Total Time + Total Billed. States: loading (pulsing placeholders), zero entries (`"0.0h"` + zero amounts + `"No billable time found for this period."` + CTA disabled), has data (values + CTA enabled).
- **CTA**: Full-width primary button `h-12` "Create Invoice". Spinner + disabled on click. Success: close modal → `router.push("/invoices/[id]")` → `toast.success("Invoice created")`. Failure: modal stays open, inline error below CTA.

**UI — Project Invoices Tab** (PRD §Project Invoices Tab, §Design Review — MetricCards):
- Wire the "Create Invoice" button to open `CreateInvoiceModal`
- T&M MetricCards: `Total Invoiced` (currency sum) + `Uninvoiced` (currency sum of `Σ unbilled hours × rate`)
- `InvoiceList` component (reusable table): columns for Number, Subject, Client, Billing Type badge, Status badge, Total, Issue Date, Due Date. Row click navigates to `/invoices/[id]`. Shared between project tab and global page (Issue 7). Prop: `projectId?` filters when present.
- `listInvoices` query — by project, returns invoices with computed fields

### How to verify

- **Manual**: Go to a T&M project with tracked billable time → Invoices tab → see MetricCards (Uninvoiced shows amount) → click "Create Invoice" → modal opens → select date range → preview updates → change rounding → preview updates → click Create → redirected to `/invoices/[id]` (404 is OK — editor is Issue 3) → back to Invoices tab → invoice appears in list → Uninvoiced MetricCard decreased → check time entries: they now have `invoiceId` set.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a T&M project with 5 billable uninvoiced entries, when creating an invoice with "All uninvoiced" preset, then all 5 entries get `invoiceId` set and 5 line items are created grouped by (task, rate)
- [ ] Given entries with different rates for the same task, when creating an invoice, then separate line items are created per rate
- [ ] Given "Round to 15 min" selected and a task with 22 total minutes, when creating, then the line item shows 0.5h (30 min rounded up)
- [ ] Given no uninvoiced entries in the selected date range, when clicking Create, then an inline error appears: "No uninvoiced time entries found for this period."
- [ ] Given the live preview, when changing the date range preset, then Total Time and Total Billed update reactively
- [ ] Given the first invoice created for an org with default settings, when the invoice is created, then its number is `INV-001` and `nextInvoiceNumber` is incremented to 2
- [ ] Given an invoice is deleted later, when a new invoice is created, then the number is NOT reused (gap remains)

### User stories addressed

- Goal 1: Mark time as invoiced (entries get `invoiceId`)
- Goal 2: Generate invoice drafts from tracked time (T&M pre-fill)
- Goal 3: Task-level delivery report (grouped by category > task)

---

## Issue 3: T&M Invoice Editor

**Type**: AFK
**Blocked by**: Issue 2

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The full-page document-style invoice editor. After creating a T&M invoice, the user lands here and can view, edit, and save the invoice document. This issue builds the editor shell used by all billing types — subsequent issues (5, 6) add type-specific rendering.

**Backend** (PRD §Data Model, §Editable Snapshot Model):
- `getInvoice` query — returns full invoice with line items (grouped by `workCategoryId` for category headers), project info, client info, org settings (brand fields). Single query, props down.
- `updateInvoice` mutation — patches draft invoice fields: `subject`, `issueDate`, `dueDate`, `note`. Throws if status is not `"draft"`.
- `updateInvoiceLineItem` mutation — patches a single line item: `description`, `quantity` (hours), `unitPrice` (rate), `amount`. Auto-computes `amount = quantity × unitPrice` unless user overrides. Recalculates invoice `subtotal` and `total`. Throws if invoice status is not `"draft"`.
- `addInvoiceLineItem` mutation — adds a `lineType: "manual"` row to the invoice. Appends to end (`sortOrder`). Throws if not draft.
- `removeInvoiceLineItem` mutation — removes a line item. Recalculates totals. Throws if not draft.

**UI — Editor Page** (`/invoices/[id]`) (PRD §Invoice Editor Page, §UX Addendum — Layout, Routing):
- Two-column layout: container `max-w-6xl`, left "paper" `flex-1` (~65-70%), right sidebar `w-80` sticky. Below `lg` breakpoint: stacked (document first, sidebar second).
- Contextual back link: reads `?from=project&projectId=[id]&tab=invoices` params. Back arrow uses params; breadcrumb always `Invoices > INV-003`. Direct visit (no `?from=`): back arrow → `/invoices`.

**UI — Invoice Document** (PRD §Invoice Editor — Left Column, §Editable Snapshot Model):
- **Subject**: editable text input (auto-prefilled at creation, editable in draft)
- **FROM / TO** (`InvoiceParties`): agency info (from orgSettings brand fields) and client info (from client record). Read-only on the invoice — missing fields show muted "No address set" placeholder. Not editable here — edit in Settings / Client page.
- **Invoice meta**: invoice number (read-only, formatted `{prefix}{number}`), issue date (date picker), due date (date picker)
- **Work breakdown** (`InvoiceWorkBreakdown` with `showAmounts={true}`): category headers (name + subtotal hours) → task rows (description, hours, rate, amount). All fields editable in draft. `amount` auto-computes as `hours × rate` but can be manually overridden. Category subtotals auto-recompute from child rows.
- **"+ Add line item"**: adds a manual row to the work breakdown
- **Totals**: subtotal + total at the bottom

**UI — Sidebar** (`InvoiceSidebar`) (PRD §Invoice Editor — Right Column):
- Status + `InvoiceStatusBadge`
- Amount (computed)
- Issue Date (display)
- Due Date (display)
- Note (textarea, editable in draft)
- Action buttons placeholder (wired in Issue 4)

### How to verify

- **Manual**: Create a T&M invoice (from Issue 2) → redirected to editor → see document with FROM/TO, invoice number, work breakdown with category > task rows showing hours/rate/amount → edit a task description → saved → edit hours → amount recalculates → manually override amount → stays overridden → add a manual line item → appears at bottom → remove it → gone → edit subject, issue date, due date, note → all persist on reload → sidebar shows correct status and amount.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a draft T&M invoice, when viewing the editor, then the document shows FROM (agency info), TO (client info), invoice number, issue/due dates, and work breakdown with hours/rate/amount columns
- [ ] Given a draft invoice, when editing a line item's hours from 10.0 to 12.0, then the amount auto-recalculates as `12.0 × rate` and the invoice total updates
- [ ] Given a draft invoice, when manually overriding an amount, then it stays at the overridden value (does not revert to `hours × rate`)
- [ ] Given a draft invoice, when clicking "+ Add line item", then a new manual row appears at the bottom with editable description, hours, rate, amount
- [ ] Given a draft invoice, when editing the subject/issue date/due date/note, then changes persist after page reload
- [ ] Given missing brand info (e.g. no address), when viewing FROM section, then muted "No address set" placeholder text is shown
- [ ] Given navigation from a project (`?from=project&projectId=X`), when clicking the back arrow, then the user returns to `/projects/X?tab=invoices`
- [ ] Given a direct visit to `/invoices/[id]` (no `?from=`), when clicking the back arrow, then the user returns to `/invoices`
- [ ] Given the editor on a screen below `lg`, then the layout stacks: document first, sidebar second

### User stories addressed

- Goal 2: Generate invoice drafts from tracked time (view + edit the draft)
- Goal 3: Task-level delivery report (work breakdown by category > task)

---

## Issue 4: Invoice Lifecycle — Status Transitions, Read-Only Mode, Delete

**Type**: AFK
**Blocked by**: Issue 3

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The invoice status state machine and delete flow. This is billing-type-agnostic — it works identically for T&M, Fixed, and Retainer invoices.

**Backend** (PRD §Invoice Lifecycle, §Delete Flow):
- `changeInvoiceStatus` mutation — transitions:
  - `draft → invoiced`: sets status, no validation blocker
  - `invoiced → paid`: sets status + `paidAt` timestamp
  - `invoiced → draft`: revert (re-enables editing)
  - `paid → invoiced`: revert (clears `paidAt`)
- `deleteInvoice` mutation:
  - Clears `invoiceId` from all linked time entries (they become unbilled again)
  - Drafts: delete freely
  - Finalized (invoiced/paid): allowed (revert to draft first is recommended but not enforced server-side)
  - Retainer LIFO guard: checked server-side — if a later finalized retainer invoice exists for the same project, throw error. Error message: `"Delete the [Month Year] invoice first."` (See Issue 6 for full retainer guard implementation; this issue adds the generic delete + entry unlinking.)

**UI — Status transitions** (PRD §UX Addendum — Graduated Friction):
- Wire sidebar action buttons:
  - Draft: "Mark as Invoiced" (Primary button) → `ConfirmDialog`: "This will lock the invoice for editing. You can revert to draft later if corrections are needed."
  - Invoiced: "Mark as Paid" (Secondary/outline) → **No confirmation dialog**. Toast: "Invoice marked as paid"
  - Invoiced: "Revert to Draft" (Ghost, muted) → `ConfirmDialog`: "This will unlock the invoice for editing."
  - Paid: "Revert to Invoiced" (Ghost, muted) → `ConfirmDialog`: "This will mark the invoice as unpaid."
  - All states: "Delete Invoice" (Destructive) → `ConfirmDialog` (destructive variant). LIFO guard failure: `toast.error("Delete the [Month Year] invoice first.")`, dialog closes, user stays on page.

**UI — Read-only mode** (PRD §UX Addendum — Read-Only Mode):
- When `status !== "draft"`: all document fields render as **non-focusable static elements** (not disabled inputs). No hover/focus affordances — text looks printed.
- Status banner at top of document: `"This invoice is locked. Revert to draft to make changes."` — informational style, muted background.
- Sidebar: edit-related controls removed entirely (not disabled). Action buttons reflect available transitions only.
- "No disabled opacity" rule applies to **document area only**. Sidebar buttons use standard disabled styling when appropriate.

**UI — Post-delete navigation** (PRD §UX Addendum — Routing):
- `router.replace()` based on `?from=` params: if `from=project` → `/projects/[projectId]?tab=invoices`, otherwise → `/invoices`
- `toast.success("Invoice deleted")`

**UI — First-time brand info nudge** (PRD §"Mark as Invoiced" — No Blocker):
- When this is the org's first invoice AND brand info is incomplete: show inline banner at top of editor: "Complete your agency details in Settings for professional invoices." Link to settings. Dismissable (dismiss persists for the session or via local state).

### How to verify

- **Manual**: Open a draft T&M invoice → click "Mark as Invoiced" → confirm dialog → invoice becomes read-only (static text, locked banner, no edit affordances) → click "Mark as Paid" → no dialog, toast appears → status is Paid → "Revert to Invoiced" → confirm → status back to Invoiced → "Revert to Draft" → confirm → editable again → "Delete Invoice" → confirm → redirected to project invoices tab → toast "Invoice deleted" → time entries are unbilled again (check Uninvoiced MetricCard increased).
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a draft invoice, when clicking "Mark as Invoiced" and confirming, then the invoice status becomes `"invoiced"` and all fields are read-only (static elements, not disabled inputs)
- [ ] Given an invoiced invoice, when clicking "Mark as Paid", then NO confirmation dialog appears, a toast shows "Invoice marked as paid", and `paidAt` is set
- [ ] Given a paid invoice, when clicking "Revert to Invoiced" and confirming, then status becomes `"invoiced"` and `paidAt` is cleared
- [ ] Given an invoiced invoice, when clicking "Revert to Draft" and confirming, then the invoice becomes editable again
- [ ] Given an invoiced invoice, when viewing the editor, then a locked banner appears: "This invoice is locked. Revert to draft to make changes."
- [ ] Given a read-only invoice, then edit controls are removed (not shown as disabled) and document text has no hover/focus affordances
- [ ] Given a draft invoice with linked time entries, when deleting the invoice, then all linked entries have `invoiceId` cleared and become available for future invoicing
- [ ] Given navigation from a project, when deleting an invoice, then `router.replace` goes to `/projects/[id]?tab=invoices` with a success toast
- [ ] Given the org's first invoice with incomplete brand info, then an inline banner appears linking to settings

### User stories addressed

- Goal 4: Track invoice status (draft → invoiced → paid)
- Goal 1: Mark time as invoiced (delete clears `invoiceId`)

---

## Issue 5: Fixed Fee Invoice — Creation + Editor

**Type**: AFK
**Blocked by**: Issue 4

### Parent PRD

`docs/invoicing-prd.md`

### What to build

End-to-end Fixed Fee invoice flow: creation modal, editor rendering with work report + billing summary card, and project tab MetricCards.

**Backend** (PRD §Fixed Fee Pre-fill Logic, §Shared Backend):
- Extend `createInvoice` mutation — Fixed variant accepting `{ projectId, dateRange, roundingMinutes }`:
  1. Calculate already invoiced: `Σ amounts` from existing `lineType: "fixed"` line items on this project's invoices
  2. Generate one `lineType: "fixed"` line item: description = project name, quantity = 1, unitPrice = `fixedPrice - alreadyInvoiced` (remaining balance), amount = unitPrice
  3. Query uninvoiced billable entries in date range for work breakdown → generate `lineType: "time"` line items (hours only, no rate/amount billing — these are for the delivery report)
  4. Apply rounding to work breakdown hours (per-task-total rounding). Rounding affects hours only — billing amount is the fixed fee, unaffected.
  5. Auto-prefill subject: `"Website Redesign"` (project name only)
  6. Set `invoiceId` on all uninvoiced billable entries in the period
  7. Same numbering, due date, and atomicity logic as T&M

**UI — CreateInvoiceModal (Fixed)** (PRD §Modal Content — Fixed):
- Same layout as T&M modal (preset chips + date pickers + rounding)
- Preview card: Total Time + Billing Amount (the fixed fee line item amount)
- Same feedback states (loading, zero entries, success/failure)

**UI — Editor (Fixed)** (PRD §Fixed Fee — Work Report + Billing Summary Card, §Unified Work Breakdown):
- Work breakdown with `showAmounts={false}`: category > task rows with hours only (no rate/amount columns). Editable in draft (descriptions, hours). Category headers show subtotal hours. No "+ Add line item" in the work report.
- `InvoiceBillingSummary` card below work breakdown: visually distinct card showing the fixed fee line item (description + amount, editable in draft) + total. "+ Add line item" on the billing summary card for manual rows (e.g. "Domain registration") using `lineType: "manual"`.
- Fixed-specific computed rule: editing hours updates category subtotals but does NOT affect the billing summary card amount.

**UI — Sidebar (Fixed)** (PRD §Invoice Editor — Sidebar):
- Fixed fee progress: `"Invoiced: €5,000 / €10,000 (50%)"` — agency-only tracking, not on the document. Shows sum of all fixed-fee invoices for this project vs. `fixedPrice`.

**UI — Project Invoices Tab (Fixed)** (PRD §Design Review — MetricCards):
- Fixed MetricCards: `Invoiced` (currency sum, subline: `{pct}% of {fixedPrice}`) + `Remaining` (currency: `fixedPrice - invoiced`)

### How to verify

- **Manual**: Go to a Fixed project (fixedPrice €10,000) with tracked time → Invoices tab → MetricCards show Invoiced €0 / Remaining €10,000 → Create Invoice → modal shows date range + preview (Total Time + Billing Amount €10,000) → Create → editor shows work report (hours only, no rate/amount) + billing summary card (€10,000) → edit billing amount to €5,000 (milestone billing) → save → sidebar shows "Invoiced: €5,000 / €10,000 (50%)" → create second invoice → remaining pre-fills to €5,000.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a Fixed project with fixedPrice €10,000 and no existing invoices, when creating an invoice, then the fixed fee line item pre-fills with €10,000
- [ ] Given a Fixed project with €5,000 already invoiced, when creating a new invoice, then the fixed fee pre-fills with €5,000 (remaining balance)
- [ ] Given a Fixed invoice editor, then the work breakdown shows hours-only columns (no rate/amount) and no "+ Add line item" in the work report
- [ ] Given a Fixed invoice editor, then the billing summary card shows the fixed fee amount, a total, and "+ Add line item" for manual rows
- [ ] Given a Fixed draft invoice, when editing task hours, then category subtotals update but the billing summary card amount stays unchanged
- [ ] Given the sidebar on a Fixed invoice, then it shows `"Invoiced: €X / €Y (Z%)"` progress
- [ ] Given the Fixed project Invoices tab, then MetricCards show `Invoiced` with percentage subline and `Remaining` with currency amount
- [ ] Given Fixed invoice entries, then all billable entries in the period have `invoiceId` set (universal semantics — "accounted for", not "billed at entry level")

### User stories addressed

- Goal 2: Generate invoice drafts from tracked time (Fixed pre-fill with remaining balance)
- Goal 3: Task-level delivery report (work report with hours)

---

## Issue 6: Retainer Invoice — Creation + Editor + Balance Chaining

**Type**: AFK
**Blocked by**: Issue 4

### Parent PRD

`docs/invoicing-prd.md`

### What to build

End-to-end Retainer invoice flow: monthly creation with balance derivation, editor with balance section and overage, LIFO deletion guard, and project tab MetricCards. This is the most complex single slice due to balance chaining and overage logic being deeply coupled.

**Backend** (PRD §Retainer Pre-fill Logic, §Balance Tracking, §Concurrency & Safety):
- Extend `createInvoice` mutation — Retainer variant accepting `{ projectId, retainerMonth, roundingMinutes }`:
  1. **Duplicate guard**: Check for existing invoice (draft OR finalized) for this project-month. Throw `"An invoice for [Month Year] already exists."` if found. One invoice per project-month regardless of status.
  2. Get month data from `getRetainerData` for the selected month
  3. **Balance derivation** (server-side, single transaction): query latest finalized retainer invoice for this project where `periodEnd < thisMonth`, ordered by `periodEnd` DESC. Use its `retainerEndBalanceMinutes` as starting balance. If none → 0.
  4. Generate work breakdown `lineType: "time"` line items from billable entries (hours only, per-task-total rounding)
  5. Compute: `usedMinutes = Σ rounded task hours`, `endBalance = start + included - used`
  6. **Overage logic**: When `endBalance < 0`:
     - Rollover OFF: overage on any month with negative balance
     - Rollover ON: overage only on cycle-closing invoice (mid-cycle deficit may recover)
  7. `lineType: "retainer_fee"` — snapshot of `project.monthlyFee`
  8. If overage: `lineType: "overage"` — `|endBalance| / 60 × overageRate`
  9. Snapshot all balance fields (`retainerStartBalanceMinutes`, `retainerIncludedMinutes`, `retainerUsedMinutes`, `retainerEndBalanceMinutes`) and rate fields (`retainerMonthlyFee`, `retainerOverageRate`) on the invoice
  10. Set `periodStart` / `periodEnd` from month boundaries
  11. Set `invoiceId` on all billable entries in the month
  12. Auto-prefill subject: `"March 2026 — Ongoing Support"` (invoiced month + project name)

- **LIFO deletion guard** (PRD §LIFO Deletion Guard): Extend `deleteInvoice` mutation — for retainer invoices, query `any finalized retainer invoice for this project WHERE periodStart > thisInvoice.periodEnd`. If found → throw with message: `"Delete the [Month Year] invoice first."` Drafts can always be deleted regardless.

**UI — CreateInvoiceModal (Retainer)** (PRD §Modal Content — Retainer):
- Month dropdown: lists closed, uninvoiced months from `getRetainerData`. Single select, one month per invoice.
- Rounding dropdown (same options as T&M/Fixed)
- Preview card: Total Time + Retainer Fee + Overage (if any) + Total
- Same feedback states. CTA disabled until month is selected.

**UI — Editor (Retainer)** (PRD §Retainer — Monthly Billing, §Editable Snapshot Model):
- Work breakdown with `showAmounts={false}`: category > task rows with hours only. Editable in draft.
- `InvoiceBillingSummary` card with two sections:
  - **Balance section**: Starting balance → Included → Used → Ending balance
  - **Billing lines**: Retainer fee + Overage (if any) + Total
  - `"+ Add line item"` on the billing summary card for manual rows
- **Balance auto-recalculation**: when hours are edited in draft, `usedMinutes = Σ work breakdown hours` recalculates → ending balance updates → overage updates. Snapshot fields (`startingBalance`, `includedMinutes`, `retainerFee`, `overageRate`) stay frozen.

**UI — Project Invoices Tab (Retainer)** (PRD §Design Review — MetricCards):
- Retainer MetricCards: `Total Invoiced` (currency sum, subline: `{n} invoices`) + `Uninvoiced Months` (count, subline: month names or "All caught up")

### How to verify

- **Manual**: Go to a Retainer project (40h/month, €5,000/month, €75/h overage) with a closed month having 42h tracked → Invoices tab → MetricCards show 1 Uninvoiced Month → Create Invoice → month dropdown shows closed months → select month → preview shows 42.0h, €5,000 fee, €150 overage (2h × €75), €5,150 total → Create → editor shows work report + balance (0h start, 40h included, 42h used, -2h ending) + billing card (fee + overage + total) → edit a task from 18h to 16h → used drops to 40h → ending balance becomes 0h → overage disappears → save. Create a second month's invoice → starting balance = ending balance from first. Try to delete the first invoice while second exists (finalized) → LIFO blocked with toast error.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a Retainer project with a closed, uninvoiced month, when creating an invoice, then the balance section shows correct starting/included/used/ending values
- [ ] Given no previous retainer invoices, then starting balance is 0
- [ ] Given a previous finalized retainer invoice with ending balance of -120 minutes, then the next invoice's starting balance is -120 minutes
- [ ] Given rollover OFF and a month with negative ending balance, then an overage line item is created
- [ ] Given rollover ON and a mid-cycle month with negative ending balance, then NO overage line item is created (deficit may recover)
- [ ] Given rollover ON and the cycle-closing month with negative ending balance, then an overage line item IS created
- [ ] Given a draft retainer invoice, when editing task hours in the work breakdown, then `usedMinutes` recalculates, ending balance updates, and overage adjusts accordingly
- [ ] Given editing task hours, then `startingBalance`, `includedMinutes`, `retainerFee`, `overageRate` remain unchanged (frozen snapshot values)
- [ ] Given an existing invoice (draft or finalized) for March 2026, when trying to create another for March 2026, then the mutation throws: "An invoice for March 2026 already exists."
- [ ] Given two finalized retainer invoices (Jan, Feb), when trying to delete the Jan invoice, then the mutation throws: "Delete the February 2026 invoice first."
- [ ] Given a draft retainer invoice, when deleting it, then LIFO guard does NOT apply (drafts always deletable)
- [ ] Given the Retainer project Invoices tab, then MetricCards show `Total Invoiced` with count subline and `Uninvoiced Months` with month names or "All caught up"

### User stories addressed

- Goal 1: Mark time as invoiced (entries get `invoiceId`, balance chaining prevents double-billing)
- Goal 2: Generate invoice drafts from tracked time (retainer pre-fill with balance)
- Goal 3: Task-level delivery report (work report + balance section)

---

## Issue 7: Global Invoices Page

**Type**: AFK
**Blocked by**: Issue 4

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The org-wide `/invoices` list page with metric cards, filters, status tabs, and the "Ready to invoice" action card for retainer projects.

**Backend** (PRD §Global Invoices Page):
- `listAllInvoices` query — returns all invoices for the org with filters: status tab, client dropdown, project dropdown, search (by invoice number or subject). Includes denormalized client name, project name, billing type for display. Paginated or full list depending on scale.
- `getReadyToInvoice` query — returns closed, uninvoiced retainer months across all projects. Each row: client info (avatar, name), project name, month(s), monthly fee.
- `getInvoiceMetrics` query — returns counts and sums for the 4 metric cards: Draft (count + sum), Outstanding (invoiced AND dueDate >= today), Overdue (invoiced AND dueDate < today), Paid This Month (paid AND paidAt in current month). Outstanding and Overdue are mutually exclusive. Uses `orgSettings.timezone` for today comparison.

**UI — `/invoices` page** (PRD §Global Invoices Page, §UX Addendum — Metric Cards):
- Replace the empty state (from Issue 1) with the full page when invoices exist
- **"Ready to invoice" action card**: collapsible card above metric cards. Each row: client avatar + name, project name, month, monthly fee. "Create" button per row opens `CreateInvoiceModal` pre-filled for that month. Card disappears when all retainer months are invoiced. Retainer-only (T&M/Fixed have no calendar-driven nudge).
- **4 MetricCards**: Draft (default variant), Outstanding (default), Overdue (destructive variant), Paid This Month (default)
- **Status tabs**: All | Draft | Invoiced | Paid — stored in URL param `?status=draft`. Reuses existing tab pattern.
- **Filters**: Client dropdown, Project dropdown, search input (by invoice number/subject)
- **Invoice table**: reuse `InvoiceList` component from Issue 2. Columns: Number, Subject, Client, Project, Billing Type badge, Status badge, Total, Issue Date, Due Date. Row click → `/invoices/[id]`.

### How to verify

- **Manual**: Create several invoices (draft, invoiced, paid) across multiple projects and clients → visit `/invoices` → metric cards show correct counts/sums → click "Draft" tab → only drafts shown → search by invoice number → filters work → click a row → navigated to editor → create a retainer project with a closed uninvoiced month → "Ready to invoice" card appears with the month → click Create → modal opens pre-filled → mark an invoiced invoice as overdue (set dueDate to past) → Overdue card appears with red/destructive styling, Outstanding card count decreases.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given invoices across multiple projects, when visiting `/invoices`, then all invoices for the org are listed
- [ ] Given the status tabs, when clicking "Draft", then URL updates to `?status=draft` and only draft invoices are shown
- [ ] Given filters, when selecting a client, then only that client's invoices appear
- [ ] Given the search input, when typing "INV-003", then matching invoices are filtered
- [ ] Given 2 draft invoices totaling €3,000, then the Draft MetricCard shows count 2 and sum €3,000
- [ ] Given 1 invoiced invoice with dueDate in the past, then it appears in the Overdue card (destructive) and NOT in the Outstanding card
- [ ] Given 1 invoiced invoice with dueDate in the future, then it appears in Outstanding and NOT in Overdue
- [ ] Given a paid invoice with `paidAt` in the current month, then it appears in Paid This Month
- [ ] Given a retainer project with a closed uninvoiced month, then the "Ready to invoice" card shows the month with a Create button
- [ ] Given all retainer months are invoiced, then the "Ready to invoice" card is hidden

### User stories addressed

- Goal 4: Track invoice status (org-wide view with filtering)

---

## Issue 8: Path B — T&M Time Tab Checkbox Selection

**Type**: AFK
**Blocked by**: Issue 3

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The Time tab checkbox selection flow for T&M projects. Users select specific time entries and create an invoice from the selection.

**Backend** (PRD §Path B, §Shared Backend):
- Extend `createInvoice` mutation to accept `{ projectId, timeEntryIds }` — T&M variant from selected entries. Same grouping/line-item logic as Path A but using explicit entry IDs instead of date range. Rounding is available in the editor after creation (not in this flow's entry point).

**UI — Time Tab** (PRD §Project Detail — Time Tab, §UX Addendum — Empty States):
- T&M projects: show checkboxes on billable + uninvoiced entries. Already-invoiced and non-billable entries are not selectable.
- Each entry row shows a billing status badge: if invoiced → links to the invoice (`/invoices/[id]`)
- Selection toolbar: appears when entries are selected — shows count + total hours + "Create Invoice from Selected" button
- Click "Create Invoice from Selected" → `createInvoice` with `timeEntryIds` → navigate to `/invoices/[id]` → toast success
- Fixed / Retainer projects: read-only time log, no checkboxes. Shows which entries are invoiced and which invoice they belong to.
- Empty state (zero uninvoiced entries): inline banner "All billable time has been invoiced." + "View invoices" link → switches to Invoices tab
- Filters: member, billing status, search

### How to verify

- **Manual**: Go to a T&M project Time tab → see entries with checkboxes (only billable + uninvoiced) → check 3 entries → toolbar shows "3 entries, 4.5h" + "Create Invoice from Selected" → click → invoice created → redirected to editor → only selected entries appear as line items → back to Time tab → those 3 entries now show "Invoiced" badge linking to the invoice → remaining entries still have checkboxes. Switch to a Fixed project Time tab → no checkboxes, entries show invoiced/uninvoiced badges.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a T&M project Time tab, then only billable + uninvoiced entries have checkboxes
- [ ] Given a T&M project Time tab with an invoiced entry, then it shows a billing status badge that links to the invoice
- [ ] Given 3 entries selected, then the selection toolbar shows count (3), total hours, and "Create Invoice from Selected" button
- [ ] Given entries selected, when clicking "Create Invoice from Selected", then an invoice is created with those specific entries as line items and the user is navigated to the editor
- [ ] Given a Fixed or Retainer project Time tab, then no checkboxes are shown
- [ ] Given all billable time is invoiced, then an inline banner shows "All billable time has been invoiced." with a "View invoices" link
- [ ] Given a T&M Time tab, then filters for member, billing status, and search are available

### User stories addressed

- Goal 2: Generate invoice drafts from tracked time (cherry-pick specific entries)

---

## Issue 9: Path C — Retainer Overview "Invoice This Month"

**Type**: AFK
**Blocked by**: Issue 6

### Parent PRD

`docs/invoicing-prd.md`

### What to build

The "Invoice this month" button on closed retainer month cards in the project overview, plus the cycle-end banner.

**UI — Retainer Overview** (PRD §Path C, §Project Detail — Overview Tab):
- Per-month cards in the retainer overview: closed, uninvoiced months show an "Invoice this month" button
- Click → opens `CreateInvoiceModal` pre-filled for that month (same as Path A retainer modal from Issue 6)
- Already-invoiced months: button is hidden or replaced with a link to the invoice
- Cycle-end banner: when a cycle closes, show a banner prompting invoicing

**UI — Overview Tab MetricCards** (PRD §Project Detail — Overview Tab):
- T&M: "Uninvoiced" metric card shows `Σ(unbilled hours × billableRate)` — update to use `invoiceId` presence instead of any prior placeholder logic
- Fixed: "Invoiced" metric shows `Σ invoiced / fixedPrice` — wire to real invoice data
- Retainer: overview already exists; this issue adds the "Invoice this month" button interaction

### How to verify

- **Manual**: Go to a Retainer project Overview → see month cards → closed uninvoiced month shows "Invoice this month" button → click → `CreateInvoiceModal` opens pre-filled for that month → create invoice → button disappears from that month card (or shows link to invoice). Check cycle-end banner appears when a cycle closes.
- **Automated**: `npx tsc --noEmit` passes.

### Acceptance criteria

- [ ] Given a Retainer project overview with a closed, uninvoiced month, then the month card shows an "Invoice this month" button
- [ ] Given clicking "Invoice this month", then the `CreateInvoiceModal` opens pre-filled with that month selected
- [ ] Given an already-invoiced month, then the "Invoice this month" button is not shown
- [ ] Given a T&M project overview, then the "Uninvoiced" MetricCard reflects actual uninvoiced time (entries without `invoiceId`)
- [ ] Given a Fixed project overview, then the "Invoiced" MetricCard reflects actual invoiced amounts from invoice line items

### User stories addressed

- Goal 2: Generate invoice drafts from tracked time (retainer monthly shortcut)

---

## Dependency Graph

```
Issue 1 (Foundation)
  └── Issue 2 (T&M Creation)
        └── Issue 3 (T&M Editor)
              ├── Issue 8 (Path B: T&M Checkbox) 
              └── Issue 4 (Lifecycle)
                    ├── Issue 5 (Fixed Fee) ─────── can run in parallel
                    ├── Issue 6 (Retainer) ──────── can run in parallel
                    │     └── Issue 9 (Path C: Retainer Overview)
                    └── Issue 7 (Global Page) ───── can run in parallel
```

**Parallel opportunities after Issue 4**: Issues 5, 6, and 7 are independent and can be implemented concurrently. Issue 8 can start as soon as Issue 3 is done (doesn't need lifecycle). Issue 9 depends only on Issue 6.
