# PRD: Billing Refactor — Close as a First-Class Entity

> **Status:** Draft for implementation · 2026-10-17 · Owner: Adam
>
> **Supersedes** the data model and write paths of `docs/prd-month-close.md`,
> `docs/invoicing-refactor.md`, and `docs/phase-8-time-entry-settlement.md`. Their
> *business behaviour* (review-first close, skip-to-next-close, oldest-first, retainer
> overage, rollover cycles) is preserved unless this document says otherwise. Where they
> conflict with this PRD, this PRD wins.
>
> **Criticality.** This flow decides what clients are billed. Every rule below is an
> invariant, every invariant has an owning module, and every module has tests. If code
> must deviate from a MUST in this document, update this document first.

## 1. Problem Statement

The owner does not trust the time tracking → reporting → invoicing flow. A senior review
(2026-10-17) found that the distrust is justified. The problem is not the business
concept. Three generations of the billing model run side by side, and no generation
replaced the one before it:

1. Phase 8 settlement stamps on entries (`settledAt`, `settledReason`,
   `settledPeriodStart/End`)
2. the invoicing-refactor ready feed and retainer balance helpers (`readyToInvoice`,
   `retainerBalance`, `retainerCycle`)
3. the month-close `billingScope` module (I1–I4)

So the question "is this hour billed, and where?" is answered by six entry fields, two
tables (`retainerPeriods.closedAt` and the invoice period anchor), and the line-item
`timeEntryIds` arrays. Each reader assembles the answer slightly differently.

| Concern | Implementations today |
|---|---|
| Retainer overage amount | 8 copies, 2 different formulas |
| Retainer balance / usage ladder | 7 |
| T&M amount (minutes × rate + rounding) | 6 |
| `round2` / minute-rounding helpers | 11 + 6 |
| Period membership derived outside `billingScope` | 22 sites |
| Definitions of "entries on invoice X" | 3 |
| tasks → entries fan-outs (entries carry no `projectId`) | ~20 |
| UI entry points that call `createInvoice` | 7 (the month-close PRD allows 1) |
| Business math in the frontend | ~22 sites |

The test suite (1,562 passing) tests each engine on its own. Nothing asserts that the
queue, the workspace, the invoice, and the report agree, and that boundary is where the
bugs are.

### 1.1 Verified defects in the current code

| # | Defect | Where |
|---|---|---|
| B1 | Retainer overage is priced from minutes in the queue and workspace (7 min × 100/h = 11.67) but from 2-decimal hours on the invoice (0.12 h → 12.00). "Generate · $11.67" produces a $12.00 draft. | `lib/retainerBalance.ts:103` vs `lib/billingScope.ts:532` |
| B2 | Project-page "Create Invoice" calls `createInvoice` for T&M with no date bounds. It sweeps every open billable entry, including skipped ones, ignores oldest-first, and then marks the month as closed. | `components/invoices/project-invoices.tsx:89`, `convex/invoices.ts:1474` |
| B3 | The retainer finalize gate requires entries logged after the draft to be refreshed in. `billingScope` and the month-close PRD (I2) say those entries belong to the next close. | `convex/invoices.ts:2976` |
| B4 | While a carried-in entry sits on a draft, it counts in its origin month's report, a month that is already closed. The receiving month's report leaves it out. Reproduced: March is closed with a 30-min skipped entry, and April has 45 min plus that carried entry. The April draft bills 15 min of overage, yet the April report shows 45 min used and "within budget", and the March report shows 30 min used. This breaks "closed reports are stable" (I4) and N11. | `lib/reportMembership.ts` (draft-linked → natural month) |
| B5 | Editing hours on a draft time line recomputes the amount from 2-decimal hours (20 min @ 100 → 33.00, not 33.33). | `convex/invoices.ts:2674` |
| B6 | An invoice reverted from `invoiced` to `draft` keeps its number and can then be deleted, which leaves a gap in the "gapless" series. | `convex/invoices.ts:3316` |
| B7 | *Latent rule defect.* After an older retainer period is re-opened while later periods stay closed, an open entry dated in a later, closed period resolves into that closed period (I1 `max` rule). It is then in no close scope, yet the closed month's report lists it. Today the retainer entry-date write guard (`lib/settleGuards.ts`) masks this, because it blocks logging into closed periods. The rule itself is wrong, and the new scope rule (§6) must not depend on that guard. | `lib/billingScope.ts:422`, `lib/reportMembership.ts` |

## 2. Goals and Non-Goals

**Goals**

