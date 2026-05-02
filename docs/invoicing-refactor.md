# PRD: Invoicing Refactor — One Document Per Period

> **One-liner**: One document per closed period. Overage > $0 → **invoice** (numbered, lifecycle, pay this). Overage = $0 → **monthly report** (no number, no lifecycle, FYI). Monthly retainer fee is **Stripe** — never billed here. Never two documents for the same period.
>
> **Status**: Spec finalized 2026-05-02 after grilling session. Replaces previous statement-first draft.
> **Depends on**: existing invoicing (Phases 1–7, done). DB wipe + reseed for cutover (MVP, dummy data only).

---

## Problem Statement

The agency owner runs a retainer business. The recurring monthly fee is already collected by **Stripe subscription** — set-and-forget, money lands every month without involvement from this tool. The job of *this* tool is two things, and only two things:

1. Bill the **variable overage** when a client uses more hours than their retainer covers.
2. Send the client a periodic accountability artifact — *"here's what you got for your retainer this month"* — so they can see usage even when there's no overage.

Today the system fights that workflow in three ways:

- **The invoices list is polluted.** Every closed retainer month — even fully-within-budget ones — generates an invoice (auto-paid `$0` "delivery report"). Hundreds of these noise rows drown out the real billable invoices.
- **The mental model has too many concepts.** A "statement", an "invoice", and the relationship between them ("invoice contains the monthly fee + overage") doesn't match how the owner actually thinks about billing. The recurring fee is on Stripe, full stop. This tool only handles overage and accountability.
- **The UI lies.** The monthly breakdown shows `$0` for in-budget months but the underlying invoice contains `monthlyFee + overage`. The amount the owner sees, the amount the invoice contains, and the amount the client owes are three different numbers.

A new team member should be able to learn the billing model in 5 minutes. Today they can't.

---

## Solution

When this PRD is complete, the following is true:

- **Every closed period produces exactly one document.** If overage > $0, that document is an **invoice** — it has a number, sits in `/invoices`, and the client owes the overage amount. If overage = $0, that document is a **monthly report** — it has no number, lives only on the project page, and is sent as FYI.
- **Documents are never duplicated.** A given period never produces both an invoice and a report. The invoice itself contains the activity summary (hours used / included / balance) — so when a client receives it, they see "why" and "how much" in one document.
- **The monthly retainer fee never appears on any document as a chargeable line item.** It may appear as context text ("Retainer: $1,000/mo, billed separately via Stripe") so the client doesn't get confused, but it never increments a total.
- **`/invoices` only shows real billable invoices.** Within-budget periods are absent by construction.
- **The Ready feed in `/invoices` only lists periods that need an invoice.** No more zero-amount rows.
- **Voiding an invoice frees the period.** It reappears as Ready and can be re-billed.
- **The owner can view a monthly report for any period — past, current, or in-progress** — for their own reference. In-progress months show an "In progress" badge so they aren't accidentally sent to the client.
- **The PRD's previous concept of a separate "statement" is renamed "monthly report"** so a client's AP team doesn't try to process it as an invoice.
- **No Stripe integration is added.** The disclaimer line is hardcoded text from the project's `monthlyFee` field. Stripe webhook + payment reconciliation is explicitly Future.

---

## User Stories

### Agency owner — generating documents

1. As an agency owner, when a retainer client's closed month has overage, I want to see a single Ready row in `/invoices` showing the overage amount, so I know what's billable.
2. As an agency owner, when a retainer client's closed month is within budget, I want to see *no* row in `/invoices` Ready, so the queue stays clean.
3. As an agency owner, when I click "Generate invoice" on a Ready row, I want to land directly on the draft invoice page (no modal), so I can review and finalize in one screen.
4. As an agency owner, on a project's Monthly Breakdown card, I want each closed-period row to show **one primary action** — "Generate invoice" if there's overage and no invoice yet, "Download report" otherwise, or the invoice number link if billed — so I never have to choose between two buttons.
5. As an agency owner, for a rollover-enabled project, I want the Ready feed to only show **cycle-end months that have cycle overage**, not every closed month within the cycle, so I'm only prompted at the moment something is billable.
6. As an agency owner, for a rollover-enabled project, I want the cycle-end invoice to cover the **entire cycle range** (`cycleStart → cycleEnd`) with a single Overage line, so I don't have a chain of per-month invoices to reconcile.
7. As an agency owner, I want the document header for a $0 report to say **"Monthly Report"** — not "Invoice" or "Statement" — so my client's AP team doesn't try to process it as a bill or duplicate.
8. As an agency owner, I want every invoice document to display the activity summary (hours used / included / balance) prominently, so the client never needs a separate report alongside the invoice.
9. As an agency owner, I want the project page to display a Stripe disclaimer line ("Monthly retainer fee — $X/mo — billed separately via Stripe") below the Monthly Breakdown title, so anyone reading the page understands the recurring fee is not handled here.

