# Financial Systems Review — Agent Execution Plan

Execution plan for `docs/fable-to-review/REVIEW-SPEC.md`. It decomposes the review
into self-contained task cards that concrete agents can execute. Each card carries
its own context, inputs, method, and done-criteria, so the plan works in either
mode:

- **single orchestrated session** — one coordinator spawns the cards as parallel
  subagents per wave, or
- **session-per-task** — each card is pasted into a fresh Claude Code session; the
  deliverable files under `docs/fable-to-review/results/` are the only handoff
  channel between tasks.

## Locked execution decisions (product owner, 2026-07-12)

1. **Hybrid task cards.** Plan format as described above.
2. **Static code-trace validation.** The golden ledger fixture is validated by
   hand-derived code traces only — no test code is executed against the fixture
   during this review. Every reconciliation cell is computed twice: once from the
   spec formulas ("Expected") and once by mechanically walking the actual source
   ("Actual per code trace"), citing `file:line` for every branch taken. The
   executable `convex-test` harness that would turn these traces into running
   proof is **specified but not implemented** — it is the centerpiece of
   `05-test-gap-plan.md`. Consequence: a verdict may be at most
   **"proven (by trace)"**; where a trace is too fragile to trust by reading,
   report **"not provable with current tests/data"** and point to the harness.
3. **Live UI review is in scope.** Local dev server via the `next-dev` launch
   configuration (`.claude/launch.json`, port 3000), with the owner's existing
   authenticated Clerk test organization and seeded dummy data. UI agents use the
   in-app Browser pane. Never screenshot anything resembling real client data.

## Baseline facts (verified 2026-07-12)

- Branch `agentic`, commit `660d28f`, worktree clean at plan time (re-verify in
  TASK-00; treat as shared and potentially dirty).
- All 39 files in the spec's architecture inventory exist.
- Test stack: `vitest` (`npm test`), `convex-test@0.0.53` installed but **unused**
  — there are zero Convex integration tests. Existing tests near the chain:
  `convex/lib/{rates,rounding,timer,worksheetAi,agentReportCore}.test.ts` and
  `lib/{time-entry-grouping,time-entry-filters,date-buckets,csv,worksheet-view-export,duration,retainer-row-action,worksheet-period-presets,worksheet-toast}.test.ts`,
  `components/timer-provider.test.tsx`. All are pure/unit level.
- Large files needing chunked reading: `convex/invoices.ts` (~3300 lines),
  `convex/projects.ts` (~1300), `convex/timeEntries.ts` (~1270),
  `convex/schema.ts` (~880).
- Relevant PRDs for Phase 0 reading: `docs/prd-month-close.md`,
  `docs/billing-periods-monthly-close-prd.md`, `docs/phase-7-time-tracking.md`,
  `docs/phase-8-slice-{1..4}*.md`, `docs/phase-8-time-entry-settlement.md`,
  `docs/phase-9-worksheet-export.md`, `docs/time-tracking-prd.md`,
  `docs/invoicing-audit.md`, `docs/d1-currency-integrity-plan.md`.

## Global rules — prepend to every agent prompt

Every agent must follow these without exception:

1. Read `AGENTS.md` / `CLAUDE.md` at repo root before anything else. Before
   touching Convex reasoning, read `convex/_generated/ai/guidelines.md`
   completely. Before Next.js behavioral claims, read the version-matched file
   under `node_modules/next/dist/docs/`.
2. **Review-only.** Do not modify application code, schema, tests, config, or
   data. The only writable locations are `docs/fable-to-review/results/` (the
   eight deliverable files listed below — create no other files there) and the
   session scratchpad for working notes.
3. No `git stash`, `git reset --hard`, `git checkout --`, `git restore`,
   `git clean`, or any destructive git command. Prefer `rg` / `rg --files` and
   read-only inspection.
4. Do not send repository contents to external services.
5. Evidence discipline: every claim cites exact `file:line` and function name.
   Every finding uses the spec's mandatory finding format (REVIEW-SPEC.md
   "Finding format") and the spec severity model. No "could potentially be
   wrong" without a concrete scenario and code path.
6. Invariant verdicts use exactly: **proven** (qualify "by trace"), **violated**,
   **partially proven**, **not provable with current tests/data**.
7. Finding IDs: `F-<area>-<nn>` where area ∈ {TMR (timer/writers), RAT (rates),
   AGG (aggregation), RET (retainer), INV (invoicing/T&M), WKS (worksheet/AI),
   UX (UI/UX), SCL (scale/concurrency), SEC (tenancy)}. Allocate sequentially
   within your task; on merge, TASK-11 renumbers collisions.
