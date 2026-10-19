<!-- TASK-00 begin -->
# 00 — Review Metadata (Baseline, quality gates, product intent)

## 1. Review timestamp and environment

| Item | Value |
|---|---|
| Date/time | Sunday 2026-07-12, 20:53–21:05 CEST (UTC+02:00, Europe/Budapest) |
| Repository | `/Users/tothadam/claude_code_projects/agency-flow-dev` |
| Commit | `660d28f02b85133385a9d99ab6222d41ca2cf4bd` ("agentic worksflow 1.0 ready") |
| Branch | `agentic` |
| Node | v25.2.1 |
| npm / npx | 11.6.2 / 11.6.2 |
| convex | declared `^1.34.1`, locked **1.34.1** |
| next | declared `^16.2.2`, locked **16.2.2** |
| react | 19.2.3 |
| typescript | 5.9.3 |
| vitest | locked 4.1.1 (declared `^4.1.0`) |
| convex-test | **0.0.53 installed, zero usages** (no Convex integration tests exist) |
| eslint | 9.39.4 |

**Convex guidelines version mismatch (flag per AGENTS.md):** `convex/_generated/ai/guidelines.md` states "These guidelines target Convex `^1.41.0`", but the installed/locked package is `convex@1.34.1`. Downstream tasks must verify any version-specific Convex API claim against the installed 1.34.1 behavior, not the guidelines alone.

## 2. Worktree status (dirty — concurrent work in flight; not touched)

`git status --short` at review start:

```
 M convex/_generated/api.d.ts
 M convex/schema.ts
?? convex/lib/billingScope.ts
?? convex/lib/closeFlags.ts
?? docs/fable-to-review/financial-systems-plan.md
```

- The `convex/schema.ts` diff (+14 lines, read-only inspection) adds one optional field to `timeEntries`: **`skippedThrough`** (`v.optional(v.string())`, YYYY-MM-DD period-end) — the Month-Close PRD's skip-to-next-close stamp, read only by the new pure `billingScope` module. `convex/_generated/api.d.ts` gains 4 lines correspondingly.
- `convex/lib/billingScope.ts` and `convex/lib/closeFlags.ts` are **untracked new files** — Slice 01 of the Month-Close PRD (`docs/prd-month-close.md` § Module Design) in progress.
- **Consequence for all tasks:** the review baseline is commit `660d28f` **plus** this uncommitted month-close work. Traces of close/invoice scope must state whether they read the committed code path or the new (not yet wired) `billingScope` module. Nothing was cleaned, stashed, or modified.

## 3. Quality gates — commands run and full results

All four commands from REVIEW-SPEC.md § "Existing tests and quality gates" were attempted. No files were modified; no fixes applied.

### 3.1 `npx tsc --noEmit` — PASS

Exit 0, no output. Zero TypeScript errors at baseline.

### 3.2 `npm test -- --reporter=dot` (vitest 4.1.1) — FAIL (exit 1)

Full run: **81 test files, 1451 tests → 3 files failed, 4 tests failed, 1 suite failed to load** (duration ~14.5 s).

Failures:

1. **Configuration defect (not an app bug):** `.reference/tiptap-docs/.reference/tiptap/packages/core/src/__tests__/transformPastedHTML.test.ts` — suite fails to load: `Failed to resolve import "@tiptap/core"`. Root cause: `vitest.config.ts` uses `include: ["**/*.test.ts", "**/*.test.tsx"]` with `exclude: ["node_modules/**"]` only, so the vendored `.reference/` documentation tree is swept into the app test run. Recorded as a config defect per spec; not fixed.
2. `lib/format-activity-timestamp.test.ts` — 3 assertion failures: `formatActivityTimestamp` returns `"1 min ago"` / `"5 mins ago"` / `"59 mins ago"` where the tests expect `"1 min"` / `"5 mins"` / `"59 mins"` (implementation appends " ago"; tests expect bare form).
3. `convex/lib/__tests__/taskActivityIndicators.test.ts` — 1 failure: `computeTaskIndicatorState › shows unseen only for the other assignees after one user updates a task` (`taskActivityIndicators.test.ts:54`, expected `hasUnseen === true`, got `false`).

**App-scoped re-run** (config defect excluded): `npx vitest run --reporter=dot --exclude "node_modules/**" --exclude ".reference/**"` → **81 files, 1481 tests → 2 files failed, 4 tests failed** (same 4 as above; the tiptap suite is gone). Exit 1.