### Agency owner — failure modes

10. As an agency owner, when I try to generate an invoice for a period with no overage, I want the system to refuse with a clear message, so I cannot accidentally create a $0 invoice.
11. As an agency owner, the "Generate invoice" button must not appear at all on within-budget rows — only "Download report" — so the failure case from story 10 is unreachable through normal UI.
12. As an agency owner, when I void an overage invoice, I want the period to revert to Ready in `/invoices`, so I can re-bill if the void was a correction.
13. As an agency owner, a voided invoice should remain visible in `/invoices` history (Voided tab) with full audit trail, so I can see what was voided and when.
14. As an agency owner, if I or a team member back-dates a time entry into an already-closed period, the next render of that period's report or invoice should reflect the new numbers, so the report is always live truth. (No locking in MVP.)

### Agency owner — viewing the monthly report

15. As an agency owner, I want to view a monthly report for any closed period of any retainer project, so I can sanity-check what the client will see.
16. As an agency owner, I want to view a monthly report for the **current in-progress month**, so mid-cycle I can see "where are we tracking". The in-progress report displays an "In progress — partial data" badge.
17. As an agency owner, viewing a monthly report for a rollover project's mid-cycle month, I want to see **both** this month's usage *and* cycle-to-date totals (`X used of Y included this month` AND `A used of B included so far this cycle, balance ±Z`), so I always know where the cycle stands.
18. As an agency owner, when I click "Download report" or open a report URL, I want it to open the report page in a new browser tab so I can use the browser's Print > Save as PDF dialog and attach the PDF to my own email, so I'm not blocked on email-sending infrastructure.
19. As an agency owner, the per-project Monthly Breakdown card is my **only** surface for finding closed periods that need a report. There is no global cross-client "statements queue" in MVP — I'll check each project on the 1st of each month.

### Agency owner — `/invoices` page

20. As an agency owner, `/invoices` keeps its current tab structure (Ready / Draft / Sent / Paid / Overdue) — the refactor must not change the page's information architecture.
21. As an agency owner, the Ready tab only shows: T&M projects with billable hours, Fixed projects with remaining balance, retainer monthly rows with overage, and retainer cycle-end rows with cycle overage. Within-budget retainer rows never appear.
22. As an agency owner, I want a clear empty-state on the Ready tab when no periods need invoicing, so I'm not staring at a blank screen wondering if it's broken.

### T&M and Fixed Price projects

23. As an agency owner, T&M and Fixed Price project behavior is **unchanged**. Invoices are the only artifact; there is no monthly report concept for these project types.
24. As an agency owner, the Ready feed for T&M and Fixed projects continues to work exactly as today — no change in row construction, no change in invoice creation.

### Client (the agency's customer)

25. As a client, when I receive an overage invoice, I see one document with: who I am, what I bought (overage hours), how much I owe, *and* the activity context (hours used vs included this period) — so I never need to ask "what's this for?".
26. As a client, when I receive a monthly report, I see one document clearly titled "Monthly Report" with my activity summary (hours used vs included), and I am NOT prompted to pay anything — so my AP team does not log it as a payable invoice.
27. As a client, both invoices and monthly reports use the same brand identity (logo, colors, parties block) so they feel like they came from the same agency.
28. As a client, the monthly retainer fee I pay via Stripe subscription is referenced as context on every document ("Retainer: $X/mo, billed separately via Stripe") so I understand the document doesn't replace my Stripe receipt.

### Pro-rated months (project starts/ends mid-month)

