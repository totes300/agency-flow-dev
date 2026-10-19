# Agency Flow — Time, Rates, Retainers, Reporting & Worksheet Review Specification

## Assignment

Act as a senior staff engineer and financial-systems reviewer. Perform a precise,
evidence-based, end-to-end audit of Agency Flow's human time tracking and every
downstream calculation that consumes tracked time.

The system will be used by real agencies as the source of truth for:

- employee and contractor work time;
- internal labor cost and project profitability;
- T&M billing;
- monthly retainer usage, rollover, overage and settlement;
- client-facing reports, invoices and worksheets;
- AI-generated client-facing descriptions of delivered work.

An incorrect result can cause lost revenue, overbilling, incorrect client
statements or loss of trust. Treat silent discrepancies as more severe than
visible failures.

This assignment is **review-only**. Do not modify application code, schema,
tests, configuration or production data. You may add the requested review
deliverables under `docs/fable-to-review/results/`. If a finding needs a code
change to validate it, describe the smallest proposed experiment or test rather
than implementing the change.

## Required repository precautions

Before reviewing:

1. Read the repository-root `AGENTS.md` and `CLAUDE.md` completely.
2. Before reading or reasoning about Convex implementation details, read
   `convex/_generated/ai/guidelines.md` completely.
3. Before evaluating Next.js behavior, read the relevant version-matched files
   under `node_modules/next/dist/docs/`.
4. Treat the working tree as shared and potentially dirty.
5. Never run `git stash`, `git reset --hard`, `git checkout --`, `git restore`,
   `git clean` or any destructive Git command.
6. Do not reformat, regenerate or overwrite existing files.
7. Do not send repository contents to an external review service without
   explicit authorization.
8. Prefer read-only inspection commands. Use `rg`/`rg --files` for search.
9. Record the commit hash and `git status --short` in the review metadata, but
   do not attempt to clean the worktree.

## Primary question

Can Agency Flow be trusted as the authoritative ledger from the moment a human
starts measuring work through every filter, aggregation, rate snapshot,
retainer calculation, close operation, invoice, report, worksheet and
AI-generated summary shown to an agency or its client?

The answer must not be a general impression. Prove or disprove each invariant
with code traces, reconciliation tables and executable-test recommendations.

## Review priorities

Review in this order:

1. Time measurement and ledger persistence.
2. Human cost rates and client billable rate snapshots.
3. Every filter, grouping and aggregation consuming time entries.
4. Monthly retainers without rollover.
5. Monthly retainers with rollover cycles.
6. T&M project accounting, reporting, invoicing and worksheets.
7. Monthly and cycle worksheets, including AI summarization.
8. Daily time-tracking UI/UX and failure recovery.
9. Scalability and concurrency of the critical path.

Do not spend meaningful time on unrelated agent-builder polish, general task
management aesthetics, marketing pages or broad refactors.

## System boundary

The critical data chain is:

```text
Human work
  -> timer state or manual entry form
  -> timeEntries ledger row
  -> costRate / billableRate / currency snapshot
  -> filter and aggregation functions
  -> project billing model
       -> T&M
       -> monthly retainer without rollover
       -> multi-month retainer with rollover
  -> close / draft / finalize / reopen / void
  -> project overview / monthly breakdown / ready queue
  -> invoice / monthly report / worksheet
  -> AI-generated task summary and delivered-work text
  -> client-visible document
```

Audit the complete chain. Do not stop after verifying a pure calculation if a
query, mutation or UI adapts its result differently.

## Architecture and file inventory

This is a starting inventory, not an exhaustive allowlist. Follow imports and
calls into sibling functions whenever they affect the same data.

### Time measurement and writes

- `convex/timer.ts`
- `convex/timeEntries.ts`
- `convex/lib/timer.ts`
- `convex/lib/timerEntry.ts`
- `convex/lib/rounding.ts`
- `convex/lib/dateValidation.ts`
- `convex/lib/settleGuards.ts`
- `convex/lib/entryStatus.ts`
- `convex/lib/settleEntries.ts`
- `convex/schema.ts`
- any task/project archive or delete path that stops or autosaves timers

### Time reads, filters and aggregations

- all exported functions in `convex/timeEntries.ts`
- `convex/projects.ts`
- `convex/statements.ts`
- `convex/invoices.ts`
- `convex/worksheets.ts`
- `convex/worksheetsHelpers.ts`
- `convex/timesheets.ts`
- `convex/agentReports.ts`
- `convex/lib/projectSummary.ts`
- `convex/lib/timesheetPivot.ts`
- `convex/lib/readyToInvoice.ts`
- `convex/lib/agentReportCore.ts`
- `lib/time-entry-grouping.ts`
- `lib/time-entry-filters.ts`
- `lib/date-buckets.ts`
- `lib/worksheet-view-export.ts`