- One write path from "time logged" to "invoice exists": the Close workspace commit.
- One state field per entry, one scope rule, one pricing function, one rounding policy.
- Finalized documents are frozen snapshots: no later code or data change can alter
  what a sent invoice or report says.
- Money stored as integer minor units.
- An append-only audit trail of every billing state change.
- A test suite that proves queue = workspace = invoice = report for the same inputs.
- Delete more code than we add.

**Non-goals**

- Changing the review-first UX of the Close queue and workspace (layout stays; data
  sources change).
- Credit notes or storno documents (the invoiced → draft revert stays; see §3).
- Tax / VAT lines, multi-currency per project, client portal, auto-send.
- Data migration. MVP stage with dummy data: reseed after schema changes
  ([[project_mvp_dummy_data]]).

## 3. Owner Decisions (2026-10-17, binding)

| # | Decision |
|---|---|
| D1 | **Rollover (multi-month cycle) retainers stay.** A real client uses them. The implementation is simplified (§6, §8). |
| D2 | **Skip-to-next-close and logged-late carry stay.** The mechanism is simplified (§6). |
| D3 | **`invoiced → draft` revert stays.** The number is kept. Every revert is written to the billing event log. |
| D4 | **Data-model rebuild**: a first-class `billingCloses` entity replaces derived close state. |
| D5 | **Fixed-fee projects leave the close machinery.** A fixed-fee invoice is purely amount-based (deposit / installment / remainder). Fixed-project entries are reporting-only and never lock. |
| D6 | **Draft time and overage lines are not editable in amount.** Only the description text is editable. Extras and discounts are manual lines. The fix for wrong hours is the ledger (workspace), never the document. |
| D7 | **Draft refresh is removed**, along with the stale-draft finalize gate. A draft is the snapshot of its scope at commit. Later time belongs to the next close; to include it, delete the draft and regenerate. |
| D8 | **Removed entry points:** invoice from selected entries (Path B), unbounded T&M generate, and every Generate button outside the Close workspace (project overview banners, project Invoices tab, Monthly Breakdown rows, retainer callout). These become links to the workspace. |
| D9 | **Per-draft rounding picker is removed.** Rounding is a setting that is frozen into the close at commit. |
| D10 | **Worksheet exports collapse to two**: export a close, and export an ad-hoc date range. |
| D11 | **Stripe-grade amendments**: frozen snapshot at commit, integer minor units, append-only event log. |

## 4. Glossary

- **Entry**: a `timeEntries` row. Its minutes and rate snapshot are the ledger.
- **Period**: the close unit on a project's grid. A non-rollover retainer and T&M use a
  calendar month. A rollover retainer uses an N-month cycle anchored at
  `project.startDate`. Fixed-fee projects have no periods.
- **Close**: a `billingCloses` row. The committed decision "these entries settle period P
  of project X". A close is **live** while its status is `draft` or `final`, and
  **released** once it has been undone.
- **Open entry**: an entry with no `closeId`. Only open entries are editable.
- **Scope of P**: the open entries that belong to period P (§6).
- **Snapshot**: the `billingCloseEntries` rows written at commit, an immutable copy of
  every member's minutes, rate, category, task, and month bucket.
- **Minor units**: integer amounts in the currency's smallest unit (cents). Rates are
  minor units per hour.

## 5. Data Model

### 5.1 New tables

