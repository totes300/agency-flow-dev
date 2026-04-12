# Invoicing — PRD

> Last updated: 2026-04-12
> Status: Validated through Bonsai/Harvest research + design grilling session

---

## What This Is About

Agency Flow tracks time and costs. Invoicing closes the loop: it lets agency owners generate pro-forma invoices (internal billing summaries) from tracked time, then export to their accounting system (Billingo, Számlázz.hu, etc.) for the official invoice.

**This is NOT a full invoicing system.** It's an internal billing summary tool that doubles as a delivery report for clients. No tax calculation, no online payments, no PDF generation in v1. The official invoice lives in the external accounting system.

### Goals

1. **Mark time as invoiced** — prevent double-billing, know what's been billed
2. **Generate invoice drafts from tracked time** — pre-filled line items per project type
3. **Task-level delivery report on every invoice** — the client sees what they're paying for
4. **Track invoice status** — draft / invoiced (in accounting system) / paid

---

## Design Decisions (Validated)

These decisions were validated through competitive research (Bonsai, Harvest, Clockify, ClickUp) and a design grilling session with interactive Q&A.

### Core Principles

| Decision | Rationale |
|---|---|
| Invoice = **snapshot** | Once generated, line items are copies. Editing a time entry does NOT update the invoice. |
| Time entries stay **editable** after invoicing | Industry standard. The invoice is the historical record, not the entry. |
| Invoice → Project is **many:1** | Many invoices per project (T&M per period, Fixed per milestone, Retainer per month). One invoice always belongs to one project. No multi-project invoices. |
| **Pro-forma only** | No tax, no PDF generation, no online payments. Export to accounting system for the real invoice. |
| **No automation** | No auto-generated invoices. The system suggests/pre-fills, the user reviews and creates. |
| **Full-page document-style editor** | Like Bonsai — FROM/TO section, line items table, sidebar. Professional look even for pro-forma. |
| **Three creation paths** | Path A: Invoices tab modal. Path B: Time tab checkbox select (T&M only). Path C: "Invoice this month" button on retainer overview. |

---

## Invoice Creation Flows

### Path A — Invoices Tab → Modal → Editor

**Entry point:** "Create Invoice" button on the project Invoices tab. Available for all billable project types.

**Flow:**
1. Click "Create Invoice"
2. `CreateInvoiceModal` opens — content varies by billing type (see below)
3. Click "Create" → mutation creates invoice + line items → navigate to `/invoices/[id]`

#### Modal Content by Billing Type

**T&M:**
- Date range presets: All uninvoiced (default) / This month / Previous month / Custom date range
- Rounding dropdown: Don't round / 5 min / 15 min / 30 min / 1 hour
- Rounding tooltip (info icon): "Rounding only affects hours on this invoice. Original tracked time is not modified."
- Live preview: Total Time + Total Billed (reacts to date range and rounding changes)

**Fixed:**
- Date range presets: All uninvoiced (default) / This month / Previous month / Custom date range
- Rounding dropdown: same options as T&M
- Rounding tooltip: same as T&M
- Live preview: Total Time + Billing Amount

**Retainer:**
- Month dropdown: lists closed, uninvoiced months from `getRetainerData`. One month per invoice (no multi-select).
- Rounding dropdown: same options as T&M
- Rounding tooltip: same as T&M
- Live preview: Total Time + Retainer Fee + Overage (if any) + Total

### Path B — Time Tab → Checkbox Select → Editor (T&M only)

**Entry point:** "Create Invoice from Selected" button on the project Time tab.

**Flow:**
1. Time tab shows entries with checkboxes (only billable, uninvoiced entries are selectable)
2. User checks entries to include
3. Click "Create Invoice from Selected"
4. Mutation creates invoice from selected entry IDs → navigate to `/invoices/[id]`
5. Rounding available in the editor after creation

**T&M only.** Fixed and Retainer projects do not have checkboxes on the Time tab.

### Path C — Retainer Overview → "Invoice This Month" → Editor