At minimum, trace these public time-entry functions:

- `timeEntries.listByTask`
- `timeEntries.listToday`
- `timeEntries.sumByTasks`
- `timeEntries.sumMyToday`
- `timeEntries.sumByProject`
- `timeEntries.create`
- `timeEntries.update`
- `timeEntries.remove`
- `timeEntries.countMismatchedBillable`
- `timeEntries.bulkUpdateBillable`
- `timeEntries.listProjectEntries`
- `timeEntries.projectOverview`
- `timeEntries.projectMonthlyBreakdown`
- `timer.getState`
- `timer.start`
- `timer.previewRateForTask`
- `timer.stop`
- `timer.pause`
- `timer.resume`
- `timer.discard`
- `timer.commitEntry`

### Rates

- `convex/userRates.ts`
- `convex/categoryRates.ts`
- `convex/projectRateOverrides.ts`
- `convex/lib/rates.ts`
- `convex/lib/orgHelpers.ts`
- `convex/lib/projectSummary.ts`
- rate-related fields and indexes in `convex/schema.ts`
- settings UI for user, category and project rates

### Retainers and settlement

- `convex/lib/retainerBalance.ts`
- `convex/lib/retainerUsage.ts`
- `convex/lib/retainerCycle.ts`
- `convex/lib/reportPeriod.ts`
- `convex/lib/invoiceAnchor.ts`
- `convex/lib/invoiceCreation.ts`
- `convex/lib/readyToInvoice.ts`
- `convex/retainerPeriods.ts`
- `convex/retainerCron.ts`
- retainer branches in `convex/projects.ts`
- retainer branches in `convex/invoices.ts`
- `convex/statements.ts`
- `components/document/retainer-usage-table.tsx`
- `components/projects/monthly-report-document.tsx`
- `components/projects/monthly-breakdown-card.tsx`
- retainer sections in `components/invoices/`
- `lib/retainerLabels.ts`
- `lib/retainer-row-action.ts`

### Worksheets and AI summaries

- `convex/worksheets.ts`
- `convex/worksheetsHelpers.ts`
- `convex/lib/worksheetAi.ts`
- `convex/lib/worksheetAi.test.ts`
- worksheet/export UI under `components/worksheet/`
- invoice and project worksheet entry points
- `lib/csv.ts`
- `lib/worksheet-period-presets.ts`
- `lib/worksheet-toast.ts`

### Daily time-tracking UI/UX

- `components/timer-provider.tsx`
- all components under `components/timer/`
- all components under `components/time/`
- `components/tasks/time-log-form.tsx`
- `components/tasks/time-log-popover.tsx`
- `components/tasks/time-entries-table.tsx`
- `components/tasks/inline-time-cell.tsx`
- `components/projects/time-entry-modal.tsx`
- `components/projects/time-entry-hours-cell.tsx`
- `components/projects/project-time*.tsx`
- `app/(dashboard)/my-time/page.tsx`
- time-related surfaces in Tasks, My Tasks, Workday and project detail

## Rate configuration domain-model and UX review

This is a mandatory product/domain review, not a cosmetic appendix. A technically
correct rate engine is unsafe if an agency owner cannot predict which value will
be applied to a time entry, project total, invoice or profitability report.

### Intended mental model to verify

The implementation appears to distinguish three concepts:

```text
User cost rate
  = the agency's internal hourly cost for the person who owns the time entry
  = selected by entry owner + project/client currency
  = snapshotted to timeEntry.costRate

Workspace category default bill rate
  = the default client-facing hourly selling rate for a type of work
  = selected by task category + project/client currency
  = snapshotted to timeEntry.billableRate for eligible T&M/Fixed work

Project category override
  = a project-specific replacement for the workspace category default
  = wins over the workspace default for that project/category/currency context
```

Retainer entries intentionally snapshot `billableRate = 0`; retainer revenue and
overage are calculated at month/cycle level. The reviewer must independently
verify this model in code and then decide whether the UI communicates it.

### Terminology review

Prove that every label consistently distinguishes:

- **cost rate**: internal labor cost, belongs to a person;
- **bill rate**: client selling rate, belongs to work category/project;
- **default bill rate**: workspace fallback;
- **project override**: rate used only for one project;
- **retainer overage rate**: cycle/month-level price, not an entry category
  bill rate;
- **currency**: the currency in which the snapshot and report are expressed.

Flag any surface where users could reasonably infer that Work Categories carry
employee cost rates. Work Categories currently appear intended to carry only
default **bill** rates; verify that no legacy category cost-rate field, UI,
migration or calculation remains.

### Explainability requirement

From the Settings UI alone, an agency owner must be able to answer:

