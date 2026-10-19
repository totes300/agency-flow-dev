# TASK-03 — Reader / filter / aggregation trace (Phase 3; A1–A5)

Reviewed at commit `660d28f` (branch `agentic`), worktree DIRTY: `convex/schema.ts` modified
(adds `timeEntries.skippedThrough`, schema.ts:406-418), untracked `convex/lib/billingScope.ts`
and `convex/lib/closeFlags.ts` (Month-Close slices, pure, **not yet imported by any Convex
function** — verified by `rg "billingScope" convex` → only self/closeFlags). All claims cite
current working-tree sources. Verdict vocabulary per plan rule 6; everything here is
static-trace only (locked decision #2).

---

## 01-system-map — Reader/aggregation graph + predicate inventory

### Sources of truth (explicit)

| Truth | Where | Consumed by |
|---|---|---|
| Raw ledger row | `timeEntries` doc: `date` (YYYY-MM-DD, org tz), `durationMinutes` (integer, minute-ceiled at write — `convex/lib/rounding.ts:6-10`, `timeEntries.create`:249, `update`:354, `lib/timerEntry.ts:52`), `isBillable`, `costRate`/`billableRate`/`rateCurrency` snapshots, `snapshotCategoryId` | every reader below |
| Lock axes | `invoiceId` (document linkage) + `settledAt/settledReason/settledPeriodStart/End` (closure axis) — schema.ts:380-404 | `entryStatus()` (`convex/lib/entryStatus.ts:37-42`), `billableOverviewBucket()` (`convex/lib/settleEntries.ts:229-234`), every billing filter |
| Canonical settled-by-invoice set | union of `invoiceLineItems.timeEntryIds` — NOT `entry.invoiceId == X` (`convex/lib/settleEntries.ts:9-25,47-70`; schema.ts:419-422) | settle/unsettle, invoice worksheet, invoice usage table |
| Admin close state | `retainerPeriods.closedAt` (`convex/retainerPeriods.ts`) | getRetainerData, ready feed, settleGuards, agentReports |
| Frozen invoice money | `invoices.retainer*` snapshots + line items (`convex/invoices.ts:1765-1774`) | invoice document footer (invoices.ts:2330-2337) |
| Cycle boundary math | `convex/lib/retainerCycle.ts:getCyclePeriods` + `convex/lib/retainerBalance.ts:getRetainerCyclePosition/StartMonth` + `convex/lib/readyToInvoice.ts:enumerateRetainerCycleState` (three implementations, comment-linked as "must stay aligned" — readyToInvoice.ts:417-424) | see M4 handoff |

### Reader graph (writer → ledger → consumers)

```
timeEntries ledger
├── Per-user daily:      listToday / sumMyToday (by_userId_date + orgId filter) → My Time page, My Tasks header
├── Per-task:            listByTask, sumByTasks, countMismatchedBillable, tasks.getTaskDetail.totalMinutes,
│                        tasks.getSubtasks timeMap  (by_taskId)
├── Per-project fan-out (tasks by_orgId_projectId → entries by_taskId):
│   ├── listProjectEntries → project Time tab (+ client-side lib/time-entry-filters, project-time-stats)
│   ├── projectOverview  → TM/Fixed overview cards, InvoiceBanner openAmount
│   ├── projectMonthlyBreakdown → Fixed/T&M monthly card
│   ├── projects.getSummary → ProjectSummaryCard (via lib/projectSummary pure calc)
│   ├── projects.getRetainerData → retainer overview + MonthlyBreakdownCard + PeriodDetailSheet context
│   ├── statements.getRetainerStatement → Monthly Report document
│   ├── invoices.enumerateReadyRows → Ready inbox + sidebar badge (lib/readyToInvoice pure)
│   ├── invoices.getClosedUninvoicedMonths → project InvoiceBanner / uninvoiced months
│   ├── invoices.createInvoice / collectRefreshableEntries / refreshInvoiceDraft (reader half)
│   ├── retainerCycle.sumBillableMinutes → close gates (retainerPeriods)
│   ├── worksheetsHelpers.resolveScopeEntries + buildTaskRows → all worksheet CSVs, timesheets.collectTimesheetData
│   └── agentReports.clientMonthlySummary / retainerHealthForMonth (per-client/project fan-out)
├── Org-date index (by_orgId_date):
│   ├── workday.weekGrid
│   └── agentReports.timeByMember / orgFinanceSnapshot (scanEntriesInRange)
├── Invoice-anchored:    worksheetsHelpers invoice scope (line-item union), invoices.getInvoice retainerUsage
└── NEW (unwired):       lib/billingScope.computeBillingScope (I1–I4 effective-period model, skippedThrough)
```

### Predicate inventory table

Legend — Read set: index used (all `by_taskId` reads fan out from tasks fetched via
`by_orgId_projectId` unless noted). Org: ✓ = explicit orgId filter/check on the entry read;
(task) = relies on the task's org check only. Rounding: "raw" = plain sum of
`durationMinutes`; "inv" = per-(category,task,rate) group `ceil(min/roundTo)` then
`round2(h×rate)`; "r2" = cents rounding of the aggregate.

| # | Function (file:line) | Read set / index | Org scoping | Entry predicate | Date semantics | Billability | Draft/settled semantics | Rate source | Rounding | Consumers / same-label siblings |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `timeEntries.listByTask` (timeEntries.ts:40) | by_taskId | ✓ (:51) + task check (:46) | all entries of task; **member → own only** (:55-57) | none | all | fields ride along | stored snapshot | raw | task detail time list; sibling of #3, #22 |
| 2 | `timeEntries.listToday` (:81) | by_userId_date | ✓ (:95) | caller's entries, `date == today(orgTz)` | org-tz today (:88) | all | none | n/a | raw | My Time page list+total (page sums client-side, my-time/page.tsx:18) |
| 3 | `timeEntries.sumByTasks` (:119) | by_taskId per task (≤100) | ✓ (:139) + task check (:134) | all entries of task — **NOT member-scoped** | none | all | none | n/a | raw | Tasks / My Tasks time cells; conflicts with #1's member scoping (F-AGG-05) |
| 4 | `timeEntries.sumMyToday` (:150) | by_userId_date | ✓ (:163) | caller's today entries | org-tz today | all | none | n/a | raw | My Tasks "today" header |
| 5 | `timeEntries.sumByProject` (:170) | fan-out | ✓ (:194) | all project entries | per-`date` histogram | all | none | n/a | raw | (project header) |
| 6 | `timeEntries.countMismatchedBillable` (:523) | by_taskId | ✓ (:537) | `isBillable != target` | none | both | includes locked entries in count | n/a | count | task billable-toggle dialog |
| 7 | `timeEntries.listProjectEntries` (:618) | fan-out | ✓ (:668) + invoice map guard (:708) | project entries; **member → own only** (:675-677); filters memberId / billingStatus (open/draft/closed/non_billable mirroring `entryStatus`) / search / fromDate/toDate | `date` string range | axis: `non_billable` beats settlement (:791-803) | open=`!invoiceId&&!settledAt`, draft=`invoiceId&&!settledAt`, closed=`settledAt` | stored snapshot (returned per row) | raw | project Time tab rows; feeds client stats #30 |
| 8 | `timeEntries.projectOverview` (:840) | fan-out | ✓ (:863) | all project entries (archived tasks included) | `date` month-keys; "this month" = org-tz today (:876) | split | 4 buckets via `billableOverviewBucket` (:951-975): open/draft/invoiced(`settledReason=="invoiced"`)/settled(retainer/fixed_included) | stored snapshots; category = `snapshotCategoryId` (:867) | minutes raw; **openAmount = inv rounding** (:990-994, workspace default); other bucket amounts raw; `totalActualCost` raw float (:941) | TM/Fixed overview, InvoiceBanner. Siblings: #13 (unbilled), #30 (Open Amount), invoices tab Total Invoiced (comment :1044-1046) |
| 9 | `timeEntries.projectMonthlyBreakdown` (:1067) | fan-out | ✓ (:1097) | all project entries | month = `date.slice(0,7)` | split | none (voided/invoiced all count) | `billableRate` snapshot | raw (`totalAmount` float, :1127-1130) | Fixed/T&M monthly card; sibling of #12 months + #14 groups |
| 10 | `timer.getState` (timer.ts:28) | users doc | task org check (:38) | timer fields only, no entries | n/a | task.billable | n/a | n/a | n/a | floating timer widget |
| 11 | `timer.previewRateForTask` (timer.ts:105) | rate tables | ✓ | none | n/a | task.billable | n/a | resolveRateSnapshot (live) | n/a | timer/entry form warnings |
| 12 | `projects.getRetainerData` (projects.ts:507) | fan-out | **✗ — no orgId filter on entry read (:582-596)**; project+tasks org-scoped | all project entries | cycle months via `getCyclePeriods` (org-tz today :541); month = `date.slice(0,7)` | split | ignores invoiceId/settledAt for usage; overage-due excludes invoice-anchored months (:800-833); `periodEnded` calendar vs `isClosed` admin (:721-724) | n/a (minutes only) + `overageRate` | raw minutes; `overageDue` **unrounded** float (:820,830) | retainer overview, MonthlyBreakdownCard. **Member-callable, returns monthlyFee/overageDue** (F-SEC-02) |
| 13 | `projects.getSummary` (projects.ts:888) → `lib/projectSummary.ts` | fan-out | ✓ (:923) | all project entries; T&M date-range preset (org-tz today :941) | `date` in [from,to] inclusive (projectSummary.ts:500-505) | split | "billed" = `invoiceId OR settledAt` (projectSummary.ts:201-203); retainer overage: rollover=pooled cycle, non-rollover=Σ per-ended-month excess (:439-446) | stored snapshots | **raw everywhere** (projectSummary.ts:9) | ProjectSummaryCard; member gets timeBreakdown only (:223-231 etc.) |
| 14 | `statements.getRetainerStatement` (statements.ts:151) | fan-out (single pass :199-209) | ✓ (:205) + admin gate (:158) | all project entries in month; cycle-to-date over cycle range (:358-363) | `date` in [periodStart,periodEnd]; month grid via `getRetainerCyclePosition` | split (billable drives balance; non-billable listed) | **ignores invoice/settled state** — live re-derivation by design (:14-16, :211-215) | n/a | raw; overage `round2` (:296,392,408); **footer availableMinutes = Σ row.available (:450) — carryover double-count, H3** | Monthly Report document; sibling of invoice usage table (#19) |
| 15 | `invoices.getInvoiceMetrics` (invoices.ts:299) | invoices by_orgId | ✓ + admin | invoice-derived only | dueDate vs org-tz today; paid month org-tz (:344) | n/a | void excluded | n/a | r2 per currency | /invoices metric cards |
| 16 | `invoices.enumerateReadyRows` (:443) → `lib/readyToInvoice.ts` | fan-out per project | ✓ (:554,599) | billable, `!invoiceId`, `!settledAt` (readyToInvoice.ts:271-273); month ended (`mEnd < today`, :277-279); retainer via `enumerateRetainerCycleState` (:446-519, `isClosed = mEnd < todayStr` :475) | org-tz today (invoices.ts:690) | billable only | settled/invoiced excluded; admin-closed months drop close rows | `billableRate` snapshot | inv rounding per group + roundCents (readyToInvoice.ts:297-301) | Ready inbox `getReadyToInvoiceUnified` (:684) + sidebar badge `getInvoicingNavSignals` (:712) — same helper, cannot drift |
| 17 | `invoices.getProjectInvoiceMetrics` (:769) + `getClosedUninvoicedMonths` (:1079) | invoices + fan-out | ✓ | overage months: same `enumerateRetainerCycleState`; skips entirely when `overageRate === 0` (:1090) | org-tz today | billable only | anchor-month dedup vs non-void invoices (:1139-1144) | overageRate | r2 per month + summed r2 (:871-873) | project Invoices tab, InvoiceBanner |
| 18 | `invoices.createInvoice` (reader half, :1209) | fan-out | ✓ (:1318) | billable ∧ `invoiceId===undefined` ∧ (`settledAt===undefined` ∨ retainer `settledReason=="retainer_included"`) (:1320-1337); date ∈ effective period; Path B explicit IDs deduped (:1441) | retainer: month/cycle bounds (:1353-1388); T&M/Fixed: min/max entry dates (:1521-1529) | billable only | see predicate | `billableRate` snapshot per group | **inv**: group `(cat,task,rate)` T&M / `(cat,task)` retainer+fixed (:1494-1496); `roundMinutesUp(minutes, effectiveRounding)`; retainer forced rounding=1 (:1545-1548); r2 line + r2 subtotal (:1596-1600,1732) | draft invoice |
| 19 | `invoices.getInvoice` (:2132) | line items + entry gets | ✓ incl. identifier resolution (lib/invoiceIdentifier.ts:34-66) | retainerUsage rows: entries from line-item `timeEntryIds` (:2295-2308); per-month raw then `reconcileUsedMinutesToTotal` to frozen snapshot (:2313-2317) | invoice periodStart/End month range | billable only (:2305) | **footer = frozen snapshot** (:2330-2337) | frozen invoice fields | snapshot totals; per-month distribution proportional (retainerUsage.ts:121-160) | invoice document; sibling of #14 (same component via lib/retainerLabels) |
| 20 | `invoices.collectRefreshableEntries` (:1907) | fan-out | ✓ (:1927) | billable ∧ unstamped ∧ unsettled; retainer+T&M bounded to stored period, Fixed periodless (:1939-1952) | invoice period | billable only | open only | snapshot | raw (count/minutes) | staleEntries signal + refreshInvoiceDraft (merge math :2050-2062 = inv rounding on merged raw) |
| 21 | `worksheetsHelpers.resolveScopeEntries` (worksheetsHelpers.ts:282) | invoice: line-item union (:296-312); period/cycle: fan-out (:348-377) | ✓ every doc (:289,293,304,309,362-370) + admin gate (:204) | period: `date ∈ [start,end]` + optional billable filter + **task-level category filter (current `task.workCategoryId`, :356-364)** | date string range | filterable | ignores invoice/settled state (period scope) | n/a | raw; H:MM formatting only | all worksheet CSVs |
| 22 | `worksheetsHelpers.buildTaskRows` (:383) | per-task comments/subtasks/full-lifecycle entries (:433-481) | ✓ (:407,418,451,477) | hours from scoped entries; **AI input = ALL comments (no period cutoff :445-453), all subtasks, full-lifecycle entry notes (:473-481, deliberate)**; `categoryName` = **current task category (:486)** | scoped for money; unscoped for AI | split | n/a | n/a | raw | worksheet rows + AI context (H5/W3 → TASK-06) |
| 23 | `worksheetsHelpers.collectCycleWorksheetData` (:748) | fan-out per month (re-fetches tasks per month, :797-813) | ✓ (:756,763,809) | month sections `date ∈ month`; rollover ledger via `buildRetainerUsageRows` (:840-857) | **`todayStr = new Date().toISOString()` — UTC, not org tz (:777)** | split | ignores settlement | n/a | raw; H:MM | full-cycle CSV (F-AGG-03) |
| 24 | `timesheets.collectTimesheetData` (timesheets.ts:54) | #21+#22 per client project | ✓ + admin (:72-76,116) | same as #21 | period args | filterable | same | n/a | raw; pivot cells = task totalMinutes (timesheetPivot.ts:118-123) | agent timesheet table |
| 25 | `agentReports.timeByMember` (agentReports.ts:187) | by_orgId_date scan, cap 20k (:159-175) | ✓ index | entries of target users; member force-scoped to self (:213-214) | fromDate–toDate ≤366d | split | none | n/a | raw | agent tool |
| 26 | `agentReports.clientMonthlySummary` (:272) | fan-out per client project | ✓ (:334) + admin | date ∈ month range | month keys | split | none | `billableRate` snapshot | raw minutes; `billableAmount` r2 per month + totals (agentReportCore.ts:274-283) | agent tool |
| 27 | `agentReports.retainerHealthForMonth` (:408) | fan-out per retainer project | ✓ (:479) + admin | billable per month; due-ness: `periodEnded && balance<0 && !coveringInvoice` (:560,578) — matches #12's rule | org-tz today (:425) | billable | admin close via retainerPeriods (:507-513) | overageRate | raw; overageAmount r2 (:604) | agent tool |
| 28 | `agentReports.orgFinanceSnapshot` (:661) | by_orgId_date scan + invoices by_orgId | ✓ + admin | all entries in range | issueDate range for invoices | split | invoice draft/final split; void excluded | cost+billable snapshots **per rateCurrency** (agentReportCore.ts:390-397) | raw; r2 at output | agent tool |
| 29 | `workday.weekGrid` (workday.ts:68) | **by_orgId_date** (:131-136), take-cap 10k | ✓ index | entries in date range; member force-scoped to self (:84-86) | date strings; day iteration UTC-safe (:54-66) | all | none | n/a | raw | Workday grid |
| 30 | client: `ProjectTimeStats` (components/projects/project-time-stats.tsx:26-63) | rows from #7 (date-filtered — Time tab defaults to **This month**, lib/date-buckets.ts:29) | inherits | `entryStatus(e)==="open"` (:42) | visible range | billable | open only | `billableRate` from rows | **raw** `Σ min/60×rate` (:44) | Time tab "Open Amount" — same label family as #8 openAmount (inv-rounded, all-time) |
| 31 | `tasks.getTaskDetail` totalMinutes (tasks.ts:81-85), `getSubtasks` timeMap (:143-150) | by_taskId | **✗ no orgId filter on entries** (task org-checked earlier) | all entries incl. other users' | none | all | none | n/a | raw | task detail header, subtask rows |
| 32 | `retainerCycle.sumBillableMinutes` (retainerCycle.ts:185-228) | fan-out | ✓ (:212) | billable ∧ date ∈ period; grouped `(snapshotCategoryId, task)` | period bounds | billable | ignores settlement (deliberate — close gate counts ALL billable work, cf. createInvoice comment invoices.ts:1325-1336) | n/a | raw (rounding param always 1) | close/cycle-close gates (retainerPeriods) |
| 33 | `retainerPeriods.closePeriodInternal` (retainerPeriods.ts:290-339) | fan-out | ✓ (:318) | `shouldSettleEntry`: date ∈ period ∧ !settledAt ∧ !invoiceId (:189-199); settles billable AND non-billable | period bounds | both | writer of `retainer_included` stamps | n/a | n/a | close mutations (A5 write side) |
| 34 | `settleEntries.backfillSettledFromInvoiceId` (convex/settleEntries.ts:40-44) | **full-table `.collect()`** | internalMutation (not public) | migration one-shot | — | — | — | — | — | TASK-09 note |
| 35 | NEW `lib/billingScope.computeBillingScope` (billingScope.ts:396) | pure (caller feeds docs) | caller's duty | I1 effective period = max(natural, after-skip, firstOpen); I4 closed → stamps (:437-439,543-578); T&M billable-only, retainer incl. non-billable | period grid (monthly/cycle, :237-247) | per I2 | open iff `!invoiceId && !settledAt` (:268-272) | `billableRate` snapshot | T&M amount = inv rounding, mirrors createInvoice (:595-620) | **UNWIRED** — Month-Close in progress; introduces a 3rd membership model (carry-forward) that intentionally diverges from every shipped date-based reader. Flagged for TASK-04/05 awareness |

Client-side pure helpers (no new predicates, verified consistent): `lib/date-buckets.ts`
(string-math bucketing, org-tz today via Intl :87-89), `lib/time-entry-grouping.ts` (group sums
raw, same sort as server), `lib/time-entry-filters.ts` (facets reuse `entryStatus`),
`lib/worksheet-view-export.ts` (maps visible Time-tab filters onto export; member+search
deliberately dropped :21-23 — exported worksheet can differ from the FILTERED view a member/admin
sees when member/search filters are active; documented, view default range preserved).

---

## 02-invariant-verdicts — A1–A5 (draft)

| Inv | Verdict (draft) | Evidence / notes |
|---|---|---|
| **A1** Raw time conservation | **partially proven (by trace)** | Every aggregate in the inventory sums stored `durationMinutes` with no minute rounding (rows above, "raw"). Two qualifications: (1) the ledger itself is minute-ceiled at write (`lib/rounding.ts:6-10`; H1/T4 — TASK-01's finding, not a reader defect); (2) "identical explicit scope" is NOT identical across surfaces for non-admins — `sumByTasks` (timeEntries.ts:119) and `tasks.getTaskDetail` (tasks.ts:85) total ALL users while `listByTask`/`listProjectEntries` show a member only their own rows (F-AGG-05); (3) the invoice document's per-month used-minutes rows are a proportional redistribution, not raw sums (`reconcileUsedMinutesToTotal`, retainerUsage.ts:121-160) — footer conserves, rows are derived. Full numeric proof → golden fixture (TASK-04). |
| **A2** Cost calculation | **proven (by trace)** | `Σ (durationMinutes/60 × costRate)` verbatim at timeEntries.ts:941, projectSummary.ts:192/292/428, agentReportCore.ts:394/417. Monetary rounding point: none server-side on overview/summary (raw float shipped to UI formatter); agent reports `round2` at final aggregate only (agentReportCore.ts:42-44,470-489). No path rounds minutes before costing. Cross-currency: only `orgFinanceSnapshot` mixes projects and it partitions per `rateCurrency` (agentReportCore.ts:390-397); project-scoped surfaces rely on the D1 single-currency invariant (schema.ts:346-360). |
| **A3** T&M value | **proven (by trace), with A4-relevant caveat** | Raw formula at projectSummary.ts:196, timeEntries.ts:952/1127-1130, agentReportCore.ts:250. Invoice-time divergence is deterministic and reproducible: group by `(category, task, billableRate)` → `roundMinutesUp(min, rounding)` → `round2(h×rate)` (invoices.ts:1494-1600). Preview surfaces intentionally run invoice math (projectOverview.openAmount timeEntries.ts:990-994; ready rows readyToInvoice.ts:297-301; billingScope.ts:595-620). The difference is explicit in code but **not labeled in the UI** (H7 / F-AGG-04). |
| **A4** Filter equivalence | **violated** | Five concrete divergences with same/similar product labels: F-AGG-01 (statement vs invoice footer "available"), F-AGG-02 (category attribution snapshot vs current), F-AGG-03 (cycle worksheet UTC today), F-AGG-04 ("Open Amount" raw+date-scoped vs invoice-rounded all-time; overview "invoiced" entry-derived vs Invoices tab invoice-derived), F-AGG-05 (member-scoped rows vs all-user totals). Each locally correct; the pairs disagree. |
| **A5** Canonical closed scope | **partially proven (by trace)** | Proven immutable: invoice documents — footer from frozen `invoice.retainer*` snapshots (invoices.ts:2330-2337), membership from line-item `timeEntryIds` union (settleEntries.ts:47-70; worksheetsHelpers.ts:296-312). Live-by-design: Monthly Report re-derives from live entries every render (statements.ts:14-16 "Reports are NOT entities… D7 no period locking") — stability after close rests on write guards, not stamps: settled entries can't be edited/deleted (timeEntries.ts:339-346,501-507), bulk toggle skips locked (:573-574), and closed/invoiced retainer periods reject new/moved/backdated entries (`assertEntryDateOpen` — settleGuards.ts:44-108, called from create:264, update:427-438, timerEntry.ts:76-87). Residual gap: the guard is retainer-only by design (settleGuards.ts:10-16); closed-scope stamps exist (`settledPeriodStart/End`) but **no shipped reader derives membership from them** — the unwired `billingScope` I4 (billingScope.ts:543-578) is the first. Not provable further without the fixture/harness. |

---

## 04-findings

### [F-AGG-01] Monthly Report footer sums carryover-inflated "available" while invoice footer uses contractual allocation (H3 — confirmed at code level)

- Severity: High
- Confidence: Confirmed (static trace; fixture arithmetic → TASK-05)
- Affected invariant(s): A4, M2, M6, H3
- Location: `convex/statements.ts:450` (`availableMinutes: usageRows.reduce((sum,row)=>sum+row.availableMinutes,0)`); rows built by `buildRetainerUsageRows` where `availableMinutes = monthlyIncluded + carryover` (`convex/lib/retainerUsage.ts:94-107`); invoice counterpart `convex/invoices.ts:2330-2337` uses frozen `invoice.retainerIncludedMinutes` (= monthly × cycleLength, invoices.ts:1644-1646)
- Affected workflow: retainer / report
- User/business impact: for any rollover cycle with a positive month-1 balance, the Monthly Report's "Total available" exceeds the contractual allocation (spec's 10h/5h example: rows 10h+15h → footer 25h vs contractual 20h), while the invoice for the same cycle shows 20h. Client-facing documents disagree; the report overstates what the client bought.
- Reproduction: 2-month rollover cycle, included 10h/mo, month1 used 5h, month2 used 0 → statement `retainerUsage.total.availableMinutes = 25h`; invoice for same cycle shows 20h.
- Expected: footer available = contractual allocation (Σ monthly included), per M2.
- Actual: footer = Σ per-row available (each row re-counts carryover).
- Root cause: footer aggregates a running-balance column.
- Existing test coverage: none (no test asserts the statement footer).
- Missing test: fixture cycle with carryover asserting `total.availableMinutes === includedMinutes × cycleLength`.
- Recommended fix: compute footer available as `includedMinutes × rows.length` (or last row's cumulative allocation), leaving rows unchanged.
- Migration/backfill: none (computed at read).
- Verification: golden-ledger harness row "Monthly report footer".

### [F-AGG-02] Category attribution diverges: entry snapshot vs current task category

- Severity: High
- Confidence: Confirmed
- Affected invariant(s): A4, W2 (worksheet), R3-adjacent
- Location: snapshot-based: `timeEntries.projectOverview` (timeEntries.ts:867,933), `projectMonthlyBreakdown` (:1103), `statements.groupByCategory` (statements.ts:222-236), `createInvoice` grouping (invoices.ts:1340,1494-1496), `getRetainerData` (projects.ts:592). Current-task-based: `worksheetsHelpers.buildTaskRows` `categoryName(task.workCategoryId)` (worksheetsHelpers.ts:486) and the worksheet **category filter** (:356-364, comment admits the choice), `timesheets` pivot columns (via same rows), `workday.weekGrid` (workday.ts:185-199).
- Affected workflow: report / worksheet / T&M
- User/business impact: after a task's category changes with history (a required golden-ledger oddity), the project Monthly Breakdown / Monthly Report bucket old hours under the OLD category while the worksheet/timesheet for the same month bucket the same hours under the NEW category. Category-filtered worksheets can also include/exclude different entry sets than any snapshot-based surface. Client sees two documents for the same month with different category subtotals.
- Reproduction: log entries under category A; change task to category B; export month worksheet and render Monthly Report for the same month.
- Expected: one attribution rule (or an explicit label difference).
- Actual: two rules across same-label surfaces.
- Root cause: worksheet path deliberately reads live task category (comment worksheetsHelpers.ts:356-361) while financial surfaces use `snapshotCategoryId`.
- Existing test coverage: none crossing the two paths.
- Missing test: fixture "task category change after history" reconciled across breakdown vs worksheet.
- Recommended fix: product decision + one rule; minimally, worksheet rows should use `snapshotCategoryId` for the money-bearing grouping or label the column "current category".
- Migration/backfill: none.
- Verification: matrix rows "Monthly worksheet totals" vs "Project monthly breakdown".

### [F-AGG-03] Cycle worksheet resolves "today" in UTC, not org timezone

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): A4, M4, W2
- Location: `convex/worksheetsHelpers.ts:777` `const todayStr = new Date().toISOString().slice(0, 10);` feeding `resolveCycleMonths` → `getCyclePeriods`; every sibling consumer resolves today via `getDateInTimezone(Date.now(), orgTz)` (e.g. projects.ts:541, invoices.ts:690, statements.ts:173).
- Affected workflow: worksheet / retainer
- User/business impact: for Europe/Budapest (UTC+1/+2), between local midnight and 01:00/02:00 on the 1st of a month, the cycle export's `getCyclePeriods` sees the previous month as "today" — `isCycleClosed`/offset search can resolve a different cycle than the Monthly Breakdown card the admin is looking at. (Bounded impact: `resolveCycleMonths` matches by `cycleStart`, so the month LIST is usually right; the mismatch window affects offset resolution/fallback and any closed-flag consumers.)
- Reproduction: freeze clock at 2026-08-01T00:30 Europe/Budapest; export cycle worksheet vs breakdown card.
- Expected: same org-tz today rule everywhere.
- Actual: one UTC outlier.
- Root cause: missed `getOrgSettings` timezone plumb-through.
- Missing test: unit test injecting todayStr.
- Recommended fix: use `getDateInTimezone(Date.now(), orgSettings.timezone)` (settings already fetched at :767).
- Verification: code diff + cycle-boundary fixture case.

### [F-AGG-04] Three different "open/unbilled" amounts with the same product label

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): A4, A3, H7
- Location: (a) project Time tab "Open Amount" = raw Σ over the **visible date range (default This month)** of `entryStatus==open` rows — `components/projects/project-time-stats.tsx:42-53` + default range `lib/date-buckets.ts:29`; (b) T&M overview / InvoiceBanner `openAmount` = **all-time** open entries with **invoice rounding** (workspace default) — `convex/timeEntries.ts:899-906,966-974,990-994`; (c) ProjectSummaryCard `unbilledAmount` = raw, range-preset scope — `convex/lib/projectSummary.ts:196-209`. Related: overview `invoicedAmount` is entry-derived raw (timeEntries.ts:952-957) while the Invoices tab "Total Invoiced" is invoice-derived (invoices.ts:798-817) — acknowledged in code (timeEntries.ts:1041-1046) but not on screen.
- Affected workflow: T&M / report / UI
- User/business impact: an owner sees three "open/unbilled" numbers on one project that disagree by (i) date scope and (ii) rounding, with no on-screen explanation; erodes trust in the promised invoice amount.
- Reproduction: T&M project, entries in two months, workspace rounding 15m; open Overview, Summary card, Time tab.
- Expected: same label ⇒ same number, or explicit qualifiers ("this month", "rounded as invoiced").
- Actual: three predicates.
- Root cause: deliberate per-surface choices, never reconciled at label level.
- Missing test: matrix rows "Project Time filtered/unfiltered totals" vs "Project overview value" vs "T&M draft amount".
- Recommended fix: label copy (cheapest) or unify scope; keep invoice-identical math for anything called "ready to bill".
- Verification: TASK-04 matrix + TASK-08 UI pass.

### [F-AGG-05] Member-visible entry lists don't reconcile with the totals shown next to them

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): A4, A1
- Location: member-scoped rows: `listByTask` (timeEntries.ts:55-57), `listProjectEntries` (:675-677); all-user totals shown to the same member: `sumByTasks` (:119-148, no member filter), `tasks.getTaskDetail.totalMinutes` (tasks.ts:81-85), `tasks.getSubtasks` timeMap (tasks.ts:143-150), `projectOverview`/`projectMonthlyBreakdown` (no role scoping).
- Affected workflow: UI / report
- User/business impact: a member opens a task: the time cell says 12h (whole team) but the visible entries sum to 3h (their own) — looks like lost time; support burden and mistrust of ledger.
- Reproduction: two users log on one task; view as member.
- Expected: either totals scoped like the rows, or an explicit "team total" label.
- Actual: silent mismatch.
- Root cause: per-query visibility decisions never reconciled.
- Missing test: component-level assertion of row-sum == displayed total per role.
- Recommended fix: product decision; likely label ("Team total") or scope `sumByTasks` by role.
- Verification: TASK-08 UI journey step 7.