```ts
billingCloses: defineTable({
  orgId: v.string(),
  projectId: v.id("projects"),
  kind: v.union(v.literal("retainer"), v.literal("t_and_m")),
  periodStart: v.string(),            // YYYY-MM-01
  periodEnd: v.string(),              // YYYY-MM-DD (month end, or cycle end)
  status: v.union(v.literal("draft"), v.literal("final"), v.literal("released")),
  invoiceId: v.optional(v.id("invoices")),  // present iff the close bills money

  // Frozen at commit — the pricing inputs and outputs.
  currency: v.string(),
  roundingMinutes: v.number(),        // T&M line rounding; retainer always 1
  includedMinutes: v.number(),        // retainer: perMonth × months; T&M: 0
  overageRateMinor: v.number(),       // retainer, minor units per hour; T&M: 0
  usageMinutes: v.number(),           // billable minutes in scope (raw)
  overageMinutes: v.number(),
  amountMinor: v.number(),            // money the close bills (0 = within budget)

  committedAt: v.number(),
  committedBy: v.id("users"),
  finalizedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  releasedReason: v.optional(v.union(
    v.literal("draft_deleted"), v.literal("invoice_voided"), v.literal("reopened"),
  )),
})
  .index("by_projectId_periodStart", ["projectId", "periodStart"])
  .index("by_orgId_status", ["orgId", "status"]),

billingCloseEntries: defineTable({   // the immutable snapshot (N2)
  orgId: v.string(),
  closeId: v.id("billingCloses"),
  entryId: v.id("timeEntries"),
  taskId: v.id("tasks"),
  categoryId: v.optional(v.id("workCategories")),
  date: v.string(),                   // entry date at commit
  monthKey: v.string(),               // YYYY-MM bucket (§8.3)
  minutes: v.number(),
  isBillable: v.boolean(),
  billableRateMinor: v.number(),
  carried: v.optional(v.union(v.literal("skipped"), v.literal("logged-late"))),
})
  .index("by_closeId", ["closeId"])
  .index("by_entryId", ["entryId"]),

billingEvents: defineTable({          // append-only audit trail (N10)
  orgId: v.string(),
  projectId: v.id("projects"),
  closeId: v.optional(v.id("billingCloses")),
  invoiceId: v.optional(v.id("invoices")),
  type: v.union(
    v.literal("close_committed"), v.literal("close_released"),
    v.literal("invoice_finalized"), v.literal("invoice_reverted"),
    v.literal("invoice_voided"), v.literal("invoice_paid"),
    v.literal("invoice_unpaid"), v.literal("draft_deleted"),
    v.literal("entries_skipped"), v.literal("entries_unskipped"),
  ),
  actorId: v.id("users"),
  at: v.number(),
  data: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
})
  .index("by_projectId_at", ["projectId", "at"])
  .index("by_invoiceId", ["invoiceId"]),
```

Convex has no unique constraints. N3 (one live close per period) is enforced inside the
single commit mutation, which reads `by_projectId_periodStart` in the same transaction.

### 5.2 Changed tables

**`timeEntries`**

- **Add** `projectId: v.id("projects")` (denormalized from the task) with index
  `by_orgId_projectId_closeId: ["orgId", "projectId", "closeId"]`. This removes the ~20 tasks → entries
  fan-outs.
- **Add** `closeId: v.optional(v.id("billingCloses"))`. It is a lock and a lookup key,
  **not** the source of truth for a closed period's membership (that is the snapshot,
  N2).
- **Change** `billableRate` / `costRate` to integer minor units per hour
  (`billableRateMinor`, `costRateMinor`). *Not done:* rate config and the entry
  rate snapshot stay decimal and are converted once, at commit
  (`closeData.toBillingEntry`); every stored billing output is minor units.
- **Keep** `skippedThrough` (a period end date).
- **Remove** `invoiceId`, `settledAt`, `settledReason`, `settledPeriodStart`,
  `settledPeriodEnd`.
- `projectId` sync: every path that changes `task.projectId` MUST keep rejecting tasks
  that have entries (today only the bulk path in `convex/tasks.ts:1690` does; audit the
  single-task path). `timeEntries.update` with a new `taskId` MUST set the new
  `projectId`, and only on open entries.

**`invoices`**

- Amounts become minor units: `subtotalMinor`, `totalMinor` (required). The
  decimal `subtotal` / `total` are gone from storage; queries add them as display
  copies at the read boundary (`lib/billing/invoiceView.ts`).
- **Add** `closeId: v.optional(v.id("billingCloses"))`. Absent on fixed-fee invoices.
- **Add** `sentAt: v.optional(v.number())`, reserved for the open question in §13.
- **Remove** `retainerStartBalanceMinutes`, `retainerIncludedMinutes`,
  `retainerUsedMinutes`, `retainerEndBalanceMinutes`, `retainerMonthlyFee`,
  `retainerOverageRate`, `retainerRolloverEnabled`, `retainerCycleLength`,
  `roundingMinutes`, and `periodStart/End`. They move to the close (or are read through
  `closeId`): `invoices.getInvoice` returns the close's `period` (with its month count,
  which also labels the document "monthly" vs "N-month rollover"). The Stripe
  disclaimer reads the project's live `monthlyFee`; add `monthlyFeeMinor` to the
  close if the disclaimer must survive a fee change.
- Keep both `subtotalMinor` and `totalMinor`. They are equal until tax lines exist.

**`invoiceLineItems`**

- `lineType`: `time | overage | fixed | manual`.
- Amounts in minor units: `unitPriceMinor`, `amountMinor` (required; the decimal
  `unitPrice` / `amount` are read-boundary display copies). `quantityMinutes` stays
  the source quantity for time and overage lines.