1. Why does a person need a cost rate?
2. Why does a work category need a default bill rate?
3. Which one is internal and which one reaches a client invoice?
4. What wins when a project has an override?
5. What happens for retainers?
6. Which currency is required and why?
7. What blocks time tracking when a rate is missing?
8. Do rate changes affect historical time entries?
9. Which projects currently use each configured rate?

If these answers require reading source code, classify the UX as unsuccessful
even when the implementation is technically correct.

### Required rate-resolution visualization

Evaluate whether the product needs an always-visible hierarchy such as:

```text
TIME ENTRY

Internal cost
  Adam Toth -> USD cost rate $40/h

Client billing
  Task category: Development
  Project override: none
  Workspace default: $100/h
  Effective bill rate: $100/h

Snapshot stored on entry
  cost $40/h | bill $100/h | USD
```

The reviewer must propose at least one low-complexity way to expose this mental
model in Settings and one contextual way to expose the effective rate on a task,
timer preview or time-entry detail without overwhelming daily users.

### Locked product decision — per-user/per-currency cost rates

The product owner has explicitly selected the current multi-currency model. This
is not an open architecture decision and the reviewer must not propose foreign-
exchange conversion, a single base-currency cost model or FX snapshots.

The required behavior is:

```text
Adam's configured cost rates:
  USD -> $50/h
  EUR -> €80/h
  HUF -> 30,000 Ft/h

USD project time entry -> snapshot Adam's USD cost rate
EUR project time entry -> snapshot Adam's EUR cost rate
HUF project time entry -> snapshot Adam's HUF cost rate
```

Each person's cost rate is configured once for every currency in which that
person may work. The project inherits its currency from its client. At time-entry
creation, the system must select the entry owner's cost rate in that exact
project/client currency and snapshot it onto the entry. No currency conversion
is performed or desired.

The review must prove:

- the correct user and currency pair is selected on every entry writer;
- admin-on-behalf and task-archive autosave use the entry owner's rate, not the
  acting admin's rate;
- missing currency coverage is detected before measured work can be lost;
- existing entries remain unchanged when configured rates are edited or removed;
- project/client currency and entry `rateCurrency` never drift;
- the UI makes currency coverage easy to configure and audit;
- the admin can see which users are missing a rate for currencies actively used
  by clients/projects;
- unnecessary currencies do not distract from the setup workflow.

The reviewer may recommend data-integrity constraints, coverage checks,
batch-editing and UI/UX improvements within this model. Do not recommend a
different currency model.

### Mandatory rate-settings UI inspection

Review all of these workflows visually and behaviorally:

1. Settings -> Work Categories -> default bill rates.
2. Create/edit Work Category -> multi-currency default bill rates.
3. Settings -> User Rates -> per-user cost rates.
4. Add/edit/remove a user's currency rate.
5. Project Settings -> Billable Rates -> inherited defaults.
6. Project Settings -> override a category rate.
7. Reset a project override to workspace default.
8. Missing user/category rate when starting a timer or adding manual time.
9. Inspect an existing time entry and determine the stored cost/bill snapshots.

Evaluate these specific UI qualities:

- Do rate badges look editable, removable, disabled or merely informational?
- Is the Add action discoverable without hover?
- Can keyboard and touch users discover it?
- Is inherited versus overridden state visible without focusing an input?
- Is the effective value shown separately from its source?
- Is currency selection contextual or an unexplained list of every currency?
- Are missing-rate states actionable and linked to the correct setting?
- Does the amount/currency typography create a readable visual hierarchy?
- Is there excessive whitespace relative to the small amount of information?
- Are workspace and project rate screens visually consistent?
- Does the project screen explain why its currency is inherited from the client?
- Can an admin see which team members are missing the cost rate required by a
  project's currency before time tracking is blocked?

### Required rate UX artifact

Add a dedicated section to `04-findings.md` named **Rate model and configuration
UX**. It must include:

- the verified current rate hierarchy;
- whether the domain model is correct;
- whether the locked per-user/per-currency model is implemented correctly;
- a user-by-active-currency coverage and missing-rate UX proposal;
- a screenshot/code evidence inventory;
- the top comprehension and visual-design failures;
- a recommended information architecture;
- one minimal UI redesign and one ideal UI redesign that preserve the locked
  domain model;
- migration implications of any necessary integrity/schema hardening;
- exact copy recommendations for titles, descriptions, source labels and
  missing-rate errors.

## Non-negotiable invariants

For every invariant, report one of: **proven**, **violated**, **partially
proven**, or **not provable with current tests/data**.

### T — Time measurement and ledger invariants

#### T1. Server authority

Timer duration must be derived from server-controlled timestamps, not from a
client-supplied elapsed counter, except for an explicit and audited correction
flow.

#### T2. No lost measured time

Once a user stops a valid timer, closing the UI, losing connectivity after the
mutation returns or abandoning the post-stop form must not lose the entry.