8. When appending to a shared deliverable, add a clearly delimited section header
   `<!-- TASK-XX begin -->` … `<!-- TASK-XX end -->` so the synthesis task can
   merge deterministically.
9. Treat silent discrepancies as more severe than visible failures.

### Deliverables (create only these, under `docs/fable-to-review/results/`)

| File | Owner task(s) |
|---|---|
| `00-review-metadata.md` | TASK-00 |
| `01-system-map.md` | TASK-01 (writers), TASK-02 (rates), TASK-03 (readers), TASK-05 (retainer graph), TASK-06 (worksheet/AI graph) |
| `02-invariant-verdicts.md` | drafted per-task, finalized by TASK-11 |
| `03-reconciliation-matrix.md` | TASK-04 (fixture + matrix skeleton), filled by TASK-04/05/06, finalized by TASK-11 |
| `04-findings.md` | all tasks contribute; TASK-07 owns the mandatory "Rate model and configuration UX" section; TASK-11 sorts/merges |
| `05-test-gap-plan.md` | TASK-10 |
| `06-remediation-roadmap.md` | TASK-11 |
| `07-executive-summary.md` | TASK-11 |

## Wave plan and dependencies

```text
Wave 0   TASK-00 Baseline & quality gates                 (sequential, first)
Wave 1   TASK-01 Writer trace          ─┐
         TASK-02 Rate trace             ├─ parallel (read-only, independent)
         TASK-03 Reader/aggregation     │
         TASK-09 Scale & concurrency    │
         TASK-10a Test inventory       ─┘
Wave 2   TASK-04 Golden ledger fixture + reconciliation matrix (needs 01+02+03)
         then, parallel on top of the fixture:
         TASK-05 Retainer proof
         TASK-06 Worksheet & AI proof
Wave 2u  TASK-07 Rate settings UX review  ─┐ browser-bound; run sequentially
         TASK-08 Daily timer UX journey   ─┘ if sharing one Browser pane
         (can start any time after TASK-02 / TASK-01 respectively)
Wave 3   TASK-10b Test gap plan (needs all findings)
         TASK-11 Synthesis: verdicts, roadmap, executive summary (last)
```

Suggested runners: code-trace tasks → `general-purpose` agent (or `Explore` for
pure inventory sweeps) at high effort; UI tasks → main-session agent with Browser
pane access; synthesis → main session. In session-per-task mode each card below is
the complete prompt (plus the Global rules block).

---

## TASK-00 — Baseline, quality gates, metadata

- **Wave:** 0 (run first; everything else may cite its output)
- **Objective:** Produce `00-review-metadata.md` and establish the baseline all
  other tasks reference.
- **Method:**
  1. Record date/time + timezone, `git rev-parse HEAD`, branch,
     `git status --short` (do not clean anything), Node/npm/npx versions,
     `convex` and `next` versions from the lockfile.
  2. Run, without modifying any file, capturing full output:
     `npx tsc --noEmit`; `npm test -- --reporter=dot`;
     `npx eslint app components convex lib proxy.ts --quiet`;
     `npx convex insights --details` (if it needs deployment auth that is
     unavailable, record that as a limitation, do not force it).
  3. If a command fails due to configuration that includes unrelated reference
     files, record both the configuration defect and an app-scoped re-run result.
     Do not fix anything.
  4. Read the PRDs listed in "Baseline facts" above; write a half-page "product
     intent summary" (month close, settlement, worksheet decisions) into the
     metadata file so later tasks don't re-read all PRDs.
  5. List current failures relevant to the critical chain.
- **Output:** `results/00-review-metadata.md` (commands, versions, failures,
  limitations, unavailable production signals, PRD intent summary).
- **Done when:** all four commands were attempted, outputs archived, limitations
  explicit.

## TASK-01 — Trace every time-entry writer (Phase 1; invariants T1–T8)

- **Wave:** 1. **Depends on:** TASK-00.
- **Objective:** For each creation/update/delete path of `timeEntries`, document
  the full write pipeline and give verdicts on T1–T8.