**Entry point:** "Invoice this month" button on closed month cards in the retainer overview.

**Flow:**
1. Retainer overview shows per-month cards with balance data
2. Closed, uninvoiced months show "Invoice this month" button
3. Click → opens `CreateInvoiceModal` pre-filled for that month (same as Path A retainer modal)
4. Click "Create" → mutation creates invoice → navigate to `/invoices/[id]`

### Shared Backend

All paths call the same `createInvoice` mutation. It accepts:
- `{ projectId, dateRange, roundingMinutes }` — Path A (T&M, Fixed)
- `{ projectId, timeEntryIds }` — Path B (T&M checkbox)
- `{ projectId, retainerMonth, roundingMinutes }` — Path A/C (Retainer)

---

## Rounding

Per-invoice, chosen during creation (modal). Only applies to line item quantities — original time entries are never modified.

### Options

| Setting | Behavior |
|---|---|
| Don't round | Exact tracked time on line items |
| Round to next 5 minutes | Round up to nearest 5-min block |
| Round to next 15 minutes | Round up to nearest 15-min block |
| Round to next 30 minutes | Round up to nearest 30-min block |
| Round to next hour | Round up to nearest hour |

No "Round to 1 minute" option — entries are already stored as integer minutes.

### Rounding Rule

One rule, no user-facing options: **round per task line item total.** Sum all entries for a task, then round the total once. Not per-entry rounding — simpler, less total inflation.

### Rounding Applies to All Billing Types

| Type | What rounding affects |
|---|---|
| **T&M** | Work breakdown hours AND billing amounts (`roundedHours × rate = amount`) |
| **Fixed** | Work breakdown hours only. Billing amount is user-set fixed fee. |
| **Retainer** | Work breakdown hours AND balance section. `usedMinutes = Σ rounded task hours`. Balance and overage computed from rounded values. |

**Retainer rounding rationale:** The invoice is a snapshot document. If the user chooses to round, the entire invoice (work breakdown + balance + overage) uses rounded values for internal consistency. The retainer engine continues tracking exact minutes for the overview page. Invoices form their own billing ledger, separate from the engine.

### UX

- **Tooltip** on rounding dropdown (info icon): "Rounding only affects hours on this invoice. Original tracked time is not modified."
- **Live preview** in modal updates when rounding changes, showing the impact before creating.

---

## Data Model

### Time Entry Addition

Rename existing `invoicedInReportId` guards to `invoiceId`. Add one field to `timeEntries`:

```
invoiceId: v.optional(v.id("invoices"))
```

**Uninvoiced query:** `isBillable === true && invoiceId === undefined`

No `isInvoiced` boolean needed — `invoiceId` presence is the source of truth.

### New Tables

#### `invoices`

```
orgId: v.string()
projectId: v.id("projects")
clientId: v.id("clients")              // denormalized from project
number: v.number()                      // auto-increment from orgSettings
prefix: v.string()                      // from orgSettings.invoicePrefix at creation time
subject: v.optional(v.string())         // auto-prefill varies by type (see below)
status: v.union(
  v.literal("draft"),
  v.literal("invoiced"),
  v.literal("paid")
)
currency: v.string()                    // from client
subtotal: v.number()                    // Σ line item amounts
total: v.number()                       // = subtotal (no tax in v1)
issueDate: v.string()                   // YYYY-MM-DD
dueDate: v.optional(v.string())         // YYYY-MM-DD, auto-filled from org default payment terms
paidAt: v.optional(v.number())          // timestamp
periodStart: v.optional(v.string())     // YYYY-MM-DD billing window
periodEnd: v.optional(v.string())       // YYYY-MM-DD billing window
note: v.optional(v.string())            // free text on invoice
roundingMinutes: v.optional(v.number()) // rounding applied at creation (0 = none)

// Retainer balance snapshot (retainer invoices only)
retainerStartBalanceMinutes: v.optional(v.number())   // from previous invoice's ending balance
retainerIncludedMinutes: v.optional(v.number())       // includedMinutesPerMonth for this month
retainerUsedMinutes: v.optional(v.number())           // Σ rounded task hours
retainerEndBalanceMinutes: v.optional(v.number())     // start + included - used
retainerMonthlyFee: v.optional(v.number())            // snapshot of project monthlyFee at creation
retainerOverageRate: v.optional(v.number())           // snapshot of project overageRate at creation

createdAt: v.number()
updatedAt: v.number()
createdBy: v.id("users")
```

