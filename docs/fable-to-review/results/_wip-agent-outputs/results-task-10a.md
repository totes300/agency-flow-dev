# TASK-10a — Test inventory (financial-systems review)

Date: 2026-07-12 · Branch `agentic` @ `660d28f` · Reviewer: TASK-10a agent
Scope: every existing test touching the time → rates → aggregation → retainer → invoice → worksheet chain.

**Headline correction to the plan's baseline:** the claim "`convex-test@0.0.53` is
installed but unused — zero Convex integration tests" is **FALSE**. Five test files
under `convex/__tests__/` import `convexTest` from `convex-test` and run against the
real schema in an `@edge-runtime/vm` environment (verified executing: 13/13 pass in
`invoiceTransitions.test.ts`). Two of the five are on the critical chain.

**Concurrent-work caveat:** the worktree contains untracked concurrent work relevant
to the chain: `convex/lib/billingScope.ts` + `convex/lib/__tests__/billingScope.test.ts`
(676 lines), `convex/lib/closeFlags.ts` + `convex/lib/__tests__/closeFlags.test.ts`,
and a modified `convex/schema.ts`. These are inventoried below but flagged as
**uncommitted** — they are not part of the reviewed baseline commit.

---

## Test inventory (classified)

Legend for the strict-proof column: a pure helper test proves the helper's math only.
It does NOT prove that callers pass the correct entry scope, the correct identity, or
that the UI renders the result honestly. "Proves" below is used in that strict sense.

### Class 1 — Convex integration tests (convex-test, identity + db state)

#### 1.1 `convex/__tests__/invoiceTransitions.test.ts` (597 lines) — ON CHAIN
- **Exercises:** `applyStatusTransition` (from `convex/invoices.ts`) via `t.run` with
  a seeded graph (user, orgMember, orgSettings, status, client, project, task,
  timeEntry with full rate snapshot, invoice, invoiceLineItem with `timeEntryIds`);
  plus the **public mutations** `api.invoices.deleteInvoice`,
  `api.timeEntries.update`, `api.timeEntries.remove` through `t.withIdentity`
  (Clerk-shaped identity with `org_id` / `org_role`).
- **Branches covered:** T&M draft→invoiced (settledReason=`invoiced`, period stamps,
  invoiceId preserved); Fixed draft→invoiced (`fixed_included`); invoiced→void
  (unsettles AND clears invoiceId); invoiced→draft (unsettles, KEEPS invoiceId);
  number allocation at finalization + no double-claim on finalize→revert→re-finalize;
  seller-identity gate (no brandName → transition rejected, nothing mutated); paid→draft
  rejected; deleteInvoice rejects finalized / removes draft and releases entries;
  settled-entry guards on `timeEntries.update`/`remove` (settledAt-only branch —
  retainer close; invoiceId branch with draft-vs-finalized status-aware messages).
- **Strictly proves:** T7 partially (edit/delete of settled or invoice-linked entries
  is rejected through the real public mutation with real auth context); M5 partially
  (void/revert restore the settlement axes correctly on a 1-entry fixture; number
  identity survives revert). This is the ONLY place in the suite where an invariant
  gets integration-level proof.