- **Inputs:** `convex/timer.ts`, `convex/timeEntries.ts` (writers only),
  `convex/lib/timer.ts`, `convex/lib/timerEntry.ts`, `convex/lib/rounding.ts`,
  `convex/lib/dateValidation.ts`, `convex/lib/settleGuards.ts`,
  `convex/lib/entryStatus.ts`, `convex/lib/settleEntries.ts`,
  `convex/schema.ts` (timeEntries + timer tables), plus **search** for any
  task/project archive/delete path that stops or autosaves timers
  (`rg -n "archive|autosave|stopTimer|discard" convex`), and
  `components/timer-provider.tsx` + `components/timer/*` for the client half of
  T1/T2/T3.
- **Method:** For every writer (manual create, timer stop/commit, short-timer
  recovery, task-archive autosave, edit, delete, bulk billable update), fill the
  Phase-1 table from the spec: entrypoint, authorization, source of duration,
  source of date+timezone, rounding, owner vs actor, rate snapshot call, settle
  guards, transaction boundaries, error/retry behavior, audit logging.
  Then verdict each of T1–T8 with evidence. Specifically:
  - **T4/H1:** read `roundMinutes` and every call site; state exactly what is
    stored (raw ms? ceiled minutes?), whether any UI/copy calls it "exact/raw",
    and whether raw milliseconds remain recoverable.
  - **T5:** trace `entry.date` derivation vs `startedAt` in org timezone; walk
    DST spring/fall, midnight crossing, invalid IANA zone, overnight timer
    through the actual date code (`convex/lib/dateValidation.ts`,
    `lib/date-buckets.ts`).
  - **T3:** examine timer stop for idempotency (double click, two tabs, retry) —
    what prevents duplicate rows?
  - **T8/H6 (writer half):** for each numeric arg, list the validation actually
    applied; note Convex `v.number()` admits NaN/±Infinity.
  - Cover the "Timer" and "Manual entry" rows of the spec's scenario matrix at
    code level (backend behavior + existing test coverage columns; UI column is
    TASK-08's).
- **Output:** writer graph section of `results/01-system-map.md`; T1–T8 verdict
  rows (draft) appended to `results/02-invariant-verdicts.md`; findings
  (`F-TMR-*`) appended to `results/04-findings.md`.
- **Done when:** every public writer in `convex/timer.ts` +
  `convex/timeEntries.ts` and every archive/autosave path is in the table; T1–T8
  each have a verdict; H1 and the writer half of H6 are confirmed or rejected
  with line evidence.

## TASK-02 — Trace rates: resolution, snapshots, locked currency model (Phase 2; R1–R5)

- **Wave:** 1. **Depends on:** TASK-00.
- **Objective:** Build the rate-resolution decision table for every project type
  and mutation; prove or refute the locked per-user/per-currency cost-rate model.
- **Inputs:** `convex/userRates.ts`, `convex/categoryRates.ts`,
  `convex/projectRateOverrides.ts`, `convex/lib/rates.ts` (+ its test),
  `convex/lib/orgHelpers.ts`, `convex/lib/projectSummary.ts`, rate fields and
  indexes in `convex/schema.ts`, every caller of the resolution helpers
  (`rg -n "resolveRate|costRate|billableRate|rateCurrency" convex | rg -v _generated`).
- **Method:**
  1. Document the intended hierarchy from REVIEW-SPEC.md ("Intended mental model
     to verify") and verify it branch by branch: cost = user+currency; billable =
     project override → category default; retainer entries `billableRate = 0`;
     non-billable = 0; currency = project's client currency (R4).
  2. **Locked model proof** (spec "Locked product decision"): show that every
     entry writer selects the **entry owner's** rate in the **exact
     project/client currency**; that admin-on-behalf and archive-autosave use the
     owner's rate with actor preserved in audit metadata (R5); that missing
     currency coverage is detected before work is lost; that editing/deleting a
     configured rate never touches stored snapshots (R2); that project currency
     and `rateCurrency` cannot drift. Do **not** propose FX conversion, base
     currency, or rate versioning.
  3. **H2 snapshot timing:** determine the exact snapshot moment for: timer
     spanning a rate change (start-time vs stop-time resolution), backdated
     manual entry, entry edited after a change, entry moved to another
     task/category, former member's history. Flag only inconsistency, historical
     mutation, or unclear UI behavior.
  4. **R1:** identify any path that can write an entry with a missing/undefined
     `costRate`, `billableRate`, or `rateCurrency`.
  5. **H6 (rate half):** NaN/Infinity/negative/extreme values through rate
     mutations; check the "Rates" scenario-matrix rows at code level (zero rate
     as intentional value, delete-and-recreate, currency change constraints).
  6. Verify no legacy category **cost**-rate field/UI/migration/calculation
     remains (spec Terminology review).
- **Output:** rate-resolution graph + decision table in `results/01-system-map.md`;
  R1–R5 draft verdicts in `results/02-invariant-verdicts.md`; findings
  (`F-RAT-*`) in `results/04-findings.md`; a one-page "verified rate hierarchy"
  brief that TASK-07 will consume as ground truth.
- **Done when:** every rate mutation and every resolution call site is traced;
  R1–R5 have verdicts; H2 confirmed/rejected; the locked-model checklist (8
  bullets in the spec) each has an explicit pass/fail.

## TASK-03 — Trace every reader, filter, aggregation (Phase 3; A1–A5)

- **Wave:** 1. **Depends on:** TASK-00.
- **Objective:** Inventory the complete read side so that no consumer of
  `timeEntries` is missed, and verdict A1–A5.
- **Inputs:** all exported functions in `convex/timeEntries.ts` (at minimum the
  19 functions listed in REVIEW-SPEC.md "Time reads"), `convex/projects.ts`,
  `convex/statements.ts`, `convex/invoices.ts`, `convex/worksheets.ts`,
  `convex/worksheetsHelpers.ts`, `convex/timesheets.ts`, `convex/agentReports.ts`,
  `convex/lib/{projectSummary,timesheetPivot,readyToInvoice,agentReportCore}.ts`,
  `lib/{time-entry-grouping,time-entry-filters,date-buckets,worksheet-view-export}.ts`.
  Also sweep: `rg -n "timeEntries" convex lib app components --files-with-matches`
  to catch consumers outside the inventory.
- **Method:** For every reader record the spec's Phase-3 columns: complete read
  set (index used, org scoping), exact entry predicate, date semantics,
  billability semantics, draft/finalized/settled semantics, rate source, rounding
  point, output consumers, and sibling functions claiming the same metric.
  Produce a **predicate inventory table** (one row per function). Then:
  - **A4:** cluster functions by product label ("this shows project time") and
    diff their predicates; any two surfaces with the same label but different
    entry set or rounding is a finding even if both are locally correct.
  - **A1/A2/A3:** identify the summation and rounding point in each aggregate;
    note where `durationMinutes` vs hours vs currency rounding happens (feeds H7).
  - **A5:** for close/finalized scopes, determine whether documents re-derive
    scope from live task data or use immutable membership
    (`invoice.timeEntryIds`, settlement fields).
  - Verify tenancy on every ID-based read (ownership check after `db.get`) —
    cross-org attempts are part of the golden fixture; findings go to `F-SEC-*`.
- **Output:** reader/aggregation graph + predicate inventory in
  `results/01-system-map.md`; A1–A5 draft verdicts; findings (`F-AGG-*`,
  `F-SEC-*`); a machine-readable list of "surfaces to reconcile" handed to
  TASK-04 (embed it in the 01 file).
- **Done when:** every exported time reader is in the predicate table, including
  any found by the sweep beyond the spec inventory; A1–A5 have verdicts; H7's
  rounding map is drafted.

## TASK-04 — Golden ledger fixture + reconciliation matrix (static)

- **Wave:** 2. **Depends on:** TASK-01, TASK-02, TASK-03.
- **Objective:** Design the deterministic golden ledger exactly per the spec
  ("Golden ledger fixture": two orgs, Europe/Budapest, DST days, removed member,
  rate change mid-period, the four projects, full lifecycle) and build
  `03-reconciliation-matrix.md` by static trace.
- **Method:**
  1. Write the fixture as a precise data listing (every org, user, rate, project,
     task, entry with concrete timestamps/durations/rates — deterministic, no
     randomness) as the **preamble section of `03-reconciliation-matrix.md`**.
     Do not create extra files. Include the spec's required oddities: <30s entry,
     61s entry, 8h/16h stale timers, unicode + CSV-formula + prompt-injection
     notes, task repeated across three months, category change after history,
     locked/draft/finalized/settled entries.
  2. Compute **Expected** for every metric from the spec formulas (M1/M2/A1–A3)
     by hand, showing arithmetic.
  3. Compute **Actual (per code trace)** by walking each surface's code path
     from TASK-03's predicate table against the fixture rows, citing the lines
     that include/exclude/round each value.
  4. Fill the required matrix columns
     (`Consumer/surface | Function/component | Entry-set rule | Time basis | Rate basis | Rounding | Expected | Actual | Status`)
     for at least the 17 surfaces the spec lists (My Time today … agent
     timesheet totals). T&M rows are owned here; retainer rows are co-owned with
     TASK-05, worksheet rows with TASK-06 — leave clearly marked placeholders
     for those tasks if running in parallel.
  5. **H7:** finalize the rounding map (raw minutes / per-task rounded minutes /
     rounded hours / rounded currency per surface) and flag every visible
     discrepancy not explained to the user.
  6. Cover the "T&M" scenario-matrix rows (draft refresh, manual line-item
     adjustment, finalized/voided invoices, worksheet↔invoice canonical-set
     equality) at code level.
  7. Where a static trace is too fragile to trust (deep branching, >1 plausible
     reading), mark the row **"not provable statically"** and write the exact
     `convex-test` case TASK-10 must include.
- **Output:** `results/03-reconciliation-matrix.md` (fixture + matrix); A1–A3
  verdict updates; findings (`F-AGG-*`, `F-INV-*`).
- **Done when:** every listed surface has a row with all columns filled or an
  explicit "not provable statically" status; no row silently skipped.

## TASK-05 — Retainer proof: no-rollover + rollover cycles (Phase 4; M1–M6)

- **Wave:** 2, after TASK-04's fixture section exists. **Depends on:** TASK-03, TASK-04(fixture).
- **Objective:** Prove or break the retainer math month-by-month on the golden
  ledger and reconcile all seven retainer consumers.
- **Inputs:** `convex/lib/{retainerBalance,retainerUsage,retainerCycle,reportPeriod,invoiceAnchor,invoiceCreation,readyToInvoice}.ts`,
  `convex/retainerPeriods.ts`, `convex/retainerCron.ts`, retainer branches in
  `convex/projects.ts` and `convex/invoices.ts`, `convex/statements.ts`,
  `components/document/retainer-usage-table.tsx`,
  `components/projects/{monthly-report-document,monthly-breakdown-card}.tsx`,
  retainer sections under `components/invoices/`, `lib/retainerLabels.ts`,
  `lib/retainer-row-action.ts`.
- **Method:**
  1. Verify M1 and M2 formulas against the fixture's retainer projects (one
     under-budget + one over-budget month; three-month rollover with unused m1,
     negative interim m2, cycle-end result m3, repeated task in all three).
     Show the month table: available/used/balance/overage per month, cycle
     totals; prove carryover is not double-counted.
  2. **H3:** specifically compute `statements.getRetainerStatement`'s footer on
     the fixture (does `sum(row.availableMinutes)` exceed contractual
     allocation?) and diff against the invoice path's frozen
     `retainerIncludedMinutes`. Confirm or reject with the 10h/5h illustrative
     scenario from the spec recomputed on real code.
  3. **M3:** verify overage timing (month close vs cycle close; current/future
     periods never shown as finally due).
  4. **M4:** diff the cycle-boundary/close-eligibility computation across all
     eight listed consumers (overview, breakdown, ready queue + nav badge, close
     mutations, invoice creation/refresh, invoice document, monthly report,
     worksheet); any divergence is a finding.
  5. **M5:** walk close → reopen → re-close, invoice → revert → void through the
     mutations; verify entry-set restoration and that void neither deletes
     history nor duplicates future billing.
  6. **M6:** classify every displayed retainer value into the five classes
     (live/invoice-rounded/invoice-snapshot/settlement-snapshot/derived) and
     flag UIs comparing unlike classes without explanation.
  7. Cover both retainer scenario-matrix groups (incl. December start, cycle
     across year boundary, partial first cycle, forfeiture, late entry after
     close) at code level.
  8. Fill the retainer rows of `03-reconciliation-matrix.md`.
- **Output:** retainer close/invoice/report graph in `results/01-system-map.md`;
  M1–M6 draft verdicts; findings (`F-RET-*`); retainer matrix rows.
- **Done when:** all seven consumers reconciled on the same fixture; H3
  confirmed/rejected; M1–M6 verdicts written.

## TASK-06 — Worksheet & AI proof (Phase 5; W1–W6)

- **Wave:** 2, after TASK-04's fixture section exists. **Depends on:** TASK-03, TASK-04(fixture).
- **Objective:** Prove deterministic entry membership of every worksheet type,
  then evaluate AI context scope, temporal honesty, identity, and failure
  behavior.
- **Inputs:** `convex/worksheets.ts`, `convex/worksheetsHelpers.ts`,
  `convex/lib/worksheetAi.ts` + `worksheetAi.test.ts`, `components/worksheet/*`
  (`ad-hoc-export-dialog`, `worksheet-export-button`, `worksheet-menu-item`),
  invoice/project worksheet entry points, `lib/csv.ts`,
  `lib/worksheet-period-presets.ts`, `lib/worksheet-toast.ts`,
  `lib/worksheet-view-export.ts`.
- **Method:**
  1. **W2 first (deterministic membership):** period worksheet = exact filter
     match; invoice worksheet = union of line-item `timeEntryIds`; cycle
     worksheet = exact union of monthly scopes, no dup/omission. Reconcile on
     the fixture; fill the worksheet rows of the matrix.
  2. **W1:** show the AI writes narrative only — grep every place AI output is
     stored/rendered and prove it cannot alter membership, durations, totals,
     rates, balances, overage.
  3. **H5/W3:** read `buildTaskRows` — is there a temporal cutoff at the period
     boundary for comments/subtasks/description edits? Can a July comment leak
     into a June worksheet? Fixture has comments before/after each boundary.
  4. **H4/W4:** determine the AI output key — `(taskId)` or `(period, taskId)`?
     Trace a cycle export with the fixture's repeated task: does month-3 text
     overwrite months 1–2 sections?
  5. **W5:** audit prompt construction for grounding; walk the fixture's
     prompt-injection note, contradictory comments, empty context, future
     comments through the prompt builder. Static analysis of the prompt +
     existing `worksheetAi.test.ts`; live provider calls are out of scope —
     write the missing tests into the TASK-10 handoff list.
  6. **W6:** trace skipped/failed/succeeded AI rows to the rendered totals and
     the fallback labeling; CSV export path through `lib/csv.ts` (verify formula
     escaping against the fixture's `=SUM`-prefixed note).
  7. Cover the "Worksheet AI" scenario-matrix rows at code level.
- **Output:** worksheet/AI graph in `results/01-system-map.md`; W1–W6 draft
  verdicts; findings (`F-WKS-*`); worksheet matrix rows.
- **Done when:** all three worksheet types reconcile to their source sets on the
  fixture; H4 and H5 confirmed/rejected with line evidence; W1–W6 verdicts written.

## TASK-07 — Rate model & configuration UX review (mandatory product review; H8–H10)

- **Wave:** 2u (browser-bound). **Depends on:** TASK-02's "verified rate
  hierarchy" brief; dev server + authenticated test org (available per owner).
- **Objective:** Produce the mandatory **"Rate model and configuration UX"**
  section of `04-findings.md`, exactly per the spec's "Required rate UX artifact"
  checklist.
- **Inputs (code):** `components/settings/settings-work-categories.tsx`,
  `components/settings/settings-user-rates.tsx`,
  `components/projects/settings-rates.tsx`, `components/rate-badge.tsx`,
  `components/onboarding/step-categories.tsx`, missing-rate error surfaces
  (`rg -n "missing.*rate|rate.*missing" components convex lib -i`).
- **Inputs (live):** `preview_start {name: "next-dev"}`; walk the nine mandatory
  workflows from the spec (work-category default bill rates; multi-currency
  create/edit; user cost rates; add/edit/remove currency rate; project inherited
  defaults; override; reset override; missing-rate block on timer/manual entry;
  inspect stored snapshots on an existing entry).
- **Method:**
  1. Answer the nine explainability questions **from the Settings UI alone**; if
     any answer requires source code, classify the UX as unsuccessful even if
     technically correct.
  2. Evaluate the twelve UI-quality bullets from the spec (editability
     affordance, hover-only Add, keyboard/touch discoverability, inherited vs
     overridden visibility, effective-vs-source, contextual currency list,
     actionable missing-rate states, typography hierarchy, whitespace,
     workspace/project consistency, currency-inheritance explanation,
     missing-coverage visibility).
  3. Verify **H8–H10** in the live UI; capture screenshots only where they
     materially support a finding (dummy data only).
  4. Propose: a user-by-active-currency coverage view + missing-rate UX; one
     low-complexity Settings exposure of the hierarchy and one contextual
     effective-rate exposure (task/timer preview/entry detail); one **minimal**
     and one **ideal** redesign preserving the locked domain model (no FX, no
     base currency); exact copy for titles, descriptions, source labels,
     missing-rate errors; migration implications of any integrity hardening.
  5. Honor known owner design rules: no bordered pill badges / "AI slop", reuse
     shared components, Notion-style patterns (see repo memory: quiet ghost
     buttons, muted counts).
- **Output:** the complete "Rate model and configuration UX" section in
  `results/04-findings.md` (all ten required sub-items from the spec), plus
  individual `F-UX-*` / `F-RAT-*` findings; screenshot inventory.
- **Done when:** all nine workflows exercised live, all ten artifact sub-items
  present, H8–H10 verdicts written.

## TASK-08 — Daily time-tracking UI/UX journey & failure recovery (Phase 6)

- **Wave:** 2u (browser-bound; after or before TASK-07, not concurrent if one
  Browser pane). **Depends on:** TASK-01 (writer semantics as ground truth).
- **Objective:** Exercise the complete daily journey in the running app and tie
  every UX finding to a risk of lost, duplicated, misdated, or misbilled time.
- **Inputs (code):** `components/timer-provider.tsx` (+ test), `components/timer/*`
  (floating widget, stale-timer dialog, commit form, display, today section),
  `components/time/*`, `components/tasks/{time-log-form,time-log-popover,time-entries-table,inline-time-cell}.tsx`,
  `components/projects/{time-entry-modal,time-entry-hours-cell,project-time*}.tsx`,
  `app/(dashboard)/my-time/page.tsx`, time surfaces in Tasks/My Tasks/Workday.
- **Inputs (live):** dev server + test org, in-app Browser pane.
- **Method:**
  1. Run the spec's nine-step journey (find task → start → identify scope →
     pause/resume/navigate → stop → confirm persistence → adjust → find entry in
     My Time/task/project Time → correct error → observe reporting/billing
     preview change).
  2. For every state answer the spec's twelve questions (running vs paused
     clarity, server vs local state, exact/rounded labeling, date/timezone
     clarity, billability, rate-source visibility, failure/recovery paths,
     double-submission, destructive confirmation, keyboard completeness,
     accessibility announcements, mobile via `resize_window` mobile preset).
  3. Execute the **UI columns** of the Timer + Manual entry scenario matrices
     where safely reproducible in a browser: double click stop, two tabs, tab
     closed before post-stop edit, task switch while running, missing rate at
     start, under-30s stop, browser reload mid-timer. Skip clock manipulation
     and DST live tests — verify those against TASK-01's code trace and mark
     "code-level only".
  4. Cross-check what the UI *claims* against what TASK-01 proved is *stored*
     (e.g. whole-minute ceiling presented as exact → finding under T4).