**Subject auto-prefill by billing type:**
- T&M: `"April 2026 — Website Redesign"` (period month + project name)
- Fixed: `"Website Redesign"` (project name only)
- Retainer: `"March 2026 — Ongoing Support"` (invoiced month + project name)

**Indexes:**
- `by_orgId` — list all invoices
- `by_projectId` — invoices for a project
- `by_clientId` — invoices for a client
- `by_orgId_status` — filter by status

#### `invoiceLineItems`

```
orgId: v.string()
invoiceId: v.id("invoices")
sortOrder: v.number()
lineType: v.union(
  v.literal("time"),                    // T&M — billable hours per task
  v.literal("fixed"),                   // Fixed fee amount
  v.literal("retainer_fee"),            // Monthly retainer fee
  v.literal("overage"),                 // Retainer overage hours
  v.literal("manual")                   // Manually added line
)
description: v.string()                 // editable by user
quantity: v.number()                    // hours or units
unitPrice: v.number()                   // rate per unit
amount: v.number()                      // quantity × unitPrice (editable, user can override)
workCategoryId: v.optional(v.id("workCategories"))  // for category grouping
timeEntryIds: v.optional(v.array(v.id("timeEntries")))  // audit trail
createdAt: v.number()
updatedAt: v.number()
```

**Money rounding:** All amounts rounded to 2 decimal places at the line item level.

**Indexes:**
- `by_invoiceId` — line items for an invoice

### Org Settings Additions

```
nextInvoiceNumber: v.optional(v.number())         // auto-increment counter, default 1
invoicePrefix: v.optional(v.string())             // e.g. "INV-", editable in settings
defaultPaymentTermsDays: v.optional(v.number())   // Net 15/30/45/60, default 30
```

---

## Invoice Structure by Project Type

All three billable project types share the **same category > task work breakdown component**. The difference is whether rate/amount columns are shown (T&M) or only hours (Fixed/Retainer), and where the billing amounts appear.

### Unified Work Breakdown Component

One component renders the task breakdown for all types. It receives:
- `showAmounts: boolean` — T&M: `true` (shows rate + amount per task), Fixed/Retainer: `false` (hours only)
- Category headers show the category name + subtotal hours on the right
- Task rows are indented under their category
- This reuses the existing `MonthTaskTable` pattern with `showAmounts` prop

### T&M — Line Items ARE the Billing

Each task is a billable line item with hours × rate. The work breakdown IS the invoice.

**Grouping:** entries are grouped by `(taskId, billableRate)`. If a task has entries with different rates (rate changed mid-period), it appears as separate line items — one per rate.

```
DESCRIPTION                        HOURS    RATE        AMOUNT
───────────────────────────────────────────────────────────────
● Design                           23.0h
  Homepage mockups                  15.0h    €100/h     €1,500
  Mobile responsive                  8.0h    €100/h       €800
● Development                      20.5h
  API integration                   12.5h    €120/h     €1,500
  Auth flow refactor                 8.0h    €120/h       €960
+ Add line item
───────────────────────────────────────────────────────────────
                        Subtotal    43.5h               €4,760
                           Total                        €4,760
```

**"+ Add line item"** available on T&M — user can add manual rows (e.g. "Domain registration", "Hosting fee").

**Pre-fill logic:**
1. Query entries matching criteria (date range or selected IDs) where `isBillable === true && invoiceId === undefined`
2. Group by `snapshotCategoryId` → `(taskId, billableRate)`
3. One `lineType: "time"` line item per unique (task, rate) pair:
   - `description`: task title
   - `quantity`: Σ durationMinutes / 60, rounded per rounding setting
   - `unitPrice`: billableRate from entries
   - `amount`: quantity × unitPrice
   - `workCategoryId`: for category grouping
   - `timeEntryIds`: all entry IDs aggregated