#### T3. No double-counted time

Retries, double clicks, multiple tabs, task switching and reconnects must not
produce duplicate ledger entries for the same timer stop.

#### T4. Exactness is explicit

Document exactly what is measured and stored:

- raw elapsed milliseconds or seconds;
- whole minutes;
- rounding direction;
- sub-30-second behavior;
- stale-timer caps;
- manual overrides.

If the stored ledger is rounded, the product and code must not call it exact or
raw without qualification.

#### T5. Date/time consistency

For every entry:

```text
entry.date == calendar day of entry.startedAt in the organization timezone
```

Cover DST start/end, midnight crossing, timezone changes, invalid IANA zones and
overnight timers.

#### T6. One canonical writer policy

Manual creation, normal timer stop, short-timer recovery, task-archive autosave
and time-entry edits must enforce the same duration, date, rate, tenancy and
settlement rules unless a difference is explicitly documented.

#### T7. Locked history

An entry linked to an invoice or carrying settlement fields cannot be edited,
deleted, moved, re-rated or have billability changed except through a defined
reopen/revert/void state transition.

#### T8. Valid numeric domain

Reject `NaN`, positive/negative `Infinity`, negative values, unsafe magnitudes
and non-integer minute values wherever the domain requires integers. Remember
that Convex `v.number()` permits IEEE-754 special values.

### R — Rate invariants

#### R1. Snapshot completeness

Every time entry must contain a valid `costRate`, `billableRate` and
`rateCurrency` snapshot appropriate to its project type and owner.

#### R2. Historical stability

Changing or deleting current user/category/project rates must never silently
change previously stored entries, issued invoices or closed reports.

#### R3. Snapshot timing policy

The product does not require effective-dated rate tables. Determine and
document the exact snapshot moment and which currently configured currency-
specific rate applies to:

- a timer that spans a rate change;
- a manual entry backdated before a rate change;
- an entry edited after a rate change;
- an entry moved to another task/category;
- a former member's historical work.

Previously created entries must retain their stored snapshots when settings
change. Do not recommend rate versioning merely to handle these scenarios; flag
only inconsistent snapshot timing, historical mutation or unclear UI behavior.

#### R4. Rate resolution order

Prove the intended order:

```text
cost rate: user + currency
billable rate: project/category override -> category/currency default
retainer: entry billableRate = 0; revenue is period/cycle-level
non-billable entry/project: billableRate = 0
currency: authoritative project client currency
```

#### R5. Actor versus owner

When an admin logs or autosaves time for another person, the cost rate must come
from the entry owner, while audit metadata must preserve the acting admin.

### A — Aggregation and reconciliation invariants

#### A1. Raw time conservation

For an identical explicit entry scope:

```text
raw total minutes == sum(entry.durationMinutes)
```

No list, overview, breakdown, report or worksheet may lose or duplicate an
entry without a documented filter.

#### A2. Cost calculation

```text
labor cost == sum(entry.durationMinutes / 60 * entry.costRate)
```

Define the monetary rounding point and prove that UI totals reconcile.

#### A3. T&M value

```text
raw T&M value ==
  sum(billable entry.durationMinutes / 60 * entry.billableRate)
```

Invoice-time rounding may differ, but the difference must be explicit,
reproducible and honestly labeled.

#### A4. Filter equivalence

The same member, task, project, date, billability and settlement filters must
produce equivalent entry sets across all surfaces that claim to show the same
scope.

#### A5. Canonical closed scope

After finalization/close, client-facing documents must use immutable settlement
or invoice membership rather than re-deriving historical scope from mutable
live task data, unless the product intentionally defines a live report.

### M — Monthly retainer invariants

#### M1. No rollover

For each independent month:

```text
available = monthly included minutes
used = sum(in-scope billable raw minutes)
balance = available - used
overage minutes = max(0, -balance)
amount due = monetary_round(overage minutes / 60 * overage rate)
```

Non-billable time may appear in work breakdowns but must not consume allocation
or generate overage.

#### M2. Rollover cycle

For month `i` in a cycle:

```text
available[i] = monthly included + balance[i - 1]
balance[i] = available[i] - used[i]
cycle contractual allocation = monthly included * cycle length
cycle used = sum(used[i])
cycle final balance = cycle contractual allocation - cycle used
cycle overage = max(0, -cycle final balance)
```

Prove that carryover is not double-counted in totals.

#### M3. Overage timing

- Non-rollover: overage becomes due at eligible month close.
- Rollover: negative mid-cycle balance is not payable until cycle close.
- Current/future periods cannot be represented as finally due.

#### M4. Single period/cycle definition

Cycle boundaries, cycle position and close eligibility must agree across:

- project overview;
- monthly breakdown;
- billing ready queue and nav badge;
- close mutations;
- invoice creation and refresh;
- invoice document;
- monthly report;
- monthly/cycle worksheet.