- **Output:** findings (`F-UX-*`, cross-referenced to T-invariants) in
  `results/04-findings.md`; scenario-matrix UI-column results appended to the
  relevant sections; screenshots only where material.
- **Done when:** journey completed end-to-end at desktop and mobile widths;
  every scenario row has a UI result or an explicit "code-level only" marker.

## TASK-09 — Scalability & concurrency (Phase 7)

- **Wave:** 1 (independent). **Depends on:** TASK-00.
- **Objective:** Determine whether correct behavior survives the spec's dataset
  targets (50 users, 100k entries/org, 1k tasks/project, 12-month cycle, large
  T&M invoice).
- **Method:**
  1. Sweep for the spec's ten smells:
     `rg -n "\.collect\(\)" convex` and classify each hit as bounded/unbounded
     (by index + filter); per-task N+1 entry reads (loops issuing queries);
     reactive invalidation amplification (broad subscriptions on hot tables);
     transaction read/write limits during close/invoice creation (count
     documents touched per mutation on the 100k-entry model); unbounded
     `timeEntryIds` arrays on invoice line items; duplicate subscriptions across
     daily UI surfaces (`rg -n "useQuery" components app` on timer/time
     surfaces); OCC conflict candidates (timer/rate/invoice hot documents);
     two admins closing/invoicing the same scope concurrently (idempotency
     guards in close/invoice mutations); duplicate AI calls per (task, period);
     action timeouts + provider rate limits during large worksheet exports.
  2. Use `npx convex insights` output from TASK-00 if available; state
     explicitly that absence of warnings is not proof.
  3. Consult `convex/_generated/ai/guidelines.md` limits section for the actual
     transaction/document limits of the installed Convex version.
  4. Recommend measurement/load tests before any invasive refactor — do not
     propose broad refactors.