4. Set `periodStart` / `periodEnd` from min/max entry dates
5. Set `invoiceId` on all included time entries

### Fixed Fee — Work Report + Billing Summary Card

The document body is a **read-only work report** (category > task, hours only). Billing amounts appear in a **visually distinct summary card** at the bottom — not as inline line items.

```
WORK DELIVERED                                         68.5h
───────────────────────────────────────────────────────────────
● Design                                               36.5h
  App wireframes                                       18.0h
  UI design — onboarding flow                          12.5h
  Icon set & illustrations                              6.0h
● Development                                         32.0h
  React Native setup                                    8.0h
  Auth & navigation                                    14.0h
  API layer scaffold                                   10.0h

┌─────────────────────────────────────────────────────────────┐
│ Website Redesign                                 €10,000.00 │
│ ─────────────────────────────────────────────────────────── │
│ Total                                            €10,000.00 │
└─────────────────────────────────────────────────────────────┘
```

**No "+ Add line item" in the work report.** The task breakdown is generated from time entries and is read-only. Manual line items can be added to the billing summary card (e.g. "Domain registration").

**"Remaining from €X" is NOT shown on the invoice document.** It appears in the **editor sidebar only** (agency-internal tracking): `Invoiced: €5,000 / €10,000 (50%)`.

**Pre-fill logic:**
1. Calculate already invoiced: Σ amounts from existing `lineType: "fixed"` line items on this project's invoices
2. Generate one `lineType: "fixed"` line item:
   - `description`: project name
   - `quantity`: 1
   - `unitPrice`: `fixedPrice - alreadyInvoiced` (remaining balance)
   - `amount`: same as unitPrice (user can edit in the editor for milestone billing)
3. Query uninvoiced billable entries in the date range for the work breakdown
4. Set `invoiceId` on all uninvoiced billable entries in the period

**Multiple invoices per project:** Allowed. Each pre-fills with remaining balance. User edits the amount in the editor for milestone billing (e.g. 50% deposit). No partial billing UI in the modal.

### Retainer — Monthly Billing with Balance Tracking

**Retainer invoices are created per month, not per cycle.** Each monthly invoice includes:
1. A read-only work report (category > task, hours only)
2. A balance section showing starting balance → included → used → ending balance
3. A billing summary card with retainer fee and overage (if applicable)

```
WORK DELIVERED                                        42.0h
───────────────────────────────────────────────────────────────
● Development                                         30.0h
  Feature X — user dashboard                          18.0h
  Bug fixes (Q1 backlog)                              12.0h
● Design                                              12.0h
  New onboarding flow                                 12.0h

┌─────────────────────────────────────────────────────────────┐
│ Budget                                                      │
│ Starting balance                                 0.0h       │
│ Included                                        40.0h       │
│ Used                                            42.0h       │
│ Ending balance                                  −2.0h       │
│                                                             │
│ Retainer fee                                 €5,000.00      │
│ Overage (2.0h × €75/h)                        €150.00      │
│ ─────────────────────────────────────────────────────────── │
│ Total                                        €5,150.00      │
└─────────────────────────────────────────────────────────────┘
```

**Balance tracking — invoice chaining:**

Retainer invoices form a billing ledger. Each invoice's ending balance feeds the next invoice's starting balance.

- **Starting balance:** Query the latest finalized retainer invoice for this project (`WHERE periodEnd < thisMonth ORDER BY periodEnd DESC LIMIT 1`). Use its `retainerEndBalanceMinutes`. If none exists → 0.
- **Included:** `includedMinutesPerMonth` from the project
- **Used:** Σ rounded task hours (rounding applies uniformly)
- **Ending balance:** `start + included - used`
- **Overage:** When `endBalance < 0`:
  - Rollover ON: overage only on cycle-closing invoice (mid-cycle deficit may recover)
  - Rollover OFF: overage on any month with negative ending balance

