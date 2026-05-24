# Time Tracking: All Projects Workbench

Status: Draft v1  
Owner: Adam Toth  
Route: `/time-tracking`  
Audience: Admins / agency operators  
Related surface: Project detail -> Time tab

## 1. Summary

`/time-tracking` is the all-project version of Project Time. It gives admins one
place to review time, clean up entries, and create invoice drafts.

The page should feel close to Bonsai's time tracking surface: dense table,
grouping, filters, billing status, row actions, and direct invoice actions.
It should also borrow the simplicity of Toggl and Clockify, the task-first
review model of ClickUp, and the billing-type awareness of agency operations
tools like Scoro.

The core v1 principle:

> Same surface pattern, separate billing logic.

T&M, Retainer, and Fixed must not be mixed in one ledger. They are reviewed,
reported, and invoiced differently.

## 2. Product Goals

V1 should let an admin:

1. Review time across all projects.
2. Keep T&M, Retainer, and Fixed work separated.
3. Filter and group quickly.
4. Edit or clean up entries before invoicing.
5. Select eligible work and create invoice drafts.
6. See billing state clearly enough to avoid double billing.
7. Catch retainer periods/cycles that need action without making retainers look
   like T&M.

## 3. Non-Goals

Do not build these in v1:

- Profitability or margin reporting.
- Saved views.
- Tags.
- Calendar, heatmap, or pivot views.
- Advanced export.
- Multi-project invoices.
- Automated invoice generation.
- Bulk mark-as-billed without creating an invoice.
- A replacement for the invoice review page.

All invoice actions create drafts and send the user into the existing invoice
review flow.

## 4. Page Model

The page has three tabs:

| Tab | Shows | Decision unit | Invoice pricing source |
| --- | --- | --- | --- |
| T&M | T&M project time | Billable time entries and tasks | Hours x captured rate |
| Retainer | Retainer periods/cycles | Project period/cycle | Overage rules; monthly fee as context if billed separately |
| Fixed | Fixed project work | Project/category budget and selected evidence | Fixed amount / remaining contract amount |

Tabs use the same UX pattern but do not share billing logic.

Default tab: `T&M`.

## 5. Shared Layout

Header:

- Title: `Time Tracking`
- Helper text: `Review time across projects, clean it up, and create invoice drafts.`
- Primary action: `Add Time`

Toolbar:

- Search
- Date range
- Filter button with active count
- Group by

Search matches:

- Task title
- Entry note
- Project name
- Client name
- Member name

Date range presets:

- This week
- Last week
- This month
- Last month
- This year
- All time
- Custom

Default date range: `This month`.

Filter drawer fields:

- Client
- Project
- Member
- Category / role
- Currency
- Status, using tab-specific values

URL state persists:

- Active tab
- Search
- Date range
- Filters
- Group by

URL state does not persist:

- Expanded groups
- Selected rows
- Open modals

## 6. Shared Table Behavior

The table should be dense, scannable, and stable. Avoid card-style row layouts.

Implementation direction: reuse the existing Project Time table/component
grammar wherever possible. `/time-tracking` is the global version of that
surface, not a separate table invention.

The canonical time-entry columns are:

1. Select, where selection is valid.
2. Date.
3. Member.
4. Project, global page only.
5. Client, global page only.
6. Task.
7. Category / role.
8. Billing, e.g. Billable or Non-billable.
9. Status, e.g. Unbilled or Invoiced.
10. Hours.
11. Rate / Amount, where financially meaningful.
12. Row actions.

Common table behavior:

- Group headers show totals.
- Groups can collapse and expand.
- Entry rows can be opened for edit/review.
- Invoiced/finalized entries are locked.
- Row actions live on the far right.
- Invoice-linked rows offer a path to the invoice.

Common row actions:

- Edit entry, when allowed.
- Delete entry, when allowed.
- Open task.
- Open project.
- Open invoice, when linked.

`Add Time` uses the existing manual time-entry model. Admins can log time for
self or another valid org member.

## 7. T&M Tab

### Purpose

Help the owner find billable, uninvoiced T&M work and create an invoice from
selected time.

### Status Model

Use the fewest states that answer the operator's next question.

T&M row state:

- `Unbilled`
- `Invoiced`
- `Non-billable`

Do not show `Draft`, `Paid`, or `Overdue` on T&M time rows in v1. Those belong
on the invoice itself. Time Tracking only needs to answer: can this row still be
used for invoice creation?

### Columns