- **Output:** findings (`F-SCL-*`) with concrete numbers ("close of a 12-month
  cycle with N entries reads ~X documents; limit is Y"); scale section notes for
  the roadmap.
- **Done when:** all ten smell categories swept with per-hit classification;
  worst-case document counts estimated for close and invoice creation.

## TASK-10 — Test inventory & test gap plan

- **Wave:** 1 for the inventory (10a); Wave 3 for the plan (10b, needs all
  findings). Can be one agent run twice or one run at the end doing both.
- **Objective:** Produce `05-test-gap-plan.md`.
- **Method:**
  1. **Inventory (10a):** classify every existing test touching the chain as
     pure-calculation / Convex-integration / component / E2E. (Baseline: zero
     Convex integration tests exist; `convex-test@0.0.53` is installed and
     unused.) State explicitly which invariants each existing test actually
     proves — a pure helper test does not prove callers pass correct scope.
  2. **Gap plan (10b):** for every Critical/High finding and every "not provable
     statically" matrix row, specify: exact test name, level (unit /
     convex-test integration / component / Playwright E2E), fixture/setup
     requirements, the assertion, and which finding it prevents. The centerpiece
     is the **executable golden-ledger harness**: a `convex-test` suite that
     seeds the TASK-04 fixture verbatim and asserts every reconciliation-matrix
     row — this converts the static traces into running proof (locked decision
     #2). Order the implementation (harness first, then per-finding regression
     tests). Every proposed test must fail before and pass after its
     recommended fix.