### [F-AGG-06] Invoice document per-month usage rows are proportionally redistributed, not ledger sums

- Severity: Low (informational; M6 classification)
- Confidence: Confirmed
- Affected invariant(s): M6, A1 (qualified)
- Location: `convex/invoices.ts:2310-2317` + `convex/lib/retainerUsage.ts:121-160` (`reconcileUsedMinutesToTotal`: proportional scale, drift onto largest bucket; if raw sum is 0, entire total dumped on last month :135-139).
- Impact: invoice per-month "used" can differ from the Monthly Report's raw per-month used for the same months; footer is exact. If line items were manually edited so raw entries sum to 0, the whole used total lands on the final month.
- Recommended handling: classify rows as "derived presentation values" (they are, per design decision 2026-05-03 Q1); TASK-05 to verify fixture arithmetic and flag any UI that shows both without explanation.

### [F-SEC-01] `by_taskId` entry reads without org filter in three readers (defense-in-depth gap, not an exposure)

- Severity: Low
- Confidence: Confirmed (gap); Hypothesis (exploitability — none found)
- Affected invariant(s): tenancy rule (AGENTS.md "org-scoped indexes for lists")
- Location: `projects.getRetainerData` entry fan-out has **no** `.filter(orgId)` and no per-entry check (projects.ts:582-596); `tasks.getTaskDetail` (tasks.ts:81-85); `tasks.getSubtasks` (tasks.ts:143-150). Contrast: every other fan-out filters (e.g. timeEntries.ts:661-669 with explicit CLAUDE.md comment, statements.ts:199-209, projects.getSummary:917-927, retainerCycle.ts:212).
- Impact: none currently exploitable — tasks are fetched via org-scoped index and every writer stamps `orgId = auth.orgId` after checking `task.orgId === auth.orgId` (timeEntries.ts:234-235,279-296; timerEntry.ts:89-106), so a cross-org entry on an in-org task cannot exist. It is an invariant-by-writers, not invariant-by-readers; one future writer bug turns these three into cross-tenant leaks.
- Recommended fix: add the same `.filter((q)=>q.eq(q.field("orgId"), orgId))` used elsewhere.
- Missing test: convex-test seeding a forged cross-org entry directly via `t.run` and asserting these queries exclude it.