29. As an agency owner, when a project starts or ends mid-month, that partial month receives the **full** included budget — not a pro-rated bucket. (Acknowledged limitation: small money leak vs. Stripe pro-rated charge. Logged in backlog. Acceptable while client count is small.)

---

## Implementation Decisions

### Architectural — the unified rule

- **One document per closed period.** Overage > $0 → invoice (DB entity, numbered, lifecycle). Overage = $0 → monthly report (on-demand render, no DB entity, no number, no lifecycle).
- **Reports are never persisted.** Always rendered live from the existing retainer-statement-style query. No `monthlyReports` table, no number sequence, no audit row. This is a deliberate choice — see decision rationale below.
- **The same period never produces both artifacts.** The "Statement ✅ Always" cell pattern in the previous draft meant *the report URL is always renderable for the owner's reference*, not *send a report alongside every invoice*. The client only ever receives one document per period.
- **The retainer monthly fee is never a chargeable line item on any document.** It appears only as disclaimer/context text. No `retainer_fee` line type exists in the schema after this refactor.

### D1 — Cycle invoice scope

For rollover-enabled retainer projects, **one invoice per cycle**, period = cycle range. The previous per-month chain (start-balance + cascade + sequential guard) is deleted. Mid-cycle months get no invoice; only the cycle-end month produces an invoice (and only if cycle overage > 0). `usedMinutes` = sum of all billable entries in the cycle. `includedMinutes` = `cycleLength × monthlyIncluded`. `startBalance = 0`.

### D2 — Mid-cycle invoicing

**Not allowed. Cycle-end only.** This is a permanent constraint, not a "for now" — removed from the previous draft's Future Extensibility list. If a runaway-overage situation occurs, the agency owner handles it out-of-band with the client.

### D3 — $0 invoice drafts

**Cannot exist.** The `createInvoice` mutation throws if a retainer period has no overage. The "Generate invoice" UI button does not appear on within-budget rows. The previous draft's "draft at $0 with finalize-time guard" pattern is deleted entirely — the bouncer is at the door of *creation*, not finalize.

### D4 — Report representation

**On-demand render, no DB entity.** Live render of a single query → HTML page → browser-native print → PDF. No drift possible (report and invoice read the same source). Future auto-send becomes a purely additive `sentReports` table without refactoring this flow. Report URL is always YYYY-MM (consistent for rollover and non-rollover); the renderer infers cycle context when relevant.

### D5 — Void semantics

Voiding an overage invoice **frees the period to be re-billed**. The Ready feed shows it again. The voided invoice remains visible in the Voided tab of `/invoices` for audit. No "credit note" entity in MVP — the void + re-create pattern handles corrections.

### D6 — In-progress month reports

The monthly report URL works for any past *or* current month. Current-month renders include an "In progress — partial data" badge. The owner uses this as a mid-cycle sanity check; the badge prevents accidental client send. Future-month URLs return Not Found.

### D7 — Backdated time entries

After-the-fact edits to closed-period time entries are **allowed**. Reports re-render with current data on every view (live truth). No period locking in MVP. The owner is responsible for not back-dating into already-sent periods. Future: optional period-lock action when auto-send ships.

### D8 — Document naming

The on-demand document is titled **"Monthly Report"** in the UI and on the rendered PDF (header). The previous draft's "Activity Statement" label is replaced. Reasoning: "report" is more obviously not-a-bill than "statement" (which has accounting connotations).

### D9 — `/invoices` page structure

Existing tab structure is preserved: **Ready / Draft / Sent / Paid / Overdue**. No "Inbox" merge, no new tabs, no relocation. The only change is content: Ready no longer contains within-budget retainer rows.

### D10 — Modal removal

The `CreateInvoiceModal` is removed. Clicking "Generate invoice" on a Ready row creates a draft invoice immediately and navigates to the draft page. The draft page itself is the preview/edit surface. Saves ~200 LOC and matches Stripe/Bonsai patterns.

### D11 — Stripe disclaimer

The project's Monthly Breakdown card shows a static disclaimer line below the title:
> *Monthly retainer fee ($X/mo) is billed separately via Stripe. This panel shows hours used and overage billed through this tool.*