- **Add** `groupKey` (time lines: `category::task::rate`) and `descriptionOverride`.
- **Remove** `timeEntryIds` (membership lives in the snapshot) and `amountOverridden`.
  *Deviation:* `quantity` stays. It is the manual-line multiplier (user input), 1 on
  fixed lines, and the billed hours of a time/overage line written once at commit
  for display. It never feeds money back: amounts are priced from minutes.
- Editability (D6): time, overage, and fixed lines allow `descriptionOverride` only, and
  only in draft. Manual lines are fully editable in draft.

### 5.3 Removed tables

- `retainerPeriods`. "Closed" is now "has a live close". `retainerCron` goes with it.

## 6. The Scope Rule

Owning module: `convex/lib/billing/scope.ts` (pure).

**Effective period** of an open entry `e` on project `X`:

```
from(e)            = later of naturalPeriod(e.date) and periodAfter(e.skippedThrough)
effectivePeriod(e) = the first period P on X's grid with P.start ≥ from(e).start
                     that has NO live close
```

**Scope of period P** = open entries whose effective period is P.

- **T&M**: billable entries only. Non-billable T&M entries are never closed.
- **Retainer**: billable and non-billable. Non-billable entries never count toward money,
  but they settle with the close, so each hour appears on exactly one client report.
- An entry in scope with `date < P.start` is **carried**: reason `skipped` if it has a
  skip stamp, otherwise `logged-late`.

**Committable period** of a project:

- **Retainer**: the earliest period on the grid (from `startDate`) with no live close. It
  is committable iff it has fully elapsed (`P.end < today` in the org timezone). Empty
  periods are committable (a zero-usage "Close & report").
- **T&M**: the earliest elapsed period with no live close whose scope is non-empty.

What this replaces, and why it is simpler:

- There is no `firstOpenPeriod` input and no three-way `max`. "First period without a
  live close at or after `from(e)`" covers natural, skipped, and logged-late entries with
  one rule. It also fixes B7: an entry can never resolve into a closed period.
- **Logged-late needs no code.** An open entry whose natural period is closed simply
  resolves to the next unclosed period.
- **Skip** sets `skippedThrough = P.end` for the committable period P. Skipping again
  next period is the same action. Un-skip clears the stamp. If the origin period has
  since closed, the entry still resolves forward (month-close story 22 holds
  structurally).
- **Voiding or deleting** an older close makes that period unclosed again, so its
  entries resolve back to it and it becomes the committable period. Month-close story 30
  holds.

## 7. Pricing and Rounding Policy

Owning modules: `convex/lib/billing/money.ts` (units, rounding) and
`convex/lib/billing/pricing.ts` (pure). **No other module may multiply minutes by a
rate, round money, or derive overage.** Frontend code formats server-provided minor
units only.

| Rule | Policy |
|---|---|
| Storage | Integer minor units, ISO 4217 exponent per currency (`money.ts` exponent table). Rates in minor units per hour. Validate `Number.isInteger` at every write. |
| Ledger minutes | Integers. Entry creation rounds up to the whole minute (existing `roundMinutes(raw, 1)`). Never rounded otherwise. |
| T&M line | Group scope by `(category, task, rate)`. `billedMinutes = ceilTo(groupMinutes, roundingMinutes)`. `amountMinor = roundHalfUp(billedMinutes × rateMinor / 60)`. |
| Retainer | No minute rounding (raw, so the close gate and invoice can never disagree at a rounding boundary). `included = perMonth × months(P)`. `overageMinutes = max(0, usage − included)`. `amountMinor = roundHalfUp(overageMinutes × overageRateMinor / 60)`. |
| Invoice total | `Σ line.amountMinor`. Nothing is rounded at document level. |
| Display hours | `minutes / 60`, formatted. Never fed back into a calculation. |

`pricing.priceScope(input) → { lines, usageMinutes, includedMinutes, overageMinutes,
amountMinor, withinBudget, issues, monthlyBalances }` is the one function. The queue
row, the workspace summary, the commit, and the client report all call it. Issues are
typed and never thrown: `missing-overage-rate` (blocking for Generate) and
`not-committable`.

## 8. Lifecycles

### 8.1 Commit (the only way a close or a T&M/retainer invoice comes into being)

`billing.commitClose({ projectId, periodStart })`, admin only. In one transaction it:

1. Resolves the committable period server-side and rejects if `periodStart` does not
   match it (oldest-first, N5). Also rejects if a live close already exists (N3).
2. Computes scope (§6) and price (§7) from current data. Client state is never trusted.
3. Blocks on `missing-overage-rate`.
4. Inserts `billingCloses`, then one `billingCloseEntries` row per scope entry, then sets
   `closeId` on each entry.