- **Conspicuously does not cover:** move/re-rate/billability change of settled entries
  (T7's other axes); bulk paths (`bulkUpdate` billable flips); multi-entry invoices;
  retainer invoice transitions (`retainer_included` settle reason is only ever patched
  in by hand, never produced by the code under test); concurrent double-finalize
  (two admins); auth is bypassed via `t.run` for the four transition cases — only the
  guard tests go through real auth; cross-org (tenancy) transition attempts.

#### 1.2 `convex/__tests__/worksheetLifecycleEvidence.test.ts` (166 lines) — ON CHAIN
- **Exercises:** `buildTaskRows` and `groupWorksheetRowsByTaskId` (from
  `convex/worksheetsHelpers.ts`) via `t.run` with a seeded project/task and two
  entries in different months (Jan + June).
- **Strictly proves:** the financial half of a worksheet row is scoped to the entries
  *passed in* (June row: 120 min, entryCount 1) while `aiInput.entryNotes` contains
  **all** of the task's entry notes including the out-of-period January note —
  i.e. it **locks in** cross-period note leakage into AI input as intended
  "lifecycle evidence" behavior. Also: `groupWorksheetRowsByTaskId` collapses the same
  task across two months into one group with `occurrenceCount: 2` (keyed by taskId).
- **W-invariant relevance (strict):** proves W2's *totals* half only for a
  hand-passed entry array — the entry-membership selection (which entries reach
  `buildTaskRows`) is untested. For W3 it is **counter-evidence**: it asserts that a
  June-scoped row's AI context includes January notes, with no labeling assertion.
  For W4 it shows grouping is per-`taskId`, not `(period, taskId)` — direct input to
  H4, but no assertion about AI output identity.
- **Does not cover:** comments/subtasks/description in AI input; period filtering of
  the AI context; the worksheet mutations/actions themselves; AI action failure paths.

#### 1.3 Off-chain convex-test files (for completeness of the "unused" rebuttal)
- `convex/__tests__/notifications.test.ts` (660) — notification fan-out/state machine.
- `convex/__tests__/planner.test.ts` (885) — planner segments/week grid.
- `convex/__tests__/todayGestures.test.ts` (603) — today-list gestures, permissions.
None touch time-entry money semantics; they matter only as proof the harness works.

### Class 2 — Pure calculation tests (no db, no identity)

#### Rates & rounding (R, T4/H1)
- `convex/lib/rates.test.ts` (162) — `resolveRate` only. Branches: full snapshot;
  missing cost rate → error naming the required currency; missing billable rate →
  custom/fallback error; retainer billable → `billableRate = 0` without missing-rate
  error; non-billable entry/project → 0; costRate 0 valid; EUR/HUF currency
  propagation. **Strictly proves:** the leaf rules of R4 and the error half of R1 —
  *for a pre-assembled `RateContext`*. The hierarchy itself (project override →
  category default lookup, user+currency lookup) lives in the CALLERS and is
  untested; nothing proves every writer calls `resolveRate` at all. No NaN/Infinity
  inputs (H6 rate half untested).
- `convex/lib/rounding.test.ts` (41) — `roundMinutes` ceiling at intervals 1/5/6/15;
  negative → 0. **Strictly proves:** the helper ceils (H1's mechanism confirmed at
  helper level). Does not prove what writers store, whether UI labels it exact, or
  raw-ms recoverability. No NaN/Infinity.

#### Timer & date math (T1/T5 adjacent)
- `convex/lib/timer.test.ts` (59) — `computeElapsedMs` (negative clamps to 0),
  `totalElapsedMs`, `msToMinutes`, `getDateInTimezone` (midnight crossing both
  directions, hemisphere offsets). **No DST case, no invalid-IANA case, no overnight
  timer.** Pure helpers; no writer uses them under test.
- `lib/workday.test.ts` (~135 of interest) — `tzWallToEpoch`, `anchorStartedAt`
  (noon anchoring, today-vs-past, overflow clamps to midnight, malformed fallback),
  `reanchorStartedAt` (preserves time-of-day across date move), `getYMDInTimezone`.
  One test literally named "guarantees the server's date↔startedAt invariant
  regardless of UTC offset" — but only for the *helper's own output*, i.e. T5 at
  helper level. TZ pinned to America/New_York in `vitest.setup.ts` for real offsets,
  yet **no chain test exercises a DST transition day** (the only DST tests in the
  repo are in off-chain `lib/inbox-snooze.test.ts`).
- `lib/date-buckets.test.ts` (188) — `mondayOfWeek`, `bucketKey` day/week/month
  (year boundaries), `bucketLabel`, `resolveDateRangePreset`. Grouping-key math only.
- `lib/duration.test.ts` (75) — `parseDuration` (formats, rejects 0/negative/
  malformed), display formatters. Client-side input validation only — irrelevant to
  server-side T8 (Convex `v.number()` NaN/Infinity path completely untested).

#### Settlement status & guards (T7/A5 adjacent)
- `convex/lib/__tests__/settleEntries.test.ts` (191) — `entryStatus`,
  `billableOverviewBucket`: four-bucket routing, settledReason precedence over
  invoiceId, mutual exclusivity over the full input cube, 1:1 consistency between
  the two helpers. Strong helper-level status taxonomy proof.
- `convex/lib/__tests__/settleGuards.test.ts` (147) — `pickClosedCoveringPeriod`
  (closed-only, inclusive boundaries, mixed lists), `pickCoveringFinalizedInvoice`
  (invoiced/paid match, drafts/voids never, boundary inclusivity). Pure predicates;
  which mutations invoke them is untested. NOTE: `convex/lib/settleGuards.ts:114`
  carries a **stale comment** ("The repo's test setup doesn't ship `convex-test`")
  — false since the `convex/__tests__/` suite landed.
- `convex/lib/__tests__/retainerPeriods.test.ts` (396) — `periodBoundsFromStart`
  (month lengths, leap Feb, malformed rejects), `evaluateCloseGate` /
  `evaluateCycleCloseGate` (overage gate wording + precedence over draft-invoice
  gate), `findConflictingInvoice` (overlap variants, voided ignored),
  `shouldSettleEntry` (range inclusivity, idempotency, invoice-linked skip),
  `shouldReopenEntry` (triple match, never reopens `invoiced`/`fixed_included`).
  Helper-level; the close/reopen mutations that orchestrate these are untested.

#### Retainer math (M1–M3 adjacent)
- `convex/lib/__tests__/retainerBalance.test.ts` (598) — rollover ON balance
  chaining, cycle-end settlement (deficit mid-cycle not due; due at closed cycle
  end; overage minutes→amount), rollover OFF per-month isolation, edge cases
  (non-billable untouched, includedHours 0, archived-task entries count), an
  "invariants" block (available/endBalance/startBalance/overageDue formulas),
  `computeRetainerBalance` (invoice-side) for both modes, `getRetainerCyclePosition`
  / `getRetainerRecalcCyclePosition` / `getRetainerCycleStartMonth`.
  **Strictly proves:** M1/M2 formula math at helper level, including that the
  statement-side and invoice-side helpers each behave — but **no test asserts the
  two sides agree on the same fixture** (H3, the footer double-count hypothesis, is
  exactly the untested seam).
- `convex/lib/__tests__/retainerCycle.test.ts` (277) — `getCyclePeriods` (monthly +
  rollover alignment, year wrap, cycleOffset ±1, pre-start null), `applyOverageRule`
  (monthly-isolated / rollover-monthly / rollover-cycle; invariants incl.
  overageRate 0 still flips isOverageDue with amount 0). M3 timing at helper level.
- `convex/lib/__tests__/reportPeriod.test.ts` (32) — `classifyReportPeriod`
  past/current/future. Trivial but feeds M3's "current/future never finally due".

#### Invoice creation & lifecycle helpers (INV adjacent)
- `convex/lib/__tests__/invoiceCreation.test.ts` (285) — `findResumableInvoice`
  (Fixed/T&M/Retainer resume-draft semantics, other-org drafts ignored, voided =
  re-invoiceable, earliest-draft determinism), `canEditInvoiceMessage`,
  `assertRetainerInvoiceable` (exact user-facing message), `assertRolloverCycleEnd`
  (mid-cycle and position-0 throw). Helper-level.
- `convex/lib/__tests__/invoiceAnchor.test.ts` (99) — `getInvoiceAnchorMonthKey`,
  `invoiceCoversMonth` (leap Feb, cross-year cycles, null periods).
- `convex/lib/__tests__/markPaid.test.ts` (101) — `classifyMarkPaid` / `classifyUndo`
  (idempotency, third-party-edit skip reasons). Pure classifiers extracted from
  `convex/invoices.ts` precisely so they can dodge convex-test.
- `convex/lib/__tests__/fixedPrice.test.ts` (93) — **WARNING: proves nothing about
  production code.** The validation functions are re-implemented INSIDE the test file
  (`convex/lib/__tests__/fixedPrice.test.ts:9-31` defines its own
  `validateFixedPriceOnCreate/OnUpdate`); no production import. Pure tautology.
- `convex/lib/__tests__/readyToInvoice.test.ts` (865) — `computeLastInvoicedAt`,
  `enumerateRetainerCycleState` (balance chaining, in-progress cycle, chain restart
  per cycle, year rollover), `buildRetainerMonthlyReadyRows` /
  `buildRetainerCycleReadyRows` (close rows, already-closed suppression, overage
  charge, invoiced/void blocking, configIssue on overageRate 0, cycle-spanning
  invoice coverage), `buildFixedReadyRow`, `buildTmReadyRows` (closed prior months,
  excludes current month / invoice-attached / non-billable), `isInvoiceable`
  (zero-amount never produced), `selectBatchEligibleRows`. The most thorough
  helper suite on the chain — still fed hand-built fixture arrays, never db state.

#### Aggregation / summaries (A1–A3 adjacent)
- `convex/lib/__tests__/projectSummary.test.ts` (687) — `computeTmSummary` (billable/
  invoiced/non-billable splits, date-range inclusivity, member view stripping,
  costRate 0 margin), `computeFixedSummary` (billed vs fee slots, draft exclusion,
  manual extra lines, budget/effective-rate math), `computeRetainerSummary` (fee +
  live overage revenue, multi-month budget, non-billable cost-only,
  non-rollover per-month excess vs rollover pooling, member view),
  `resolveDateRange`, `filterEntriesByDate`. Helper-level A1/A2/A3 math.
- `convex/lib/__tests__/projectOverview.test.ts` (286) — `computeLast3Months` (the
  only production import — from `convex/timeEntries.ts`); the "Fixed overview
  calculations" and "T&M overview calculations" blocks compute expectations with
  **locally re-implemented arithmetic over fixture arrays** (same tautology risk as
  fixedPrice, though lighter: it documents intended formulas incl. "groups by
  entry.isBillable, not task.billable" and "archived task entries still count").
- `convex/lib/__tests__/timesheetPivot.test.ts` (215) — `buildTimesheetTable`
  (category pivot, per-category + grand totals, column ordering, row sort,
  table-guard acceptance, AI prose columns inserted after Project with EMPTY prose
  totals), `monthBounds` (leap Feb), `formatTimesheetPeriodLabel`. The "prose totals
  empty" assertions are the closest thing to a W1 proof at helper level.
- `convex/lib/agentReportCore.test.ts` (287) — month-key helpers,
  `aggregateTimeByMember` (zero-fill, No-project bucket), `aggregateClientMonths`,
  `classifyRetainerMonth`, `aggregateOrgFinance` (per-currency rollup). Agent
  reporting aggregation at helper level.

#### Client-side grouping/filter/export helpers
- `lib/time-entry-grouping.test.ts` (140) — `groupTimeEntries` day/week/month/member/
  task axes, sort orders, minute sums.
- `lib/time-entry-filters.test.ts` (155) — filter serialize/parse round-trip,
  `applyTimeEntryFilters` (member include/exclude, status matches entryStatus
  vocabulary, category, AND across facets).
- `lib/worksheet-view-export.test.ts` (134) — `mapBillingStatusToBillable`,
  `resolveViewExportPeriod` (presets, invalid custom ranges fall back to all-time),
  `resolveViewExportParams`. Proves the view→export parameter mapping, NOT that the
  exported entry set equals the on-screen set (the A4-shaped claim in its own test
  names — "matches the ad-hoc dialog's preset" — is asserted against constants, not
  against the other surface's code).
- `lib/worksheet-period-presets.test.ts` (137) — `resolvePeriodPreset` against org
  timezone, quarter/year wraps, custom-range rejection.
- `lib/worksheet-toast.test.ts` (116) — `buildCompletionToast` success/partial/error
  arithmetic incl. skipped-vs-failed separation (W6's counting logic, toast level).
- `lib/retainer-row-action.test.ts` (304) — `decideRetainerRowAction` (invoice link
  wins, void freed, monthly vs rollover generate/report decisions, zero overage rate
  → report), `isCycleEnd`, `decideRetainerRowCloseAction` (member null, already
  closed, in-progress, invoice-covered, over-budget rows). UI action-decision logic
  for M3/M4 surfaces at helper level.
- `lib/invoice-banner-view.test.ts` (135) — `deriveInvoiceBannerView` per billing
  type (fixed remaining/percent, T&M open balance, retainer monthly/cycle overage
  wording + tone).
- `lib/entry-tooltip.test.ts` (102) — `formatLockedTooltip` for settled
  (retainer/fixed/invoiced variants with period boundary, legacy fallback) and
  draft entries. M6-adjacent labeling.
- `lib/csv.test.ts` (90) — `escapeCsvField` formula-injection guards (`=`, `+`, `-`,
  `@`, tab/CR), quoting, `joinCsvRow`, `CSV_BOM`. Proves the escaping helper; not
  that every export path uses it.
- `lib/format.test.ts` — `formatCurrency`(Precise), `formatMinutes`, date formatting.
  Display-rounding vocabulary for H7, helper level.
- `lib/agents/table.test.ts` (212) — `isAgentTableOutput` guard (rejects empty/
  malformed tables), `classifyProseCell` (flagged/unavailable sentinels),
  `classifyParts` table expansion. W6-adjacent sentinel handling.
- `lib/agents/table-csv.test.ts` (96) — `agentTableToCsv` (BOM, column order,
  sentinel display text, formula-injection guard on task titles, totals omission).
- `lib/agents/sheet.test.ts` (184) — `grandTotalColumnKey`, `categoryShares`,
  `countFlaggedRows`/`isFlaggedRow`, `sortTableRows` (refuses prose columns, no
  mutation), `inlinePreviewColumns`.
- `lib/agents/reportViews.test.ts` (370) — report flatteners (`flattenProjectOverview`
  money rounded to 2dp, `flattenMonthlyBreakdown` billable split,
  `flattenRetainerCycle`, `flattenRetainerStatement`, invoice flatteners). These
  flatten *already-computed* query outputs — no aggregation proof.

#### Untracked concurrent work (not part of the reviewed baseline)
- `convex/lib/__tests__/billingScope.test.ts` (676) — 12 scenarios over the new
  `convex/lib/billingScope.ts`: period grid (monthly + 3-month cycle), `isOpenEntry`,
  baseline scope == naive date filter (the only cross-derivation equivalence test in
  the repo, A4-shaped), skip/carry semantics, logged-late, undo skip, oldest-first
  commit ordering, budget flip, missing overage rate, reopen equivalence,
  non-billable in/out of scope per billing type, cycle bucketing, settlement-stamp
  immutability ("a backdated entry inserted after close changes nothing" — A5/I4),
  fixed projects. Pure, fixture-array driven, but the strongest invariant-shaped
  suite in the tree. **Uncommitted.**
- `convex/lib/__tests__/closeFlags.test.ts` — `computeCloseFlags` ordering
  (blocking→warning→info), 480-min long-entry threshold, running-timer warnings,
  carried-in info. **Uncommitted.**

### Class 3 — Component tests (jsdom, @testing-library)

- `components/timer-provider.test.tsx` (409) — context split (`useTimerActions` /
  `useTimerTick` / `useTimer`), `isRunningOn`, `pendingStopResult` task-switch flow,
  stale-dialog derived state (threshold boundary, dismissal reset on task change),
  elapsed-ms derivation. **All Convex interaction is replaced by hand-built context
  values** (`components/timer-provider.test.tsx:14-16`: "Instead of mocking Convex,
  we provide context values directly"). Proves the provider's client-side state
  machine, NOT that stop/commit persist anything (T2), NOT idempotency of the real
  stop mutation (T3), NOT server-derived elapsed time (T1).
- `components/projects/project-time-stats.test.tsx` (130) — Open figure counts only
  `entryStatus() === 'open'` entries; excludes Draft/Closed; money-shaped T&M
  variant renders. One honest render-level check of a status-filtered sum.
- `components/projects/period-detail-sheet.test.ts` (245) — `groupBySettledReason`
  (retainer/invoiced/fixed/draft/open/nonBillable routing, mixed-period drill-down,
  invoice-ref de-dup, totals.amount counts only billable revenue). Pure function
  exported from a component file — no rendering; M6-adjacent classification logic.
- `components/billing-status-badge.test.tsx` (71) — label per state, legacy
  `uninvoiced`→Open mapping, lock icon on Draft+Closed only. M6/T7 labeling surface.

### Class 4 — Browser E2E tests

**None.** No Playwright/Cypress config, no `e2e/` or `tests/` directory, neither
appears in `package.json` (the `@playwright/test` strings in `package-lock.json` are
transitive optional peer references of vitest's browser mode, not installed deps).
There is also **no `.github/workflows/` directory at all** — no CI gate runs the
suite; `npm test` is purely a local convention.

---

## Invariant coverage map

Verdict vocabulary (strict): **integration-partial** = proven for some branches with
real db+identity; **helper-only** = the formula/predicate is proven pure but no test
proves callers use it with correct scope; **none** = no meaningful coverage.

| Invariant | Proving tests | Strength | Strongest existing adjacent test |
|---|---|---|---|
| T1 server authority | none | none | `convex/lib/timer.test.ts` (`computeElapsedMs` clamps negative) |
| T2 no lost measured time | none | none | `components/timer-provider.test.tsx` (`pendingStopResult` survives task switch — client state only) |
| T3 no double-counted time | none | none | `components/timer-provider.test.tsx` (task-switch flow; no mutation idempotency anywhere) |
| T4 exactness explicit | none | none (helper mechanism documented) | `convex/lib/rounding.test.ts` (proves `roundMinutes` ceils — H1's mechanism, not its storage/labeling consequence) |
| T5 date/timezone consistency | none at writer level | helper-only | `lib/workday.test.ts` ("guarantees the server's date↔startedAt invariant" — helper output only) + `convex/lib/timer.test.ts` `getDateInTimezone`; **zero DST / invalid-IANA / overnight-timer chain tests** |
| T6 one canonical writer | none | none | — (no test compares two writers' rules) |
| T7 locked history | `convex/__tests__/invoiceTransitions.test.ts` (update/remove guards via public mutations with identity) | **integration-partial** | same file; move/re-rate/billability/bulk untested |
| T8 valid numeric domain | none | none | `lib/duration.test.ts` (client string parsing rejects negatives — irrelevant to server `v.number()` NaN/±Infinity) |
| R1 snapshot completeness | none | helper-only (error branch) | `convex/lib/rates.test.ts` (`resolveRate` throws on missing rates — for a pre-assembled context; no proof every writer calls it) |
| R2 historical stability | none | none | `convex/lib/__tests__/retainerPeriods.test.ts` `shouldReopenEntry` never touches rates (tangential) |
| R3 snapshot timing policy | none | none | — (no test creates an entry across a rate change) |
| R4 rate resolution order | none | helper-only (leaf rules) | `convex/lib/rates.test.ts` (retainer→0, non-billable→0, currency propagation); the override→category lookup order lives in untested callers |
| R5 actor vs owner | none | none | — |
| A1 raw time conservation | none | helper-only | `convex/lib/__tests__/projectSummary.test.ts` + `projectOverview.test.ts` (sums over hand-built fixture arrays; `projectOverview` re-implements expectations locally) |
| A2 cost calculation | none | helper-only | `convex/lib/__tests__/projectSummary.test.ts` (cost from costRate snapshots) / `agentReportCore.test.ts` (`aggregateOrgFinance`) |
| A3 T&M value | none | helper-only | `convex/lib/__tests__/projectSummary.test.ts` `computeTmSummary` + `readyToInvoice.test.ts` `buildTmReadyRows` |
| A4 filter equivalence | none in committed code | none | untracked `billingScope.test.ts` "baseline equals a naive date-filter selection" is the only cross-derivation equivalence test; committed closest: `lib/worksheet-view-export.test.ts` (asserts mapping constants, not the other surface) |
| A5 canonical closed scope | none in committed code | none (integration-adjacent) | `convex/__tests__/invoiceTransitions.test.ts` (settledPeriodStart/End stamped); untracked `billingScope.test.ts` "backdated entry after close changes nothing" (I4) |
| M1 no-rollover month math | none | helper-only (strong formula coverage) | `convex/lib/__tests__/retainerBalance.test.ts` "rollover OFF" + invariants block; `retainerCycle.test.ts` `applyOverageRule` monthly-isolated |
| M2 rollover cycle math | none | helper-only | `convex/lib/__tests__/retainerBalance.test.ts` (chaining, cycle-end settlement, invoice-side `computeRetainerBalance`) + `readyToInvoice.test.ts` `enumerateRetainerCycleState`; **no test asserts statement-side and invoice-side agree on one fixture (H3 seam untested)** |
| M3 overage timing | none | helper-only | `retainerBalance.test.ts` (mid-cycle deficit not due) + `retainerCycle.test.ts` (rollover-monthly never due) + `lib/retainer-row-action.test.ts` (in-progress rows never Generate) + `reportPeriod.test.ts` |
| M4 single period/cycle definition | none | none | each consumer's helper tested in isolation (`retainerCycle`, `readyToInvoice`, `invoiceAnchor`, `retainerPeriods`) — no cross-consumer agreement test exists |
| M5 reopen/revert/void | `convex/__tests__/invoiceTransitions.test.ts` (void unsettles+clears; draft revert keeps invoiceId; number no-double-claim) | **integration-partial** (1-entry fixture, invoice axis only) | same file + `retainerPeriods.test.ts` `shouldReopenEntry`/`shouldSettleEntry` for the period axis (helper-only) |
| M6 honest live vs frozen | none | none (labeling adjacent) | `lib/entry-tooltip.test.ts` + `components/billing-status-badge.test.tsx` + `components/projects/period-detail-sheet.test.ts` (labels/classification; no like-vs-unlike class comparison test) |
| W1 AI never determines accounting | none | helper-only | `convex/lib/__tests__/timesheetPivot.test.ts` ("leaves prose totals empty", deterministic shape without AI columns) + `lib/agents/table.test.ts` guard |
| W2 worksheet entry-set reconciliation | none | integration-adjacent (totals half only) | `convex/__tests__/worksheetLifecycleEvidence.test.ts` (`buildTaskRows` totals scoped to passed entries — but membership selection untested; period/invoice/cycle union logic untested) |
| W3 period-aware AI context | none — **counter-evidence exists** | none | `convex/__tests__/worksheetLifecycleEvidence.test.ts` asserts a June row's `aiInput.entryNotes` INCLUDES the January note (cross-period leakage locked in as "lifecycle evidence", no labeling assertion) — direct input for H5 |
| W4 unique AI output identity | none | none | `convex/__tests__/worksheetLifecycleEvidence.test.ts` (`groupWorksheetRowsByTaskId` keys by taskId, occurrenceCount 2 — evidence FOR H4's risk, not proof of (period,taskId) identity) |
| W5 grounding and honesty | none | none (parse-robustness only) | `convex/lib/worksheetAi.test.ts` (`parseResponse` drift/fallback/caps; `hasMeaningfulAiInput`) — zero prompt-injection / contradictory-comment / future-comment tests |
| W6 failure transparency | none | helper-only | `lib/worksheet-toast.test.ts` (skipped vs failed vs success arithmetic) + `lib/agents/sheet.test.ts` `countFlaggedRows` + `lib/agents/table.test.ts` sentinel classification |

### Coverage statement

- **0 of 30 invariants are fully proven** by existing tests.
- **2 of 30 (T7, M5) have partial integration-level proof** — both from the single
  file `convex/__tests__/invoiceTransitions.test.ts`, both on a one-entry T&M/Fixed
  fixture; the retainer axis of each is helper-only.
- **~13 more have helper-only formula/predicate coverage** (T5, R1, R4, A1–A3,
  M1–M3, W1, W2, W6) where nothing proves callers pass correct scope, identity, or
  render honestly.
- **~15 have effectively nothing**: T1, T2, T3, T4, T6, T8, R2, R3, R5, A4, A5, M4,
  M6, W3, W4, W5 — including every concurrency/idempotency invariant, every
  rate-change-over-time invariant, and every cross-surface agreement invariant.
- The three headline hypotheses with a testable seam — **H1** (helper mechanism
  confirmed, consequence untested), **H3** (statement-vs-invoice agreement never
  asserted on one fixture), **H4/H5** (worksheetLifecycleEvidence actively locks in
  taskId-keyed grouping and cross-period note leakage) — all fall in the gap.

---

## Infrastructure notes (vitest config, convex-test status, E2E status)

### vitest
- `vitest.config.ts`: `include: ["**/*.test.ts", "**/*.test.tsx"]`,
  `exclude: ["node_modules/**"]`, `environment: "jsdom"`, alias `@` → repo root,
  `setupFiles: ["./vitest.setup.ts"]`. No coverage thresholds, no projects split, no
  `.spec.*` pattern (nothing uses it).
- `vitest.setup.ts`: loads jest-dom matchers and pins `process.env.TZ =
  "America/New_York"` explicitly so DST-observing assertions are possible — an
  affordance the chain's date tests do not use (only off-chain `inbox-snooze` does).
- `npm test` = `vitest run`; `npm run test:watch` = `vitest`. `@vitest/coverage-v8`
  is installed but no coverage script exists.

### convex-test — baseline claim FALSIFIED
- `convex-test@^0.0.53` (package.json:87) is **actively used** by five files in
  `convex/__tests__/`: `invoiceTransitions`, `worksheetLifecycleEvidence`,
  `notifications`, `planner`, `todayGestures`. Two are on the critical chain.
- Mechanics: per-file `// @vitest-environment edge-runtime` override (jsdom lacks
  the VM convex-test needs); `@edge-runtime/vm@^5.0.0` is a devDependency
  (package.json:78) and present in `node_modules/@edge-runtime/`; each file builds
  its own `import.meta.glob("../**/*.ts")` module map per the Convex testing docs;
  identity is faked with Clerk-shaped claims (`org_id`, `org_role: "org:admin"`).
- Verified executing on this machine: `npx vitest run
  convex/__tests__/invoiceTransitions.test.ts` → 13/13 passed (416 ms).
- Consequence for TASK-10b: the golden-ledger `convex-test` harness needs **no new
  infrastructure** — environment override, module-map, and identity patterns are
  already established in-repo and can be copied verbatim.
- Stale in-source comments contradict reality and should not be trusted by later
  tasks: `convex/lib/settleGuards.ts:114` ("The repo's test setup doesn't ship
  `convex-test`") and the plan's own baseline line.

### E2E / browser
- No Playwright or Cypress: no config file, no e2e directory, not in
  `package.json` dependencies (lockfile hits are vitest browser-mode optional peer
  metadata only). The `clerk-testing` skill exists in the environment but nothing in
  the repo uses it.
- No CI: `.github/workflows/` does not exist. Nothing enforces `npm test`,
  `tsc --noEmit`, or lint on any branch.

### Test-quality hazards worth carrying into 10b
1. **Tautological tests:** `convex/lib/__tests__/fixedPrice.test.ts` re-implements
   the validation inside the test file (lines 9–31) and imports zero production
   code; large parts of `projectOverview.test.ts` similarly compute expectations
   with locally re-implemented arithmetic over fixture arrays.
2. **Fixture-array pattern:** nearly every "integration-shaped" helper suite
   (readyToInvoice, retainerBalance, projectSummary, billingScope) feeds hand-built
   arrays, so index selection, org scoping, and predicate wiring in the real query
   functions (`convex/timeEntries.ts`, `convex/invoices.ts`, `convex/statements.ts`)
   have zero coverage.
3. **Concurrent uncommitted work:** `billingScope`/`closeFlags` tests (untracked)
   are the strongest invariant-shaped suites present but belong to in-flight work on
   a modified `convex/schema.ts`; TASK-10b must not count them as baseline coverage.
