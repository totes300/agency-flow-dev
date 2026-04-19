# Tasks for Issue 7: Global Invoices Page

Parent issue: Issue 7 in `docs/invoicing-issues.md`
Parent PRD: `docs/invoicing-prd.md`

## Product decisions (locked in)

- **Undefined `dueDate` → Outstanding.** An invoice without a due date has no overdue clock and is treated as awaiting payment but not yet overdue. Spec is silent; we choose Outstanding.
- **Multi-currency metrics.** Backend returns per-currency `{count, sum}` maps. UI shows the currency with the largest sum as the main `value`, the count as the big number, and appends `" · +N more"` as the `detail` when other currencies are present. A single-currency org sees clean single-currency cards.

## Tasks

### 1. Extend CreateInvoiceModal with prefill + backHref

**Type**: WRITE  
**Output**: `components/invoices/create-invoice-modal.tsx` accepts optional `initialRetainerYear`, `initialRetainerMonth`, and `backHref`. On success, `router.push(backHref ?? default)`. Default behavior unchanged (project caller still gets `?from=project...`).  
**Depends on**: none

Add three optional props. Initialize the `selectedMonth` state via the `useState` lazy initializer from the two prefill props (no `useEffect` sync — per CLAUDE.md "derived state: compute, never sync"). The modal is meant to be re-mounted per context, so each consumer should key it with the relevant identity (project id, or "global" + month) to guarantee fresh state; document this on the modal. Change the success redirect to: `router.push(backHref ?? \`/invoices/${invoiceId}?from=project&projectId=${projectId}&tab=invoices\`)`. Update the existing project-invoices caller to remain functional with no API change (it already doesn't pass `backHref`). This task is landed first so Task 5 can consume it.

---

### 2. Backend: `listAllInvoices` query

**Type**: WRITE  
**Output**: `listAllInvoices` query in `convex/invoices.ts` filtering by optional `status`, `clientId`, `projectId`, `search`. Returns `InvoiceRow`-compatible rows denormalized with `clientName`, `projectName`, `projectBillingType`.  
**Depends on**: none

Model on the existing `listInvoices`. Query `by_orgId_status` when `status` is set; otherwise `by_orgId`. Apply `clientId` and `projectId` as in-memory exact matches. For `search`: case-insensitive match against either (a) the formatted invoice number `{prefix}{zeroPaddedNumber}` using the same `formatInvoiceNumber` helper from `lib/format.ts` that the table uses, OR (b) a substring of `subject`. Sort newest-first by `createdAt`. Denormalize via `ctx.db.get(projectId)` and `ctx.db.get(clientId)` (same pattern as `listInvoices`). Return shape must stay compatible with the `InvoiceRow` type in `components/invoices/invoice-list.tsx` — if you need to deviate, update both sides.

---

### 3. Backend: `getInvoiceMetrics` query

**Type**: WRITE  
**Output**: `getInvoiceMetrics` query returning the 4 bucket breakdown with per-currency sums.  
**Depends on**: none

Add to `convex/invoices.ts`. Fetch org invoices via `by_orgId`. Read `orgSettings.timezone` (default `"UTC"`) and compute `todayStr` via `getDateInTimezone` from `convex/lib/timer.ts`. Compute `firstOfMonthStr = todayStr.slice(0, 7) + "-01"`; convert the month boundary to an epoch ms in the org timezone for comparing against `paidAt` (use `new Date(firstOfMonthStr + "T00:00:00Z").getTime()` — close enough for monthly granularity unless the PRD calls for strict tz math, in which case document the simplification). Iterate once and bucket:
- `status === "draft"` → Draft
- `status === "invoiced"` && (`dueDate === undefined` || `dueDate >= todayStr`) → Outstanding
- `status === "invoiced"` && `dueDate < todayStr` → Overdue
- `status === "paid"` && `paidAt != null` && `paidAt >= firstOfMonthMs` → Paid This Month

For each bucket, accumulate `count` and a `Map<currency, sum>`. Return:
```ts
{
  draft:           { count: number; currencySums: Record<string, number> },
  outstanding:     { ... },
  overdue:         { ... },
  paidThisMonth:   { ... },
}
```
Mark the `undefined dueDate → Outstanding` line with a one-line code comment pointing to the product decision at the top of this file.

---

### 4. Backend: `getReadyToInvoice` query

**Type**: WRITE  
**Output**: `getReadyToInvoice` returns a flat list of retainer months ready for invoicing, including client avatar data.  
**Depends on**: none

Add to `convex/invoices.ts`. Query retainer projects via `projects by_orgId` then filter `billingType === "retainer" && !archivedAt`. For each, call the existing private `getClosedUninvoicedMonths`. Resolve client logos via `ctx.storage.getUrl(client.logoStorageId)` when present (mirror `convex/clients.ts` line 67). Flatten into rows:
```ts
{ clientId, clientName, clientLogoUrl, projectId, projectName, monthlyFee, currency, year, month, label, startDate, endDate }
```
Sort ascending by `startDate` (oldest uninvoiced month first). Multi-tenancy: explicit `inv.orgId === orgId` filter on every sub-query. Months already come filtered by the helper.

---

### 5. UI: InvoicesPageSkeleton component

**Type**: WRITE  
**Output**: `components/invoices/invoices-page-skeleton.tsx` — content-aware loading skeleton mirroring metric cards, filters, and table rows.  
**Depends on**: none

Per CLAUDE.md: "loading skeletons must be content-aware." Render a 4-column metric card skeleton row, a tab bar skeleton, a filter-bar skeleton (three skeletons sized for two dropdowns + search), and ~6 table-row skeletons. Uses `Skeleton` from `components/ui/skeleton`.

---

### 6. UI: InvoicesMetricCards component

**Type**: WRITE  
**Output**: `components/invoices/invoices-metric-cards.tsx` — 4-card grid with primary-currency strategy.  
**Depends on**: Task 3

Takes `metrics` prop matching `getInvoiceMetrics` return. Renders four `MetricCard` instances in a `grid-cols-2 md:grid-cols-4 gap-4` layout. For each bucket: determine the primary currency (largest `sum`), show `count` as `value`, show `formatCurrency(sum, primaryCurrency)` as `detail`, and append `" · +N more"` when other currencies exist. Overdue uses `variant="destructive"`. Label strings: `"Draft"`, `"Outstanding"`, `"Overdue"`, `"Paid this month"`.

---

### 7. UI: InvoicesFilters component

**Type**: WRITE  
**Output**: `components/invoices/invoices-filters.tsx` — URL-driven tabs, client dropdown, project dropdown, debounced search input.  
**Depends on**: Task 2

Client component. Reads `useSearchParams`; writes via `router.push(pathname + "?" + params.toString())`. Status tabs (`All` → param absent, `Draft`, `Invoiced`, `Paid`) follow the pattern in `components/tasks/tasks-tabs.tsx`. Client dropdown uses `api.clients.list`; project dropdown uses `api.projects.list` (both already exist). Include a "All clients" / "All projects" option in each. Search input is controlled local state synced to `?search=...` with a 250ms debounced `useEffect` — this is an external-system sync (URL), which CLAUDE.md explicitly allows. When updating one param, preserve all others by reading the current `searchParams` and overwriting only the key being changed.

---

### 8. UI: ReadyToInvoiceCard component

**Type**: WRITE  
**Output**: `components/invoices/ready-to-invoice-card.tsx` — collapsible card listing retainer months ready to invoice.  
**Depends on**: Task 1, Task 4

Uses shadcn `Card` + a simple `useState` collapse toggle. Header: title "Ready to invoice" + count badge + chevron. Each row: `ClientColorAvatar` (from `components/clients/client-color-avatar.tsx`, pass `name` + `logoUrl`) + client name + muted project name + month label + monthlyFee on the right + "Create" button. Clicking "Create" sets local state `{ projectId, year, month, name, billingType: "retainer", currency }` and renders `<CreateInvoiceModal key={\`${projectId}-${year}-${month}\`} open={true} onOpenChange={...} initialRetainerYear={year} initialRetainerMonth={month} backHref="/invoices" ... />`. The `key` ensures the modal is re-mounted and the initial month is re-applied each time a different row is clicked. Card returns `null` when the input list is empty.

---

### 9. UI: Refactor /invoices page + compose content

**Type**: WRITE  
**Output**: `app/(dashboard)/invoices/page.tsx` becomes a thin orchestrator composing every sub-component.  
**Depends on**: Tasks 2, 3, 4, 5, 6, 7, 8

Parse URL params via `useSearchParams`: `status`, `clientId`, `projectId`, `search`. Call `listAllInvoices` (with those params), `getInvoiceMetrics`, `getReadyToInvoice`, and existing `orgSettings.get`. Render in order:
1. Header ("Invoices" + subtitle)
2. `ReadyToInvoiceCard` (null if empty input — no wrapper layout change)
3. `InvoicesMetricCards`
4. `InvoicesFilters`
5. `InvoiceList` (pass `showProject={true}`, omit `fromProject`, pass `timezone`)

Three phases in strict order (CLAUDE.md rule): (1) any of `invoices`, `metrics`, `ready` is `undefined` → `<InvoicesPageSkeleton />`; (2) `invoices.length === 0` AND `ready.length === 0` AND no active filters (so the user hasn't filtered everything out) → the existing empty state with the "View billable projects" link; (3) otherwise render the full page. Keep the page file under 200 lines.

---

### 10. Verification pass

**Type**: TEST  
**Output**: `npx tsc --noEmit` passes; every Issue 7 acceptance criterion is manually verified.  
**Depends on**: 1–9

Run `npx tsc --noEmit`. Walk every criterion from Issue 7 (docs/invoicing-issues.md:438-447):
- All invoices list renders
- Clicking "Draft" sets `?status=draft` and filters
- Client filter narrows rows
- Search `"INV-003"` matches the formatted number
- Draft metric card shows correct count + sum
- Invoiced with past `dueDate` appears in Overdue (destructive), not Outstanding
- Invoiced with future `dueDate` appears in Outstanding, not Overdue
- Paid with `paidAt` this month appears in "Paid this month"
- Retainer project with closed uninvoiced month appears in the Ready-to-invoice card with a working Create button
- Once all retainer months are invoiced, the card is hidden

---