#### M5. Reopen/revert/void

Reopening or reverting must restore exactly the correct entry set. Voiding must
not delete history, duplicate future billing or leave unreachable entries.

#### M6. Honest live versus frozen data

Explicitly classify every displayed value as one of:

- live raw ledger value;
- invoice-rounded value;
- immutable invoice snapshot;
- immutable settlement snapshot;
- derived presentation value.

Flag a UI that visually compares unlike classes without explaining the
difference.

### W — Worksheet and AI invariants

#### W1. AI never determines accounting

The AI may generate narrative text only. It must not choose entry membership,
billability, durations, totals, rates, balances or overage.

#### W2. Worksheet entry-set reconciliation

- Period worksheet: exact requested/filter-matching entry set.
- Invoice worksheet: canonical union of invoice line-item `timeEntryIds`.
- Cycle worksheet: exact union of the cycle's monthly scopes, without
  duplication or omission.

#### W3. Period-aware AI context

A worksheet for period P must not describe work, comments, state changes or
subtasks created/completed after P unless clearly labeled as later context.

#### W4. Unique AI output identity

If the same task appears in multiple months, its AI result must be scoped by at
least `(period, taskId)`, not only `taskId`.

#### W5. Grounding and honesty

AI output must be grounded only in in-scope task description snapshots,
subtasks, comments and entry notes. Test prompt injection, conflicting comments,
empty context, future comments and partially completed work.

#### W6. Failure transparency

Skipped AI rows, failed AI rows and successful rows must reconcile to the total.
The UI must state when fallback or unavailable summaries were used.

## Mandatory hypotheses to verify

These are leads, not pre-approved conclusions. Independently confirm or reject
each with line-level evidence and, where possible, a minimal test case.

### H1. Timer ledger is not fully raw

`roundMinutes(raw, 1)` appears to ceil measured time to a whole minute before
storage. Determine whether this inflates the ledger, whether the UI calls the
value exact/raw and whether a raw millisecond value remains recoverable.

### H2. Rate effective date is undefined

Rate rows appear to be overwritten in place. A backdated manual entry appears
to receive the rate current at entry creation, while a timer appears to
re-resolve rates at stop rather than snapshotting at start. Determine the
intended and actual policy.

### H3. Rollover report footer may double-count carryover

`statements.getRetainerStatement` appears to compute total available minutes by
summing each usage row's `availableMinutes`. Because each later row includes
carryover, the footer may exceed the contractual allocation. Compare it with
the invoice path, which appears to use the frozen `retainerIncludedMinutes`.

Illustrative scenario:

```text
monthly included = 10h
month 1 used = 5h, balance = +5h
month 2 available = 15h
contractual two-month allocation = 20h
sum(row.available) = 25h  # suspect
```

### H4. Cycle worksheet AI output may overwrite earlier months

Cycle exports may contain the same `taskId` in multiple monthly sections while
AI outputs are keyed only by `taskId`. Verify whether a later month's output is
rendered into earlier sections.

### H5. Worksheet AI may use future context

`buildTaskRows` appears to include all current comments and subtasks rather than
applying the worksheet period as a temporal cutoff. Verify whether a comment
created in July can influence a June worksheet.

### H6. Numeric special values may bypass validation

Several mutations appear to reject only values `< 0` or `<= 0`. Verify whether
`NaN`/`Infinity` can reach rate, duration, amount or timestamp fields.

### H7. Report, invoice and worksheet may intentionally use different rounding

Map exactly where raw minutes, per-task rounded minutes, rounded hours and
rounded currency are used. Determine whether every visible discrepancy is
explained to the user.

### H8. Work Category and User Rate screens hide the rate hierarchy

The screens appear to use technically different terms (`Default Bill Rates`
versus `User Cost Rates`) but do not explain their relationship or show a
worked example. Verify whether an agency owner can predict the effective time
entry snapshots without source-code knowledge.

### H9. Per-user/per-currency coverage may be incomplete or hard to audit

The selected product model requires one configured cost rate for each
`(user, active project currency)` pair. Verify whether admins can identify and
fill missing pairs before time tracking is blocked, whether irrelevant
currencies are hidden or deprioritized, and whether entry writers always select
the correct pair without fallback or conversion.

### H10. Rate controls may be visually undiscoverable

The User Rates Add action appears only on row hover, rate pills do not clearly
signal edit/remove behavior, and inherited project rates are rendered as faint
input placeholders. Verify keyboard, touch and first-use discoverability, and
whether inherited/overridden/effective states are visually distinguishable.

## Golden ledger fixture

Design one deterministic reference dataset that exercises every critical rule.
Do not rely only on isolated unit examples. The same fixture must be passed
through every consumer and reconciled.

### Tenancy and people