5. If `amountMinor > 0`: inserts a draft invoice with generated time and overage lines
   (status `draft`, no number). The close status is `draft`.
6. If `amountMinor === 0` (a within-budget retainer, or a T&M scope priced at zero): no
   invoice. The close status is `final` immediately ("Close & report").
7. Appends `close_committed`.

### 8.2 State table

| Transition | Close | Entries | Invoice | Event |
|---|---|---|---|---|
| commit, money > 0 | → `draft` | `closeId` set | draft created | `close_committed` |
| commit, money = 0 | → `final` | `closeId` set | none | `close_committed` |
| finalize (draft → invoiced) | → `final` | unchanged | number allocated (first time only), lines frozen | `invoice_finalized` |
| revert (invoiced → draft, D3) | → `draft` | unchanged | number kept | `invoice_reverted` |
| mark paid / undo | unchanged | unchanged | `paidAt` set / cleared | `invoice_paid` / `invoice_unpaid` |
| delete draft (never numbered) | → `released` | `closeId` cleared | deleted with lines | `draft_deleted` + `close_released` |
| void (draft or invoiced) | → `released` | `closeId` cleared | `void`, number kept | `invoice_voided` + `close_released` |
| reopen within-budget close | → `released` | `closeId` cleared | n/a | `close_released` |

- **Release** is one helper, `releaseClose(closeId, reason)`. The snapshot rows of a
  released close are kept for audit. Entries become open and re-resolve by §6. Their
  skip stamps survive.
- A draft whose invoice has ever been numbered **cannot be deleted**, only voided (fixes
  B6, N9).
- Because entries are locked from commit, rounding is frozen at commit, and line amounts
  are not editable (D6), the document's money is final at commit. Finalize only numbers
  and seals it. The only draft edits are subject, dates, message, line descriptions, and
  manual lines.

### 8.3 Month bucket (rollover cycles)

`monthKey` in the snapshot is the entry date clamped into `[P.start, P.end]`, then
truncated to `YYYY-MM`. A carried-in entry lands in the cycle's first month. It is
computed once at commit by `periods.monthBucket()` and stored. Readers never recompute
it.

The cycle balance ladder (`monthlyBalances`) is a pure function in `pricing.ts` over the
snapshot (closed) or scope (open). It replaces `computeMonthlyBalances`,
`enumerateRetainerCycleState`, `getRetainerData`'s ladder, `buildRetainerUsageRows`,
`recalcRetainerBalance`, `computeRetainerSummary`'s pooling, and
`retainerHealthForMonth`.

### 8.4 Fixed-fee projects (D5)

- No closes, no scope, no entry locking. Entries are a work report only.
- `billing.createFixedInvoice({ projectId, amountMinor, description })` creates a draft
  with one `fixed` line. Presets in the UI: 25%, 50%, Remainder.
- `remainingMinor = fixedPriceMinor − Σ fixed line amounts on invoiced and paid
  invoices`. Creation and finalization both reject `amountMinor > remainingMinor`, with
  drafts not counted. Finalize re-checks because sibling drafts may race.
- Entry point: the project's Invoices tab. Fixed-fee projects do not appear in the Close
  queue (open question in §13).

## 9. Invariants

Each has an owning module and at least one test that fails if it breaks.

| # | Invariant | Owner |
|---|---|---|
| N1 | **Lock.** An entry is editable/deletable iff `closeId` is unset or points to a released close. Fixed-project entries never get a `closeId`. | `timeEntries` guards |
| N2 | **Snapshot.** For a live close X, `{entryId ∈ billingCloseEntries(X)}` equals `{entries with closeId = X}`. Snapshot rows are written once at commit and never patched. | `commitClose`, `releaseClose` |
| N3 | **Uniqueness.** At most one live close per (project, period). Live periods of a project never overlap. | `commitClose` |
| N4 | **Scope.** A commit attaches exactly `scope(P)` as computed server-side by §6. | `scope.ts` |
| N5 | **Oldest-first.** Only the committable period (§6) can be committed. | `scope.ts`, `commitClose` |
| N6 | **Money.** All stored amounts are integer minor units, produced only by `pricing.ts` / `money.ts`. Invoice total = Σ line amounts. | `pricing.ts` |
| N7 | **Frozen.** After commit, close totals and time/overage line amounts never change. After finalize, nothing on the document changes except status, `paidAt`, and `sentAt`. | invoice mutations |
| N8 | **Report membership.** A period with a live close reads members from its snapshot. Any other period reads from §6. Each entry appears on at most one client document. | `reports.ts` |
| N9 | **Numbering.** A number is allocated at first finalization, never reused or removed. A numbered invoice cannot be deleted. | `invoiceLifecycle.ts` |
| N10 | **Audit.** Every transition in §8.2 and every skip/un-skip appends exactly one `billingEvents` row in the same transaction. | lifecycle mutations |
| N11 | **Agreement.** For identical data, queue amount = workspace amount = draft total (excluding manual lines) = report figures. | consistency suite (§11) |