**Flakiness note:** the app-scoped command was run three times. Two runs were stable at 4 failed tests / 2 failed files; one run showed **5 failed tests / 3 failed files** (the extra failing test/file was not captured before the re-runs; it did not reproduce). At least one test in the suite is timing-sensitive/flaky. Downstream tasks should not treat a single green/red run of the full suite as deterministic.

**Chain relevance:** none of the stable failures touch the time→billing chain. All chain-adjacent suites pass at baseline, including `convex/lib/rates.test.ts`, `convex/lib/rounding.test.ts`, `convex/lib/timer.test.ts`, `convex/lib/worksheetAi.test.ts`, `convex/lib/agentReportCore.test.ts`, `lib/time-entry-grouping.test.ts`, `lib/time-entry-filters.test.ts`, `lib/date-buckets.test.ts`, `lib/csv.test.ts`, `lib/worksheet-view-export.test.ts`, `lib/duration.test.ts`, `lib/retainer-row-action.test.ts`, `components/timer-provider.test.tsx`.

### 3.3 `npx eslint app components convex lib proxy.ts --quiet` — FAIL (exit 1)

**63 problems (63 errors, 0 warnings)** across 20 files. Rule breakdown:

| Rule | Count |
|---|---|
| `react-hooks/refs` (ref access during render) | 38 |
| `@typescript-eslint/no-explicit-any` | 11 |
| `react-hooks/set-state-in-effect` | 8 |
| `react-hooks/purity` | 4 |
| `react-hooks/preserve-manual-memoization` | 1 |
| `react-hooks/immutability` | 1 |

Affected files: `app/(dashboard)/{invoices,my-tasks,planner,tasks}/page.tsx`; `components/my-tasks/{completion-confetti,daily-notes-panel,my-tasks-list}.tsx`; `components/tasks/{activity-feed,inline-add-task,link-popover,task-detail-drawer,task-detail-title}.tsx`; `components/timer-provider.test.tsx`; `convex/migrations/deleteLegacyTimeEntries.ts`; `lib/hooks/{use-inline-draft-tasks,use-is-mobile,use-last-defined,use-planner-drag,use-planner-mutations}.ts`; `lib/task-detail.test.ts`.

**Chain relevance:** only two hits are chain-adjacent, both `no-explicit-any` in non-runtime-critical code — `components/timer-provider.test.tsx:111,112,130,131` (test file) and `convex/migrations/deleteLegacyTimeEntries.ts:26` (one-shot migration). **Zero lint errors in the core chain modules** (`convex/timer.ts`, `convex/timeEntries.ts`, `convex/invoices.ts`, `convex/statements.ts`, `convex/worksheets*.ts`, `convex/lib/*` rate/rounding/retainer/settle modules). The `react-hooks/refs` mass (38) concentrates in my-tasks/planner UI, outside the review scope; one `preserve-manual-memoization` error sits in `app/(dashboard)/invoices/page.tsx:71` (React Compiler skips memoizing `clearFilters` — performance-only, no correctness effect).

### 3.4 `npx convex insights --details` — SUCCEEDED (no auth limitation)

Ran against the dev deployment `fearless-mastiff-8`. Output: **1 warning in the last 72 hours** —

```
[WARNING] OCC Retried: agent:messages.js:finalizeMessage — 1 OCC conflict on table streamingMessages
  7/11/2026, 4:56:33 PM  retries:0  source: agent/streams.js:abort
```

This is in the agent-chat subsystem (streamingMessages), **not** in the time→billing chain. No insights warnings on timeEntries/invoices/retainer paths — but per the spec, absence of warnings on a 72-hour dummy-data dev window is **not** proof of scalability or concurrency safety (TASK-09 must not cite this as evidence of health).

## 4. Limitations and unavailable production signals

- **No production deployment / no real load.** All data is seeded dummy data (MVP stage, per repo memory and `docs/d1-currency-integrity-plan.md`); insights covers only a 72-hour dev window.
- **No Convex integration tests exist** (`convex-test@0.0.53` installed, unused) — per locked decision #2 of the plan, all verdicts in this review are static code traces, at most "proven (by trace)".
- **Dirty worktree** — month-close Slice-01 work uncommitted (§2); the baseline is not a pure commit.
- **Test suite has at least one flaky test** (§3.2) — single runs are not deterministic evidence.
- **Convex guidelines/package version mismatch** (§1) — guidelines target ^1.41.0 vs installed 1.34.1.
- `git status` snapshot is point-in-time; the worktree is shared and may change during the review waves.