### [F-SEC-02] Member-callable queries expose financial data the permission model reserves for admins

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): tenancy/role model (projectSummary.ts:12-13 "Member role receives only the Time Breakdown"; AGENTS.md "hidden UI is not a security boundary")
- Location: `projects.getRetainerData` — `getAuthContext` only (projects.ts:513), returns `monthlyFee`, `overageRate`, `overageDue`, full cycle economics (:841-864) to any org member. `timeEntries.projectOverview` — `getAuthContext` only (:843), returns `totalActualCost` (internal labor cost, :941/1040), `openAmount/draftAmount/invoicedAmount/settledAmount` (:1047-1054) to any member. `timeEntries.projectMonthlyBreakdown` (:1069) returns `totalAmount` revenue per month to members. Contrast: `projects.getSummary` deliberately strips billing/profitability for members (projectSummary.ts:223-231,331-338,458-466); UI hides via `isAdmin` prop only (app/(dashboard)/projects/[id]/page.tsx:31,218-234).
- User/business impact: any member of the org can read client fees, overage rates, project revenue and **internal labor cost** by calling public queries directly (browser console) — data the product's own permission model treats as admin-only.
- Reproduction: as a member, `convex.query(api.timeEntries.projectOverview, {projectId})`.
- Expected: member responses omit cost/amount fields (getSummary pattern).
- Actual: full financial payload.
- Root cause: role gating implemented in one dispatcher but not in the older sibling queries.
- Missing test: convex-test role matrix per query.
- Recommended fix: apply the `isAdmin` field-stripping pattern of `getSummary` to `projectOverview`, `projectMonthlyBreakdown`, `getRetainerData` (member keeps minutes-only view).
- Migration/backfill: none.
- Verification: role-matrix test; UI unaffected for admins.

