# PRD: Invoicing Update — Implementation Contract

> Companion to `docs/invoicing-update.md` (visual + design reference).
> This file is the **implementation contract** — it captures the interview decisions that pressure-tested the design doc and locks in behavior at the modules/data/concurrency level.
> Visual specs, copy dictionaries, and acceptance criteria live in `docs/invoicing-update.md` and `prototypes/invoicing-final.html`. This PRD does not duplicate them.

---

## Problem Statement

The agency owner (and admin teammates) cannot run a clean monthly billing ritual today. The Retainer Overview shows duplicate banners for the same overage with no actionable CTA, the actual "Invoice this month" button is buried inside a Monthly Breakdown accordion, Fixed projects have no invoice CTA on Overview at all, and there is no org-wide "what needs my attention" view to spot pending billing from any page.

On top of the surface problems, the underlying data model invents two parallel artifacts ("delivery report" vs. "invoice") in the team's heads even though the system has only one. The mental friction breeds skipped months, ad-hoc spreadsheets, and a quarterly catch-up scramble.

The user is an agency owner who needs to (a) never forget to bill, (b) trust that what's on screen is what will be on the doc the client sees, and (c) personalize each invoice with one short note without opening a settings dialog.

## Solution

When this ships, the agency owner can answer "what do I need to bill this month?" from any page in the app via a sidebar badge on `Invoices`, drill into a single `/invoices` Inbox that lists every closed billable unit across every project as one row, and one-click generate each invoice with full preview before commit. Within-budget retainer months auto-mark Paid (€0 total — they're delivery reports, but bookkept correctly), money-due invoices follow draft → invoiced → paid. Each invoice carries a "Message to client" block seeded from an org-level template and editable per invoice.

Project Overview pages get one shared `<InvoiceBanner />` per project — never two competing banners — with the amount in its own right-aligned column and a fixed `Generate invoice` CTA. The Monthly Breakdown card uses a 6-column grid with a fixed 3-value state pill dictionary; cycle progress lives in the card header instead of a separate info card.

Bulk Mark-as-Paid in the Overdue section commits immediately, no confirmation dialog, with a 5-second undo toast. Multi-currency orgs see per-currency breakdowns in the Inbox metric cards. Mid-cycle PDFs and Stripe integration are explicitly deferred.

## User Stories

### Owner — daily / weekly billing ritual

1. As an admin, I want a sidebar badge on `Invoices` showing how many billing units are ready, so that I never lose track of pending billing while working in another module.
2. As an admin, I want a calendar-clock icon on the same nav row when at least one invoice is overdue, so that overdue payments don't sit unnoticed for weeks.
3. As an admin, I want hovering the nav row to reveal a tooltip like `"3 ready to bill · 2 overdue"`, so that the icon meaning is self-teaching with no docs.
4. As an admin, I want the badge and icon to disappear when there's nothing to do, so that a clean state is visually unmistakable.

### Inbox — Overdue triage

5. As an admin, I want overdue invoices listed at the top of the Inbox under a red header, sorted oldest first, so that the most-late one is always at the top.
6. As an admin, I want to select multiple overdue rows via checkbox and click one "Mark as paid" button in a sticky bar, so that catching up after a payment batch is one gesture.
7. As an admin, I want the bulk mark-paid action to commit immediately with no confirmation dialog, so that the happy path is fast.
8. As an admin, I want a 5-second undo toast after the bulk commit, so that an accidental click is recoverable.
9. As an admin, when another admin has edited an invoice during my undo window, I want only the unmodified invoices reverted (with a toast telling me which ones were skipped), so that I never silently overwrite their edits.
10. As an admin, in bulk-select mode (≥1 row checked) I want per-row "Mark paid" buttons hidden, so that there is one and only one action surface — the sticky bar.
11. As an admin, when I uncheck the last row, I want per-row buttons to return, so that single-row actions stay fast.

### Inbox — To-generate triage

12. As an admin, I want every closed billable unit across all my projects listed as a single row in a "To generate" section, so that I have one place to look regardless of project type.
13. As an admin, I want each row to show a state badge using only `within budget` (green) or `{N}h over` (amber) for retainers, so that I can prioritize at a glance.
14. As an admin, I want fixed and T&M rows to skip the badge entirely, so that the badge column carries signal only when it's meaningful.
15. As an admin, I want the badge in a dedicated grid column (never inline with the project headline), so that all rows align vertically across the table.
16. As an admin, I want each row to carry a "last invoiced {date}" subline using relative dates (e.g. "3 days ago") for fresh invoices and absolute dates (e.g. "Mar 1, 2026") for older ones, so that the cadence signal is scannable.
17. As an admin, I want every system-generated cycle reference to use the month range (e.g. `Apr–Jun cycle`), so that I never have to remember which sequence number maps to which months.
18. As an admin, I want a "Generate all within-budget reports (N)" header button visible only when ≥1 €0 row exists, so that I can clear all the no-money-but-need-the-doc rows in one click.
19. As an admin, when the batch generate succeeds for some rows and fails for others, I want a "{N} reports generated · {M} failed [View]" toast that lets me see the failure reasons, so that partial failures are recoverable rather than invisible.
20. As an admin, when I click Generate on a row that already has a draft invoice for that period, I want the editor to open the existing draft (no new invoice created), so that I never end up with duplicates.

### Inbox — empty state and metrics

21. As an admin, I want 3 metric cards above the lists — Outstanding, Overdue, Drafts — always rendered (showing zero when empty), so that the layout is stable and "all clear" is visually confirmed.
22. As an admin, when my org has projects in multiple currencies, I want each metric card to render one row per currency, so that I never see meaningless blended totals.
23. As an admin, when both Overdue and To-generate are empty, I want a centered "All caught up" reward state with last-invoiced and next-month-close context, so that an empty Inbox feels like an achievement rather than a void.

### Project Overview — banner

24. As an admin viewing any billable project, I want at most one billing banner with one CTA, so that I never face duplicate "Bill this" surfaces fighting for my click.
25. As an admin, I want the banner using a per-type Lucide icon (`Receipt` / `Repeat` / `FileText` / `Timer`), a title, a subline with last-invoiced context, an amount with a one-word status label, and a `Generate invoice` button, so that the layout is identical across project types.
26. As an admin viewing a T&M or Fixed project where the last invoice was ≥30 days ago, I want a small `⌛ {N} days` cadence chip on the banner, so that cadence drift is a nudge, not a chrome-heavy alert.
27. As an admin viewing a cycle-rollover retainer mid-cycle, I want **no banner at all** and **no info card** — the cycle progress lives in the Monthly Breakdown header, so that the Overview page isn't cluttered with not-yet-actionable state.
28. As an admin viewing a cycle-rollover retainer when the cycle has just closed, I want a banner with `"{monthRange} cycle closed"` and the cycle-level overage (or €0), so that the moment the cycle closes I know to bill.

### Project Overview — Monthly Breakdown

29. As an admin, I want the Monthly Breakdown rendered as a 6-column grid (`dot · month · hours · state pill · amount · action`), so that every row aligns vertically regardless of content.
30. As an admin, I want the state pill to use exactly 3 fixed values (`within budget`, `over budget`, `in progress`), with no dynamic data ever embedded, so that the pill is a category tag I can scan, not a sentence I have to read.
31. As an admin, I want the dot color to mirror the pill (emerald / amber / zinc) plus a footer legend, so that the dot semantics are self-documenting.
32. As an admin, I want the oldest closed-uninvoiced row to get a subtle background wash and a `font-medium` month name, so that my eye lands on the next billing action with no chrome.
33. As an admin, on a generated row I want the invoice number itself (`INV-2026-01 ↗`) to be the link, so that I don't need a separate "view" button.
34. As an admin, I want a sort toggle in the card header (oldest first / newest first, default oldest), so that I can flip orientation when reviewing a long history.
35. As an admin, I want the sort preference held in component state only (not URL or localStorage), so that the toggle stays a transient preference per visit.
36. As an admin viewing a cycle-rollover retainer, I want the card header to carry `"{monthRange} cycle · {X}/{cycleLength} months closed · {Y}% used"` plus a `Cycle closes/closed {date}` pill, so that cycle progress is one glance away without a separate info card.

### Invoice document — message and payment instructions

37. As an admin, I want every invoice to carry a "Message to client" block, editable per invoice, with content seeded from `orgSettings.invoiceMessageTemplate`, so that personalizing each invoice takes seconds instead of opening settings.
38. As an admin, I want the message block to show a subtle "+ Add a message to client" affordance when empty in draft mode, and render nothing on the printed/sent invoice, so that there's no awkward placeholder on a sent doc.
39. As an admin generating a within-budget €0 retainer invoice (auto-Paid on creation), I want the message block to remain editable indefinitely after generation — no "Finalize" button, no time-bound lock, so that I can add or refine the personal note any time before the doc actually leaves the system. Once PDF/email infra ships in a future PR, lock semantics tied to a real hand-off event will be added then.
40. As an admin generating a money-due invoice, I want the message to lock at draft → invoiced (the same transition that locks line items today), so that finalized money-due invoices stay immutable.
41. As an admin, I want every invoice document to render an org-level "Payment instructions" block (when set) above the message block, so that IBAN, Stripe link, terms etc. are present on every doc with no per-invoice work.

### CreateInvoiceModal

42. As an admin clicking Generate from any surface, I want the modal pre-selected to the most relevant period (most recent uninvoiced month for retainer-monthly, the closed cycle for cycle retainers, all uninvoiced for T&M, full remaining for fixed), so that the common case is one more click.
43. As an admin, when a draft already exists for the period I clicked, I want a toast `"Resuming draft INV-XXXX"` and the editor to open that draft directly, so that I never accidentally create a duplicate.
44. As an admin generating a within-budget retainer, I want the preview to show `Total due €0.00` cleanly with the CTA enabled, so that the delivery-report mental model is supported by the UI.
45. As an admin generating a retainer invoice, I want the preview to include a static `Retainer fee (paid via subscription)` row, so that the doc reads as a complete picture even though the fee isn't tracked in this app yet.

### Authorization

46. As an admin, I want all invoicing queries and mutations to require admin role on the server, so that members cannot read invoice totals or trigger generations even by direct API call.
47. As a member, I want the `Invoices` nav item to be hidden from my sidebar, so that I'm never confused about whether I can or should access the billing surface.

### Concurrency edge cases

48. As an admin, when another admin marks an invoice paid milliseconds before I click my own "Mark as paid" on the same invoice, I want my click to no-op silently (last-write wins, no warning), so that the common race doesn't generate friction.
49. As an admin, when the batch "Generate all within-budget reports" hits a transient failure on one row (e.g. project deleted mid-batch), I want the other rows to succeed and the failure surfaced via the toast log, so that one bad row doesn't roll back the rest.

### Out-of-scope reminders

50. As an admin, I want the dashboard and `/projects` pages to NOT acquire any new billing surfaces (no pointer card, no Status / To-bill columns), so that billing triage stays in one place.

## Implementation Decisions

### Schema changes

- **`orgSettings`** — add three optional fields:
  - `paymentInstructions: v.optional(v.string())`
  - `invoiceMessageTemplate: v.optional(v.string())`
  - (`invoicePrefix` already exists; default stays `"INV-"` — keep org-configurable, gated by existing `hasAnyInvoice` lock)
- **`invoices`** — add one optional field:
  - `messageToClient: v.optional(v.string())` — seeded from `invoiceMessageTemplate` at creation, editable per invoice
- **`invoices.status`** — `void` stays in the enum unchanged. Re-issue against voided months stays allowed (current `createInvoice` line 1276 behavior). The PRD does not introduce a "cancel" flow.
- **No `kind` field.** Single doc type. The "delivery report" concept is a UI/UX framing, not a data shape.

### Authorization

- **All new queries `requireAdmin`** (`getReadyToInvoiceUnified`, `getOverdueInvoicesAggregate`, `getInboxEmptyStateContext`, `getInvoicingNavSignals`).
- **Backfill admin checks** on the 3 currently-leaky existing queries — `getReadyToInvoice` (will be deleted), `getProjectInvoiceMetrics`, `getInvoicePreview` — as part of this PRD.
- **All new mutations `requireAdmin`** (matches existing pattern; see `convex/invoices.ts:1194` for prior art).

### Multi-currency

- The Inbox metric cards (Outstanding / Overdue / Drafts) **render one row per currency** when ≥2 currencies are present in the org's invoices. Reuses `getInvoiceMetrics`'s existing per-currency Record shape (`convex/invoices.ts:240`).
- The "Generate all within-budget reports" batch creates invoices in each project's own currency. Toast text is currency-agnostic ("{N} reports generated"). No FX, no aggregation across currencies.

### Time, dates, and cycle close

- "Closed month" / "closed cycle" = calendar boundary evaluated in the org timezone. Read existing `retainerPeriods` markers from `retainerCron`.
- Mid-month project start: **full month, full hours allowance**. No pro-rating. (Existing behavior; no schema change.)
- Cycle progress percentage in the Monthly Breakdown header is `(cycleWorked / cycleBudget) * 100` — already exposed as `utilization` in `convex/projects.ts:752` (`getRetainerCycleData`). No new query needed; the breakdown header reads from this.
- "Closed months in cycle" = `monthlyData.filter(m => m.isMonthClosed).length` (also from `getRetainerCycleData`).
- Date formatting on banner sublines and Inbox rows uses **relative for <14 days, absolute beyond** (e.g. "3 days ago", "Mar 1, 2026"). One shared helper.
- Cadence chip threshold: `daysSinceLastInvoice ≥ 30`, where "last invoice" = most recent invoice on the same project with `status ≠ "void"`. Same definition as the "last invoiced" subline.

### Concurrency rules

- **Mark-paid race**: last-write wins. `markInvoicesPaid` is idempotent — if the invoice is already paid, the mutation no-ops for that row. No conflict UI, no version check.
- **Bulk undo race**: `undoMarkInvoicesPaid` accepts the `priorStates` array returned by the original `markInvoicesPaid` call. For each invoice, if its current `status` and `paidAt` no longer match the prior snapshot, that one is skipped. Returns `{ reverted: number, skipped: Array<{id, reason}> }`. Toast: `"Reverted {X} · {Y} skipped (modified by other users)"` when `skipped.length > 0`.
- **Batch partial failure**: `generateAllWithinBudgetRetainerInvoices` returns `{ created: Id<"invoices">[], failed: Array<{projectId, period, reason}> }`. Toast renders `"{N} reports generated"` with a `[View]` link when `failed.length > 0` that opens a small dialog listing each failure (project name + reason).
- **Existing draft on Generate**: `createInvoice` already returns the existing invoice for retainer months (line 1276). Extend the same return-existing rule to T&M and Fixed Generate flows. Frontend detects the response and opens the editor for the returned draft instead of constructing a fresh modal session. Toast: `"Resuming draft {invoiceNumber}"`.

### Auto-Paid €0 retainer invoices

- `createInvoice` sets `status: "paid"`, `paidAt: Date.now()` when computed `total === 0` AND project type is retainer. Skips the `draft → invoiced` transition entirely.
- The message block on these invoices **stays editable indefinitely**. No `finalizedAt` field, no "Finalize" button, no time-bound lock. The lock for these invoices ships with PDF/email infra in a future PR, tied to a real hand-off event.
- These invoices never appear in Outstanding or Overdue sections. They count as `Paid` in metric cards but the dollar total contribution is €0.

### Removed surfaces (defensive — never added)

- Dashboard billing-snapshot pointer card
- `/projects` table Status / To-bill columns

Codebase audit confirms neither exists today. The PRD adds them to a "must not be added" list rather than an active removal step.

### Lifecycle

- **Single PR.** All 9 modules + the schema migration ship in one bundle. Internally coupled — staged rollout would require dual-data-source code paths.
- `getReadyToInvoice` (retainer-only) is **deleted** in the same PR that ships `getReadyToInvoiceUnified`. `<ReadyToInvoiceCard />` is deleted too.

### URL state convention

- Inbox tabs (`?tab=all|draft|outstanding|paid`), search (`?search=`), filters: URL search params (matches CLAUDE.md convention).
- Monthly Breakdown sort toggle: **component state only** — explicitly does not persist. Transient per-visit preference.

## Module Design

### 1. `<InvoiceBanner />` — shared component

- **Responsibility**: render the single billing CTA on a project Overview, regardless of project type.
- **Interface**: props per `docs/invoicing-update.md` § Component Spec. No `variant` prop — banner is always actionable; cycle-in-progress lives in the Monthly Breakdown header instead.
- **Tested**: no (presentational; covered by integration of consumer pages).

### 2. `getReadyToInvoiceUnified` — Convex query

- **Responsibility**: return one row per pending billing unit across all projects in the org. Replaces `getReadyToInvoice` (retainer-only).
- **Interface**: returns `Array<{ kind, projectId, projectName, clientName, period?, amount, currency, badgeKind, lastInvoicedAt, … }>`. Used by Inbox To-generate, sidebar badge count, and project-Overview banner data hooks. Admin-only.
- **Tested**: **yes**. Fixtures cover retainer monthly closed/open, retainer cycle closed/open, fixed `remaining > 0` with and without prior invoices, T&M with prior-month uninvoiced hours, mid-cycle T&M (excluded), multi-currency org. Edge: project deleted with hanging time entries.

### 3. `<InboxOverdueSection />`

- **Responsibility**: render the Overdue list with bulk-select, sticky action bar, and undo toast. Owns its own selection state.
- **Interface**: takes the overdue rows from `listAllInvoices({status:"overdue"})` (or new query if the existing one is too coupled). Calls `markInvoicesPaid` on commit, holds returned `priorStates` for the undo window, calls `undoMarkInvoicesPaid` on undo.
- **Tested**: no (UI; behavior covered via the underlying mutation tests).

### 4. `<InboxToGenerateSection />`

- **Responsibility**: render the To-generate list with the "Generate all within-budget reports" header batch action.
- **Interface**: consumes `getReadyToInvoiceUnified`. Per-row `[Generate]` opens `CreateInvoiceModal` pre-filled. Header batch button calls `generateAllWithinBudgetRetainerInvoices` and renders the partial-failure toast.
- **Tested**: no (UI).

### 5. `<MonthlyBreakdownCard />` rebuild

- **Responsibility**: render the 6-column grid for retainer projects (monthly or cycle), with a fixed 3-value state pill dictionary, color-dot legend in the footer, and sort toggle in the header.
- **Interface**: takes `getRetainerCycleData` output (existing query, no changes). Renders cycle-progress subline in the header for rollover-ON projects.
- **Tested**: no (UI; behavior covered by `getRetainerCycleData` existing tests in `convex/lib/__tests__/retainerBalance.test.ts`).

### 6. `<InvoiceMessageBlock />`

- **Responsibility**: render the editable Markdown textarea on the invoice document. Owns the empty-state affordance, edit-state rules (editable in draft, editable indefinitely on auto-Paid €0 retainers, read-only on money-due invoiced/paid), and template-seeding behavior.
- **Interface**: takes `invoice` document and `orgSettings.invoiceMessageTemplate`. Calls `updateInvoice({ messageToClient })` on commit.
- **Tested**: no (UI; edit-state matrix is small enough to be obvious from the conditional).

### 7. Sidebar badge + `getInvoicingNavSignals`

- **Responsibility**: surface `{toGenerateCount, hasOverdue}` to the sidebar. Single Convex query, single component change.
- **Interface**: query returns `{ toGenerateCount: number, hasOverdue: boolean }`. Sidebar consumes via `useQuery` and renders the badge + calendar-clock icon + tooltip per `docs/invoicing-update.md` § 3.
- **Tested**: no (thin wrapper around `getReadyToInvoiceUnified` and an overdue count).

### 8. Mutations bundle

- **`markInvoicesPaid({ invoiceIds })`** → `{ updated, skipped, priorStates }`. Admin-only. Idempotent per row.
- **`undoMarkInvoicesPaid({ priorStates })`** → `{ reverted, skipped }`. Admin-only. Skips rows whose current state diverges from the snapshot.
- **`generateAllWithinBudgetRetainerInvoices()`** → `{ created, failed }`. Admin-only. Enumerates all closed uninvoiced retainer periods where computed total = 0, calls `createInvoice` per row, accumulates failures.
- **`createInvoice` extension** — same signature; new behavior: auto-Paid when retainer total = 0, seeds `messageToClient` from `invoiceMessageTemplate`. Returns existing invoice for already-drafted T&M/Fixed periods (pattern already in place for retainer months at line 1276).
- **Tested**: **yes** for all four. See Testing Decisions.

### 9. `formatLastInvoiced` — pure helper

- **Responsibility**: return `"3 days ago"` for `daysAgo < 14`, otherwise `"Mar 1, 2026"`. Single function, single source of truth across banner subline, Inbox subline, and cadence chip threshold computation.
- **Interface**: `formatLastInvoiced(date: number | Date | null, now?: Date) → string`. `null` returns `""`.
- **Location**: `lib/format.ts` (alongside existing `formatCurrency`).
- **Tested**: **yes** — pure function, trivially testable. Cases: null, today, 13 days ago, 14 days ago (boundary), 60 days ago, 1 year ago.

## Testing Decisions

A good test for this feature exercises external behavior — the contract a caller sees — not implementation details. Convex queries and mutations are the natural test boundary: their signatures are stable and they encode the rules.

**Modules with tests written as part of this PR (4 + 1):**

1. **`getReadyToInvoiceUnified`** — fixture matrix covering all 4 project types and the multi-currency case.
2. **`createInvoice` auto-Paid path** — within-budget retainer (€0) sets `status: "paid"`, `paidAt: now`, skips draft. Money-due retainer keeps draft.
3. **`markInvoicesPaid` + `undoMarkInvoicesPaid`** — happy path, partial undo with mutated row, idempotency, authorization (member call rejected).
4. **`generateAllWithinBudgetRetainerInvoices`** — all-success, mixed success/fail with reasons, currency mismatch handling.
5. **`formatLastInvoiced`** — pure-function unit tests (small, fast, prevents drift).

**Prior art**:
- `convex/lib/__tests__/retainerBalance.test.ts` — existing fixture-based unit tests for retainer math; mirror the pattern.

**Not tested**:
- All UI components in this PRD. Visual fidelity covered by the prototype reference; behavioral correctness comes from the mutation tests above.
- The 3 leaky-then-fixed existing queries (auth backfill is a small change, covered by manual verification + lint rule if one exists for `requireAdmin`).

## Out of Scope

- **PDF generation infrastructure** — print-to-PDF, server-side rendering, branded PDF output. Defers the auto-Paid message-lock decision until that PR lands.
- **Email sending from app** — no SMTP integration. User downloads PDF and emails outside the app once PDF infra ships.
- **Stripe integration** — `stripeCustomerId`, `stripeSubscriptionId`, webhook handler. The "paid via subscription" string stays static text in this PRD.
- **Mid-cycle rollover monthly reports** — depends on PDF infra.
- **Editable line-item audit fix** — `updateInvoiceLineItem` will continue to allow editing `retainer_fee`, `fixed`, and `overage` rows in this PRD. Audit finding ships in a separate PR.
- **`void → cancel` flow rework** — `void` status stays as-is, behavior unchanged.
- **Auto-generation cron** — no daily/monthly cron creates draft invoices. Existing `retainerCron` only creates `retainerPeriods` markers.
- **Reminder emails for overdue** — Mark-as-paid is the only action.
- **Recently-generated sidebar log** — deferred (low value at current usage).
- **Milestone-based Fixed billing UI** — schema has no milestone concept. User edits amount in editor for partial billing.
- **Pro-rated retainer hours on partial first month** — full month, full allowance.
- **Configurable T&M cadence per org** — fixed continuous-after-close visibility.
- **All-or-nothing batch transaction** — partial-fail with toast is the chosen pattern.
- **Confirmation dialog on bulk Mark-as-Paid** — undo toast is the recovery mechanism.
- **Dashboard billing-snapshot card / `/projects` Status / To-bill columns** — must not be added by this PRD or any sibling.

## Open Questions

| # | Question | Owner | Suggested resolution |
|---|---|---|---|
| 1 | When PDF/email infra ships, what's the lock-trigger event for auto-Paid €0 invoice messages? | Future PR author | Likely `markedSentAt` or `pdfDownloadedAt` — decide alongside the PDF spec, not now. |
| 2 | Multi-currency in the "Generate all within-budget reports" batch — confirm rendering when projects span 3+ currencies. | UI implementation | Toast text stays currency-agnostic. Per-currency totals only matter on the Inbox metric cards. |
| 3 | Retainer cycle-close detection currently relies on `getRetainerCycleData`'s `isCycleClosed` boolean — verify this stays accurate when org timezone changes (or a project moves to another org). | Implementation | Cross-check with existing `retainerCron` semantics. If the cron uses UTC but the closed-detection uses org TZ, there's a 24h ambiguity window. |

## Further Notes

- **Visual reference**: every surface in this PRD is rendered in `prototypes/invoicing-final.html`. Pixel and copy questions go there before they come back here.
- **CLAUDE.md compliance**: the Monthly Breakdown sort toggle deviates from the `filterable-views-persist-state-in-URL` rule. The deviation is intentional — sort orientation here is a transient per-visit preference, not a filter, and persisting it would surprise users who refresh expecting the default.
- **Contracts on existing modules**: `getRetainerCycleData` (`convex/projects.ts`) is unchanged. The new `<MonthlyBreakdownCard />` reads its existing fields. `createInvoice` extends behavior for €0 retainers and seeds `messageToClient` but its public signature does not change.
- **Concurrency primitives**: Convex's optimistic concurrency control handles `nextInvoiceNumber` increments inside `createInvoice` (existing). The new mutations rely on the same primitive — no manual locking, no sagas.
- **Single-PR rationale**: schema migration + 5 new queries/mutations + 4 new components + 1 query deletion + 1 nav change. Splitting requires either dual-data-source code (new + old query) or partial UI states (new banner with old Inbox). Both are worse than one large PR with a complete cutover.
- **Linked references**:
  - Design source: `docs/invoicing-update.md`
  - Base PRD: `docs/invoicing-prd.md`
  - Audit: `docs/invoicing-audit.md`
  - Visual prototypes: `prototypes/invoicing-final.html`, `prototypes/invoicing-comparison.html`