**The retainer engine is unaffected.** It tracks exact minutes for the overview page. Invoices are a separate billing ledger that may diverge due to rounding — this is intentional and correct.

**LIFO deletion guard:** A finalized retainer invoice cannot be deleted if a later finalized invoice exists for the same project. Delete from newest first. Drafts can always be deleted.

**Deletion check query:** `any finalized retainer invoice for this project WHERE periodStart > thisInvoice.periodEnd?` If yes → block with message: "Delete the [Month Year] invoice first."

**Pre-fill logic:**
1. Get month data from `getRetainerData` for the selected month
2. Compute balance: query previous finalized invoice for starting balance
3. Round task hours per rounding setting → compute used, ending balance
4. `lineType: "retainer_fee"` — `retainerMonthlyFee` (snapshot from project)
5. If overage: `lineType: "overage"` — `|endBalance| / 60 × retainerOverageRate` (snapshot from project)
6. Snapshot all balance fields and rate fields on the invoice
7. Set `periodStart` / `periodEnd` from month boundaries
8. Set `invoiceId` on all billable entries in the month

### Non-billable — No invoicing

Non-billable projects cannot generate invoices. No "Create Invoice" button shown.

---

## Invoice Lifecycle

### Status Flow

```
draft  →  invoiced  →  paid
  ↑          │
  └──────────┘  (revert to draft if correction needed)
```

- **draft**: Editable. Line items can be added, removed, modified. Time entries are linked (`invoiceId` set) but the invoice is still a work in progress.
- **invoiced**: Marked when the real invoice has been created in the external accounting system. Read-only in Agency Flow. Can be reverted to `draft` if a correction is needed.
- **paid**: Client has paid. Can be reverted to `invoiced` if marked by mistake.

**No "voided" status.** Drafts can be deleted freely. Finalized invoices (invoiced/paid) can be reverted to draft, then deleted. Retainer invoices have LIFO deletion guard (see Retainer section).

**Visual overdue:** When `status === "invoiced"` and `dueDate < today` (using `orgSettings.timezone`), the status badge turns red and shows "Overdue". This is NOT a DB status — it's derived in the UI. No state machine changes needed.

### Delete Flow

Deleting an invoice clears `invoiceId` from all linked time entries — they become unbilled again and are available for future invoicing. No option to delete entries (too destructive, no real use case).

**Retainer LIFO guard:** Finalized retainer invoices cannot be deleted if a later finalized invoice exists for the same project.

### Editing Rules

- **draft**: Everything editable — line items, amounts, descriptions, dates, subject, note
- **invoiced / paid**: Read-only. Revert to draft first to edit.
- **Time entries**: Always editable regardless of invoice status. The invoice is a snapshot — entry changes don't cascade.

### "Mark as Invoiced" — No Blocker

No validation blocker when marking as invoiced. If FROM/TO fields are incomplete:
- **First-time nudge:** When creating the very first invoice, if brand info is incomplete, show an inline banner at the top of the editor: "Complete your agency details in Settings for professional invoices." Link to settings. Dismissable.
- **Empty field display:** FROM/TO sections with missing fields show subtle placeholder text ("No address set") in muted color. The visual gap is the passive nudge.

---

## What `invoiceId` Means — Universal Semantics

`invoiceId` on a time entry means: **"this entry was included in this invoice's scope."** It does NOT mean "this entry's `hours × billableRate` equals the billed amount."

| Project Type | Entry gets `invoiceId`? | What it means |
|---|---|---|
| **T&M** | **Yes** | Entry was billed. `hours × billableRate` = the billed amount. |
| **Fixed** | **Yes** | Entry was accounted for in this invoice. Billed amount ≠ entry-level sum. |
| **Retainer** | **Yes** | Entry was part of a month that was invoiced. Billed amount ≠ entry-level sum. |

### Two Sources of Truth

- **Time** = `timeEntries` table. "How many hours did we work?"
- **Revenue** = `invoiceLineItems` table. "How much did we bill?"

