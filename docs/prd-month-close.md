# PRD: Month-Close Workflow (Billing hub, Close workspace, Skip-to-next-close)

> **Historical (superseded 2026-10-17).** The data model and write paths described
> here were replaced by the close model in `docs/prd-billing-refactor.md`, and the
> code this document refers to has been deleted (billing refactor slice 5). Read it
> for business intent only; `docs/prd-billing-refactor.md` is the source of truth.

> **Criticality note.** This feature changes how billable hours are selected, reviewed, and settled.
> A wrong scope rule silently mis-bills clients. Every semantic rule in this document is therefore
> stated as a precise invariant, and the core logic is isolated in pure, exhaustively tested modules.
> Where this PRD says MUST, the implementation may not deviate without updating this document first.

## Problem Statement

Month-end closing is the agency owner's most important recurring ritual, and today the product
fights it. The Invoices "Ready" tab jumps straight from a one-click **Generate** into an invoice
document where only line-item totals are visible — task names and summed hours. The owner cannot
review or correct the underlying time entries there. Worse, generating the draft immediately stamps
`invoiceId` onto every included entry, which **locks the entries against editing** — so the natural
order of work (review and fix first, commit second) is structurally impossible. The owner must
bounce between the project Time tab, the task detail, and the invoice draft, deleting and
regenerating drafts when something was wrong.

A second, related gap: work frequently starts in one month and finishes in a later one. There is no
way to say "bill this work in a later period" without falsifying entry dates or letting it pollute
the current close.

## Solution

Month-end closing becomes a three-stage, review-first workflow under a renamed **Billing** hub:

1. **Close queue** (Billing → Close tab, replacing the Ready tab): every closable period across the
   org — retainer months and cycles, T&M months with unbilled time, fixed fee remainders — grouped
   by month, with per-row review-readiness signals ("3 to review") and per-month progress
   ("1 of 4 closed"). The row action is **Review**, not Generate.
2. **Close workspace** (new full-page surface per project + period): the raw, unrounded ledger of
   in-scope entries grouped by task. Every entry is editable inline (duration, note, billable,
   date, category via the existing entry modal), the existing task peek gives full task context,
   a review checklist surfaces mechanical problems, and any entry or whole task can be **skipped to
   the next close**. Nothing locks while reviewing. Totals, balance and overage recompute live.
3. **Commit**: one primary action per workspace — **Generate invoice draft** (over-budget retainer,
   T&M, fixed) or **Close & report** (within-budget retainer). Only at commit do the existing
   mutations run and lock entries. The invoice editor keeps its current role: document polish
   (subject, rounding, manual lines, message) on already-reviewed data.

Skipped work stays open, keeps its true work date, and automatically surfaces in the next close as
a "carried over" entry that consumes the receiving period's budget. Skipping again next month is
one click — no target-month picker exists or is needed.

## Definitions

- **Open entry**: a time entry with neither `invoiceId` nor `settledAt` set. Only open entries are
  editable; this rule is unchanged.
- **Period**: the close unit for a project. Retainer without rollover → calendar month. Retainer
  with rollover → the N-month cycle. T&M → calendar month. Fixed → the single "remaining fee"
  bucket (no calendar period).
- **Natural period** of an entry: the period its `date` falls into.
- **Skip stamp** (`skippedThrough`, new optional entry field, a period-end date): "exclude this
  entry from every close whose period end is ≤ this date."
- **First open period** of a project: the earliest period that is not yet closed (retainer: no
  `closedAt` and no covering non-void invoice; T&M: earliest elapsed month that still owns open
  billable entries under the effective-period rule below).

## Core invariants (the scope rule)

These four rules are the single source of truth for "which entries belong to a close." They MUST be
implemented once, in one pure module (`billingScope`), and consumed by the queue, the workspace,
invoice creation, period close, and client-facing reports. No surface may re-derive membership.

**I1 — Effective period.** The effective period of an *open* entry is:
`max(naturalPeriod(entry.date), periodAfter(entry.skippedThrough), firstOpenPeriod(project))`.
Consequences: a deliberately skipped entry moves to the period after its skip stamp; an entry
logged late into an already-closed period automatically carries into the first open period. An open
entry can never belong to a closed period, so late entries can never be silently lost or require
blocking.