### Tenancy sweep result (F-SEC scope, all ID-based reads checked)

Verified ownership check after `db.get` before return/relate/mutate in: `listByTask`
(timeEntries.ts:45-46), `sumByTasks` (:133-134), `create`/`update`/`remove`/`bulkUpdateBillable`
(:234-235,327-328,391-394,493-494,553-554), `listProjectEntries` (:646-648, invoice map :706-710),
`projectOverview`/`projectMonthlyBreakdown` (:845-846,1072-1073), `timer.*` (timer.ts:37-38,68-69,
110-111,191-193,342-352), `statements.getRetainerStatement` (:164-169, cats :228), worksheets
(worksheetsHelpers.ts:207-215,287-312,362-370,407,417-418,451,756-764,809), timesheets
(timesheets.ts:74-76,116), agentReports (normalizeId + org check :293-299, per-doc guards
:110-134,452-456), invoices (identifier resolution lib/invoiceIdentifier.ts:40-63; list
denormalization guards invoices.ts:139-140,254-256; line-item/category guards :2161-2167,
2209-2216; entry gets :2304-2305), workday (org-scoped index + per-doc guards :148-199),
settle helpers (settleEntries.ts:60-67,150-163). No cross-org read path found. Only gaps: F-SEC-01
trio. `getInvoice` line-items read is keyed by an already-org-verified invoice — safe.