### Universal "Uninvoiced" Query

```
Uninvoiced billable time = entries WHERE isBillable === true && invoiceId === undefined
```

Works for ALL project types. No billing-type branching in reports.

---

## Invoice Numbering

**Format:** `{prefix}{number}` — e.g. `INV-001`, `INV-002`

- **Prefix**: configurable in org settings (`invoicePrefix`), default `"INV-"`
- **Number**: auto-increment from `orgSettings.nextInvoiceNumber`, zero-padded to 3 digits minimum
- Starting number editable in settings (e.g. start from 100 if migrating from another system)
- **Numbers never recycle.** Deleting a draft leaves a gap — this is standard accounting practice.

---

## Due Date & Payment Terms

**Org-level default:** `defaultPaymentTermsDays` in org settings. Options: 15 / 30 / 45 / 60 days, or custom number.

**Behavior:** When creating an invoice, `dueDate` auto-fills as `issueDate + defaultPaymentTermsDays`. The user can override it on any individual invoice.

---

## Org Settings for Invoicing

### New Fields

```
nextInvoiceNumber: v.optional(v.number())         // default: 1, auto-increments
invoicePrefix: v.optional(v.string())             // default: "INV-"
defaultPaymentTermsDays: v.optional(v.number())   // default: 30
```

### Existing Fields (already in schema)

**FROM section** on invoices — agency info:
- `brandName` — agency name
- `brandAddress` — agency address
- `brandTaxId` — agency tax ID
- `brandEmail` — agency email
- `brandPhone` — agency phone
- `brandLogoStorageId` — agency logo

**TO section** on invoices — client info (from `clients` table):
- `billingName`, `billingEmail`, `billingCountry`, `billingCity`, `billingZip`, `billingStreet`, `billingStreet2`, `taxId`

**Currency:** inherited from client, not editable on the invoice.

---

## UI Touchpoints

### Global Invoices Page (`/invoices`)

New sidebar menu item under "Finance" group. Shows all invoices across all projects.

- **Status tabs:** All | Draft | Invoiced | Paid (URL param: `?status=draft`)
- **Filters:** Client dropdown, Project dropdown, search by invoice number/subject
- **Table columns:** Number (prefix+number), Subject, Client, Project, Billing Type badge, Status badge, Total, Issue Date, Due Date
- **Row click:** navigates to `/invoices/[id]` (full-page editor)

### Project Detail Page — Invoices Tab

Summary header + invoice list for this project.

- **Summary:** 2 MetricCards — "Total Invoiced" + "Uninvoiced" amounts
- **"Create Invoice" button** → opens `CreateInvoiceModal` (Path A)
- **Invoice list:** same `InvoiceList` component as global page, filtered by projectId
- **Row click:** navigates to `/invoices/[id]`

### Project Detail Page — Time Tab

Time entries list for all project types. Checkbox selection for T&M only.

- **Entry list:** grouped by day, each row shows: date, member, task title, billing status badge (invoiced → links to invoice), rate, duration
- **T&M only:** checkboxes on billable + uninvoiced entries. Selection toolbar appears when entries selected — count + total hours + "Create Invoice from Selected" button (Path B)
- **Fixed / Retainer:** read-only log, no checkboxes. Shows which entries are invoiced and which invoice they belong to.
- **Filters:** member, billing status, search

### Project Detail Page — Overview Tab

- **T&M:** "Uninvoiced" metric card shows `Σ(unbilled hours × billableRate)`. Existing pattern.
- **Fixed:** "Invoiced" metric shows `Σ invoiced / fixedPrice`. Existing pattern.
- **Retainer:** Per-month cards show "Invoice this month" button on closed, uninvoiced months (Path C). Cycle-end banner when a cycle closes.

### Invoice Editor Page (`/invoices/[id]`)

Full-page, document-style editor. Two-column layout.