- Two organizations with deliberately overlapping names and currencies.
- Org A: one admin and two members.
- Org B: one admin and one member.
- One Org A member removed after logging historical time.
- Cross-org IDs attempted in all relevant public functions.

### Timezones and dates

- Organization timezone: `Europe/Budapest`.
- A normal weekday.
- Midnight-crossing timer.
- DST spring-forward day.
- DST fall-back day.
- Timer paused across midnight.
- Backdated manual entry.
- Entry created after a period has closed.

### Rates

- EUR user cost rates for all Org A users.
- A user cost-rate change halfway through the test period.
- Category billable defaults.
- One project/category override.
- An override changed halfway through the period.
- Missing cost rate and missing billable rate scenarios.
- Zero cost rate as an intentional supported value.
- HUF high-value rate to expose decimal/magnitude assumptions.

### Entries

- Timer and manual entries.
- Billable and non-billable entries.
- Entry under 30 seconds.
- Entry just over a whole-minute boundary.
- 8h and 16h stale timers.
- Notes containing Unicode, CSV-formula prefixes and prompt-injection text.
- Same task with entries in three months.
- Same task with comments before and after each month boundary.
- Task category change after historical entries exist.
- Locked, draft-linked, finalized and settled entries.

### Projects

1. T&M project with multiple people, categories and rates.
2. Monthly retainer without rollover, one under-budget and one over-budget
   month.
3. Three-month rollover retainer with:
   - unused time in month 1;
   - a negative interim balance in month 2;
   - cycle-end underage or overage in month 3;
   - a repeated task across all three months.
4. A non-billable project as a control.

### Lifecycle

- Open entries.
- Draft invoice creation.
- Entries logged after draft creation.
- Draft refresh.
- Finalization.
- Mark paid and undo paid.
- Revert to draft where allowed.
- Void.
- Retainer close and reopen.
- Re-generation after reopen/void.

## Required reconciliation matrix

Create `docs/fable-to-review/results/03-reconciliation-matrix.md` with one row
per displayed or exported metric.

Required columns:

| Consumer/surface | Function/component | Entry-set rule | Time basis | Rate basis | Rounding | Expected from golden ledger | Actual | Status |
|---|---|---|---|---|---|---:|---:|---|

At minimum include:

- My Time today total.
- Task time total.
- My Tasks time totals.
- Project Time filtered and unfiltered totals.
- Project overview hours, cost and value.
- Project monthly breakdown.
- Ready-to-invoice queue row amount.
- Billing navigation badge counts.
- T&M draft hours and amount.
- T&M issued invoice hours and amount.
- Retainer month/cycle used, available, balance and overage.
- Monthly report work breakdown and footer.
- Invoice retainer usage table and footer.
- Monthly worksheet totals.
- Cycle worksheet monthly and cycle totals.
- Invoice companion worksheet totals.
- Agent-generated timesheet/report totals where applicable.

Any two surfaces with the same product label but different entry set or
rounding policy must be flagged, even if both calculations are locally correct.

## Mandatory scenario matrix

For each scenario, inspect backend behavior, UI behavior and existing test
coverage.

### Timer

- start -> pause -> resume -> stop;
- stop with a tab closed before post-stop edit;
- mutation retry/double click;
- two browser tabs;
- task switch while running;
- task/archive/project deletion while running;
- missing rate at start;
- rate changed between start and stop;
- timer crosses midnight;
- timer crosses DST;
- under 30 seconds;
- exactly 30 seconds;
- 60 seconds;
- 61 seconds;
- stale 8h and max 16h;
- override above the allowed maximum;
- browser clock manipulation.

### Manual entry

- today, past date and future date;
- custom wall-clock start time;
- date/start mismatch;
- admin logs for another member;
- member attempts to log for another member;
- backdated entry before a rate change;
- entry into a closed/invoiced scope;
- task move within project;
- attempted task move across projects;
- billable toggle and bulk billable toggle;
- edit/delete after draft, finalization and settlement.

### Rates

- create, update, delete and recreate;
- project override fallback to category default;
- category missing;
- cost rate missing;
- zero rate;
- `NaN`, `Infinity`, negative and extreme values;
- currency change constraints;
- historical entries before and after changes.

### Retainer without rollover

- empty month;
- exact budget;
- under budget;
- over budget;
- non-billable-only month;
- mixed billable/non-billable;
- missing overage rate;
- current versus ended month;
- close, reopen, invoice, revert and void;
- late entry after close/invoice.

### Retainer with rollover

- 2-, 3- and 12-month cycles;
- project start in December;
- cycle boundary across years;
- partial first/current cycle;
- positive carryover;
- negative interim balance;
- cycle-end overage;
- unused time forfeiture at cycle end;
- mid-cycle report truthfulness;
- cycle close and reopen;
- cycle invoice and worksheet reconciliation;
- repeated task across months.

