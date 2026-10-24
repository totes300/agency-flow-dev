# PRD: Project Page + Billing Hub Redesign — One Period, One State, One Action

> **Status:** Draft for implementation · 2026-10-24 · Owner: Adam
>
> **Builds on** `docs/prd-billing-refactor.md` (close model, scope rule, pricing, D1–D11,
> N1–N11). That document stays the source of truth for *how money is computed and frozen*.
> This PRD changes *how periods are presented, counted and acted on* — on the project page,
> the Billing hub, the Close workspace and the invoice page. Where this PRD re-locks a rule of
> the billing-refactor PRD (vocabulary, badge count, hub structure), it says so explicitly.
>
> **Inputs:** `docs/billing-ux-audit-2026-10-24.md` (code-validated audit: A1–A16, decisions
> B1–B10), `docs/mockups/project-overview-linear.html` + `.README.md` (approved mockup:
> project Overview, project Billing tab, Billing hub).
>
> **Criticality.** This is the most business-critical surface of the app: it decides when a
> month is closed and what a client is billed. Every state is derived on the server, every
> button maps to exactly one existing mutation or route, and every rule here has a test.

---

## 1. Problem

The money math is correct (billing-refactor PRD), but the product does not communicate it:

1. **The month is lost.** The project Overview shows a tiny period navigator in a card corner;
   it is not obvious which month the numbers and tasks belong to.
2. **Buttons lie about what they do.** "Review invoice" suggests an invoice exists; it opens
   the Close workspace, where nothing exists yet. Starting billing has 7 labels, closing has 6,
   the worksheet has 5 names in 7 places (audit §B, §C).
3. **The UI ignores oldest-first.** Rows offer Close/Review on months the server rejects
   ("X must be closed first", audit A2).
4. **Two commit paths.** Project Close modals call `commitClose` directly, without the
   workspace checklist and skip (A3), contradicting D8.
5. **Needs-action is undercounted.** Drafts never count; a project with three open months
   counts as one (A6). Past due hides behind the inbox count.
6. **Security gaps.** Money is readable by members through three queries (A1 fixed in
   `cc3e61c`; A13 open) and the project task surface would leak cross-project tasks (A14).

## 2. Goals and non-goals

**Goals**

- G1. On a project, the selected **period** (month, or cycle for rollover) is the primary
  axis: numbers, work, billing state and documents all refer to it, and it is named large.
- G2. **One server-derived period state** with one vocabulary everywhere (project page, Billing
  hub, workspace, sidebar badge).
- G3. **One action per state**, always truthful about what happens next; commit happens only in
  the Close workspace (D8 re-confirmed).
- G4. Oldest-first is **visible**, never discovered by an error.
- G5. The Billing hub is an **inbox of periods that need action** plus an invoice ledger.
- G6. Fix A2–A16 inside the surfaces this PRD touches.
- G7. Linear/Stripe/Ramp-grade restraint: one primary button per view, quiet secondary
  actions, numbers that each mean one thing.

**Non-goals**

- Changing pricing, rounding, scope or the close data model (billing-refactor PRD owns them).
- Auto-closing months, scheduled closes, bulk multi-project close, credit notes, tax,
  client portal, "sent" invoice status (billing-refactor §14 stays out of scope).
- A T&M monthly report document (worksheet + invoice cover T&M).
- Member access to `/projects` or `/billing` (both stay admin-only; see §9).

## 3. Owner decisions (2026-10-24, binding)

