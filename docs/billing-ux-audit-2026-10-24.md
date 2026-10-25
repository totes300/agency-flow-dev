# Billing & month-close UX audit — 2026-10-24

Validated against code (backend, UI surfaces) and the PRDs (`prd-billing-refactor.md` is the
source of truth; `prd-month-close.md` is historical intent). Purpose: check the project-page
redesign (`docs/mockups/project-overview-linear.*`) against how billing really works, and list
what the app communicates badly today.

## 1. How it really works (the facts the UX must respect)

**Period** = calendar month (T&M, non-rollover retainer) or an N-month cycle (rollover retainer).
Fixed fee has no periods, no closes, entries never lock. Non-billable projects never bill.

**Lifecycle of a period**

1. *In progress* — not ended (org timezone). Priced live.
2. *Ended, open* — no live close. Only the **oldest** ended open period is committable
   (`closeLifecycle.ts:58-61` throws "X must be closed first" otherwise). Retainers: every
   month counts, empty ones too. T&M: only months with open billable entries.
3. **Commit** (`billingCloses.commitClose`, admin) — the one transition. Happens only in the
   Close workspace per PRD D8:
   - within budget → close `final`, no invoice ("Close period"); report becomes final.
   - over budget → close `draft` + draft invoice ("Create draft invoice") → invoice editor.
   - missing overage rate → blocked.
4. Invoice: `draft → invoiced → paid`; `invoiced → draft` (revert, keeps number, entries stay
   locked); `void` releases the close (period reopens). *Past due* = invoiced and past due date.
   There is **no "sent"** status.
5. Undo paths: within-budget close → **Reopen** (latest first); draft never numbered →
   **Delete draft**; numbered → **Void**.

Late time (logged after a close, or skipped) carries into the next open period automatically.
Reports and `exportClose` worksheets are **snapshots** of the close; `exportRange` is live.
Monthly report exists **only for retainers**. Invoice PDF = print view.

## 2. Problems found

### A. Wrong or misleading (fix regardless of redesign)
| # | Problem | Where |
|---|---|---|
| A1 | `getRetainerData` returns `overageDue`, `monthlyFee`, `overageRate` without an admin check (tenancy/authorization invariant) | `convex/projects.ts:509` |
| A2 | Project rows offer Close/Review on months that are not the oldest open one → server error | `monthly-breakdown-card.tsx`, `retainer-row-action.ts` |
| A3 | Two commit implementations: project Close modals call `commitClose` directly (no checklist, no skip, no preflight) vs. the workspace | `close-period-modal.tsx:72`, `close-cycle-modal.tsx:68` |
| A4 | T&M "Invoice unbilled hours" / "Review to invoice" go to the generic `/billing` queue, selection discarded | `project-time-content.tsx:158-166` |
| A5 | Fixed fee: drafts don't count as billed → repeated "Generate invoice" creates duplicate full-remainder drafts | `invoiceLifecycle.ts:61`, `billingInvoices.ts:27-94` |
| A6 | Draft invoices never count as "needs action" (badge, project metrics); badge counts one period per project even with "+N more" | `billingViews.ts:321-348`, `invoices.ts:464-486` |
| A7 | `updateRetainer` can change start date / cycle / rollover while live closes exist | `projects.ts:412-499` |
| A8 | Void and inline "Mark as invoiced" run without confirmation; bulk bar can void drafts (elsewhere drafts are deleted) | `invoice-row-actions.tsx`, `invoice-bulk-bar.tsx` |
| A9 | Invoice Back button lands on "To close", losing the tab you came from | `invoices/[id]/page.tsx:39-41` |
| A10 | Lock banner says "Revert to draft in the sidebar" on paid/void invoices where it doesn't exist; lock error says "delete the draft first" for numbered drafts | `invoice-document.tsx:163-167`, `timeEntries.ts:48` |
| A11 | Missing-overage-rate month shows only "Report"; alert has no settings link | `retainer-overview.tsx:146-153` |
| A12 | Time-tab reopen dialog shows one entry's minutes as the month's hours | `project-time-table.tsx:741` |
| A13 | `projectOverview` and `projectMonthlyBreakdown` return amounts and cost to any org member (`getAuthContext` only) | `convex/timeEntries.ts:866-869, 1078-1081` |
| A14 | Latent: on the project task surface a non-admin gets their assignee plan and `projectId` is never applied → tasks from every project (hidden today by the `/projects` route guard) | `convex/tasks/read.ts:255-256` |
| A15 | T&M summary counts draft closes as "billed", `projectOverview` keeps a separate draft bucket — two definitions of billed | `convex/lib/projectSummary.ts:193` vs `convex/timeEntries.ts:1042-1070` |
| A16 | `getNavSignals` rebuilds the whole org queue (one `loadCloseContext` per project) on every admin sidebar render | `convex/billingViews.ts:240-267, 331` |