---

## H7 rounding map (draft — TASK-04 to finalize per surface)

Stages of a minute from ledger to document:

| Stage | Rule | Locations |
|---|---|---|
| **Write (ledger)** | ceil raw to whole minute; `roundMinutes(raw, 1)`; workspace rounding NEVER touches ledger | lib/rounding.ts:6-10; timeEntries.ts:249,354; lib/timerEntry.ts:48-55; timer stop <30s discarded (timer.ts:211), 16h cap (timer.ts:185, lib/timerEntry.ts:163-167) |
| **Raw-minute surfaces** (no further rounding) | plain Σ durationMinutes | listToday/sumMyToday/sumByTasks/sumByProject; listProjectEntries; projectOverview minute fields; projectMonthlyBreakdown; getSummary (projectSummary.ts:9 "NO rounding anywhere"); getRetainerData; statements rows; worksheets/timesheets (H:MM format, exact); agentReports; workday |
| **Raw-money surfaces** (Σ min/60×rate, float; UI formats) | no round2 server-side | projectSummary amounts; projectOverview cost + draft/invoiced/settled amounts (timeEntries.ts:941,952); breakdown totalAmount (:1127-1130); project-time-stats.tsx:44; getRetainerData overageDue (projects.ts:820,830 — unrounded) |
| **round2-at-output surfaces** | cents rounding of final aggregate only | agentReportCore.ts:274-283,464-489; statements overage (statements.ts:296,392,408); getProjectInvoiceMetrics (invoices.ts:809-812,871-873); readyToInvoice roundCents (readyToInvoice.ts:689-691) |
| **Invoice math** (the only minute-rounding step in the system) | group by `(category, task, rate)` (T&M) / `(category, task)` (retainer+fixed) → `roundMinutesUp(groupMinutes, roundingMinutes)` → hours=round2(min/60) → amount=round2(min/60×rate) → subtotal=round2(Σ) | createInvoice invoices.ts:1483-1600,1732; updateInvoiceRounding :1853-1889 (allowed increments 0,1,5,6,15,30 :1824); refresh merge :2050-2074 (re-rounds merged raw — no double rounding); recalc via quantityMinutes raw source :964-978 |
| **Retainer exception** | retainer invoices forced rounding=1 (raw) so meters/gates/invoice agree | invoices.ts:1541-1548; updateInvoiceRounding rejects retainer :1840-1845; retainerBalance.ts:76-105 |
| **Invoice-identical previews** | same group+round math so promise == draft | projectOverview.openAmount (timeEntries.ts:904-906,966-974,990-994); buildTmReadyRows (readyToInvoice.ts:246-301); billingScope.computeTmAmount (billingScope.ts:588-620, unwired) |
| **Derived presentation** | proportional redistribution of frozen used total across months | invoices.ts:2310-2323 + retainerUsage.ts:121-160 |