## 10. Surfaces

| Surface | Change |
|---|---|
| **Close queue** | One row per retainer/T&M project: its committable period, amount from `priceScope`, review flags, plus a muted "+N more periods" hint. Blocked-row rendering and `disabledReason` are removed. Sidebar badge = row count + overdue invoices, from the same query. |
| **Close workspace** | Same UX. Reads `scope` + `priceScope`. The commit button calls `commitClose`. Generate navigates to the draft; "Close & report" stays on the queue (unchanged). |
| **Invoice editor** | No rounding picker, no refresh banner, no hours/amount edit on time/overage lines. Description override, manual lines, subject, dates, message stay. Shows "Delete draft" only if never numbered, otherwise "Void". |
| **Project pages** | Overview banners, Invoices tab, Monthly Breakdown, and retainer callout link to the Close workspace instead of generating. Fixed-fee projects get "Bill fixed fee" (§8.4). |
| **Monthly report** | Membership per N8. The "Carried over from <month>" grouping reads `carried` from the snapshot or scope. |
| **Worksheets** | `exportClose(closeId)` and `exportRange(projectId, start, end)`. The other three actions are deleted. |
| **Frontend math** | All ~22 sites render server values. Amounts arrive as minor units plus currency, and one formatter turns them into display strings. Overdue is computed once on the server. |
| **Agent tools / reports** | Read through `scope.ts`, `pricing.ts`, and `reports.ts`. No private money math. |

## 11. Testing

1. **Pure module suites** (`scope`, `pricing`, `money`, `periods`): the month-close
   golden scenarios (no skips, skip entry, skip task, double skip, logged-late, undo
   skip, oldest-first, budget flip, zero scope, missing rate, reopen, non-billable,
   cycle carry), each for monthly retainer, cycle retainer, and T&M. Add property tests:
   - every open entry resolves to exactly one non-closed period;
   - Σ scope over consecutive commits equals Σ billable minutes, with no entry counted
     twice.
2. **Consistency suite** (`convex-test`, the new N11 gate). For each scenario, seed the
   data, then assert that the queue row amount, workspace summary, `commitClose` draft
   total, finalized invoice, and monthly report figures are equal. Then void, recommit,
   and assert again.
3. **Lifecycle suite**: every row of §8.2, including the event row (N10), number
   behaviour (N9), and delete-after-revert rejection (B6).
4. **Regression list**: B1–B7 each get a named test. In slice 0 they are written against
   the current code; B1 and B2 are fixed there, and B3–B7 are marked `it.fails` until
   slice 3 fixes them structurally.

Gates per slice: `npx tsc --noEmit`, `npm run lint`, `npm test`, and reseed plus a manual
pass through queue → workspace → draft → finalize → report for one monthly retainer, one
cycle retainer, one T&M project, and one fixed-fee project.

## 12. Slices

Per project convention, the slices land as commits on one branch and ship as one PR
([[feedback_one_pr_refactors]]). Slice 0 may ship first on its own if the owner wants
the hot fixes early. Each slice ends green on the gates above.

**Slice 0 — Safety net and hot fixes (current model)**
- Consistency suite skeleton and the B1–B7 regression tests.
- Fix B1: `computeRetainerBalance` prices overage from minutes.
- Fix B2: project-page Generate buttons become links to the workspace (D8, the subset
  that is safe on the old model).
- Done: the consistency suite runs and the known failures are marked.

**Slice 1 — Foundations** *(done 2026-10-17)*
- `lib/billing/money.ts` (exponent table, `roundHalfUp`, `ceilToIncrement`,
  `priceMinutesMinor`, legacy `round2`) and `lib/billing/periods.ts` (grid,
  `periodOfDate`, `nextPeriod`, `monthBucket`). All 10 private rounding copies in
  `convex/` and `billingScope`'s private grid now import them.
- `timeEntries.projectId` (required) with index `by_orgId_projectId`, rolled out as
  widen → backfill (`migrations/backfillEntryProjectId`) → narrow. Task project changes
  are now blocked for any task with entries, including clearing the project, which used
  to be allowed.