## 5. Product intent summary (from the PRDs — so later tasks need not re-read all ~4,200 lines)

**Time measurement (Phase 7, `docs/phase-7-time-tracking.md` + `docs/time-tracking-prd.md`).** Single server-side timer per user, stored on the `users` table (`timerTaskId`, `timerStartedAt`, later `timerAccumulatedMs` + `timerStatus` for pause/resume); the client only renders `Date.now() − startedAt`. Stopping rounds elapsed time with the org's rounding setting (1/5/6/15 min), **always ceil**; entry `date` = the **stop** date in the **org timezone** (explicitly: midnight-crossing timers belong to the new day); <30 s stops are not auto-saved (toast with "Save as 1 min"); ≥8 h triggers a blocking stale-timer recovery dialog with an **empty** duration field; hard cap 16 h (960 min). Manual entry is a first-class equal path (same parser, same rounding, same rate snapshot). Rates are **snapshotted at entry creation and never updated on edit**; a missing rate **blocks** entry creation (no fallback, no silent zero). Members manage only their own entries and can only run timers on assigned tasks; admins can log on behalf of others. Locked (invoiced) entries are read-only.

**Rates and currency (D1, `docs/d1-currency-integrity-plan.md`).** The locked model: **cost rate = per-user per-currency** (`userRates`, `by_orgId_userId_currency`); **billable rate = project category override → workspace category default per currency** (`categoryRates`, `projectRateOverrides`); currency is derived from the client (`getProjectCurrency`), `client.currency` is **immutable after creation**, `project.clientId` immutable, so `timeEntries.rateCurrency == client currency` holds by construction; resolution **throws** on a missing rate rather than defaulting. The legacy `projects.currency` field was slated for removal (single source of truth = client). Retainer entries snapshot `billableRate = 0` — retainer revenue is period/cycle-level, never entry-level. No FX conversion, ever (explicit non-goal).

**Settlement (Phase 8, `docs/phase-8-time-entry-settlement.md` + slices 1–4).** The core fix: split *invoice linkage* from *closure*. `timeEntries` gains `settledAt`, `settledReason` (`invoiced` | `retainer_included` | `fixed_included`), `settledPeriodStart/End`; `retainerPeriods` gains `closedAt`/`closedBy`. Lock predicate: `invoiceId || settledAt`. Invoice transitions settle/unsettle entries (finalize → settle; void/back-to-draft/delete → unsettle); **the canonical set of "entries settled by invoice X" is the union of `invoiceLineItems.timeEntryIds`, not every entry carrying `invoiceId === X`** (drift = bug). Within-budget retainer months close via admin `closePeriod` (ensure-then-close by `projectId+periodStart`), which stamps `retainer_included` on billable *and* non-billable entries of the month; `reopenPeriod` reverses exactly those. Cycle close = bulk-close of the N monthly periods with identical `closedAt`; **rollover monthly overage is never directly invoiceable — overage settles at cycle end** (`assertRetainerInvoiceable` is the single source of truth). A backdated-entry guard (`assertEntryDateOpen`) must cover **all three** write paths (create, timer commit, update-on-date/task-change) and blocks only closed **retainer** periods (T&M/Fixed backdating is fine — invoice totals are frozen snapshots). Critical vocabulary rule: `periodEnded` (calendar) ≠ `isClosed`/`closedAt` (admin action); UI row badges collapse to Open/Draft/Closed/Non-billable while `settledReason` keeps full reporting fidelity. `projectOverview` renamed to `openMinutes/invoicedMinutes/settledMinutes(+Amounts)/nonBillableMinutes`.