Both the monthly report document and the overage invoice document include a similar context line so the client sees the full picture. Source values (`monthlyFee`, `currency`) come from project config. **No Stripe API integration. No payment date. No webhook.** Disclaimer text only.

### D12 — Pro-rated months

Partial-month projects receive the full included budget — no pro-ration. Logged as a known limitation in backlog. Acceptable while client count is small.

### D13 — `/reports` route

**Removed for MVP.** The route had no clear job after this refactor. When real cross-project analytics demand emerges (margin, utilization, revenue mix), it will be re-introduced with a defined scope. Until then, the nav item is removed.

### Schema changes

- Remove `v.literal("retainer_fee")` from the `lineType` union on `invoiceLineItems`. Only `time`, `overage`, and any other existing non-retainer line types remain. DB wipe makes this safe (MVP, dummy data).
- No new tables. No new fields.

### API contracts (logical)

- **`getReadyToInvoiceUnified` / `getRetainerUninvoicedMonths`**: returns only over-budget retainer rows for retainer projects. T&M and Fixed unchanged.
- **`getRetainerInvoicePreview`**: `total` returns overage only. `monthlyFee` returned as a separate context field, not part of total.
- **`createInvoice`** (retainer branch): throws `"This period has no overage. Download the monthly report instead."` when called for a within-budget period. For rollover projects, scopes time entries to the entire cycle and writes a single Overage line item with period = cycle range.
- **Retainer monthly report query** (currently named `getRetainerStatement`, may be renamed): unchanged shape; returns activity summary, cycle context (when applicable), monthly fee for context display, linked invoice pointer (when one exists). Accepts in-progress months and includes an `inProgress: boolean` field in the response.
- **Void invoice**: existing mutation, no API change. Frontend `/invoices` Ready feed automatically reflects re-availability because Ready computation reads invoice status.

### Cross-cutting frontend changes

- Monthly Breakdown card: single primary action per row per the rules above. Stripe disclaimer line below the card title.
- Monthly report document: title becomes "Monthly Report". Billing summary section shows fee as context (no amount-due block), used/included split, balance, plus cycle-to-date for rollover projects.
- Invoice document: drops any "Retainer fee" line item. Shows fee as context. Total = overage only.
- `CreateInvoiceModal`: deleted.
- Inbox empty-state: copy refers to monthly reports for within-budget periods (already partially in place).

---

## Module Design

### Module: Retainer balance computation

- **Name**: `computeRetainerBalance` (existing helper in retainer balance lib)
- **Responsibility**: Given a project, period, and time entries, return `{ usedMinutes, includedMinutes, startBalance, endBalance, overageMinutes, overageAmount, isOverageDue, retainerFeeAmount, total }` — where `total = overageAmount` (not `monthlyFee + overageAmount`).
- **Interface**: Pure function. Inputs: project config (monthly included, monthly fee, overage rate, rollover flag, cycle config), period (start/end timestamps), time entries scoped to the period. Outputs: balance breakdown. Failure mode: throws on inconsistent inputs (negative includedMinutes, etc.).
- **Tested**: yes — existing `retainerBalance.test.ts`, updated to assert `total === overageAmount` and rollover-cycle math.

### Module: Ready feed builders

- **Name**: `buildRetainerMonthlyReadyRows`, `buildRetainerCycleReadyRows`, `buildTmReadyRows`, `buildFixedReadyRow` (existing)
- **Responsibility**: Construct the rows shown in `/invoices` Ready tab from project state + invoices + time entries. After refactor: retainer monthly emits only over-budget closed months; retainer cycle emits only over-budget cycle-end months with period = cycle range.
- **Interface**: Pure functions. Inputs: project, related invoices, time entries, current timestamp. Output: array of `ReadyRow` (drop the `invoiceTotal` and `monthlyFee` plumbing fields — `amount` is the canonical billable amount).
- **Tested**: yes — existing `readyToInvoice.test.ts`, updated to drop `invoiceTotal` assertions and assert "no row when within budget".

### Module: `isInvoiceable` predicate

- **Name**: `isInvoiceable`
- **Responsibility**: One source of truth for "does this row produce a real invoice when batch-selected?".
- **Interface**: `(row: ReadyRow) => boolean`. Simplifies to `row.amount > 0` after refactor.
- **Tested**: yes.