- `lib/projectEntries.getProjectEntries` replaces the tasks → entries fan-out in every
  reader that survives the refactor: queue, workspace, statements, worksheets, project
  overview/breakdown/retainer data, agent reports, period close/reopen, commit scope,
  and the delete guards.
- *Deferred deliberately:*
  - Fan-outs inside `createInvoice`, the draft refresh, `lib/settleEntries`, and the
    dead `lib/retainerCycle` stay until slices 3 and 5 delete that code.
  - Rates and amounts in minor units move to slice 3, together with the new pricing
    module. Converting the old engines first would be work thrown away in slice 5.

**Slice 2 — Close model and pure modules** *(done 2026-10-17)*
- Schema: `billingCloses`, `billingCloseEntries`, `billingEvents`, and
  `timeEntries.closeId`. The slice 1 index became `by_orgId_projectId_closeId`: its
  prefix lists a project's entries, and `closeId === undefined` lists its open ones.
- `lib/billing/scope.ts` (§6) and `lib/billing/pricing.ts` (§7) are pure and have no
  production consumers yet. Suites:
  - `billingScopeRule.test.ts`: the golden scenarios, plus properties over random
    ledgers. Every open entry has exactly one unclosed home, and repeated oldest-first
    closes settle every entry exactly once.
  - `billingPricing.test.ts`.
- `billingShadow.test.ts`: the new modules agree with `computeBillingScope` on
  membership, carried reasons, usage, overage, amount, committability, and the ladder.
  It covers fixed scenarios and 40 random ledgers for each grid type. The only
  asserted difference is B7. Mutation-checked: breaking T&M rounding or the carried
  reason turns it red.

**Slice 3 — Close model goes live (expand → cutover)**

Switching only the writes would leave the old readers disagreeing with the new
writer. So slice 3 is an expand → cutover migration in which every commit stays
consistent:

- **3a — write path, in parallel** *(done 2026-10-17)*
  - `lib/billing/closeLifecycle` (`commitClose`, `releaseClose`),
    `lib/billing/invoiceLifecycle` (finalize, revert, void, paid,
    `deleteCloseModelDraft`, number allocation shared with the old path),
    `lib/billing/closeData` (the only docs → model mapping), and
    `lib/billing/events`.
  - Public: `billingCloses` (`commitClose`, `reopenClose`, `skipEntries`) and
    `billingInvoices` (`createFixedInvoice`, `setLineDescription`, manual lines).
  - The existing status mutations and `deleteInvoice` delegate to the new lifecycle
    for close-model invoices (marker: `totalMinor`). The old editing mutations
    (rounding, refresh, line amounts) reject them.
  - The entry guards treat `closeId` as a lock.
  - Invoice schema widened with `closeId`, `*Minor`, and `groupKey`. The decimal fields
    are derived display copies until slice 5.
  - Billing output (closes, invoices, lines) is stored in minor units. Rate *config*
    (rate tables, project overage rate and fixed fee) stays as typed decimals and is
    converted once, at commit (`closeData.toBillingEntry`, `toPricingProject`).
  - `billingWritePath.test.ts` (17 tests, mutation-checked) covers N1, N2, N3/N5, N7,
    N9, N10, B3, and B6 on the new path.
- **3b + 3c — read path and cutover** *(done 2026-10-17, one commit)*. Readers that
  switch in place cannot coexist with old UI writes without dual-model code, so the read
  path and the cutover landed together. Every commit stays consistent.
  - **New views:** `billingViews` (queue with one row per project plus
    `pendingPeriods`, workspace, badge) and `billingReports.getMonthlyReport` (a
    compile-time drop-in for the legacy report). Both are built on
    `lib/billing/periodView`: a closed period re-prices its frozen snapshot, an open
    period is priced live.
  - **Readers moved to closes:** `getInvoice`, `entryStatus` and the overview buckets
    (now close-aware), `getRetainerData`, `getSummary`, `getProjectInvoiceMetrics`,
    worksheets (closed-month and invoice scopes read the snapshot; cycle exports split
    by report month), and the agent retainer report. They use report months
    (`lib/billing/reportMonths`).
  - **UI cutover:**
    - Billing hub, workspace, report page and close/reopen modals call the new API.
    - Project-page Generate buttons open the Close workspace; fixed fee uses
      `createFixedInvoice`.
    - Editor: description and manual lines only (`useInvoiceLineActions`); the fixed
      amount goes through `setFixedAmount`.
    - Refresh, the rounding picker and the line amount edits are gone.
  - The retainer entry-date guard is dropped (story 28).
  - Dev reset: `migrations/resetBillingForCloseModel`.
  - The consistency suite runs on the new API, and B3–B7 are plain tests.
  - Verified in the browser on dev: queue → workspace → draft ($1,550, equal to the
    promise) → delete draft → the period returns.

