# Tasks for Issue 8: Path B — T&M Time Tab Checkbox Selection

Parent issue: Issue 8 in `docs/invoicing-issues.md`
Parent PRD: `docs/invoicing-prd.md`

## Locked-in decisions (UX)

- **Time tab is rendered for all billable types** (`t_and_m`, `fixed`, `retainer`). Non-billable hides it. Checkboxes + selection toolbar are **T&M-only**; Fixed/Retainer render a read-only entry list with invoice-status indicators.
- **Selection toolbar** reuses the floating bottom-center motion pattern from `components/tasks/bulk-toolbar.tsx` for a consistent selection experience across Tasks and Time.
- **Member filter** is dynamic — options come from users who actually have entries on the project (catches ex-team-members). Not the static `project.teamMembers` list.
- **Row click toggles the checkbox** on T&M billable+uninvoiced rows. Invoiced or non-billable rows are inert (the invoice link is still clickable). Standard Gmail/Linear/Notion pattern.
- **Three-component split** (filters + table + toolbar) per CLAUDE.md thin-component rule.

## Tasks

### 1. Backend: `listProjectEntries` query

**Type**: WRITE  
**Output**: `convex/timeEntries.ts` exports `listProjectEntries` returning a flat per-entry list with task title, category, user name+avatar, billing status, and invoice reference.  
**Depends on**: none

Args: `{ projectId, memberId?, billingStatus?, search? }` where `billingStatus ∈ "all" | "billable_uninvoiced" | "invoiced" | "non_billable"`. Tenancy: filter by `orgId`; respect the member-only visibility rule already used by `listByTask`. Walk tasks via the `by_orgId_projectId` index → pull entries via `by_taskId`. Denormalize: task title, category name+color (via `e.snapshotCategoryId ?? task.workCategoryId`), user name+imageUrl, and when `invoiceId` is set, fetch the invoice (tenancy-guarded) to return `invoicePrefix`, `invoiceNumber`, `invoiceStatus`. Apply `memberId`, `billingStatus`, and case-insensitive `search` (against task title OR entry `note`) in-memory. Sort `date DESC, createdAt DESC`. Return shape must be typed precisely — the component will narrow on it.

---

### 2. Backend: extend `createInvoice` with `timeEntryIds`

**Type**: WRITE  
**Output**: `createInvoice` mutation in `convex/invoices.ts` accepts optional `timeEntryIds: v.optional(v.array(v.id("timeEntries")))`.  
**Depends on**: none (can run in parallel with task 1)

Add the arg. When present: load entries by id, tenancy-check (`orgId === orgId`), verify every entry (a) belongs to `projectId`, (b) is billable, (c) has no `invoiceId`. On any violation throw a specific error naming the conflict. Use these entries in place of the date-range-filtered set — grouping and line-item logic remain unchanged (still groups by `(snapshotCategoryId, taskId, billableRate)` for T&M). Compute `periodStart`/`periodEnd` from min/max entry dates. Reject if caller is on Fixed/Retainer (Issue 8 is T&M scope; Fixed/Retainer use different pre-fill logic). Throw `"No entries selected"` if `timeEntryIds` is empty. `roundingMinutes` arg stays 0 by default for this entry point — rounding is editable in the editor post-create.

---

### 3. Add Time tab to project detail page

**Type**: WRITE  
**Output**: New `"time"` tab in `app/(dashboard)/projects/[id]/page.tsx` for all billable projects. Wired to a lazy-loaded `ProjectTime` component.  
**Depends on**: 4

Add `TabsTrigger value="time"` between Overview and Invoices for billable projects only (hide on `non_billable`). Extend the existing `defaultTab` logic to accept `?tab=time`. Dynamic-import `ProjectTime` the same way `ProjectInvoices` is imported. Keep the page file thin — no inline logic.

---

### 4. UI: `ProjectTime` component (shell + phases)

**Type**: WRITE  
**Output**: `components/projects/project-time.tsx` orchestrating filters + table + toolbar. Handles the three-phase loading → empty → content flow.  
**Depends on**: 1