### Module: Invoice creation orchestrator

- **Name**: `createInvoice` mutation (retainer branch)
- **Responsibility**: Validate the request, compute the balance, write the invoice + line items + period link. Refactored: retainer branch contains *no* `retainer_fee` line item; throws early when `!isOverageDue`; for rollover, scopes time-entry query to the entire cycle.
- **Interface**: Inputs: `projectId`, `period` (year/month or cycle marker — server resolves cycle from project config), optional admin overrides. Outputs: new invoice id. Failure modes: throws on within-budget retainer (clear message), throws on out-of-position cycle calls (must be cycle-end), unchanged failures for T&M/Fixed.
- **Tested**: yes — updated `invoiceCreation.test.ts` covers: retainer overage produces single Overage line; rollover cycle invoice covers full cycle range; throws when no overage; T&M/Fixed branches unchanged.

### Module: Monthly report query

- **Name**: `getRetainerMonthlyReport` (currently `getRetainerStatement` — may be renamed for terminology consistency, optional)
- **Responsibility**: Return everything needed to render a monthly report for a given project + period: balance, billing summary (with fee as context), cycle-to-date when applicable, brand, parties, billable category groups, linked invoice pointer (when an overage invoice exists for the period), and an `inProgress` flag.
- **Interface**: Inputs: `projectId`, `period` (YYYY-MM string). Outputs: `Statement | null`. Returns null for unknown periods. Returns data with `inProgress: true` for the current month.
- **Tested**: light. New test: in-progress month returns data with the flag set.

### Module: Monthly report document

- **Name**: `MonthlyReportDocument` (currently `StatementDocument`, rename for naming consistency with D8)
- **Responsibility**: Pure presentation. Renders header "Monthly Report", brand/parties block, period meta with status pill, balance breakdown (usage, included, balance, cycle-to-date when applicable), Stripe-disclaimer context line. **Never** renders an AMOUNT DUE block.
- **Interface**: Props: `{ statement: MonthlyReport }`. No callbacks, no mutations. Pure render.
- **Tested**: visual-only (manual). No unit test — pure presentation, low complexity.

### Module: Invoice document

- **Name**: `InvoiceDocument`
- **Responsibility**: Pure presentation. Renders the invoice with brand/parties, line items, AMOUNT DUE block, *and* the activity summary (hours used / included / balance) — so the client gets activity context without a separate report. Includes the Stripe-disclaimer context line.
- **Interface**: Props: `{ invoice }`. Pure render.
- **Tested**: visual-only (manual).

### Module: Monthly Breakdown card

- **Name**: `MonthlyBreakdownCard`
- **Responsibility**: List per-month rows for a retainer project. Each row shows: dot, month label, hours used, status pill (within-budget / over-budget / in-progress), amount, and exactly **one** primary action button per the row-actions rules. Renders the Stripe disclaimer line below the card title.
- **Interface**: Props: `{ data: RetainerData, projectId, projectName, currency }`. Internal state: sort direction (component-state-only, intentional).
- **Tested**: no unit tests — composition + presentation. Manual smoke per scenario.

---

## Testing Decisions

A "good test" here exercises **external behaviour**, not internal helpers:

- The retainer balance function is pure with clear inputs/outputs — table-driven unit tests cover monthly/rollover/over-budget/within-budget scenarios. **Asserts on numbers**, not on intermediate calc steps.
- The Ready feed builders are pure — test that "within-budget month produces no row" is one of the most important assertions in the whole refactor; it is the contract the entire UX depends on.
- `createInvoice` retainer branch is tested at the mutation boundary: assert the resulting invoice's line items, period, total, and snapshot — not internal helpers it called.
- Throw-message tests: "no overage → throws with the exact user-facing message" — because the message is part of the contract for the Generate-invoice UI.

### Modules with tests written