**I2 — Scope of a close** over period [S, E]: exactly the open entries whose effective period is
this period. Entries with `date < S` inside the scope are **carried-in**, with reason `skipped`
(skip stamp present) or `logged-late` (entry date falls in an already-closed span). Non-billable
entries are in scope for retainer closes (they get settled, as today) but never contribute to
usage, overage, or invoice amounts. This holds for BOTH retainer commit paths (2026-07-19,
finding F4): a within-budget period settles them at Close & report; an over-budget period
settles them when its overage invoice **finalizes** (`retainer_included`, monthly bucket, never
joining the invoice document; void/back-to-draft releases them symmetrically). Entries logged
after the draft was created belong to the next close (story 28's principle). For T&M, scope
contains billable entries only (non-billable T&M entries are never settled — unchanged from
today).

**I3 — Oldest-first.** Per project, only the first open, elapsed period can be committed. Later
periods appear in the queue but their Review CTA is disabled with the hint "Close <earlier period>
first." This makes I1's `firstOpenPeriod` well-defined and the whole system order-deterministic.

**I4 — Settlement history is immutable truth.** At commit, in-scope entries are stamped exactly as
today (`invoiceId` at draft creation; `settledAt` + `settledReason` + `settledPeriodStart/End` at
finalization or period close). `settledPeriodStart/End` is always the entry's **monthly settlement
bucket** — exactly one calendar month: the entry's natural month clamped into the settling period,
with carried-in entries bucketing to the period's first month (2026-07-19, fixing finding F3 where
cycle-invoice finalization stamped the whole cycle range and collapsed all N months into month 1 on
reports and worksheets). The settling document's own period lives on the invoice, not the entry.
All writers share one bucket rule (`lib/settleEntries.ts:monthlySettlementPeriod`); readers may
assume single-month stamps. For **closed** periods, every consumer (retainer usage math, monthly
report, cycle balance) MUST read membership from the settlement stamps, never re-derive it from
dates. For **open** periods, consumers use I1/I2. Reopening a period (existing `reopenPeriod`,
invoice void/back-to-draft) restores entries to open; their skip stamps survive, so a re-opened
close renders skipped entries as skipped, with Undo available.

**Budget consequence (retainer).** Usage of a period = Σ billable minutes of its scope (I2) for
open periods, or of its settlement stamps (I4) for closed ones. A carried-in entry therefore
consumes the *receiving* period's included budget and prices at the receiving period's overage
rate. This is the intended business behaviour, not a side effect.

## User Stories

Owner = org admin. Member = non-admin org member.

**Queue**

1. As an owner, I want a Close tab in Billing listing every closable period across all projects,
   grouped by calendar month with per-month totals and progress, so month-end is one sweepable
   ritual instead of scattered actions.
2. As an owner, I want each queue row to show project, client, billing type, hours (with
   over/within-budget), a review-readiness signal ("3 to review" / "Ready"), and the expected
   amount, so I can prioritize without opening anything.
3. As an owner, I want rows whose period cannot be committed yet (an earlier period of the same
   project is open) to show a disabled CTA with "Close <period> first," so the order is
   self-explanatory (I3).
4. As an owner, I want a period that already has a draft to leave the Close tab and show under
   Drafts (unchanged behaviour), so the queue only ever contains actionable items.
5. As an owner, I want the sidebar Billing badge to equal the queue's actionable count plus
   overdue invoices, computed from the same enumeration, so the badge and the tab can never
   disagree (unchanged principle).
6. As a member, I must not see the Billing hub at all (admin-only route, unchanged).

**Workspace — review**

7. As an owner, I want clicking Review to open a full-page close workspace for that project +
   period, showing an inline budget summary (included / logged / balance / overage × rate = amount)
   computed from the raw, unrounded ledger, so I see the money consequence while I review.
8. As an owner, I want the workspace to state explicitly that nothing is rounded and nothing locks
   until commit, so I trust that reviewing is safe.
9. As an owner, I want entries grouped by task with per-task subtotals, and a table-footer total,
   so I can sanity-check task by task.
10. As an owner, I want to edit an entry's duration and note inline, toggle billable, and open the
    full entry editor for date/task changes, with all totals, flags, and the commit summary
    recomputing immediately, so fixing the ledger is frictionless.
11. As an owner, I want to open the existing task peek from a task's title without leaving the
    workspace, so I can verify context (description, subtasks, activity) in place.
12. As an owner, I want to add a missing time entry from within the workspace (existing add-time
    modal), so discovered gaps don't force a detour.
13. As an owner, I want a review checklist listing: entries missing a note, entries ≥ 8h
    (forgotten-timer suspicion), running timers overlapping the period, and a missing overage rate
    on an over-budget retainer — each item jumping to and highlighting its row, so review is a
    finite checklist, not a hunt.