### B. Inconsistent vocabulary (one concept, many names)
- Start billing: Review to invoice · Review · Review {month} · Create invoice · Generate invoice ·
  Invoice unbilled hours · Create draft invoice.
- Close: Close · Close period · Close cycle · Review & close · To close · Close without invoice ·
  close & report.
- Ready: Ready to invoice · ready to bill · uninvoiced months.
- Status: Invoiced (badge) vs Outstanding (tab); open/closed pills vs PRD lexicon.
- Worksheet under 5 labels in 7 places; report under 3 labels.

### C. Duplicated entry points
Overage invoice can start from 5 places; worksheet from 7; reopen from 2 (never from the
workspace or report page, where people look for it).

## 3. Mockup vs. reality

| Mockup element | Reality | Needed change |
|---|---|---|
| "Review invoice" | Opens the Close workspace; nothing exists yet | Rename; it prepares the draft |
| "Close month" on card | Must go through the workspace (D8, checklist, skip) | Card button opens the workspace |
| Every ended month shows its action | Only the oldest open period is committable | Later months show "Waiting for {earlier}" |
| States: Ready to invoice / Ready to close / Draft / Invoiced / Closed | Real: + Paid, Past due, missing rate, rollover mid-cycle; draft can also be a reverted numbered invoice | Add Paid, Past due, Needs rate |
| "Reopen period" in ⋯ for closed/invoiced/draft | Reopen only for within-budget closes; invoices use Delete draft / Void | ⋯ must show the right undo per state |
| Documents: report + worksheet everywhere | Monthly report retainer-only; worksheet snapshot vs live | T&M card: worksheet + invoice only |
| Member view | All billing surfaces are admin-only today | Matches (plus A1 fix) |
| Billing tab counter | Today's metrics ignore drafts and later periods | Define the count server-side |

## 4. Decisions (owner interview, 2026-10-24)

| # | Decision |
|---|---|
| B1 | **Commit only in the Close workspace.** Project-page buttons (month card, Billing rows) open the workspace for that period; the project Close/Close-cycle modals are removed. |
| B2 | **One action-centred vocabulary everywhere** (project page, Billing hub, workspace): In progress · Ready to close · Ready to invoice · Needs rate · Draft · Invoiced · Paid · Past due · Closed. Re-locks PRD Principle #3 deliberately. |
| B3 | **Oldest-first is visible:** a later ended month shows its button disabled with the reason ("Close August first") plus a link to the blocking month. |
| B4 | **Buttons that open the workspace:** "Review & invoice" (over budget) and "Review & close" (within budget; cycle: same label on the cycle). The workspace's commit stays "Create draft invoice" / "Close period". |
| B5 | **Invoiced / Past due month card:** secondary "Mark as paid"; the invoice sits in Documents; Past due = red chip with due date. |
| B6 | **Needs-action count = every period** that is Ready to close, Ready to invoice, Needs rate or Draft (not one per project). Past due is a separate red signal. Defined server-side. |
| B7 | **Documents:** month documents live on the month card and the Billing row (Monthly report, Worksheet, Invoice); one "Export worksheet…" (custom range) in the project ⋯ menu. All other entry points removed, one naming. |
| B8 | **Undo per state in ⋯:** Closed → Reopen period · Draft → Delete draft · Invoiced/Past due → Revert to draft, Void invoice… (confirm) · Paid → Mark as unpaid. |
| B9 | **Fixed fee:** when a draft exists the CTA becomes "Open draft" (no duplicate drafts). |
| B10 | **Fix order:** A1 (`getRetainerData` admin gating) ships now on its own; A2–A12 ship with the project-page redesign PR. |