| Module | Test file (existing or new) | Status |
|---|---|---|
| `computeRetainerBalance` | `retainerBalance.test.ts` | Update: assert `total === overageAmount`, add rollover cycle math case |
| `buildRetainerMonthlyReadyRows` | `readyToInvoice.test.ts` | Update: drop `invoiceTotal`, add "within-budget produces no row" |
| `buildRetainerCycleReadyRows` | `readyToInvoice.test.ts` | Update: assert period = cycle range, drop `invoiceTotal` |
| `isInvoiceable` | `readyToInvoice.test.ts` | Update: only `row.amount > 0` |
| `createInvoice` retainer branch | `invoiceCreation.test.ts` | Update: single Overage line item, no `retainer_fee`; new test for cycle invoice period; new test for "no overage throws"; new test for "rollover non-cycle-end throws" |
| `getRetainerMonthlyReport` | new test in `statements` test file or report test file | New: in-progress month returns `inProgress: true` |

### Modules without tests

- `MonthlyReportDocument`, `InvoiceDocument`, `MonthlyBreakdownCard` — pure presentation, manually verified per the verification checklist below.
- `CreateInvoiceModal` is deleted — no test needed.

### Prior art

- `convex/lib/__tests__/invoiceCreation.test.ts` — closest analogue for invoice mutation tests.
- `convex/lib/__tests__/retainerBalance.test.ts` — closest analogue for balance helper tests.
- `convex/lib/__tests__/readyToInvoice.test.ts` — closest analogue for ready-row builder tests.
- `convex/lib/__tests__/fixedPrice.test.ts` — pattern for type-specific branch tests (mirror this for retainer).

---

## Out of Scope

- **Stripe API integration of any kind.** No webhook, no customer-id field, no payment date on documents, no auto-charge. Disclaimer text references Stripe but the tool has zero knowledge of Stripe state.
- **Auto-send reports or invoices.** No cron, no Resend, no email infrastructure. Owner downloads PDFs and attaches to their own email.
- **One-click "Send" via Resend** — added to backlog as Future, but explicitly not in this refactor.
- **Mid-cycle "Bill overage now"** — never. Cycle-end only is a permanent constraint, removed from Future.
- **"Bill monthly fee from this tool" toggle** — never. Stripe is canonical for the recurring fee, removed from Future.
- **Pro-rated included budget for partial months.** Full bucket on partial months is the accepted behavior. Logged as a known limitation; revisit when client count grows.
- **Period locking** when reports are downloaded or sent. Reports are always live truth in MVP. Owner is responsible for not back-dating into already-sent periods.
- **Cross-client global "statements queue" view.** Per-project hunting is the workflow in MVP.
- **`/reports` route.** Removed; will be re-introduced when real analytics demand emerges.
- **Credit notes.** Void + re-create handles corrections.
- **Client portal / client login.** Documents are PDF-rendered, accessible by URL or attached to email by the owner. No client-facing auth.
- **Tax / VAT.** Not in retainer billing logic; org-level invoice template can handle it later.
- **Multi-currency rollups.** Existing one-currency-per-project invariant remains.
- **Statement numbering / sent-tracking entity.** No table for tracking sends in MVP. Becomes a purely additive future change.

---

## Open Questions

| # | Question | Owner | Suggested resolution |
|---|---|---|---|
| 1 | Should `getRetainerStatement` and `StatementDocument` be renamed to `getRetainerMonthlyReport` and `MonthlyReportDocument` for terminology consistency with D8? Or keep "statement" internally and only rebrand at the document header? | Implementation | Decide during implementation. Renaming is cleaner but adds churn. Recommend: keep server symbol names; rename only the visible component and document title. |
| 2 | Should the `/projects/[id]/statements/[period]` route URL also rename to `/projects/[id]/reports/[period]`? Affects bookmarks and any existing deep links (none expected in MVP since dummy data). | Implementation | Recommend rename — consistent terminology end to end. DB wipe + dummy data makes URL change cost-free. |
| 3 | Does the in-progress-month report get any extra UI affordance besides the "In progress — partial data" badge (e.g., disabled "Download" button)? | UX | Recommend: badge only. Owner is the only audience for in-progress views; no need to lock interactions. |
| 4 | When auto-send eventually ships, does it auto-send the *invoice* in overage months or *only the report*? | Future | Defer. The unified rule says one document per period — auto-send should follow the same rule (invoice if overage, report if not). |

---

## Further Notes

### What this PRD trims from the previous draft