| Column | Notes |
| --- | --- |
| Select | Entry/task/project selection |
| Date | Entry date |
| Member | Avatar + name |
| Category / role | Work category |
| Task | Task title + entry note |
| Project | Project name |
| Client | Client name |
| Billing | Billable / non-billable |
| Status | Unbilled / Invoiced / Non-billable |
| Hours | Entry or group total |
| Rate | Captured billable rate |
| Amount | Hours x rate |
| Actions | Row menu |

### Grouping

Default: `Project`.

Options:

- None
- Day
- Week
- Month
- Project
- Member
- Task

Project groups show total hours and unbilled amount.

### Selection

Selection is allowed at:

- Entry level
- Task level
- Project group level

Eligible entries:

- Same project
- Billable
- Not linked to an invoice

The bulk bar shows:

- Selected count
- Project
- Total hours
- Billable amount
- Currency

Primary action:

- `Create invoice from selection`

Disable invoice action when:

- Selection spans multiple projects.
- Any selected row is non-billable.
- Any selected row is already invoiced.
- There is no billable amount.

### Invoice Behavior

The created draft:

- Belongs to one project.
- Uses selected time entries.
- Calculates amount from selected hours and captured rates.
- Links included entries to the invoice.
- Opens the invoice review page after creation.

## 8. Retainer Tab

### Purpose

Help the owner review retainer periods/cycles, understand usage against the
included budget, and create the correct retainer invoice/report action.

### Key Rule

Retainer is not T&M. Time entries are usage/report evidence and overage input,
not independently priced rows.

Rollover changes the decision unit:

- Rollover off: one month is the settlement unit.
- Rollover on: the cycle is the settlement unit; mid-cycle months are usage
  progress only.

For rollover projects, show cycle used/included totals such as `72h / 120h`
for a 3-month cycle. Do not show a single month as if it settles independently.

### Layout

Retainer should not use the same wide table as T&M. The cleanest v1 pattern is
master-detail:

- Left side: one compact list of retainer months/cycles.
- Right side: detail for the selected month/cycle.

The left list shows only:

- Project
- Period/cycle label
- State: `Open`, `Ready`, `Done`
- Used / included progress
- Overage or `Report`

The detail pane shows:

- Project, client, selected month/cycle.
- Used, included, overage, monthly fee context.
- Primary action: `Create overage invoice`, `Open report`, or disabled `No action yet`.
- Measured work grouped by task, with time entries underneath using the same
  Project Time entry columns: Date, Member, Task, Category, Billing, Hours, and
  note/context.

This keeps the relationship obvious:

> selected retainer period -> its tasks -> its time entries.

Do not render a separate group row, period row, and footer row for the same
period. That creates duplicate hierarchy and makes it hard to see what belongs
to what.

### Status Values

Retainer period/cycle state:

- `Open` — still in progress, no action yet.
- `Ready` — closed and needs review/action.
- `Done` — invoice/report action is complete.

The row detail explains what `Ready` means:

- `Overage due`
- `Report only`
- `Monthly fee context`

Do not turn these details into separate primary statuses unless users cannot
understand the action.

### Grouping

Default: `Project / period`.

Useful options:

- Project
- Client
- Month / cycle
- Member, for review only

Do not offer grouping that makes retainer time entries look independently
priced.

### Selection

Selection is period/cycle based where a billing/report action exists.

V1 should support one selected period per invoice. Multiple selected periods can
be deferred unless each selection creates a separate draft.

### Invoice Behavior

The created draft/report action:

- Belongs to one project.
- Uses the selected period/cycle.
- Shows monthly fee as context if monthly fee is billed separately.
- Includes overage when applicable.
- Includes tasks/time entries as report evidence.
- Links included entries according to existing invoice semantics.
- Opens the invoice review page after creation.

## 9. Fixed Tab

### Purpose

Help the owner review work on fixed projects, spot category/project budget
issues, select delivery evidence, and create fixed invoice drafts.

### Key Rule

Fixed is not hourly billing. Time entries are delivery evidence and budget
signals, not the pricing unit.

Fixed estimates are category/project-level in this product. Do not show task
quoted progress unless task estimates become a deliberate product feature. Tasks
can appear under categories as evidence, but progress is category or project
budget progress.

### Columns

| Column | Notes |
| --- | --- |
| Select | Category/task/entry evidence selection where supported |
| Project | Project name |
| Client | Client name |
| Category | Estimated work category |
| Task | Task title as evidence |
| Member | Avatar + name |
| Actual | Logged hours |
| Estimated | Category or project estimate |
| Remaining | Estimate minus actual |
| Progress | Category/project budget usage |
| Status | Fixed billing/scope state |
| Actions | Row menu |

### Status Values

Fixed project/category state:

- `Open` — work is being tracked.
- `Ready` — selected work can be used as invoice evidence.
- `Done` — already included in an invoice/report.