- **Output:** `results/05-test-gap-plan.md`.
- **Done when:** every Critical/High finding has a named preventing test; the
  golden-ledger harness is specified to the level of file layout, seed steps,
  and assertion list.

## TASK-11 — Synthesis: verdicts, roadmap, executive summary

- **Wave:** 3, last. **Depends on:** everything.
- **Objective:** Merge, deduplicate, and finalize.
- **Method:**
  1. Merge all draft verdict rows into `results/02-invariant-verdicts.md` — one
     row per invariant (T1–T8, R1–R5, A1–A5, M1–M6, W1–W6) with status, evidence
     links, linked finding IDs. Resolve conflicts by re-reading the cited code,
     not by averaging.
  2. Sort and renumber `results/04-findings.md` Critical → High → Medium → Low;
     keep confirmed defects separate from unverified hypotheses; verify every
     Critical/High has a deterministic reproduction scenario; verify each of
     H1–H10 has an explicit confirmed/rejected disposition somewhere.
  3. Write `results/06-remediation-roadmap.md` in the spec's five groups (before
     real users / before billing real clients / before scale / accepted product
     decisions / deferred polish), each item with impact, effort, dependencies,
     migration risk, and proof of completion.
  4. Write `results/07-executive-summary.md` answering the spec's eleven
     questions with unambiguous go/no-go language, top-five blockers, and the
     recommended sequence to production readiness. Qualify every "yes" with the
     static-trace limitation where the harness has not yet run.
  5. Run the spec's **Completion criteria** list as a final checklist; anything
     unmet is stated in the summary's limitations, not silently dropped.