- D3 (draft-at-$0 + finalize-time guard) is **deleted** — the bouncer is at creation now, not finalize.
- Symmetric `[Generate invoice] + [↓ Statement]` row buttons are **collapsed** to one primary action per row.
- "Statement ✅ Always" cells in per-project-type tables are **clarified** to mean "available in tool", not "send to client".
- Future Extensibility entries for *Bill monthly fee from this tool* and *Mid-cycle Bill overage now* are **removed** as permanent No.
- Future Extensibility gains *One-click Send via Resend*.
- `/reports` route is **removed**.
- Document header naming is **"Monthly Report"** (not "Activity Statement").
- The CreateInvoiceModal is **deleted** in favor of click-to-draft.
- An in-progress-month view of the monthly report is **added** (with badge).
- Pro-rated months get full bucket — **acknowledged limitation** rather than a fix.

### Net code impact

- **Deleted**: `getRetainerStartBalance` rollover-ON branch, `cascadeRetainerChain`, sequential guard in `createInvoice`, `total === 0` finalize guard, `CreateInvoiceModal` component, "Retainer Fee" preview row, secondary statement download buttons on Monthly Breakdown rows, `/reports` route page.
- **Schema**: drop `v.literal("retainer_fee")` from `invoiceLineItems.lineType`.
- **Modified**: `createInvoice` retainer branch (early throw when no overage; cycle-scoped time-entry query for rollover), `computeRetainerBalance` (`total = overage` only), `buildRetainerMonthlyReadyRows` and `buildRetainerCycleReadyRows` (drop within-budget rows, drop `invoiceTotal` field), `getRetainerInvoicePreview` (overage as total, fee as context field), Monthly Breakdown card (single action per row, Stripe disclaimer), monthly report document (title rename, billing-summary edits), invoice document (drop fee line item, add activity summary prominence, add disclaimer context).
- **Added**: `inProgress` field on the report query response for in-progress month support; "In progress" badge on the report document; backlog note for pro-ration.

### Migration

DB wipe + reseed. The user has confirmed dummy data only; no production migration concerns. Steps:

1. Wipe `invoices`, `invoiceLineItems`, `retainerPeriods` via Convex dashboard.
2. Reseed via existing seed script with realistic test data covering every scenario row in the per-project-type behavior table (within-budget months, over-budget months, rollover and monthly retainers, T&M, Fixed).
3. Manual smoke test per the verification list below.

### Verification (Definition of Done)

- [ ] `npx tsc --noEmit` returns 0 errors.
- [ ] `npx vitest run` — all updated and new tests pass.
- [ ] `npm run build` succeeds.
- [ ] DB wipe + reseed verified: no `retainer_fee` line items remain.
- [ ] Zero retainer rows in `/invoices` Ready for within-budget projects.
- [ ] `/invoices` tabs (Ready / Draft / Sent / Paid / Overdue) all render and function as before.
- [ ] Monthly Report download works for every closed retainer period (mid-cycle and cycle-end, rollover and non-rollover).
- [ ] Monthly Report renders for in-progress current month with "In progress — partial data" badge.
- [ ] Stripe disclaimer line visible on retainer Project pages.
- [ ] Generate invoice: clicking Ready row → lands on draft page (no modal).
- [ ] Within-budget rows on Monthly Breakdown card show only "Download report" — no Generate invoice.
- [ ] Overage rows on Monthly Breakdown card show only "Generate invoice" (or invoice number link if billed) — no secondary statement download.
- [ ] Voiding an overage invoice causes the period to reappear in Ready.
- [ ] T&M and Fixed Price flows demonstrate no behavioral change vs. pre-refactor.
- [ ] `/reports` route removed from nav and unreachable via URL.
- [ ] `docs/backlog.md` updated with this refactor's tasks plus "TODOs deferred to later phases" referencing the Out of Scope list and Future entries.

### Backlog tracking

Per CLAUDE.md ("Backlog tracking is mandatory"), this refactor produces backlog entries with task-level checkboxes for each module change, the verification list above, and a "TODOs deferred to later phases" section explicitly listing: one-click Resend send, period locking, cross-client report queue, pro-ration math, Stripe webhook for payment-date display, and `/reports` analytics view.