Props: `{ projectId, project: { billingType, currency } }`. Reads URL params via `useSearchParams`: `member`, `billingStatus`, `search` (search debounced 250ms to URL, same pattern as `invoices-filters.tsx`). Fetches `listProjectEntries` with those params. Selection state is a local `useState<Set<string>>` (selection is ephemeral, doesn't survive navigation — matches the Tasks BulkToolbar precedent). Phases:

- **Loading**: content-aware skeleton (filter row + 6 entry-row skeletons)
- **Empty with no active filters**: if no entries at all → "No time logged yet" empty state. If T&M and all billable entries are invoiced (zero `billable_uninvoiced`, some `invoiced`) → inline banner: `"All billable time has been invoiced."` + "View invoices" link that flips `?tab=invoices`.
- **Content**: filters + table + (T&M only) selection toolbar

Fixed/Retainer: filters still render, but `selectable={false}` is passed to the table and no toolbar is mounted. The invoice-status cell still renders with linked badges for invoiced rows.

---

### 5. UI: `ProjectTimeFilters` component

**Type**: WRITE  
**Output**: `components/projects/project-time-filters.tsx` — member `Select` + billing-status `Select` (T&M only) + debounced search `Input`.  
**Depends on**: 1

Member filter options derived from the entries query result (dynamic — passed down as `availableMembers: Array<{ id, name, imageUrl }>`), not from `project.teamMembers`. Include an "All members" option. Billing-status options: "All", "Billable · Uninvoiced", "Invoiced", "Non-billable" — render this select **only** when `project.billingType === "t_and_m"` (for Fixed/Retainer the distinction is coarser and the UI is read-only, so the filter adds noise). Search input is controlled local state synced to `?search=` via a 250ms debounced `useEffect`. All three persist to URL params using the same atomic `setParams` pattern from `components/invoices/invoices-filters.tsx` to avoid stale-closure races.

---

### 6. UI: `ProjectTimeTable` component

**Type**: WRITE  
**Output**: `components/projects/project-time-table.tsx` — presentational table with optional checkbox column and invoice-status cell.  
**Depends on**: 1

Props: `{ entries, selectedIds, onToggle, onSelectAllVisible, selectable, currency }`. Columns (in order): checkbox (if `selectable`), date, member (avatar + name), task title, category badge, hours, rate, amount (hide rate/amount columns for Fixed/Retainer), billing status.

Billing status cell logic:
- Invoiced row → `Link` to `/invoices/[invoiceId]` wrapping the existing `InvoiceStatusBadge` (showing `{prefix}{number}` text). `stopPropagation` on the link so it doesn't also toggle the row.
- Non-billable row → muted "Non-billable" pill (no link).
- Billable + uninvoiced row → muted "Uninvoiced" pill.

The header checkbox selects all **currently-visible billable+uninvoiced rows** only, not invoiced/non-billable rows. Row click (`onClick` on `<TableRow>`) toggles selection when the row is selectable. Use `cursor-pointer` on selectable rows and leave non-selectable rows with default cursor. Must not trigger selection when the click originates inside the invoice `<Link>` (`e.target` check or `onClick` stopPropagation on the link).

---

### 7. UI: `ProjectTimeSelectionToolbar` component

**Type**: WRITE  
**Output**: `components/projects/project-time-selection-toolbar.tsx` — floating bottom-center toolbar that appears when any billable+uninvoiced row is selected.  
**Depends on**: 2

Props: `{ selectedIds, entries, currency, projectId, onDeselectAll }`. Derives total minutes and total billable amount from the selected entries (display only). Layout: `"{n} entries · {h}h"` text + total amount text + deselect-all icon button + primary "Create Invoice from Selected" button. Styling: reuse the fixed-bottom centered motion pattern from `components/tasks/bulk-toolbar.tsx` — either import the same `motion` primitives it uses or extract a shared `SelectionToolbar` shell if it's trivial. On CTA click:

```
createInvoice({ projectId, timeEntryIds: [...selectedIds], roundingMinutes: 0 })
  → router.push(`/invoices/${id}?from=project&projectId=${projectId}&tab=time`)
  → toast.success("Invoice created")
```

Wrap in `try/catch` with `toastError` per CLAUDE.md. Disable the CTA + show spinner while the mutation is in flight. Escape key clears selection (wire at the `ProjectTime` level, not here).

---

### 8. Verification pass

**Type**: TEST  
**Output**: `npx tsc --noEmit` passes, `npm run lint` clean on new files, and every acceptance criterion from Issue 8 (`docs/invoicing-issues.md:487-493`) is manually verified.  
**Depends on**: 1–7

Walk:
- T&M project Time tab → only billable+uninvoiced rows have checkboxes
- Invoiced row shows linked status badge pointing to `/invoices/[id]`
- Select 3 entries → toolbar shows `"3 entries · X.Xh"` + CTA
- Click "Create Invoice from Selected" → invoice created with those entries as line items; redirected to `/invoices/[id]`; back-arrow returns to `?tab=time`
- Fixed/Retainer Time tab → no checkboxes, no toolbar, invoice badges still render
- All billable invoiced → "All billable time has been invoiced." banner + "View invoices" link switches to invoices tab
- Member filter, billing-status filter, search all narrow the table and persist to URL
- Row click on selectable row toggles checkbox; click on invoice link navigates without toggling

---