Budget health is separate and visual:

- `On budget`
- `Over budget`
- `No estimate`

Do not create separate invoice lifecycle badges for Fixed rows in v1.

### Grouping

Default: `Project`.

Useful options:

- Project
- Client
- Category
- Project
- Member
- Month

### Selection

Selection represents delivery evidence, not hourly pricing.

Supported selection targets:

- Task
- Time entry
- Category group

### Invoice Behavior

The created draft:

- Belongs to one project.
- Uses selected work as report evidence where supported.
- Lets the user confirm fixed/remaining amount.
- Does not calculate amount from time-entry rates.
- Opens the invoice review page after creation.

If selected fixed evidence is too much for v1, keep the v1 action at project
group level: `Create fixed invoice`.

## 10. Billing Semantics

`invoiceId` on a time entry means:

> This entry was included in an invoice scope.

Financial meaning depends on billing type:

| Billing type | Meaning of linked entry |
| --- | --- |
| T&M | Entry directly contributed to invoice amount |
| Retainer | Entry was included in usage/reporting/overage calculation for the period or cycle |
| Fixed | Entry was included as delivery evidence |

Do not allow invoice creation from mixed billing types.

Do not allow invoice creation from mixed projects in v1.

## 11. Permissions

V1 page access:

- Admin only.

Admins can:

- View all project time.
- Add time for self or another member.
- Edit non-invoiced entries.
- Delete non-invoiced entries.
- Create invoice drafts.
- Open linked invoices.

Members continue using `/my-time` and project-level surfaces.

Backend rules remain the source of truth.

## 12. Empty States

| Case | Copy | Action |
| --- | --- | --- |
| Filters hide everything | No time matches these filters. | Clear filters |
| No T&M time | No T&M time was logged in this period. | Try all time |
| No retainer periods | No retainer periods match this date range. | Try this month |
| No fixed time | No fixed-project time was logged in this period. | Try all time |
| No projects of type | No projects of this billing type yet. | Go to Projects |

## 13. Acceptance Criteria

### Shared

- Admin can open `/time-tracking`.
- Non-admin cannot access `/time-tracking`.
- Page has T&M, Retainer, and Fixed tabs.
- Tabs never mix billing types.
- Search, date range, filters, and grouping work per tab.
- URL persists tab, search, date range, filters, and grouping.
- Group rows show relevant totals.
- Invoiced/finalized entries are locked.
- `Add Time` reuses the existing time-entry flow.
- Invoice actions create drafts and open invoice review.

### T&M

- Shows T&M work only.
- Supports entry, task, and project-group selection.
- Selection cannot create invoices across projects.
- Invoice amount comes from selected hours and captured rates.
- Already invoiced entries cannot be selected for invoicing.

### Retainer

- Shows retainer periods/cycles only.
- Shows closed periods/cycles that are ready for review/action.
- For rollover projects, rows show cycle used/included, not only monthly used/included.
- Period rows show used, included budget, monthly fee context, overage, and simple state.
- Invoice amount comes from overage rules; monthly fee is shown as context when billed separately.
- Time entries appear as usage/report evidence.

### Fixed

- Shows fixed project work only.
- Shows tracked hours and category/project budget usage.
- Makes over-budget work visible as budget health, not as a separate billing lifecycle.
- Supports selected delivery evidence where feasible.
- Invoice amount is fixed/remaining/manual, not time-rate based.

## 14. Implementation Guardrails

Keep the implementation close to existing product patterns.

Use existing:

- Project Time components where they fit.
- Time entry create/update/delete mutations.
- Invoice draft flow.
- Date, duration, and currency helpers.
- Billing/invoice status components when semantically correct.

Avoid:

- New schema unless required.
- A second time-entry editor.
- A second invoice review flow.
- Generic components that hide billing-type logic.
- Summary cards that do not change a decision.

Share UI primitives. Keep billing logic type-specific.

## 15. Open Questions

Resolve before implementation:

1. Fixed evidence in v1:
   Should fixed invoices support selected task/time evidence immediately, or
   should v1 create project-level fixed drafts only?

2. Retainer report inclusion:
   Should all period entries be included automatically, or can admins exclude
   specific entries from the report breakdown?

3. Retainer fee collection:
   Is the monthly retainer fee invoiced inside Agency Flow, or billed
   separately through Stripe/external accounting? This determines the row action
   and amount copy, not the primary status vocabulary.

4. Retainer default date:
   Should Retainer default to `This month` like the other tabs, or to the most
   recent closed period?

5. Draft-linked entry editing:
   Are entries linked to draft invoices editable from Time Tracking, or only
   entries linked to finalized invoices locked?