Visible-but-unexplained discrepancies (feed F-AGG-04, TASK-04 H7 verdict): Time tab "Open
Amount" (raw, date-scoped) vs overview/banner open amount (rounded, all-time); overview
"invoiced" (entry-derived raw) vs Invoices tab totals (invoice-derived); Monthly Report
balances (raw) vs invoice usage table (snapshot/redistributed) — the last is documented in code
(statements.ts:141-149) but nothing tells the reader of the two documents.

---

## Surfaces to reconcile (handoff for TASK-04 — one matrix row each)

| Surface / metric | Function → component | Entry-set rule (short) |
|---|---|---|
| My Time today list + total | `timeEntries.listToday` → app/(dashboard)/my-time/page.tsx:12-22 (client Σ) | user+today(orgTz), all billability |
| My Tasks "today" figure | `timeEntries.sumMyToday` → app/(dashboard)/my-tasks/page.tsx:51 | same as above |
| Task time cell (Tasks/My Tasks) | `timeEntries.sumByTasks` → tasks/my-tasks pages :127-128 | per task, ALL users |
| Task detail total + entries | `tasks.getTaskDetail` totalMinutes (tasks.ts:85) + `timeEntries.listByTask` → components/tasks/task-detail-time.tsx | total ALL users vs rows member-scoped |
| Subtask time cells | `tasks.getSubtasks` timeMap (tasks.ts:143-150) | per subtask, all users |
| Project Time tab rows + stats (Total/Billable/Open/Open Amount) | `timeEntries.listProjectEntries` + `ProjectTimeStats` (project-time-stats.tsx:26-63) | project, default This-month range, member-scoped, status facets |
| Project overview hours/cost/value (T&M + Fixed) | `timeEntries.projectOverview` → tm-overview.tsx:26 / fixed-overview.tsx | all-time, 4 buckets, openAmount invoice-math |
| Project monthly breakdown (T&M/Fixed) | `timeEntries.projectMonthlyBreakdown` → monthly cards | month=date.slice(0,7), snapshot categories |
| Project Summary card (all 3 types) | `projects.getSummary` → ProjectSummaryCard | raw; T&M range presets; billed=invoiceId∨settledAt |
| Retainer overview + Monthly Breakdown card | `projects.getRetainerData` → monthly-breakdown-card.tsx | cycle months; overage-due excludes invoiced anchors |
| Period drill-down sheet | `timeEntries.listProjectEntries` with fromDate/toDate → period-detail-sheet.tsx:63-72 | month bounds |
| Ready-to-invoice row amount + badges | `invoices.getReadyToInvoiceUnified` (enumerateReadyRows invoices.ts:443) | open billable, ended periods, invoice-math amounts |
| Billing nav badge counts | `invoices.getInvoicingNavSignals` (invoices.ts:712) | same helper + overdue rule dueDate<today(orgTz) |
| Project invoice metrics / uninvoiced months / banner total | `invoices.getProjectInvoiceMetrics` + `getRetainerUninvoicedMonths` (invoices.ts:769,1188) | overage months, anchor dedup, skip if overageRate=0 |
| T&M draft hours/amount (creation) | `invoices.createInvoice` (invoices.ts:1209) | billable ∧ !invoiceId ∧ (!settledAt ∨ retainer_included), period-bounded |
| Draft staleness + refresh delta | `getInvoice.staleEntries` / `refreshInvoiceDraft` (invoices.ts:1907-2124) | open entries in stored period (Fixed periodless) |
| Issued invoice hours/amount + retainer usage table + footer | `invoices.getInvoice` (invoices.ts:2132-2400) | line items + frozen snapshots; per-month redistributed |
| Monthly Report work breakdown + balance + footer | `statements.getRetainerStatement` → monthly-report-document | live re-derivation, month/cycle rows, footer Σ available (H3) |
| Monthly worksheet totals | `worksheets.export*` via `collectWorksheetData` (worksheetsHelpers.ts:174) | date-range scope, task-level category filter |
| Cycle worksheet month + cycle totals | `collectCycleWorksheetData` (worksheetsHelpers.ts:748) | per-month re-fetch, UTC today (F-AGG-03) |
| Invoice companion worksheet totals | invoice scope of `resolveScopeEntries` (worksheetsHelpers.ts:287-312) | line-item timeEntryIds union |
| Ad-hoc view export | `lib/worksheet-view-export.ts` → exportAdHoc | visible range; member/search filters dropped |
| Agent timesheet totals | `timesheets.collectTimesheetData` + `lib/timesheetPivot.buildTimesheetTable` | worksheet-collector rows, pivot by CURRENT task category |
| Agent report views | `agentReports.timeByMember/clientMonthlySummary/retainerHealthForMonth/orgFinanceSnapshot` | see inventory #25-28 |
| Workday grid | `workday.weekGrid` | by_orgId_date, member self-scoped |