### T&M

- multiple users at different cost rates;
- multiple categories and project overrides;
- same task with rate changes over time;
- billable/non-billable mix;
- draft refresh;
- partial/manual line-item adjustment;
- invoice rounding changes;
- finalized/voided invoices;
- worksheet and invoice canonical-set equality.

### Worksheet AI

- one task in one month;
- same task in multiple months;
- comments before and after scope;
- task description edited after scope;
- subtasks completed after scope;
- no meaningful context;
- provider failure on first and later rows;
- partial failures;
- missing key;
- prompt injection in description/comment/note;
- contradictory comments;
- very long content and truncation;
- AI output must not alter numeric columns.

## UI/UX review protocol

Review the running application in a production-like build where possible. Use
an authenticated test organization and seeded non-production data only.

Evaluate the complete daily journey, not isolated components:

1. Find a task and start the timer.
2. Understand which task/project/client is being measured.
3. Pause/resume and navigate through the app.
4. Stop the timer.
5. Confirm what has already been persisted.
6. Adjust duration, note and billability.
7. Find the saved entry in My Time, task detail and project Time.
8. Correct an error.
9. Observe how the correction changes reporting and billing previews.

For every state, answer:

- Is it obvious whether the timer is running or paused?
- Is the server-persisted state distinguishable from local display state?
- Does the UI say whether displayed time is exact, whole-minute or rounded?
- Is the target date/timezone clear?
- Is billability clear and editable where policy permits?
- Does the user know which rate/rate source will apply?
- Are failure and recovery paths explicit?
- Can double submission occur?
- Are destructive actions confirmed?
- Can all primary actions be completed by keyboard?
- Are focus, form labels, live status and error announcements accessible?
- Does mobile behavior preserve critical time-entry functionality?

Capture screenshots only when they materially support a finding. Do not place
secrets, personal data or production client information in screenshots.

## Scalability and concurrency checks

The correctness review has priority, but evaluate whether the correct behavior
survives realistic size and concurrency.

### Dataset targets

- 50 active users per organization.
- 100,000 time entries per organization.
- Multi-year project history.
- 1,000 tasks on a large project.
- Large T&M invoice and 12-month retainer cycle.

### Check for

- unbounded `.collect()` calls;
- per-task N+1 entry reads;
- reactive query invalidation amplification;
- transaction read/write limits during close or invoice creation;
- unbounded `timeEntryIds` arrays in invoice line items;
- duplicate subscriptions across daily UI surfaces;
- OCC conflicts on simultaneous timer/rate/invoice actions;
- two admins closing or invoicing the same scope concurrently;
- excessive AI calls for duplicate task/period combinations;
- action timeout and provider rate limits during large worksheet exports.

Use Convex insights if available, but absence of warnings before real user load
is not proof of scalability.

## Existing tests and quality gates

Inventory all tests that directly prove the critical chain. Separate:

- pure calculation tests;
- Convex integration tests with identity and database state;
- component tests;
- full browser E2E tests.

Do not count a pure helper test as proof that every caller passes the correct
scope or renders the result honestly.

Run, without modifying files:

```bash
npx tsc --noEmit
npm test -- --reporter=dot
npx eslint app components convex lib proxy.ts --quiet
npx convex insights --details
```

If a command fails because the repository's configuration includes unrelated
reference files, record both the configuration defect and an app-scoped result.
Do not hide or fix the failure during this review.

## Review method

### Phase 0 — Baseline

- Record commit, branch, worktree status and tool versions.
- Run quality gates.
- List relevant current failures.
- Read relevant PRDs, especially month close, invoicing, settlement and
  worksheet decisions.

### Phase 1 — Trace every writer

For each time-entry creation/update/delete path, document:

- entrypoint;
- authorization;
- source of duration;
- source of date and timezone;
- rounding;
- owner and actor;
- rate snapshot;
- settlement guards;
- transaction boundaries;
- error/retry behavior;
- audit logging.

### Phase 2 — Trace rates

Build a rate-resolution decision table for every project type and mutation.
Trace current-rate edits into future and historical entries.

### Phase 3 — Trace every reader

For every function that filters or aggregates time, record:

- complete read set;
- exact entry predicate;
- date semantics;
- billability semantics;
- draft/finalized/settled semantics;
- rate source;
- rounding point;
- output consumers;
- sibling functions claiming to show the same metric.

### Phase 4 — Retainer proof

Use the golden ledger to prove no-rollover and rollover formulas month by
month. Reconcile project, ready queue, close, invoice, statement and worksheet.

### Phase 5 — Worksheet and AI proof

Prove deterministic entry membership first. Then evaluate AI context scope,
grounding, temporal honesty, failure behavior and duplicate-task handling.

### Phase 6 — UI/UX proof