| # | Decision |
|---|---|
| P1 | Project page is organised around the selected **period**; opens on the **current** period. |
| P2 | Overview = period header + finance card (original *Project Finances* content) + the period's work (Tasks-page rows) + side panel. |
| P3 | 3-period trend sits in the header next to the period title (rollover: the cycle's months). |
| P4 | Side panel: **period card** (only the selected period) + Properties + type card (Retainer / Rates / Fixed fee). No cross-period content in the period card. |
| P5 | Cross-period billing lives in a project **Billing tab** (replaces the Invoices tab) with a needs-action count on the tab. |
| P6 | "Work in {period}" = tasks with time logged in the period; the current period also shows open tasks without time. Overview = this period, Tasks tab = all tasks. |
| P7 | Overage appears on the finance card **and** the period card (analysis vs. action) — intentional. |
| B1 | Commit only in the Close workspace; project Close/Close-cycle modals are deleted. |
| B2 | One action-centred vocabulary (§5.2) everywhere. Re-locks billing-refactor Principle #3. |
| B3 | A later ended period shows its action **disabled with the reason** ("Close August first") + a link to the blocking period. |
| B4 | Buttons that open the workspace: **Review & invoice** / **Review & close**. Workspace commit keeps **Create draft invoice** / **Close period**. |
| B5 | Invoiced / Past due period card: secondary **Mark as paid**; invoice in Documents. |
| B6 | Needs-action count = **every period** in Ready to close, Ready to invoice, Needs rate, Draft. Past due is a separate red signal. Server-defined. |
| B7 | Documents: on the period card + Billing rows (Invoice, Monthly report, Worksheet). One "Export worksheet…" (custom range) in the project ⋯ menu. All other entry points removed. |
| B8 | Undo per state in ⋯ (§5.4). Void always confirms. |
| B9 | Fixed fee: while a draft exists the CTA is **Open draft** (server-enforced, A5). |
| B10 | A1 shipped alone (`cc3e61c`); A2–A16 ship with this PRD. |
| H1 | Billing hub = **Needs action** + **Invoices**, switched by underline tabs right above the list. |
| H2 | Needs action rows = **one row per period**, grouped by action type in month-end order. |
| H3 | Hub tiles: Unbilled · Outstanding · Paid this month · Months to close. |
| H4 | Lists reuse the Tasks-page building blocks (group header, row grid, "+ Filter", Display, URL state); only the project "Work" list is `TaskView` itself. |
| S1 | Delivered as **one branch, one PR**, in slices (§12), green gates after every slice. |
| P8 | Retainer **cycle settings** (start date, cycle length, rollover) are locked while any live close exists; fee, included hours and overage rate stay editable (§6.7). |
| P9 | T&M finance card shows **Unbilled · Billed** for the period; "Billed" = covered by a live close (draft or finalized) — one definition app-wide (§6.8). |
| P10 | Hub tiles are **information only**, not filters (§8). |

## 4. Glossary

- **Period** — billing-refactor §4: calendar month (T&M, non-rollover retainer) or an N-month
  **cycle** (rollover retainer). Fixed fee and non-billable projects have no billing periods
  (they still have calendar months for time and work).
- **Committable period** — the oldest ended period without a live close (`committablePeriod`,
  `convex/lib/billing/scope.ts:185-211`). Only it can be committed.
- **Blocked period** — ended, no live close, not committable. `blockedBy` = the committable one.
- **Period state** — §5.1. Derived on the server only.
- **Needs action** — states Ready to close, Ready to invoice, Needs rate, Draft (B6).

## 5. The period state model

### 5.1 Derivation (server, pure function)

New pure module `convex/lib/billing/periodState.ts`:

```
derivePeriodState(input) → PeriodState
input = {
  periodEnded: boolean,          // period.end < todayOrgTz
  liveClose: { status: "draft" | "final", invoiceId?: Id } | null,
  invoice: { status: "draft"|"invoiced"|"paid"|"void", dueDate?: string } | null,
  amountMinor: number,           // priceScope for open periods; frozen close amount otherwise
  missingRate: boolean,          // pricing issue "missing-overage-rate"
  isCommittable: boolean,
  todayOrgTz: string,
}
```

Rules, first match wins:

| # | Condition | State |
|---|---|---|
| 1 | `!periodEnded` | `in_progress` |
| 2 | `liveClose` with invoice `draft` (incl. reverted, numbered drafts) | `draft` |
| 3 | `liveClose` with invoice `paid` | `paid` |
| 4 | `liveClose` with invoice `invoiced` and `dueDate < today` | `past_due` |
| 5 | `liveClose` with invoice `invoiced` | `invoiced` |
| 6 | `liveClose` `final`, no invoice | `closed` |
| 7 | no live close, `missingRate` | `needs_rate` |
| 8 | no live close, `amountMinor > 0` | `ready_to_invoice` |
| 9 | no live close | `ready_to_close` |

Plus orthogonal flags on every ended open period: `isCommittable`, `blockedBy?: PeriodRef`.
Rollover mid-cycle **months** are not periods; they never get a state of their own (§7.2).
T&M: an ended month with an empty billable scope is **not a period row** (it is not
committable and not shown), mirroring `committablePeriod` (billing-refactor §6).

`void` invoices are invisible: a voided close is released, so the period falls back to rows
7–9 (consistent with `projects.ts:619`, `invoices.ts:400`).

### 5.2 Vocabulary (the copy deck — exact strings)

| State | Chip | Tone | Meaning shown on hover |
|---|---|---|---|
| `in_progress` | In progress | grey | Period not over yet |
| `ready_to_close` | Ready to close | blue | Ended within budget — review and close |
| `ready_to_invoice` | Ready to invoice | blue | Ended with billable work — review to create the draft |
| `needs_rate` | Needs rate | amber | Over budget but no overage rate |
| `draft` | Draft | amber | Draft invoice waiting to be finalized |
| `invoiced` | Invoiced | green | Finalized, not yet paid |
| `past_due` | Past due | red | Invoiced, past the due date |
| `paid` | Paid | green | Paid |
| `closed` | Closed | green | Closed within budget, nothing invoiced |

Invoice-only statuses (Invoices views): **Draft · Invoiced · Past due · Paid · Void**.
"Overdue" is renamed **Past due** everywhere. "Outstanding" = Invoiced + Past due.
Chips use the existing `ColoredPillBadge` with `showDot` (approved badge hierarchy).

Action labels (sentence case everywhere — fixes title-case drift in `invoice-sidebar.tsx`):

| Action | Label | Does |
|---|---|---|
| Open workspace, over budget | **Review & invoice** | Navigates to `/billing/close/{projectId}/{period}` |
| Open workspace, within budget | **Review & close** | Same route |
| Workspace commit | **Create draft invoice** / **Close period** | `commitClose` (unchanged) |
| Draft | **Open draft** | `/invoices/{id}` |
| Invoiced / Past due | **Mark as paid** | `changeInvoiceStatus → paid` |
| Needs rate | **Set rate** | Project settings, retainer section anchor |
| Fixed fee, nothing drafted | **Create invoice** | `createFixedInvoice` → `/invoices/{id}` |
| Undo (⋯ only) | **Reopen period · Delete draft · Revert to draft · Void invoice… · Mark as unpaid** | §5.4 |
| Documents | **Invoice · Monthly report · Worksheet** | §6.5 |
| Custom export | **Export worksheet…** | `AdHocExportDialog` → `exportRange` |
| Drill-down | **View entries** | `PeriodDetailSheet` |

Removed labels (must not appear after this PRD): Review to invoice, Review {month}, Create
Invoice (title case), Generate invoice, Invoice unbilled hours, Close cycle (as a separate
button), Review & close {month} (modal), Close without invoice, ready to bill, close & report,
Overdue, Download cycle worksheet, Download report, View report, "Billed here".

### 5.3 Action matrix (what button a period shows)

| State | Committable? | Primary action | Where |
|---|---|---|---|
| in_progress | — | none | — |
| ready_to_invoice | yes | Review & invoice (primary) | card, Billing row, hub row |
| ready_to_invoice | no | Review & invoice **disabled**, reason "Close {blockedBy} first" + link | same |
| ready_to_close | yes | Review & close | same |
| ready_to_close | no | disabled + reason + link | same |
| needs_rate | (any) | Set rate | same |
| draft | — | Open draft | same |
| invoiced / past_due | — | Mark as paid (secondary) | same |
| paid / closed | — | none | — |

Exactly one primary (filled) button per view: on the project page the period card's button is
primary only for `ready_to_invoice`; in a list, only `ready_to_invoice` rows use the filled
style.

### 5.4 Undo matrix (⋯ menu, per state)

| State | Items (after View entries · Download worksheet) | Backend |
|---|---|---|
| closed | Reopen period | `reopenClose` — only if every later close is released; otherwise the item is disabled with "Reopen {later period} first" |
| draft, never numbered | Delete draft | `deleteInvoice` |
| draft, numbered (reverted) | Void invoice… | `changeInvoiceStatus → void` |
| invoiced / past_due | Revert to draft · Void invoice… | `invoiced → draft` / `→ void` |
| paid | Mark as unpaid | `paid → invoiced` |

Void always opens a confirm dialog naming the invoice and the effect ("The period reopens and
its time can be billed again."). Bulk void of drafts is removed (drafts are deleted, A8).

### 5.5 Needs-action count (B6)

`needsActionCount(project)` = number of period rows in `ready_to_close | ready_to_invoice |
needs_rate | draft`, **including blocked periods** (they are work waiting). `pastDueCount` =
invoices in `past_due`. Org totals = sums over non-archived retainer + T&M projects, plus fixed
drafts (a fixed draft is `draft` needs-action on its project).

Sidebar badge (`nav-main.tsx`, unified red badge): shows `needsAction`; if 0 and
`pastDue > 0`, shows `pastDue`. Tooltip: "{n} periods need action · {m} past due".

## 6. Backend changes

### 6.1 `billingViews.getProjectBillingPeriods({ projectId })` — new, admin

The single read model for the project page (Overview card, trend, Billing tab, tab count).

```
returns {
  billingType, currency, timezoneToday,
  terms: { includedMinutes?, monthlyFeeMinor?, overageRateMinor?, rolloverEnabled, cycleLength,
           fixedPriceMinor? },
  periods: PeriodRow[]            // newest first, from project start to the current period
  needsActionCount, pastDueCount,
  latestInvoice: { id, number?, status, issuedAt? } | null,
  totals: { unbilledMinor, outstandingMinor }
}
PeriodRow = {
  key: "YYYY-MM" (period start month), start, end, label ("August 2026" | "Aug – Oct 2026"),
  months: { key, label, workedMinutes }[],      // for the trend + rollover breakdown
  usageMinutes, billableMinutes, nonBillableMinutes, includedMinutes?,
  overageMinutes, amountMinor,                   // server-priced (pricing.ts), frozen when closed
  state: PeriodState, isCommittable, blockedBy?: { key, label },
  closeId?, closeStatus?,
  invoice?: { id, number?, status, dueDate?, paidAt? },
  documents: { monthlyReport: "final" | "preview" | null, worksheet: "close" | "range" },
}
```

Build (no N+1 beyond one `db.get` per live close invoice):
- `loadCloseContext` once (`closeData.ts:99-122`).
- Closed periods: frozen `billingCloses` fields (`status`, `invoiceId`, `amountMinor`,
  `usageMinutes`, `overageMinutes`, span). **Do not** call `buildPeriodView` per close (it
  reads `billingCloseEntries` per close, `periodView.ts:69-70`).
- Open periods: `scopeOf` + `priceScope` (pure), enumerated via the grid helpers
  (`periods.ts:97-104`) for retainers and the `effectivePeriod` loop for T&M.
- `committablePeriod` once.
- State via `derivePeriodState` (§5.1).

Fixed fee returns `periods: []` plus `fixed: { priceMinor, invoicedMinor, draft?: {id},
remainingMinor, invoices: InvoiceSummary[] }`. Non-billable returns `periods: []`.

### 6.2 `billingViews.getNeedsAction({})` — new, admin (hub)

One row per needs-action period (+ past-due invoices) across non-archived projects, built by
running the §6.1 builder per project (shared internal helper, not a nested query). Row:
`{ projectId, projectName, clientName, billingType, period: PeriodRow subset, group }`, groups
in month-end order: `needs_rate · ready_to_invoice · ready_to_close · draft · past_due`.
Includes hub tiles: `unbilledMinor` (ready_to_invoice + draft amounts), `outstandingMinor`
(+ `pastDueCount`, `invoicedCount`), `paidThisMonthMinor` (+ count), `monthsToClose`
(ready_to_close count + `waitingCount`).

Replaces `getCloseQueue` for the hub list. `getNavSignals` is rewritten on the same helper and
returns `{ needsActionCount, pastDueCount }` (A6, A16: one pass, shared with the hub; no second
queue build).

### 6.3 Task list scoped to a period

`tasks.queries.listView` gains `workedIn?: { from: string; to: string }`, allowed only with
`surface: "project"`. Server: collect task ids from the project's entries in range
(`getProjectEntries`), `db.get` each, then apply the view spec (filters, ordering, grouping),
**including archived tasks and closed tasks regardless of `closedLimit`** (a month's work must
be complete). When `workedIn.to >= today`, also include the project's open tasks (P6).

Fix A14 in the same change: on the project surface `projectId` is always applied, for every
role, before any assignee plan.

### 6.4 Permission fixes

- A13: `timeEntries.projectOverview` and `projectMonthlyBreakdown` → `requireAdmin` (all
  callers are admin-only surfaces; verify with grep before changing; add member-rejection tests
  like `billingReadPath.test.ts` "getRetainerData access").
- All new queries: `requireAdmin`; org from auth only; project ownership checked after `get`.

### 6.5 Documents

| Document | Retainer | T&M | Fixed | Source |
|---|---|---|---|---|
| Invoice | when a live close has one | same | per invoice | `/invoices/{id}` (print = PDF) |
| Monthly report | always; **Preview** until the period's close is `final`, then **PDF** | — | — | `/projects/{id}/reports/{YYYY-MM}` |
| Worksheet | `exportClose(closeId)` when closed, else `exportRange(period)` | same | `exportRange` | `worksheets.ts` |

### 6.6 Fixed fee (A5)

`createFixedInvoice`: if the project has a draft fixed invoice, throw
`ConvexError({ code: "DRAFT_EXISTS", invoiceId })`; UI shows **Open draft** instead of
**Create invoice** from `getProjectBillingPeriods.fixed.draft`. Remaining shown on the card =
`priceMinor − invoicedMinor − draftMinor`.

### 6.7 Retainer settings guard (A7)

`projects.updateRetainer`: reject changes to `startDate`, `cycleLength` or `rolloverEnabled`
while any live close exists ("Reopen or void the closed periods before changing the billing
cycle."). Fee, included hours and overage rate stay editable (they apply to open periods only;
closed periods are frozen — D11).

### 6.8 One definition of "billed" (A15, P9)

**Billed** = billable entries covered by a live close (draft or final) — today's
`computeTmSummary` rule (`projectSummary.ts:193`). **Unbilled** = open billable entries.
`projectOverview` drops its separate draft bucket for these totals (its `draft*` fields may stay
for internal use but no surface shows "Draft" as a money column). The period card still shows
the `draft` *state* with Open draft.

## 7. Project page

Route `app/(dashboard)/projects/[id]/page.tsx`. Tabs: **Overview · Tasks · Time · Billing ·
Settings** (Billing and the period card are hidden for non-billable projects; Time stays).

### 7.1 URL state

- `?period=YYYY-MM` — the selected period (any month; rollover snaps to its cycle on the
  server). Absent = current period. Replaces `cycleOffset` and `summaryRange*` (redirect old
  params to `?period=` once, then drop).
- `?tab=` unchanged. TaskView's own params (`view`, `filter`, `q`, display) unchanged.

### 7.2 Overview — layout (all billable types)

1. **Period header**: `‹ ›` (outlined icon buttons) + period title (24px semibold) + `⋯`
   (period menu: View entries, Download worksheet, undo per §5.4). Subline: date range ·
   "current month · N days left" | "ended · **Back to current month**" (link). Rollover title
   "Aug – Oct 2026", subline adds "3-month cycle".
2. **Trend** (right of the header): the selected period and the two before it — thin bars,
   dashed included-hours line, month + hours under each bar; selected bar dark, over-budget
   red. Click = select. Rollover: the cycle's months, the dashed line at the monthly included
   hours (the pooled cycle budget is on the finance card). T&M: hours only, no line. Fixed /
   non-billable: hidden.
3. **Finance card** — the original *Project Finances* columns, no card header:
   - Retainer: Time breakdown (semicircle gauge `BudgetArc` + Billable / Non-billable) ·
     Overage (Over budget, Overage due) · Profitability (Earned revenue, Profit, Total cost,
     Margin).
   - T&M: Time breakdown (Total hours + Billable / Non-billable, no gauge) · Billing
     (Unbilled, Billed for the period — §6.8) · Profitability.
   - Fixed ("Project to date"): Time breakdown (gauge vs. estimate, Remaining) · Billing
     (Fixed fee, Invoiced, Remaining) · Profitability (+ Expected / Effective rate).
   - Non-billable: Time breakdown only.
4. **Work in {Month}** — section title + count, right: Filter + Display (TaskView's own). Body:
   `TaskView surface="project" workedIn={period}` (§6.3); default grouping status, columns
   priority · ID · status · title · assignee · time-in-period. Fixed: "Work" with no period
   scope (active view). Empty: "No time logged in {Month}." with "Log time" (current period).
5. **Side panel** (separate grey surface, white cards; toggle in the tab bar, remembered in
   `localStorage`, closed by default under 1200px):
   - **Period card** (§7.3) — billable types only.
   - **Properties**: Status, Client, Lead, Team.
   - **Type card**: Retainer (Included, Fee, Overage rate, Rollover) · Rates (T&M default rate,
     rounding) · Fixed fee (Fee, Estimate).

### 7.3 Period card

Header: period name + state chip. Body: label → amount (24px) → one sub-line → action.

| State | Label | Amount | Sub-line | Button |
|---|---|---|---|---|
| in_progress | Overage so far (T&M: Billable so far) | live amount | "Within budget · closes after Oct 31" / "+02:30 over" | — |
| ready_to_invoice | Overage to invoice (T&M: To invoice) | amount | "+02:30 over 08:00 · $100/h" (T&M: "14:20 billable") | Review & invoice (primary) |
| ready_to_close | Nothing to invoice | $0.00 muted | "Ended · within budget" | Review & close |
| needs_rate | Overage not priced | — | "+02:30 over · no overage rate" | Set rate |
| blocked (any open) | as above | as above | as above | disabled + "Close {blockedBy} first · Go to {blockedBy}" |
| draft | Overage on draft | amount | "INV-0043 · not finalized yet" (unnumbered: "Draft invoice") | Open draft |
| invoiced | Overage invoiced | amount | "INV-0042 · due Nov 3" | Mark as paid |
| past_due | Overage invoiced | amount | "INV-0040 · due Jul 16 · 100 days overdue" (red) | Mark as paid |
| paid | Overage billed | amount | "INV-0038 · paid Jun 20" | — |
| closed | Nothing to invoice | $0.00 muted | "Closed Oct 2 · within budget" | — |

**Documents** section under it: Invoice (if any; "Draft" tag while draft), Monthly report
(retainer; "Preview"/"PDF"), Worksheet. Each row = icon · name · type · download/open icon.

Fixed fee card ("Fixed fee"): chip Not invoiced / Partly invoiced / Draft / Fully invoiced;
amount = Remaining; sub-line "$6,000 of $12,000 invoiced"; button Create invoice | Open draft;
Documents = the project's fixed invoices.

### 7.4 Billing tab (replaces Invoices)

- Header: "Billing" + terms line ("Retainer · 08:00 included · $800.00 / month · overage
  $100.00 / h" | "Time & materials · $95.00 / h" | "Fixed fee · $12,000.00").
- Tiles: Unbilled · Outstanding (+ "N past due" red) · Latest invoice.
- Period list (retainer/T&M), newest first: Period · State chip · Hours (`10:30 / 08:00`, red
  when over) · Amount · Invoice number · Action (§5.3, disabled+reason when blocked) · Files
  (report, worksheet icons) · hover ⋯ (§5.4). Row click → Overview at that period.
- Fixed fee: invoice list (installments) + Create invoice / Open draft.
- Tab label shows `needsActionCount` (blue) and a red dot when `pastDueCount > 0`.
- Absorbs today's `ProjectInvoices` content; its callouts and "Paid lifetime" go away.

### 7.5 Time tab

Keeps the entry table, filters, Add time. **Removes** "Invoice unbilled hours", the selection
"Review to invoice" (A4) and the separate Worksheet button (B7: period card + project ⋯).
Locked-row menu: "Open invoice", "View period" (→ Overview at that period), "Reopen period"
(retainer, per §5.4) — fix A12 (dialog shows the period's hours).

### 7.6 Header and ⋯

Header unchanged except: Edit stays; ⋯ = **Export worksheet…** · Archive/Restore · Delete.

### 7.7 Deleted on the project page

`MonthlyBreakdownCard` (+ `ROW_GRID`, `SortToggle`, `BilledHereHeader`, `StripeDisclaimer`),
`ClosePeriodModal`, `CloseCycleModal`, `InvoiceBanner` (project usages), `ProjectSummaryCard`
navigators (`CycleNavigator`, `DateRangePicker`), `retainer-row-action.ts` (replaced by
`derivePeriodState` + §5.3), project `InvoicesEmptyState` copy, `RoleGatedColumn` usages.

## 8. Billing hub (`/billing`)

1. Title "Billing" + subline "October 2026 · month-end in N days".
2. Tiles (H3): **Unbilled** ("2 ready · 1 draft") · **Outstanding** ("1 past due · 1
   invoiced") · **Paid this month** ("1 invoice") · **Months to close** ("1 waiting on an
   earlier month"). Tiles are information only (P10).
3. **View tabs** directly above the list (underline, 15px, count pills): **Needs action**
   (blue count = `needsActionCount`, which excludes past due; red dot if any past due) ·
   **Invoices** (grey count). Right: Filter · Display. URL: `?view=action|invoices`. The Past
   due group is listed under Needs action but not counted (it is a collection task, not a
   month-end task — §5.5).
4. **Needs action**: groups (GroupHeaderRow: icon · name · count · one-line hint) in order
   Needs rate → Ready to invoice → Ready to close → Drafts → Past due. Row: Period · Project
   (sub-line: type · reason) · Client · Hours · Amount · Action (§5.3) · hover ⋯. Blocked rows
   are muted with the disabled button + "Close {period} first". Row click → project Overview
   at that period. Filters ("+ Filter"): Client, Project, Billing type, State. Empty: "All
   caught up" + "View invoices".
5. **Invoices**: status filter pills with counts (All · Draft · Invoiced · Past due · Paid ·
   Void) + "+ Filter" (Client, Project). Columns: Number · Client · Project · Period · Issued ·
   Due (red when past due) · Amount · Status · hover ⋯. Bulk: Mark as paid (with the existing
   5-second undo `markInvoicesPaid`/`undoMarkInvoicesPaid`, previously unwired). No bulk void.
6. Removed: "To close" tab, Close/"Close without invoice" tiles, one-row-per-project queue.

## 9. Permissions and tenancy

- `/projects`, `/billing`, `/invoices` stay admin-only (`lib/route-access.ts`). All new and
  touched queries call `requireAdmin`; org comes from auth; IDs read by `get` are ownership-
  checked before use.
- Member UI branches on these surfaces are deleted (unreachable today, audit §UI).
- If members ever get project access, the rule is: no money (no Profitability, no amounts, no
  period card amounts, no Billing tab) — not implemented now.

## 10. Close workspace and invoice page

- Workspace header chip uses §5.2 vocabulary. When the period is already closed: show
  **Monthly report**, **Worksheet** and the state's undo (§5.4) instead of the bare "Closed"
  card (audit: closed view had no reopen/report).
- Workspace for a **blocked** period: banner "Close {blockedBy} first" + link; commit disabled
  (server already rejects).
- Invoice page: Back goes to the referrer (`?from=` param: project Billing tab, hub view +
  filter) instead of `/invoices` (A9). Lock banner copy per status (A10: no "Revert to draft"
  hint on paid/void). Title-case labels → sentence case. Void confirm.
- Error copy for locked entries (`timeEntries.ts:48`) branches on numbered vs. unnumbered draft.

## 11. Edge cases (each needs a test)

1. Late entry dated in a closed period → counts in the next open period; the closed period's
   numbers and report do not change (N8).
2. Void an invoice → period returns to ready_to_*; its `needsActionCount` rises again.
3. Revert invoiced → draft (numbered) → state `draft`, undo offers Void, not Delete.
4. Reopen with a later live close → disabled with reason.
5. Missing overage rate on an over-budget period → `needs_rate`, Set rate, never a commit.
6. Empty retainer month → `ready_to_close` (blocks oldest-first, must be closed).
7. T&M month with no billable entries → no row.
8. Rollover mid-cycle → no per-month state; the cycle row carries it; trend shows months.
9. Retainer settings change with live closes → rejected (§6.7).
10. Fixed fee second "Create invoice" while a draft exists → rejected, UI shows Open draft.
11. Current period with overage so far → in_progress, amount shown, no action.
12. Timezone: "ended" and "past due" use the org timezone (`orgSettings.timezone`).
13. Period param before project start / in the future → clamp to first / current period.
14. Archived project → excluded from hub and counts; its page still renders read-only actions.

## 12. Slices (one branch, one PR — S1)

Each slice ends green: `npx tsc --noEmit`, `npm run lint`, `npm test`, plus the manual pass
in §13 for the surfaces it touched.

| # | Slice | Contents | Done when |
|---|---|---|---|
| 0 | Period state core | `periodState.ts` + exhaustive unit tests (every row of §5.1/§5.3/§5.4) | 100% branch coverage of the table |
| 1 | Project read model | `getProjectBillingPeriods` (+ fixed/non-billable shapes); N11-style consistency test: period rows agree with workspace, queue amount, report, invoice | test suite green; no per-close snapshot reads |
| 2 | Org read model + badge | `getNeedsAction`, new `getNavSignals`, badge + tooltip | counts match §5.5 in tests |
| 3 | Security + data fixes | A13, A14 (+ `workedIn`), A5, A7, A15 — each with a named test | member tests reject; fixed draft guard |
| 4 | Project Overview | period header, trend, finance card per type, Work list, side panel, period card, `?period=` | manual pass §13 (all types) |
| 5 | Project Billing tab + Time tab | Billing tab, Time-tab removals, A12, locked-row menu | manual pass |
| 6 | Billing hub | tiles, view tabs, Needs action, Invoices, filters, bulk paid + undo | manual pass |
| 7 | Workspace + invoice page | vocabulary, closed-view actions, blocked banner, Back (A9), A8, A10 | manual pass |
| 8 | Cleanup | delete §7.7 components, removed labels grep-clean (§5.2 list), dead code (`InvoicesMetricCards`, member branches), stale comments in `retainer-row-action.ts` (deleted) | `rg` for every removed label returns nothing |

## 13. Verification

**Automated**
- `periodState` table tests (slice 0).
- `convex-test` suites: project read model per type; needs-action across projects; every
  edge case in §11; member rejection for every new/touched query.
- Existing N11 consistency suite (`billingReadPath.test.ts`) stays green and is extended with
  `getProjectBillingPeriods`.

**Manual pass** (reseed first, light theme, admin):
- Monthly retainer: current → previous months; one month in each state of §5.2; blocked month
  shows disabled + link; Review & invoice → workspace → Create draft invoice → Open draft →
  finalize → Mark as paid → Mark as unpaid → Void (confirm) → period back to ready.
- Rollover retainer: cycle title, trend months, mid-cycle has no actions, cycle close.
- T&M: month states, no monthly report, Time tab has no invoice buttons.
- Fixed: Project to date, Create invoice → second click shows Open draft.
- Hub: groups order, blocked rows, tiles filter, Invoices filters, bulk Mark as paid + undo,
  badge = needs action, tooltip, past-due-only badge.

## 14. Out of scope / open questions

- Out: everything in §2 non-goals; billing history/events view (billing-refactor optional);
  mobile layout beyond "side panel closed under 1200px".
- Open (owner, before slice 4): none blocking. Nice-to-have later: per-client billing view in
  the hub; email/send state for invoices.

## 15. Execution notes (for the implementing session)

Read first, in order: this PRD → `docs/billing-ux-audit-2026-10-24.md` →
`docs/mockups/project-overview-linear.html` (open in a browser; Projects/Billing in the
sidebar, "View as" switch) → `docs/prd-billing-refactor.md` §4–§10 →
`convex/_generated/ai/guidelines.md` (note: guidelines target Convex 1.44, installed is
1.34.1 — verify version-specific APIs).

Key code: `convex/lib/billing/{scope,pricing,periods,periodView,closeData,closeLifecycle}.ts`,
`convex/billingViews.ts`, `convex/billingCloses.ts`, `convex/invoices.ts`,
`convex/billingInvoices.ts`, `convex/projects.ts` (`getRetainerData`, `getSummary`,
`updateRetainer`), `convex/timeEntries.ts` (`projectOverview`, `projectMonthlyBreakdown`),
`convex/tasks/{queries,read}.ts`, `components/projects/**`, `components/billing/**`,
`components/invoices/**`, `components/task-view/**`, `components/nav-main.tsx`.

The worktree carries unrelated uncommitted work (MCP, list pages). Commit only this PRD's
files per slice; never stash/clean/restore.