**Left column — "The Paper":**
- **Subject** — editable text, auto-prefilled per billing type
- **FROM / TO** — agency info (from orgSettings) and client info (from client record). Read-only on the invoice — edit in Settings / Client. Missing fields show muted "No address set" placeholder.
- **Invoice meta** — invoice number (read-only), issue date (date picker), due date (date picker)
- **Work breakdown** — unified component for all billing types:
  - **T&M:** category > task rows with hours, rate, amount columns. Each task is a billable line item. "+ Add line item" for manual rows.
  - **Fixed / Retainer:** category > task rows with hours only (no rate/amount). Read-only — generated from time entries. Category headers show subtotal hours on the right.
- **Balance section** (Retainer only) — starting balance → included → used → ending balance. Part of the billing summary card.
- **Billing summary** (Fixed / Retainer only) — visually distinct card below the work breakdown. Contains the billing line items (fixed fee amount / retainer fee + overage) and the total. Editable in draft.
- **Totals** (T&M) — subtotal + total at the bottom of the line items table.

**Right column — Sidebar (sticky):**
- Status + `InvoiceStatusBadge`
- Amount (computed from billing line items)
- Fixed Fee: progress — `Invoiced: €5,000 / €10,000 (50%)` (agency-only, not on document)
- Issue Date
- Due Date
- Note (textarea)
- **Actions:**
  - Draft → "Mark as Invoiced"
  - Invoiced → "Mark as Paid" / "Revert to Draft"
  - Paid → "Revert to Invoiced"
  - "Delete Invoice" (confirmation dialog, LIFO guard for retainer)

**Read-only mode:** When status is `invoiced` or `paid`, all fields and line items become read-only. Revert to draft to edit.

**First-time brand info nudge:** If this is the org's first invoice and brand info is incomplete, show an inline banner: "Complete your agency details in Settings for professional invoices." Dismissable.

### Org Settings — Invoicing Section

New section in the Settings > General tab (or dedicated "Invoicing" tab):

- Invoice prefix (`INV-`)
- Next invoice number (editable)
- Default payment terms (Net 15 / 30 / 45 / 60 / custom)
- Brand info reminder — link to existing brand fields (name, address, tax ID, etc.)

---

## Component Architecture

### File Structure

```
app/(dashboard)/
  invoices/
    page.tsx                              ← Global invoices list (thin orchestrator)
    [id]/
      page.tsx                            ← Invoice editor page (thin orchestrator)

components/invoices/
  # Shared
  invoice-status-badge.tsx                ← draft/invoiced/paid + visual overdue
  invoice-list.tsx                        ← Reusable table: global page AND project tab
  invoice-list-row.tsx                    ← Row: number, subject, client, billing type badge, status, total, dates

  # Creation flow
  create-invoice-modal.tsx                ← Billing-type-aware: T&M/Fixed (date range) vs Retainer (month picker)

  # Editor
  invoice-document.tsx                    ← The "paper" — FROM/TO + meta + work breakdown + billing
  invoice-parties.tsx                     ← FROM (orgSettings) + TO (client) grid
  invoice-work-breakdown.tsx              ← Unified category > task component for ALL billing types
  invoice-line-item-row.tsx               ← Single editable row (T&M task / manual line)
  invoice-billing-summary.tsx             ← Fixed/Retainer billing card (fee, overage, balance, total)
  invoice-sidebar.tsx                     ← Status, dates, note, action buttons

components/projects/
  project-invoices.tsx                    ← Invoices tab content (summary + InvoiceList)
  project-time-entries.tsx                ← Time tab content (all types: T&M has checkboxes, others read-only)
```

### Key Component: `InvoiceWorkBreakdown`

One component renders the category > task breakdown for **all three billing types**. It replaces the previously planned separate `invoice-line-items.tsx` + `invoice-delivery-section.tsx`.

```tsx
type Props = {
  categories: CategoryGroup[]
  showAmounts: boolean          // T&M: true, Fixed/Retainer: false
  readOnly: boolean             // invoiced/paid: true
  onAddLine?: () => void        // T&M only — adds manual line item
  currency: string
}
```