Exercise daily workflows and failure recovery in the browser. Tie each UX
finding to a risk of lost, duplicated, incorrectly dated or incorrectly billed
time.

### Phase 7 — Scale and concurrency

Identify unbounded paths and concurrency races. Recommend measurement or load
tests before invasive refactors.

## Severity model

### Critical

- Cross-tenant data exposure.
- Lost or duplicated time under normal behavior.
- Silent overbilling or lost billable revenue.
- Closed/issued financial history can be rewritten without a defined reversal.
- Client-facing report or worksheet assigns work/time to the wrong period.

### High

- Different official surfaces disagree on the same scope or total.
- Rate history produces materially incorrect cost/revenue.
- Rollover/overage logic is wrong in a realistic scenario.
- Normal browser/network behavior can leave the timer in an ambiguous state.
- AI produces temporally false client-facing summaries.

### Medium

- Edge-case correctness defect with a recoverable manual workaround.
- Scalability path is clearly unbounded but current usage is small.
- Important UX ambiguity that can cause occasional incorrect input.

### Low

- Maintainability, naming or minor accessibility issue with no credible effect
  on ledger or billing correctness.

## Finding format

Every finding must contain:

```markdown
### [ID] Short title

- Severity: Critical | High | Medium | Low
- Confidence: Confirmed | Strong evidence | Hypothesis
- Affected invariant(s): T3, R3, M2, W4, ...
- Location: exact file:line references and function names
- Affected workflow: timer | manual entry | rates | T&M | retainer | report | worksheet | UI
- User/business impact: concrete failure in agency/client terms
- Reproduction: smallest deterministic scenario
- Expected result:
- Actual result:
- Root cause:
- Existing test coverage:
- Missing test:
- Recommended fix: smallest safe remediation
- Migration/backfill impact:
- Verification after fix:
```

Do not report style preferences as findings. Do not use vague language such as
"could potentially be wrong" without a concrete scenario and code path.

## Required deliverables

Create only these files under `docs/fable-to-review/results/`:

### `00-review-metadata.md`

- date/time and timezone;
- commit and branch;
- dirty-worktree summary;
- commands executed;
- relevant tool versions;
- limitations and unavailable production signals.

### `01-system-map.md`

- writer graph;
- rate-resolution graph;
- reader/aggregation graph;
- retainer close/invoice/report graph;
- worksheet/AI graph;
- explicit sources of truth and duplicated derivations.

### `02-invariant-verdicts.md`

One row per invariant with status, evidence and linked findings.

### `03-reconciliation-matrix.md`

The required golden-ledger comparison table.

### `04-findings.md`

All findings sorted Critical -> High -> Medium -> Low using the mandatory
format. Keep confirmed defects separate from unverified hypotheses.

### `05-test-gap-plan.md`

- exact missing unit, Convex integration and E2E tests;
- fixture/setup requirements;
- test names and assertions;
- order of implementation;
- which finding each test prevents.

### `06-remediation-roadmap.md`

Prioritized fixes grouped as:

1. Must fix before real users.
2. Must fix before billing real clients.
3. Must fix before scale.
4. Acceptable documented product decisions.
5. Deferred polish.

For each item include impact, effort, dependencies, migration risk and proof of
completion.

### `07-executive-summary.md`

Answer in plain language:

- Can real users safely track time today?
- Can the system safely calculate internal labor cost today?
- Is the cost-rate/bill-rate hierarchy understandable and operationally safe?
- Is the locked per-user/per-currency cost-rate model implemented correctly and
  easy to configure?
- Can T&M clients be billed reliably today?
- Are non-rollover retainers correct today?
- Are rollover retainers correct today?
- Are reports and worksheets honest today?
- Is the AI summary safe for client-facing use today?
- What are the top five blockers?
- What is the recommended sequence to reach production readiness?

## Completion criteria

The review is complete only when:

- every public time writer is traced;
- every public time filter/aggregator is inventoried;
- every rate mutation and resolution path is traced;
- the Work Categories, User Rates and Project Billable Rates information
  architecture is reviewed as one connected workflow;
- the reviewer proves the locked per-user/per-currency cost-rate model and gives
  a clear UX/integrity hardening plan without proposing FX conversion;
- every retainer consumer is reconciled on the same golden ledger;
- monthly and cycle worksheets are reconciled to their source entry sets;
- AI temporal scope and duplicate-task behavior are proven;
- daily UI workflows and failure recovery are exercised;
- every invariant has a verdict;
- all Critical/High findings have deterministic reproduction scenarios;
- proposed tests would fail before and pass after each recommended fix;
- the executive summary gives unambiguous go/no-go answers.

Do not declare the system safe because individual helper tests pass. Safety
requires end-to-end agreement between persisted ledger rows and every
client-visible number and narrative derived from them.