**Worksheets + AI (Phase 9, `docs/phase-9-worksheet-export.md`).** Client-facing CSV companion, **live render, never stored**; scope-driven triggers: retainer month row, cycle-close row (union of the cycle's monthly scopes with per-month subtotal/allocation/rollover/overage lines reusing `retainerCycle.ts` + `retainerUsage.ts`), invoice row (scope = canonical union of `lineItems.timeEntryIds`), and ad-hoc picker (period presets resolved against org timezone, category + billable filters; always flat, never sectioned). One row per task; billable/non-billable/total hour split; **no rate column** ("the invoice carries the money — the worksheet carries the work"). AI (claude-sonnet-4-6 via Vercel AI Gateway, direct SDK fallback) generates only two narrative columns (`Task summary`, `What we did`) from title + parsed Tiptap description + subtasks + flattened comments + in-scope entry notes; deterministic fallbacks on empty content or per-task failure; whole-batch failure → no download; CSV formula-injection protection and UTF-8 BOM required; admin-only with explicit org guard in an internal query.

**Month close (current work, `docs/prd-month-close.md`, final 2026-07-12).** Billing hub (Invoices → Billing) with a review-first three-stage close: Close queue → full-page Close workspace (raw unrounded ledger, inline edits, nothing locks during review) → single commit ("Generate invoice draft" or "Close & report"). Four locked invariants: **I1** effective period of an open entry = `max(naturalPeriod(date), periodAfter(skippedThrough), firstOpenPeriod)`; **I2** close scope = exactly the open entries whose effective period is the target (carried-in entries marked `skipped`/`logged-late`; carried entries consume the *receiving* period's budget at its overage rate — intended behavior); **I3** oldest-first commits only; **I4** settlement stamps are immutable truth for closed periods — consumers must never re-derive closed membership from dates. One new schema field (`skippedThrough`), one pure module (`billingScope`) that every consumer (queue, workspace, `createInvoice`, `closePeriod`/`closeRetainerCycle`, monthly report, stale-draft refresh) must share — no surface may re-derive membership. Lock timing and rounding unchanged (lock at draft creation; rounding only on the invoice). This is the work sitting uncommitted in the worktree (§2).

**Future architecture (`docs/billing-periods-monthly-close-prd.md`, draft — NOT built).** A later rebuild: `billingPeriods` ledger + unified `billingDocuments` (statement|invoice sharing one editor/renderer; statements never enter `/invoices` or payment metrics) + `billingPeriodEvents` audit + `billingPeriodId` as the eventual lock anchor. Phase 8 was deliberately the lightweight forward-compatible step; escalation triggers are listed and none were met. Reviewers should treat this PRD as intent/direction, not current behavior.

**Known prior audit (`docs/invoicing-audit.md`, 2026-04-17).** Three Critical findings were recorded against invoicing at that date: (1) Fixed-fee "already invoiced" sums include **draft** invoices → deletable-draft double-billing (`convex/invoices.ts` ~1335–1356 + 3 mirrors); (2) `updateInvoiceLineItem` did not guard `retainer_fee`/`fixed`/`overage` line types → snapshot/total desync; (3) retainer revert-to-draft guard ignored later **draft** invoices → stale `retainerStartBalanceMinutes` chains. Plus High: member-accessible invoice list/preview queries (admin-gated UI only), no date validation on `updateInvoice`, sticky `amountOverridden`. The audit predates ~3 months of commits — **TASK-03/04/05 must re-verify each of these against current code** rather than assume fixed or still-broken.

## 6. Current failures relevant to the critical time→billing chain

1. **No failing chain code at baseline gates:** `tsc` clean; all chain-adjacent unit tests green; zero lint errors in chain math modules. The 4 stable test failures (`format-activity-timestamp` ×3, `taskActivityIndicators` ×1) are activity-UI features **outside** the chain.
2. **Structural gap (highest relevance):** the entire chain is proven only by **pure unit tests** — there are **zero** Convex integration tests (identity + DB state), zero E2E tests. Nothing executable currently proves that callers pass correct scope, that close/invoice mutations settle the right entry sets, or that surfaces reconcile. This is the review's central known weakness (feeds TASK-10).
3. **Vitest config defect:** `.reference/` vendor tree swept into `npm test`, adding a guaranteed suite-load failure to every full run (masks real signal; exit code is always 1).
4. **Test flakiness:** one unidentified timing-sensitive test failed in 1 of 3 app-scoped runs.
5. **In-flight month-close work** (uncommitted `skippedThrough` + `billingScope`/`closeFlags`): the scope rule for closes is mid-migration; committed consumers may not yet route through the new module — writer/reader traces must record which path is live.
6. **Prior Critical invoicing findings** (§5 last paragraph) are unresolved-until-verified inputs to the chain review.
7. **Convex guidelines target ^1.41.0 vs installed 1.34.1** — version-specific API/limit claims need independent verification.
8. Insights: no chain-related runtime warnings, but the observation window (72 h, dummy data) has no evidentiary weight for scale (TASK-09).
<!-- TASK-00 end -->