- **T&M** (`showAmounts={true}`): category header (name + subtotal hours) → task rows (description, hours, rate, amount). Each row editable in draft. "+ Add line item" at bottom.
- **Fixed/Retainer** (`showAmounts={false}`): category header (name + subtotal hours) → task rows (description, hours only). Read-only always — generated from time entries.

This reuses the same visual hierarchy as the existing `MonthTaskTable`, adapted for the invoice editor context.

### Component Reuse Map

| Component | Where Used | Notes |
|---|---|---|
| `InvoiceList` | Global page + Project Invoices tab | Prop: `projectId?` filters when present |
| `InvoiceStatusBadge` | Everywhere invoices appear | Same pattern as existing `StatusBadge` |
| `InvoiceWorkBreakdown` | All 3 billing types in editor | `showAmounts` prop controls rate/amount columns |
| `InvoiceBillingSummary` | Editor: Fixed + Retainer only | Distinct card with billing amounts + balance (retainer) + total |
| `MetricCard` | Project Invoices tab summary | Already exists, direct reuse |
| `CategoryBadge` | Work breakdown category headers | Already exists, direct reuse |
| `CreateInvoiceModal` | Project Invoices tab + Retainer overview | Billing-type-aware content |

### What We Don't Build

- No `InvoiceProvider` context — editor queries one invoice, props down. Tree isn't deep enough for context.
- No `useInvoiceForm` monolithic hook — individual `useState` per field (existing `SettingsGeneral` pattern).
- No billing type "strategy" abstraction — explicit switch/if is cleaner for 3 types.
- No separate `InvoiceDeliverySection` — the `InvoiceWorkBreakdown` handles all types with `showAmounts` prop.
- No drag-to-reorder on line items in v1 — `sortOrder` field, Add Row appends to end.
- No invoice preview mode in v1 — the editor is readable enough. PDF export later.
- No `predecessorInvoiceId` — previous invoice balance is derived via query at creation time.

---

## Navigation Changes

Add to `lib/navigation.ts` under the "Finance" group:

```ts
{ title: "Invoices", url: "/invoices", icon: ReceiptIcon, adminOnly: true }
```

Add to `lib/route-access.ts`:

```ts
"/invoices"  // admin-only route
```

---

## Concurrency & Safety

### Server-side Balance Derivation

The `createInvoice` mutation derives the retainer starting balance **server-side** in a single transaction. The UI preview shows an estimated balance, but the mutation re-computes it at execution time. Convex OCC ensures that if two users create invoices simultaneously, one retries and sees the first invoice already exists.

### Uniqueness Constraint

One finalized invoice per project + month for retainer projects. The mutation checks for existing invoices covering the same period and rejects duplicates.

### Invoice Number Atomicity

`nextInvoiceNumber` is read and incremented in the same mutation. Convex OCC prevents duplicate numbers.

---

## Scope — What's NOT in v1

- Tax calculation (ÁFA) — handled in external accounting system
- Discounts — edit the amount manually
- PDF generation / export
- Email sending
- Online payments (Stripe)
- Recurring / auto-generated invoices
- Partial payment tracking
- Multi-project invoices
- Invoice preview mode (clean read-only view)
- External reference number (Billingo invoice #)
- Invoice templates / branding customization beyond org settings
- Credit notes / refunds
- Billingo / Számlázz.hu API integration
- Drag-to-reorder line items
- Per-entry rounding rule option (one rule: round per task total)
- Voided invoice status
- Multi-month retainer invoices (one invoice per month)
- Between-cycle balance rollover (cycles always reset to 0)

---

## Migration

No data migration needed. New tables (`invoices`, `invoiceLineItems`) start empty. Add `invoiceId` as optional field to `timeEntries` schema — existing entries have no invoice reference, which is correct (they're uninvoiced). Rename existing `invoicedInReportId` guard checks in `timeEntries.ts` to `invoiceId`.

Add `nextInvoiceNumber`, `invoicePrefix`, `defaultPaymentTermsDays` to `orgSettings` — all optional with sensible defaults when first invoice is created.