Cross-org attempt targets for the fixture (F-SEC verification): `listByTask`, `sumByTasks`,
`listProjectEntries`, `projectOverview`, `getRetainerData`, `getSummary`,
`getRetainerStatement`, `getInvoice` (both identifier forms), `collectWorksheetData` (all 3
scopes), `collectTimesheetData`, all agentReports ids, `createInvoice` Path B with foreign
timeEntryIds (guarded at invoices.ts:1449-1451).

---

## Handoffs

### → TASK-05 (retainer)
1. **H3 is code-confirmed** (F-AGG-01): compute the fixture footer for statements.ts:450 and diff invoices.ts:2333. Note the non-rollover fallback path (statements.ts:397-410) has a single row so footer==included there — H3 only bites rollover cycles.
2. Cycle/close-eligibility rule inventory for M4: `getCyclePeriods` (getRetainerData, getSummary, cycle worksheet), `enumerateRetainerCycleState` (ready feed, getClosedUninvoicedMonths), `getRetainerCyclePosition/StartMonth` (statements, agentReports, createInvoice). All use `mEnd < todayStr(orgTz)` for "ended" except the cycle worksheet's UTC today (F-AGG-03). Verify equivalence of the walker vs position-math on the fixture (esp. December start / year boundary).
3. `createInvoice` retainer entry predicate includes `retainer_included` re-billing (invoices.ts:1325-1337) — verify the reopen-deadlock rationale and that overage isn't double-charged when a closed month's entries ride the cycle invoice (computeRetainerBalance startBalance always 0, invoices.ts:939-941).
4. M6 classification inputs: statement=live raw; invoice rows=derived (F-AGG-06); invoice footer=frozen snapshot; ready feed/banner=live rounded; getRetainerData overageDue=live unrounded float.
5. `unsettleInvoiceEntries` re-stamps `retainer_included` for still-closed periods (settleEntries.ts:139-189) — key to M5 revert/void proofs.