14. As an owner, I want the checklist to show "All clear — ready to close" when no flags remain,
    so completion is visible.
15. As an owner, I want carried-in entries visibly marked ("carried from May" / "logged after May
    close") with an informational checklist line, so I always know why a foreign-dated entry is in
    this close.
16. As an owner, I want to leave the workspace at any time and come back later with all my edits
    and skips intact (entry edits are real mutations; skips are persisted stamps), so closing can
    span days.

**Skip**

17. As an owner, I want a per-entry "Skip → <next period>" action that removes the entry from this
    close without changing its work date, so unfinished work bills later while reports stay
    truthful.
18. As an owner, I want a task-level "Skip all → <next period>" on the task group header that skips
    every in-scope entry of that task and collapses the group to a single summary row with Undo,
    because I think in tasks, not entries.
19. As an owner, I want Undo on any skipped entry or task while the period is still open, restoring
    it to this close, so skipping is reversible in place.
20. As an owner, I want a skipped entry to appear automatically in the next close as carried-in —
    and if it is still not ready there, skipping it again is the same single click — so multi-month
    deferral needs no date picker.
21. As an owner, I must not be able to skip an entry that is already invoiced or settled; the
    action is absent on locked entries and the mutation rejects with a clear error, so history
    cannot be rewritten.
22. As an owner, I must not be able to un-skip a carried entry whose origin period has since been
    closed (that would move it into a closed period); the only forward paths are billing it here or
    skipping it further (I1 guarantees this structurally — the mutation clears the stamp but the
    effective period still resolves to the first open period).
23. As a member, I must not be able to skip entries (admin-only mutation), because deferral is a
    billing decision.

**Commit**

24. As an owner, I want one primary action in the workspace top bar showing exactly what will be
    produced — "Generate invoice draft · $X" or, when within budget, "Close & report" — flipping
    automatically as my edits move the period across the budget line, so the consequence is always
    explicit before I commit.
25. As an owner, I want Generate to create the draft with exactly the workspace's in-scope entries
    (server re-derives scope at commit; client state is never trusted), stamp them to the draft as
    today, and navigate me to the existing invoice editor for document polish, so the pipeline
    after commit is unchanged and already battle-tested.
26. As an owner, I want Close & report (within-budget retainer) to settle exactly the in-scope
    entries — excluding skipped ones — and give me the existing Monthly Report, so the
    report-only path shares the same review ritual. After Close & report I return to the Close
    tab (the row flips to "Closed · report" with an "Open report" link, plus a confirmation
    toast); the report opens on demand, not automatically. Only Generate (story 25) navigates
    forward, into the invoice editor — a draft genuinely needs polish, a report does not, and
    staying in the queue preserves the month-end sweep.
27. As an owner, I want committing to be blocked with a clear reason when an over-budget retainer
    has no overage rate ("Set rate" linking to project settings, as today), so an unpriceable
    invoice can never be generated.
28. As an owner, I want a running timer in the period to be a warning, not a blocker — if I commit
    anyway, the timer's eventual entry lands as open, gets `logged-late` status, and carries into
    the next close (I1), so no time is ever lost.
29. As an owner, after commit I want the queue row to reflect the outcome (Drafted · INV-xxx with
    "Open draft", or Closed · report with "Open report"), month progress to advance, and the badge
    to decrease, so the ritual has visible momentum.
30. As an owner, I want deleting a draft or voiding an invoice to return the period to the Close
    queue with all entries unlocked and skip stamps intact (existing unsettle paths + I4), so
    mistakes are recoverable.

**Client-facing documents**

31. As an owner, I want the monthly report and the invoice work breakdown of a period to include
    carried-in entries in a separate "Carried over from <month>" group showing their true dates,
    and the origin month's report to simply not contain them, so the client sees an honest,
    single-billing story (each entry appears on exactly one client document).
32. As an owner, I want closed periods' reports to be stable — rendered from settlement stamps, not
    recomputed from dates — so a late-logged entry can never retroactively change an
    already-delivered report (it belongs to the next close instead).

**Failure modes & concurrency**

33. As an owner, if another admin commits the same period first, my commit must fail safely with
    the existing "already covered" gates and refresh my view, so double-billing is impossible.
34. As an owner, if an entry is edited or locked between my page load and my commit, the server's
    commit-time scope re-derivation governs; amounts are always computed server-side.
35. As an owner, I want a period with zero in-scope entries (e.g., everything skipped) to still be
    closable as within-budget ("Close & report" with zero usage) for retainers, and to simply not
    produce a T&M row, so empty months don't jam the oldest-first queue.

## Implementation Decisions

**Naming and navigation**
- The nav item is renamed **Invoices → Billing** (single source of truth in the navigation module;
  sidebar badge behaviour unchanged).
- Tabs: **Close** (replaces Ready), Drafts, Outstanding, Paid, Void. The one-click Generate on list
  rows is removed; the only path to a draft is through the Close workspace. The T&M "Invoice
  Unbilled Hours" button and bulk-selection path on the project Time tab are redirected to the
  workspace as well (they open the corresponding close), so scope rule I2 has no bypass.
- The Close workspace is addressable by project + period start (deep-linkable, back returns to the
  queue). Invoice document URLs are unchanged.

**Schema**
- One new optional field on time entries: `skippedThrough` (ISO date string, a period-end). No new
  tables, no new entities. Set/cleared by a new admin-only mutation that accepts a batch of entry
  ids; guards: org-scoped, entries must be open, the date must be the period end of the entry's
  current effective period. Task-level skip is the same mutation fed with the task's visible
  in-scope entry ids — no separate mutation.
- No index change anticipated at MVP scale (dummy data); revisit if entry volume grows.

**Scope and money**
- All membership questions go through the new pure `billingScope` module implementing I1–I4.
  `createInvoice`, `closePeriod` / `closeRetainerCycle`, the queue enumeration, the workspace
  query, the monthly report, and the stale-draft refresh consume it. The existing per-month
  bucketing inside retainer cycle-state computation switches from raw dates to effective periods
  for open entries and settlement stamps for closed ones.
- Carried-in entries bucket into the first month of the receiving period (relevant for cycle
  retainers' per-month usage display).
- Lock timing is **unchanged**: `invoiceId` stamps at draft creation, settlement at finalization or
  period close. The workflow change (review before generate) is what removes the old pain, not a
  relaxation of locking.
- Rounding is unchanged: the workspace shows raw minutes; rounding exists only on the invoice
  (existing `roundingMinutes` machinery).
- The stale-draft refresh keeps working and MUST exclude entries whose skip stamp covers the draft
  period.
- Retainer snapshot fields on the invoice are computed from `billingScope` usage at creation and
  remain immutable thereafter (unchanged principle).

**Review checklist (v1 flag set — fixed, not configurable)**
- Missing note (empty note on in-scope entry).
- Long entry (duration ≥ 480 minutes).
- Running timer overlapping the period (warning only, never blocking — see story 28).
- Missing overage rate on over-budget retainer (blocking for Generate; reuses the existing
  configIssue concept, surfaced in the checklist with a settings link).
- Flag counts are computed by a pure `closeFlags` module and surfaced both on queue rows
  ("3 to review") and in the workspace checklist. Carried-in entries produce informational
  (non-warning) checklist lines.

**UI composition (follows existing conventions)**
- Queue and workspace are built from shared components; the workspace reuses the existing entry
  editing mutations/modal, billable toggle, task peek pane, and add-time modal — no forked editing
  logic. Loading skeletons mirror actual layouts; empty states are dedicated components; every
  mutation call has error handling with toasts; tabs/filters persist in URL params.
- Visual language per the approved prototype (Notion-calibrated): flat grouped list with hairline
  dividers, single inline budget summary line, gray callout for the checklist, one primary button
  per screen (commit, in the top bar), quiet outline Review buttons on rows, hover-revealed row
  actions ("Skip → <next>", billable toggle), task-header "Skip all → <next>", carried label on
  entry rows, calculation-row style table footer.

## UX Decisions

Collected in the UX review (2026-07-12, senior-designer grill against Wise / Stripe / ClickUp /
Notion / Harvest / Toggl practice, grounded in the existing invoice-list, project-Time-tab, and
grouping components). All items below are owner-confirmed and binding.

**Flow & navigation**
- Post-commit navigation is **hybrid**: Generate invoice draft → navigate forward to the invoice
  editor; Close & report → stay on the Close tab with a confirmation toast carrying an
  "Open report" link (see amended story 26). Queue row, month progress, and badge update live.

**Layout & information architecture**
- Close-queue rows are **Notion-flat single lines**, no column headers: project (primary) +
  client (muted, same line), billing type as dot + muted text (never a pill), hours with
  within/over color, "N to review" as muted text, amount right-aligned tabular-nums, and a
  hover-revealed quiet outline **Review** button. Month group headers are collapsible and carry
  the "N of M closed" progress and month total (reuse the existing Time-tab group-header
  pattern).
- Workspace grouping is **by task only** in v1; the member is visible per row as an avatar. No
  By-Member toggle (deferred; the existing grouping engine makes it cheap to add later if
  demand appears).
- Workspace entry rows are **lean review rows**: date, inline-editable note, member avatar,
  inline duration (existing hours-cell component), hover billable toggle, right-aligned amount,
  category as a dot. The Time tab's invoice-number, billing-status, and rate columns are
  deliberately omitted — nothing in this surface is locked or invoiced, so those columns are
  dead weight. Full entry editor and "Skip → <next>" appear on hover.

**Search & filter**
- The Close tab gets a ghost search input plus the approved Notion "+ Filter" three-step faceted
  pattern with facets **client, billing type, readiness** — URL-persisted, no default filter, no
  permanent property chips (existing filter components are the prior art).

**States**
- Blocked oldest-first rows stay fully rendered and un-dimmed (their numbers are exactly what
  motivates closing the earlier period); only the CTA slot is replaced by a muted,
  non-interactive "Close <period> first" hint fed by the enumeration's `disabledReason`.
- Queue empty state: dedicated empty-state component — "All caught up — nothing to close this
  month," no primary CTA, optional muted link to Drafts. Skeleton mirrors month headers + flat
  rows.
- Workspace zero-scope state (story 35) is a valid end-state, not an error: budget summary line
  at zero + gray callout "No entries in scope — you can still Close & report (zero usage)" with
  the commit button live for retainers. Skeleton mirrors the budget line + one task group.
- Commit success and all mutation errors surface as the approved bottom-left white-card toast.

**Data display**
- Carried-in entries render an inline muted "carried · <month>" label (dot + muted text). When a
  task group is majority-carried, the shared label is promoted once to the group header (same
  mechanism as the existing shared-reference promotion in grouped time views) instead of
  repeating per row. Client-document grouping (story 31) is unchanged.

**Responsive**
- Desktop-first. The Close tab reflows to a readable stacked list on narrow viewports; the Close
  workspace shows a "best on desktop" notice instead of a degraded editable ledger. No mobile
  editing parity in v1.

## Module Design

- **Name**: `billingScope`
  - **Responsibility**: the single source of truth for close membership and money: given project
    config, period-close state, and entries, produce for a target period — the in-scope entry set
    (with carried flag + reason), usage minutes, overage minutes and amount, blocking issues, and
    whether the period is committable under oldest-first (I1–I4).
  - **Interface**: pure function(s); inputs are plain data (project, periods, entries, target
    period), output is a scope report object. Failure modes are represented as typed issues in the
    output (never thrown): `not-earliest-open`, `missing-overage-rate`.
  - **Tested**: yes — exhaustively (this module carries the business risk).

- **Name**: `closeFlags`
  - **Responsibility**: derive the v1 review flags and informational carried lines from a scope
    report plus running-timer info.
  - **Interface**: pure function; returns an ordered flag list with kind, severity
    (warning / info / blocking), entry ref, and label data.
  - **Tested**: yes.

- **Name**: close-queue enumeration (extension of the existing ready-row iterator)
  - **Responsibility**: enumerate closable periods per org with amounts, flag counts, month
    grouping, progress, and per-row committability; continue to feed the sidebar badge from the
    same pass.
  - **Interface**: existing query shape extended with flagCount, entryCount, carried info, and
    `disabledReason`; the sort/grouping contract is stable, row internals may evolve.
  - **Tested**: yes (extend the existing pure-logic test suite).

- **Name**: skip mutation (`skipEntries` / clear)
  - **Responsibility**: set or clear `skippedThrough` on a batch of open entries with all guards
    (admin, org, open-state, valid period end).
  - **Interface**: mutation taking entry ids + target period end (or null to clear); rejects with
    typed errors on any locked entry (all-or-nothing batch).
  - **Tested**: yes — guard logic as pure helper with unit tests.

- **Name**: Close workspace surface (page + query)
  - **Responsibility**: render one period's scope report as the editable review UI; compose
    existing entry-editing, task-peek, and add-time components; host the commit action.
  - **Interface**: addressable by project + period start; commit delegates to existing
    `createInvoice` / `closePeriod` with server-side scope re-derivation.
  - **Tested**: no dedicated UI tests; all logic it renders comes from tested pure modules.

- **Name**: commit integration (modifications to invoice creation, period close, report)
  - **Responsibility**: route entry selection in `createInvoice`, `closePeriodInternal`,
    `closeRetainerCycle`, stale-draft refresh, and the monthly report through `billingScope` (open
    periods) and settlement stamps (closed periods); add the "Carried over from <month>" grouping
    to client-facing documents.
  - **Interface**: existing mutation/query signatures preserved.
  - **Tested**: yes — extend existing suites with carried/skip/late-entry scenarios.

## Testing Decisions

- Test **external behaviour of the scope rules**, not implementation: given entries/periods/config,
  assert scope membership, carried reasons, usage/overage amounts, committability, and flag output.
  Follow the existing pattern of pure logic modules with co-located unit tests (the ready-to-invoice
  and agent-report core suites are the prior art).
- Mandatory golden scenarios for `billingScope` (each for retainer-monthly, retainer-cycle, T&M;
  fixed where applicable):
  1. No skips — scope equals natural period (regression baseline vs. today's behaviour).
  2. Skip one entry → June close excludes it; July scope carries it with reason `skipped`; July
     usage/overage includes it at July's rate.
  3. Skip entire task → same, batch.
  4. Double skip (June → July → August).
  5. Late entry into a closed month → carried with reason `logged-late` into first open period.
  6. Undo skip while origin open; skip-clear when origin closed still resolves forward (story 22).
  7. Oldest-first: later period not committable while earlier open; becomes committable after.
  8. Within-budget after edits (over → under budget flips commit mode); zero-scope close.
  9. Missing overage rate → blocking issue; rate set → resolves.
  10. Reopen closed period → stamps removed, skips intact, scope re-renders identically.
  11. Non-billable entries: settled by retainer close, never counted in money; ignored by T&M.
  12. Cycle retainer: carried-in bucketed into first month of receiving cycle; cycle balance
      correct.
- Settlement-stamp immutability: after close, report queries must return identical results before
  and after a backdated entry is inserted (it must appear only in the next open period).
- TypeScript zero errors gate as always; run the full existing invoice/retainer suites to prove the
  no-skip baseline is behaviour-identical.

## Out of Scope

- Target-month picker for skips (deliberately rejected: repeated one-click skip covers multi-month
  deferral because the next close always resurfaces the entry).
- Configurable flag thresholds or custom flag rules (the 8h threshold is hardcoded in v1).
- Bulk multi-period or multi-project "close all" actions.
- Scheduled/automatic closing, reminders, or notifications.
- Any change to rounding, invoice numbering, currency handling, or the invoice editor's feature
  set.
- Client portal / external sharing of reports (existing behaviour only).
- Member (non-admin) visibility into Billing or skip capability.
- Data migration for historical periods (MVP dummy-data stage; direct-narrow schema change is
  acceptable per project policy).
- Renaming or restructuring the invoice document routes.

## Open Questions

- **Exact copy for carried reasons on client documents** ("Carried over from May" vs. also
  distinguishing "logged after May close" client-side). Owner: Adam. Suggested resolution: decide
  during the report/invoice document design pass; internal data model already distinguishes the two
  reasons, so this is copy-only.
- **URL for the Billing hub** (rename route to /billing vs. keep /invoices with new title). Owner:
  implementer. Suggested resolution: rename cleanly now (MVP, no external links to preserve);
  keep invoice document URLs unchanged.

## Further Notes

- The clickable prototype (Artifact "Month-close — Billing prototype", label `skip-to-next-close`)
  is the visual reference for both surfaces, already calibrated to the approved Notion-restraint
  style (no stat-card grids, no uppercase micro-labels, one primary per screen, flat lists,
  callout-based checklist, side peek without scrim).
- Existing behaviours explicitly preserved: draft-time `invoiceId` stamping and entry locking;
  settlement stamping at finalization/close; unsettle on void/back-to-draft/reopen; gapless invoice
  numbering at finalization; sidebar badge unification with the queue enumeration; raw-ledger
  (no default date filter, no rounding) presentation on review surfaces.
- Implementation order recommendation (tracer bullet): slice 1 = `billingScope` + `closeFlags` pure
  modules with the full golden-scenario suite and the no-skip baseline regression proof; slice 2 =
  skip mutation + workspace read query + workspace UI (read-only first, then editing); slice 3 =
  queue rework + nav rename + commit integration + report grouping. Each slice lands with backlog
  updates per project convention (backlog tracking is mandatory).
- Per project convention, this feature's implementation must add task-level checkboxes,
  a verification section, and deferred-TODO notes to the backlog document.
