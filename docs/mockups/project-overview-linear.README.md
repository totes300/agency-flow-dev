# Project page redesign — Overview + Billing (mockup)

> The binding spec is `docs/prd-project-billing-redesign.md`. This file records the mockup's
> decisions; where they differ, the PRD wins.

Mockup: `project-overview-linear.html` (open in a browser; light theme only, built on
the `tasks-refactor-prototype-v4` visual system). Retainer is the reference project
type. Interview with the owner: 2026-10-24.

## Layout (Overview tab)

1. **Month header** — `‹ ›` + large month title + `⋯` (month actions). Subline: date range ·
   "current month · N days left" or "ended · Back to current month" (link). Opens on the
   **current month** always.
2. **3-month trend** — right side of the header row: the selected month and the two before
   it as thin bars, dashed line at included hours, month + hours under each bar. Clicking a
   bar selects that month. Not repeated in the side panel.
3. **Finance card** — the original *Project Finances* content without its own header:
   Time breakdown (semicircle gauge + billable / non-billable), Overage (over budget,
   overage due), Profitability (earned revenue, profit, total cost, margin). The overage
   amount intentionally appears here **and** on the month card (analysis vs. action).
4. **Work in {month}** — the Tasks-page rows (priority, ID, status icon, title, assignee
   avatar, time in month), grouped by status, with the Tasks-page Filter + Display controls.
   Membership: tasks with time logged in the month; for the **current** month also open
   tasks without time. Category column is off by default (Display can turn it on).
5. **Side panel** (separate grey surface, white cards; open by default, toggle remembered
   per browser, closed by default on narrow screens):
   - **Month card** — only the selected month: state chip → amount → one action →
     Documents (invoice if any, monthly report — "Preview" until the month is closed —, worksheet).
     Custom-range export is the single "Export worksheet…" in the project ⋯ menu.
   - **Properties** — status, client, lead, team.
   - **Retainer** — included hours, fee, overage rate, rollover.

## Month states (one chip vocabulary everywhere — see `docs/billing-ux-audit-2026-10-24.md` B2)

Only the Close workspace commits (B1). Card / row buttons open it.

| State | Chip | Card amount | Action |
| --- | --- | --- | --- |
| Current month | grey *In progress* | Overage so far | — |
| Oldest ended, within budget | blue *Ready to close* | Nothing to invoice ($0) | Review & close |
| Oldest ended, over budget | blue *Ready to invoice* | Overage to invoice | Review & invoice |
| Over budget, no overage rate | amber *Needs rate* | — | Set overage rate |
| Ended but not the oldest open | same chip | same | button disabled: "Close {month} first" + link |
| Draft invoice | amber *Draft* | Overage on draft | Open draft |
| Finalized, not paid | green *Invoiced* | Overage invoiced | Mark as paid |
| Past due date | red *Past due* | Overage invoiced, due date in red | Mark as paid |
| Paid | green *Paid* | Overage billed | — |
| Closed within budget | green *Closed* | Nothing to invoice ($0) | — |

Undo lives in ⋯ per state (B8). Needs-action count = Ready to close + Ready to invoice +
Needs rate + Draft, per period; Past due is a separate red dot.

## Billing tab (replaces the Invoices tab)

- Header: "Billing" + retainer terms line.
- Summary card: Unbilled overage (ready + draft) · Outstanding (invoiced + past due, with
  "N past due" in red) · Latest invoice.
- One row per month, newest first: Month · Status chip · Hours (red when over) · Overage ·
  Invoice number · the row's one action (Review & invoice / Review & close / Open draft /
  Mark as paid; disabled with reason when not the oldest open) · Files (report, worksheet) and
  a hover `⋯` (View entries, Download worksheet, then the state's undo). Clicking a row opens that
  month on Overview. The existing `ProjectInvoices` content folds into this tab.

## Roles

Member (non-admin): no Profitability column, no overage money (hours only), month card shows
state + monthly report only, Billing tab hidden. No "hidden for your role" placeholders.

## Other project types (decided, not mocked)

- **Rollover retainer** — the picker steps by **cycle** ("Aug – Oct 2026"); numbers and
  billing are cycle-scoped; the trend shows the cycle's months.
- **T&M** — same monthly view; finance shows unbilled / billed + profitability; the month card
  carries the month's unbilled amount and invoice.
- **Fixed fee** — no month picker: "Project to date"; the card shows fixed-fee billing.

## Out of scope

Client summary document, links/resources, activity feed, auto-closing months.