### → TASK-06 (worksheet/AI)
1. W2 membership predicates fully traced (inventory #21-23); invoice scope = line-item union with per-doc org checks.
2. **H5 evidence**: `buildTaskRows` includes ALL comments (worksheetsHelpers.ts:445-453), all live subtasks (:433-441), current description (:457-465), and full-lifecycle entry notes (:473-481, explicitly deliberate). No period cutoff anywhere.
3. **H4 evidence**: `groupWorksheetRowsByTaskId` keys by `taskId` only (:142-156); `buildFullCycleCsv` looks up `ai.get(row.taskId)` per section (:977) — one task-level output repeated in every month section (repetition, not overwrite; verify labeling honesty).
4. F-AGG-02 (current vs snapshot category) and F-AGG-03 (UTC today) land in your surfaces.
5. CSV: totals rows are pure sums of rows (:649-666); formula-escape lives in `lib/csv.ts` (verify `=SUM` note).

### → TASK-09 (scale — observed while tracing)
- Per-task N+1 fan-out is the dominant pattern (≥12 call sites, inventory rows 5,7,8,9,12,13,14,16,17,18,20,21,26,27,32,33); `collectCycleWorksheetData` additionally re-fetches all tasks+entries **per month** (worksheetsHelpers.ts:797-813).
- `settleEntries.backfillSettledFromInvoiceId` full-table `.collect()` (convex/settleEntries.ts:44).
- `enumerateReadyRows` reads every project's full entry history on every Inbox/sidebar render (invoices.ts:443-675).
- Bounded scans done right: workday take-cap 10k (workday.ts:9,131-141), agentReports 20k throw-don't-truncate (agentReports.ts:52,158-175).

### → TASK-10 (tests)
Highest-value convex-test cases from this trace: (1) golden-fixture reconciliation of the
surfaces table above; (2) role matrix for F-SEC-02 queries; (3) forged cross-org entry vs
F-SEC-01 readers; (4) statement footer H3; (5) category-change-with-history across breakdown vs
worksheet (F-AGG-02); (6) org-tz vs UTC today freeze test for cycle worksheet (F-AGG-03);
(7) member row-sum vs displayed total (F-AGG-05); (8) `reconcileUsedMinutesToTotal` rawSum==0
degenerate month attribution (F-AGG-06).

### Note for TASK-04/TASK-11 (concurrent work)
`convex/lib/billingScope.ts` (uncommitted) introduces the I1–I4 effective-period model with
`skippedThrough` carry-forward — a deliberate THIRD membership rule that will supersede several
date-based predicates in this inventory once wired. Findings above are against shipped behavior;
the synthesis should mark F-AGG rows that Month-Close will subsume (I4 stamp-based closed
membership directly addresses the A5 gap noted here).