- **Output:** final `02`, `04` (sorted), `06`, `07`.
- **Done when:** all eight deliverable files exist, are internally consistent,
  and the completion checklist is answered item by item.

---

## Scenario-matrix ownership map

| Spec scenario group | Code-level owner | UI-level owner |
|---|---|---|
| Timer | TASK-01 | TASK-08 |
| Manual entry | TASK-01 | TASK-08 |
| Rates | TASK-02 | TASK-07 |
| Retainer without rollover | TASK-05 | TASK-05 (doc surfaces) / TASK-08 (entry side) |
| Retainer with rollover | TASK-05 | TASK-05 |
| T&M | TASK-04 | TASK-04 |
| Worksheet AI | TASK-06 | TASK-06 |

## Hypothesis ownership map

| H | Owner | H | Owner |
|---|---|---|---|
| H1 timer rounding | TASK-01 | H6 numeric specials | TASK-01 + TASK-02 |
| H2 rate timing | TASK-02 | H7 rounding map | TASK-03 + TASK-04 |
| H3 statement footer | TASK-05 | H8 hierarchy comprehension | TASK-07 |
| H4 cycle AI overwrite | TASK-06 | H9 currency coverage audit | TASK-02 + TASK-07 |
| H5 AI future context | TASK-06 | H10 rate control discoverability | TASK-07 |

## Estimated effort (single orchestrated session, parallel waves)

Wave 0 ~15 min; Wave 1 four agents in parallel, longest (TASK-01/03) ~45–60 min
each; Wave 2 TASK-04 ~60–90 min then TASK-05/06 parallel ~45 min; Wave 2u two
browser tasks ~40 min each, sequential; Wave 3 ~45 min. Wall clock roughly
4–5 hours orchestrated; materially more as separate sessions.