**Slice 4 — Read path**
- Queue (one row per project), workspace, monthly report (N8), worksheets (2 exports),
  project overview, summary and monthly breakdown, invoice list and metrics, sidebar
  badge, agent tools and reports.
- Remove frontend money math.

**Slice 5 — Deletion** *(done 2026-10-17)*
- Schema: the entry `invoiceId` and `settled*` fields, the `retainerPeriods` table,
  the invoice retainer snapshot fields, `roundingMinutes` and `periodStart/End`, and
  the line `timeEntryIds` / `amountOverridden` are gone. Money is stored only as
  minor units (`subtotalMinor`, `totalMinor`, `unitPriceMinor`, `amountMinor` are
  required); `lib/billing/invoiceView` adds the decimal display copies in queries.
  `quantity` stays (see §5.2).
- Deleted: `lib/billingScope`, `readyToInvoice`, `retainerBalance`, `retainerCycle`
  (`getCyclePeriods` moved to `lib/billing/periods`), `reportMembership`,
  `settleEntries`, `settleGuards`, `commitScope`, `invoiceAnchor`, `invoiceCreation`,
  `fixedBilling`, `skipGuards`; `convex/close.ts` (its UI types now live in
  `billingViews.ts`), `statements.ts`, `retainerPeriods.ts`, `settleEntries.ts`,
  `retainerCron.ts` and `crons.ts`; the legacy `invoices.ts` mutations and queries
  (`createInvoice`, refresh, rounding, line amount edits, the ready feed and nav
  signals); the old-model migrations (including `backfillEntryProjectId` and
  `resetBillingForCloseModel`); and their tests (`billingShadow`, the B2 test and
  `invoiceTransitions` with them — the seller-name gate and paid → draft rejection
  moved to `billingWritePath`). `lib/retainerUsage` stays, trimmed to the document
  usage rows.
- `lib/billing/invoiceLifecycle` is the only lifecycle (`transitionInvoice`,
  `deleteDraftInvoice`); the `isCloseModelInvoice` marker is gone.
- Readers: entry status and locks read only `closeId` / the live close (the Time
  tab, task time list, tooltips, day-group references and the period drill-down
  now show close data — the Reopen / View report row actions work again). Queue
  rows lost `disabledReason` / `committable` (no blocked rows); the workspace's
  `fromSettlementStamps` is now `isClosed`. Agent tools read the Close queue and
  `billingReports.getMonthlyReport`. Invoice-list "ready" rows are gone; list and
  bulk totals sum minor units.
- `docs/architecture.md` has a Billing section; the month-close, invoicing-refactor
  and Phase 8 PRDs are marked historical.
- *Left for later:* worksheet exports still number five (D10); slice 4's remaining
  frontend money math (overview `openAmount`, Time-tab selection totals, drill-down
  amounts) and the queue's "+N more periods" hint.

**Slice 6 — Hardening**
- Reconciliation query: for every live close, re-price the snapshot and compare it with
  the stored close and invoice amounts. Run in tests and from a dev-only admin query.
- Billing history view (events) on the invoice and project pages. Optional; owner call.

## 13. Open Questions

| Question | Recommendation |
|---|---|
| HUF and other currencies invoiced in whole units in practice: round line amounts to whole units? | Follow the accountant. The `money.ts` exponent table can mark HUF as invoice-precision 0 without changing storage. |
| Should the revert (D3) be limited to invoices not yet sent or downloaded? | Yes, once `sentAt` exists. Until then, revert is always allowed and always logged. |
| Should fixed-fee remainders appear in the Close queue as reminders? | No. They have no period. Show them on the project and in the Billing hub's metrics. |
| T&M ad-hoc mid-month invoices? | Not supported. Monthly close plus skip covers the known cases. Revisit on real demand. |

## 14. Out of Scope

Credit notes and storno, tax lines, client portal and auto-send, configurable review
flags, multi-project bulk close, scheduled closing, and data migration of real
historical invoices.

## Appendix A — Version Note

`convex/_generated/ai/guidelines.md` targets Convex `^1.44.0`, while `package.json` pins
`^1.34.1`. Verify version-specific APIs (index matching on optional fields for
`by_projectId_closeId`, `v.record` in `billingEvents.data`) against the installed
version in slice 2, or upgrade first.
