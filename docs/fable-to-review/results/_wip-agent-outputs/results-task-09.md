<!-- TASK-09 begin -->
# TASK-09 — Scalability & concurrency (Phase 7)

Reviewer: TASK-09 agent, 2026-07-12. Branch `agentic`, review-only.
Dataset targets per REVIEW-SPEC.md: 50 active users/org, 100,000 time entries/org,
multi-year history, 1,000 tasks on a large project, large T&M invoice, 12-month
retainer cycle.

## Limits baseline (what the code is measured against)

`convex/_generated/ai/guidelines.md` (read completely; targets Convex `^1.41.0`) pins:

- Arrays: **max 8,192 values** per array field (guidelines.md:77).
- Values/strings: **< 1 MB** each; documents effectively ~1 MB (guidelines.md:75–76).
- Objects: max 1,024 entries (guidelines.md:78).
- "Convex mutations are transactions with **limits on the number of documents read
  and written**" — batching + self-rescheduling prescribed for anything larger
  (guidelines.md:248); `.collect()` on growing tables prohibited (guidelines.md:245).
- High-churn operational fields must NOT live on shared profile documents
  (guidelines.md:160) — directly relevant to timer state below.

The repo guidelines do **not** pin numeric transaction limits. The Convex platform
documentation for 1.x deployments documents per-transaction defaults of
**~16,384 documents scanned / 8 MiB read** and **~8,192 documents / ~16 MiB written**,
and a **10-minute action timeout**. These numbers are used for the estimates below
and should be re-verified against the deployed Convex version before acting on
exact thresholds; the *orders of magnitude* of the findings do not depend on the
exact values.

`npx convex insights` output: not available to this task at execution time
(TASK-00 runs in parallel; `docs/fable-to-review/results/` did not yet exist when
checked). **Explicitly noted: absence of insights warnings is not proof of
scalability** — the current dataset is MVP dummy data and far below every
threshold discussed here.

Root structural fact driving most findings: **`timeEntries` has no project-scoped
index.** Indexes are `by_orgId`, `by_taskId`, `by_userId_date`, `by_orgId_date`
(convex/schema.ts:424–427). Every project-scoped read therefore fans out
`tasks.by_orgId_projectId` → one `timeEntries.by_taskId.collect()` **per task**,
and always reads the project's *entire multi-year* entry history before filtering
dates in JS. The N+1 is acknowledged in code (convex/retainerPeriods.ts:286–288,
convex/lib/retainerCycle.ts:180–183: "A `projectId` denormalization on
`timeEntries` is the perf-driven follow-up").

---

## Sweep results (all 10 categories, per-hit classification)

### 1. `.collect()` classification (`rg -n "\.collect\(\)" convex`, 232 hits)

Legend: **B** = bounded (small config-sized table or index+filter caps growth),
**U(project)** = unbounded in project entry history, **U(org)** = unbounded in
org-wide data, **U(table)** = unbounded whole-table.

Financial-chain hits (every hit classified individually):

| File:line | Read set (index) | Class | Bound / growth driver |
|---|---|---|---|
| settleEntries.ts:44 | whole `timeEntries` table, no index | **U(table)** | Internal one-shot backfill; self-acknowledged "would OOM on production" (settleEntries.ts:36–38). Breaks at ~16k entries total (all orgs). |
| timeEntries.ts:52, 96, 140, 164, 181, 195 | `by_taskId` / `by_userId_date` | 52/140: **U(task)** per-task entries; 96/164: **B** (one user × one day); 181+195: **U(project)** via sumByProject task fan-out | listByTask/sumByTasks grow with per-task history; sumByProject reads all project entries |
| timeEntries.ts:538, 565 | `by_taskId` (countMismatchedBillable, bulkUpdateBillable) | **U(task)** | all entries of one task; bulk mutation also patches each (writes grow same way) |
| timeEntries.ts:657, 669 | tasks + per-task entries (listProjectEntries) | **U(project)** | all tasks + ALL project entries, date filter applied in JS afterwards (timeEntries.ts:777–782) |
| timeEntries.ts:854, 864 | tasks + per-task entries (projectOverview) | **U(project)** | full project history every render |
| timeEntries.ts:1014, 1023 | invoices + line items per invoice (projectOverview fixed branch) | **U(invoices×lines)** | grows with invoice count |
| timeEntries.ts:1081, 1087, 1098 | tasks + categories + per-task entries (projectMonthlyBreakdown) | **U(project)** | full history |
| invoices.ts:123/128, 192/197 | `invoices.by_orgId(_status)` | **U(org-invoices)** | list pages; grows ~50–500/yr — acceptable medium-term |
| invoices.ts:307, 380, 727, 783 | org invoices (metrics/inbox context) | **U(org-invoices)** | same |
| invoices.ts:451 | `projects.by_orgId` (enumerateReadyRows) | **U(org)** | see category 3 / F-SCL-01 |
| invoices.ts:484, 524/526, 547/555, 592/600, 627/630 | per project: invoices, line items, tasks, **per-task entries**, retainerPeriods (enumerateReadyRows) | **U(org)** | reads ~ALL org entries: tasks→entries fan-out for every T&M *and* retainer project on every execution |
| invoices.ts:836, 962, 1043, 1101/1109, 1138 | line items / tasks+entries for invoice views | **U(project)** for the tasks+entries walks (1097–1116); line items **B(invoice)** |
| invoices.ts:1257, 1302, 1319 | project invoices, tasks, per-task entries (createInvoice) | **U(project)** | reads full project history to build one invoice |
| invoices.ts:1856 | line items of one invoice (updateInvoiceRounding) | **B(invoice)** |  |
| invoices.ts:1918, 1928 | tasks + per-task entries (collectRefreshableEntries) | **U(project)** | runs in `getInvoice` (subscribed staleness signal), `refreshInvoiceDraft`, and the retainer finalize gate (invoices.ts:2922) |
| invoices.ts:2026, 2098 | line items (refresh) | **B(invoice)** |  |
| invoices.ts:2150, 2233/2239, 2643, 2677, 2777, 2888 | line items / sibling invoices for one invoice | **B(invoice)** / **U(org-invoices)** at 2233 |
| invoices.ts:3289 | line items (deleteInvoice) | **B(invoice)** |  |
| retainerPeriods.ts:26, 307/315, 478, 539, 552/561, 706 | period rows `by_projectId`; tasks + **per-task entries** in closePeriodInternal (307/315) and reopenPeriod (552/561) | periods **B(project-months)**; entry walks **U(project)** | close/reopen read ALL project entries |
| retainerCron.ts:28 | `projects.by_billingType_retainerStatus` across ALL orgs | **U(cross-org)** | single mutation creates periods for every customer; fine now, breaks at SaaS scale |
| statements.ts:195, 206, 267 | tasks + per-task entries + project invoices (getRetainerStatement) | **U(project)** | full history per monthly-report render (deliberately single-pass, statements.ts:186–189 — halved from 2×, still unbounded) |
| timesheets.ts:88, 115 | categories (B); projects by client (B) — but loops `resolveScopeEntries` per project | **U(client)** | one transaction reads tasks+entries for every project of a client |
| worksheetsHelpers.ts:300, 353, 368, 438, 448, 802/807 | line items (B(invoice)); tasks + per-task entries (**U(project)**); subtasks + comments per task (**U(task)**); cycle loop re-reads tasks+entries **×N months** (802/807) | **U(project × cycleLength)** | see F-SCL-07 |
| lib/retainerCycle.ts:203, 210 | tasks + per-task entries (sumBillableMinutes) | **U(project)** | used by close gates and ready rows |
| lib/settleGuards.ts:98 | `invoices.by_projectId` (findEntryDateBlocker) | **B(project-invoices)** | runs on EVERY retainer entry create/update/timer-stop; grows with project invoice count (~12/yr) — acceptable |
| lib/settleEntries.ts:55, 159 | line items of one invoice; retainerPeriods by project | **B(invoice)** / **B(project-months)** | but per-entry `ctx.db.get` loop inside — writes scale with invoice entry count (category 4/5) |
| lib/timerEntry.ts:149 | `orgMembers.by_orgId` (autoSaveTimersForTasks) | **B(org-members, ≤~50)** | plus per-member user get — fine |
| lib/fixedBilling.ts:31, 39 | project invoices + line items | **B(project-invoices)** |  |
| projects.ts:52/53 | org projects + clients (list) | **U(org)** but slow-growing tables — acceptable |
| projects.ts:265, 379/385, 579/588, 620, 635, 655, 916/924, 964/968/977, 1048, 1200, 1219, 1232–1234 | tasks + **per-task entries** (getRetainerData 579/588; getSummary 916/924/964–977), categories, invoices, periods | entry walks **U(project)**; config reads **B** | retainer overview + project summary card read full project history reactively |
| userRates.ts:14, 27; categoryRates.ts:13, 26; projectRateOverrides.ts:17; workCategories.ts:17, 54, 100, 201 | org-scoped rate/config tables | **B(config)** | tens–hundreds of rows |
| lib/helpers.ts:16, 83 | org projects / org clients (code generation) | **B-ish (org)** | slow-growing |
| lib/task_helpers.ts:69–210 (12 hits) | subtasks/comments/attachments/entries of ONE task (delete/archive cascades) | **U(task)** | acceptable per-task bound; a task with years of entries could get large |

Peripheral hits, classified in groups: `tasks.ts` (28 hits — org/project task lists,
subtask walks: **U(org-tasks)**, several full-org `orgMembers`/`statuses` reads **B**),
`planner.ts` (10 — org-scoped, date-windowed: mostly **B/U(org)** non-financial),
`comments.ts`, `commentAttachments.ts`, `commentReactions.ts`, `typingIndicators.ts`
(per-task/per-user: **B/U(task)**), `myTasks.ts`, `workday.ts` (per-user date-windowed:
**B**), `clients.ts`, `clientContacts.ts`, `statuses.ts`, `orgMembers.ts`,
`projectCategoryEstimates.ts`, `agents*.ts`, `skills.ts`, `dailyNotes.ts`,
`connectors.ts` (org config scale: **B**), `users.ts:142` and `agents.ts:364/367`
(**U(table)** whole `users`/`orgMembers` scans — cross-org, should be indexed),
`devSeed*.ts`, `migrations/*` (**U(table)** but dev/one-shot), `__tests__/*` (test-only).

### 2. Per-task N+1 entry reads

Confirmed as the **standard project read pattern**, not an exception. Loops issuing
one `timeEntries.by_taskId` query per task:

- convex/timeEntries.ts:189–201 (`sumByProject`), 662–672 (`listProjectEntries`),
  856–871 (`projectOverview`), 1090–1107 (`projectMonthlyBreakdown`)
- convex/invoices.ts:548–558 & 593–603 (`enumerateReadyRows`), 1312–1344
  (`createInvoice`), 1921–1937 (`collectRefreshableEntries`), 1097–1116 (invoice view)
- convex/retainerPeriods.ts:311–330 (`closePeriodInternal`), 557–575 (`reopenPeriod`)
- convex/lib/retainerCycle.ts:206–218 (`sumBillableMinutes` — all close gates)
- convex/statements.ts:199–209 (`getRetainerStatement`)
- convex/worksheetsHelpers.ts:356–376 (`resolveScopeEntries`), 803–813 (cycle loop,
  ×N months), and buildTaskRows re-reads **all** entries of each in-scope task a
  second time (worksheetsHelpers.ts:473–478, deliberate "lifecycle" scope) plus one
  subtasks query (433–438) and one comments query (445–448) per task
- convex/projects.ts:582–596 (`getRetainerData`), 920–927 (`getSummary`)
- convex/timeEntries.ts:131–144 (`sumByTasks` — bounded to 100 tasks per call,
  timeEntries.ts:125–127, but each per-task read unbounded)

At 1,000 tasks/project this is 1,001 queries per render *and* the full entry
history in memory. Cost is O(tasks + all-time entries) for every surface,
regardless of the date window requested.

### 3. Reactive invalidation amplification

- **`getInvoicingNavSignals` / `getReadyToInvoiceUnified`** — both execute
  `enumerateReadyRows` (convex/invoices.ts:443–675), which reads all org projects,
  all their invoices, and for every T&M/retainer project all tasks + **all time
  entries**. Subscribed from the persistent sidebar (components/nav-main.tsx:52)
  on every admin page, and again (plus the unified feed) on the Invoices page
  (app/(dashboard)/invoices/page.tsx:91,103). Read set ⊇ every `timeEntries`,
  `tasks`, `invoices`, `projects`, `retainerPeriods` row in the org ⇒ **every
  time-entry write by any of 50 users re-executes an org-wide full scan** (twice
  on the Invoices page: badge + feed are different functions, no dedupe between
  them). This is the single worst amplification point in the app.
- **Project surfaces** — `projectOverview`, `projectMonthlyBreakdown`,
  `getSummary`, `getRetainerData`, `listProjectEntries` each subscribe to the full
  project entry set; any entry write on the project re-runs all of them
  (project page mounts 3–4 simultaneously: app/(dashboard)/projects/[id]/page.tsx,
  components/projects/{tm,fixed,retainer}-overview.tsx).
- **Timer state on the `users` document** (convex/schema.ts:18
  `timerTaskId` + siblings; written by convex/timer.ts:91, 276, 294, and
  clearTimerFields at timer.ts:18–22). Dozens of queries read user docs for name
  enrichment (e.g. timeEntries.ts:61–66, 681–686; comments; task lists). Every
  timer start/pause/resume/stop invalidates every subscribed query that read that
  user's doc. This is precisely the anti-pattern guidelines.md:160 forbids
  ("separate high-churn operational data from stable profile data").
- **`orgSettings` as universal read + finalize-time write** — virtually every
  query calls `getOrgSettings` (timezone/rounding); invoice finalization patches
  the same document to allocate the number (convex/invoices.ts:2954–2957). One
  finalize ⇒ invalidation of essentially **every active subscription in the org**.
- `getInvoice`'s staleness signal calls `collectRefreshableEntries`
  (invoices.ts:1907–1954 via getInvoice) ⇒ the invoice editor re-runs a full
  project fan-out on every entry write on that project.

### 4. Transaction read/write limits at close / invoice creation (100k-entry model)

Model: org = 50 users, 100k entries, ~4,000 tasks, ~40 projects. Large project P =
1,000 tasks, 20,000 entries. 12-month rollover cycle C on a mid-size retainer
project R = 300 tasks, 12,000 total entries, 9,000 inside the cycle. Entry doc
≈ 400 bytes.

| Operation | Reads (docs) | Writes (docs) | Verdict vs ~16,384-read / ~8,192-write |
|---|---:|---:|---|
| `projectOverview(P)` (query) | 1 + 1,000 + 20,000 + invoices ≈ **21,100**; ≈8 MB data | — | **Fails read limit** (and brushes 8 MiB) |
| `getReadyToInvoiceUnified` / nav badge (query) | 40 + ~200 + 4,000 + 100,000 ≈ **104,000** | — | **Fails ~6× over**; breaks once org total ≈16k docs (≈2 months at 50 users × 8 entries/day ≈ 8,800/mo) |
| `closePeriod` (non-rollover month, R) | gate `sumBillableMinutes` 300+12,000 + close walk 300+12,000 ≈ **24,600** | ≤ month's entries (~750) + 1 | **Fails read limit** |
| `closeRetainerCycle` (12-month cycle C) | overage pass 12,300 + 12 × (300+12,000) = **≈160,000** | 9,000 entry patches + 12 periods = **9,012** | **Fails read (~10×) AND write (~1.1×) limits.** Atomic rollback ⇒ no corruption, but the cycle becomes permanently uncloseable |
| `createInvoice` (cycle C) | invoices + 300 tasks + 12,000 entries ≈ **12,400** | 1 invoice + ~lines + **9,000 entry stamps** (invoices.ts:1800–1802) | **Fails write limit**; reads fail on bigger projects |
| finalize (`changeInvoiceStatus` draft→invoiced, cycle C) | retainer gate re-fans project (≈12,300) + `getEntriesForInvoice` per-ID gets 9,000 ≈ **21,400** | settle patch per entry ≈ **9,000** (lib/settleEntries.ts:95–109) | **Fails both** |
| `reopenPeriod` / void (`unsettleInvoiceEntries`) | full project fan-out / per-ID gets | per-entry patches | Same failure shape as close/settle |
| `timer.stop`, `timeEntries.create/update/remove` | O(1) + settleGuards project-invoice scan (~tens) | 1–2 | **OK** at all targets |

All failures are hard `ConvexError`/limit errors with rollback — **availability
failures, not silent corruption**. The dangerous consequence is financial-process
deadlock: a 12-month cycle that crosses the write threshold can never be closed
or invoiced without engineering intervention.

### 5. Unbounded `timeEntryIds` arrays on invoice line items

- Schema: `invoiceLineItems.timeEntryIds: v.optional(v.array(v.id("timeEntries")))`
  (convex/schema.ts:341). Hard platform cap: **8,192 array values**
  (guidelines.md:77); ~1 MB doc cap.
- Line grouping is `(category, task, rate)` for T&M and `(category, task)` for
  retainer/fixed (invoices.ts:1493–1512), so one line's array = all in-scope
  entries of one task. A catch-all task ("General", "Meetings") on a 12-month
  cycle at 50 users can plausibly exceed 8,192 entries ⇒ `ctx.db.insert` throws
  and invoice creation fails. Below the cap it still means multi-hundred-KB line
  items rewritten wholesale on every refresh.
- `refreshInvoiceDraft` **appends** to the array in place
  (invoices.ts:2059 `timeEntryIds: [...(target.timeEntryIds ?? []), ...group.entryIds]`)
  — monotone growth, no bound check.
- The settle/unsettle walk then does one `ctx.db.get` + one `ctx.db.patch` per ID
  (lib/settleEntries.ts:58–67, 95–109) — the write-limit exposure in category 4.

### 6. Duplicate subscriptions across daily UI surfaces

Sweep: `rg -n "useQuery" components app` on timer/time surfaces.

- `api.timer.getState` — one global subscription in the provider
  (components/timer-provider.tsx:68). Clean.
- `api.timeEntries.listToday` — subscribed by components/timer/timer-today-section.tsx
  and app/(dashboard)/my-time/page.tsx; identical `(function, args)` pairs are
  deduped by the Convex client, so co-mounting costs one subscription. OK.
- `api.timeEntries.sumByTasks` — Tasks page (app/(dashboard)/tasks/page.tsx:176)
  and My Tasks (app/(dashboard)/my-tasks/page.tsx:128); ≤100 task IDs per call,
  arg sets differ per view ⇒ separate 100-way fan-out subscriptions per page.
- Project detail co-mounts `projectOverview` + `projectMonthlyBreakdown` +
  `projects.getSummary` (+ `listProjectEntries` on the Time tab, + `getRetainerData`
  on retainers) — 3–5 concurrent full-project-fan-out subscriptions over the SAME
  underlying rows; each entry write re-runs all of them.
- Invoices page: `getInvoicingNavSignals` (also in nav — deduped) **plus**
  `getReadyToInvoiceUnified` — two distinct functions executing the same org-wide
  scan (invoices/page.tsx:91,103).

Verdict: no pathological same-query duplication (client dedupe works); the issue
is *distinct* heavyweight queries over overlapping read sets (category 3).

### 7. OCC conflict candidates (hot documents)

- **`users` doc** — timer state + profile + enrichment source. Timer transitions
  patch it; concurrent stop attempts conflict and serialize (see category 8 —
  this is what makes stop idempotent). Contention is per-user only (a user
  conflicts with themself), so throughput is fine; the cost is invalidation
  amplification (category 3), not OCC starvation.
- **`orgSettings` doc** — read by ~every function; **written** by finalization's
  number allocation (invoices.ts:2950–2958) and settings edits. Two concurrent
  finalizations conflict on it and retry-serialize ⇒ gapless numbering is
  **correct by construction**; cost = retries of the (already huge) finalize
  transaction + org-wide invalidation per finalize.
- **`retainerPeriods` rows** — close/reopen patch them; conflicts retry and hit
  the `closedAt` guards (retainerPeriods.ts:438–440, 526–528). Correct.
- **`invoices` rows + `by_projectId` index range** — createInvoice reads the
  range and inserts into it; concurrent creates conflict ⇒ retry sees the new
  draft ⇒ resume path (invoices.ts:1266–1294, 1395–1412). Correct.
- **Rate rows** (`userRates`, `categoryRates`, `projectRateOverrides`) — patched
  in place on edit; readers snapshot at entry-write time. Low write frequency,
  no meaningful contention. Not a hotspot.

### 8. Two admins closing/invoicing the same scope concurrently

Idempotency/eligibility guards verified per mutation (all rely on Convex OCC
serializability — conflicting transactions retry against the committed state):

- `closePeriod`: second admin's retry sees `period.closedAt !== undefined` ⇒
  clean "Period is already closed." (retainerPeriods.ts:438–440). **Sound.**
- `closeRetainerCycle`: per-month `if (period.closedAt !== undefined) continue`
  makes concurrent/partial re-runs idempotent (retainerPeriods.ts:733–739);
  `closePeriodInternal` is a no-op on already-settled entries via
  `shouldSettleEntry`. **Sound.**
- `createInvoice`: resume-existing-draft for fixed/T&M/retainer
  (invoices.ts:1266–1294, 1395–1408) + `blocked-duplicate` throw for finalized
  periods (1409–1412); concurrent double-create serializes on the read invoice
  index range ⇒ second call resumes the first's draft. Path B re-validates per
  entry and throws "already invoiced" on the loser (1444–1461). **Sound.**
- Finalize: `VALID_TRANSITIONS` gate + `invoice.number == null` idempotency
  (invoices.ts:2842–2848, 2950) ⇒ double-finalize is a no-op/clean error, numbers
  gapless. **Sound.**
- `refreshInvoiceDraft` racing itself: both stamp the same open entries; loser
  retries, `collectRefreshableEntries` then returns them as already stamped ⇒
  `added: 0` (invoices.ts:1929–1934, 1988–1990). **Sound.**
- `timer.stop` double click / two tabs: both transactions write the user doc;
  loser retries, re-reads `timerTaskId === undefined` ⇒ "No active timer"
  (timer.ts:164–166). **No duplicate entry possible** (supports T1/T3).

**No concurrency-correctness finding.** The residual risk is operational: these
giant transactions retrying under OCC multiply the category-4 read costs.

### 9. Duplicate AI calls per (task, period) in worksheet generation

- Within one export, AI calls are deduped **by `taskId`** via
  `groupWorksheetRowsByTaskId` (convex/worksheets.ts:139–149): a task appearing
  in all 12 months of a cycle gets **one** call, with `occurrenceCount` used only
  for stats. No duplicate (task, month) calls ⇒ no cost blow-up inside an export.
  (The flip side — one output reused across months — is TASK-06's H4, not a scale
  issue.)
- **Across exports there is no caching/persistence of AI outputs**: every
  re-export of the same month/cycle/invoice re-pays every AI call
  (worksheets.ts:189–441 — outputs live only in the action's memory). Repeated
  exports of a 300-task cycle = 300 fresh Sonnet calls each time. Cost/latency
  concern, not correctness.

### 10. Action timeouts + provider rate limits during large worksheet exports

- Orchestration: bounded concurrency **4**, probe-then-fan-out, single retry with
  400–600 ms backoff on transient errors (429/5xx/timeout), per-task failures
  degrade to `[summary unavailable]` and are surfaced in `stats`
  (convex/lib/worksheetAi.ts:328–371, 297–305; worksheets.ts:110–184). Good
  transparency (W6-friendly).
- Wall clock: eligible tasks / 4 workers × ~2–4 s/call. 100 tasks ≈ 1–2 min;
  **~600–1,000 unique eligible tasks ≈ 8–17 min ⇒ exceeds the ~10-minute Convex
  action timeout** ⇒ whole export dies after paying for most of the AI calls.
  A 12-month cycle on a 1,000-task project is squarely in this range.
- Rate limits: BYOK customer Anthropic keys (worksheetAi.ts:223–236) are often
  low-tier (e.g. ~50 RPM); concurrency 4 with one retry produces sustained
  429s on large exports ⇒ mass `[summary unavailable]` rows. Labeled, so honest,
  but the export quality silently collapses at size.
- **Before the AI even runs**, `collectCycleWorksheetData` must finish one
  internalQuery transaction reading ≈ cycleLength × (tasks + all entries) plus
  buildTaskRows' second per-task entry read + comments + subtasks
  (worksheetsHelpers.ts:791–835, 433–478) ⇒ read limit is the earlier failure at
  target scale (see F-SCL-07).
- The agent timesheet path (`timesheets.collectTimesheetData`) loops every
  project of a client inside ONE transaction (timesheets.ts:129–147) — same
  exposure, client-wide.

---

## 04-findings — F-SCL-*

### [F-SCL-01] Org-wide unbounded scan behind the sidebar billing badge and Ready feed

- Severity: High
- Confidence: Confirmed (static trace; arithmetic below)
- Affected invariant(s): none directly (availability); amplifies A-surface costs
- Location: `enumerateReadyRows` convex/invoices.ts:443–675; consumers
  `getReadyToInvoiceUnified` invoices.ts:684–693, `getInvoicingNavSignals`
  invoices.ts:712–760; subscriptions components/nav-main.tsx:52,
  app/(dashboard)/invoices/page.tsx:91,103
- Affected workflow: T&M | retainer | report (billing inbox, nav badge)
- User/business impact: the query reads every project, invoice, task,
  retainerPeriod and **time entry** in the org on every execution, and is
  subscribed from the persistent sidebar for every admin. At the review's
  target (100k entries) it needs ~104k document reads vs a ~16,384/transaction
  platform limit — the badge and the entire billing inbox hard-error for the
  whole org. At 50 users × ~8 entries/day the org crosses ~16k total docs in
  **under 2 months** of real use. Until then, every single time-entry write in
  the org re-executes this full scan (twice on the Invoices page).
- Reproduction: seed one org with >16.4k combined docs across
  projects+invoices+tasks+entries; open any admin page; nav badge query throws.
- Expected result: badge/feed cost proportional to pending billing units.
- Actual result: cost proportional to total org history; hard failure past the
  transaction read limit.
- Root cause: no project-scoped `timeEntries` index and no denormalized
  "ready" state; the feed recomputes all-time balances from raw entries inline.
- Existing test coverage: none (no convex-test; pure helpers only).
- Missing test: load-shaped convex-test seeding N entries and asserting
  `getReadyToInvoiceUnified` document-read ceiling (or paginated/denormalized
  behavior after fix).
- Recommended fix (measure first, no broad refactor now): instrument with
  `npx convex insights` / function-log read counts under a seeded 20k-entry
  dataset to confirm the curve; then the smallest safe remediations are
  (a) split the badge from the feed and derive the badge from a maintained
  per-project summary document, (b) add a `timeEntries` project-scoped index +
  per-month aggregation so ready rows read months, not entries.
- Migration/backfill impact: index addition = schema-only; summary docs need a
  one-shot backfill (batched per guidelines.md:248).
- Verification after fix: insights shows bounded reads; badge survives a
  100k-entry seeded org.

### [F-SCL-02] 12-month cycle close and cycle invoice exceed transaction read/write limits — cycle becomes uncloseable

- Severity: High
- Confidence: Confirmed (static trace + arithmetic)
- Affected invariant(s): M3/M5 operationally (close/void paths stop working at
  size); no silent-wrongness (transactions roll back atomically)
- Location: `closeRetainerCycle` convex/retainerPeriods.ts:607–745 with
  `closePeriodInternal` retainerPeriods.ts:290–339 (re-reads ALL project tasks +
  entries **per month**, ×12); `sumBillableMinutes`
  convex/lib/retainerCycle.ts:185–228; `createInvoice` convex/invoices.ts:1296–1344
  (full-project read) and 1800–1802 (per-entry stamp writes); finalize settle walk
  convex/lib/settleEntries.ts:85–111 + retainer gate convex/invoices.ts:2917–2939;
  `reopenPeriod` retainerPeriods.ts:547–575; `unsettleInvoiceEntries`
  lib/settleEntries.ts:129–191
- Affected workflow: retainer close | invoice | void/reopen
- User/business impact: for a 12-month cycle on a project with 300 tasks /
  12,000 entries (9,000 in cycle): **close reads ≈ 160,000 docs (limit ~16,384)
  and writes ≈ 9,012 docs (limit ~8,192)** — both fail. `createInvoice` for the
  same cycle writes ~9,000 entry stamps — fails. Finalization settles ~9,000
  entries — fails. Net effect: a large cycle can be *worked* but never *closed,
  invoiced, finalized, voided or reopened*. Revenue is blocked, not corrupted.
- Reproduction: seed a rollover project with cycleLength 12 and >8,192 in-cycle
  billable entries; call `closeRetainerCycle` / `createInvoice` → limit error.
- Expected result: cycle operations scale with entries via batching.
- Actual result: single-transaction all-or-nothing over the full ledger; ×13
  read amplification from the per-month re-walk.
- Root cause: (a) `closePeriodInternal` re-fans the whole project per month
  instead of reading the cycle range once; (b) per-entry settlement stamps in
  one transaction; (c) no project/date index on `timeEntries`.
- Existing test coverage: pure gate predicates only; no integration test at any
  size.
- Missing test: convex-test that closes a cycle with (i) 1k and (ii) >8.2k
  entries; assert success or a designed batched continuation, never a limit
  error.
- Recommended fix: first a **measurement/load test** (seeded convex-test or dev
  deployment) to establish the real per-entry cost; then the guidelines-blessed
  pattern — batch with `.take(n)` + `ctx.scheduler.runAfter(0, …)` self-
  continuation for settle stamping (guidelines.md:248), and hoist the task/entry
  read out of the per-month loop (single cycle-range pass, as
  `computeCycleOverageContext` already does at retainerCycle.ts:333–355).
- Migration/backfill impact: none (behavioral batching only); interim states
  must keep the `closedAt` fingerprint semantics.
- Verification after fix: seeded 10k-entry cycle closes; reopen restores exactly.

### [F-SCL-03] Every project-scoped financial read fans out per task and loads all-time history (missing project index on timeEntries)

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): A-surfaces (availability), H7 surfaces
- Location: index list convex/schema.ts:424–427 (no projectId index); fan-out
  sites — convex/timeEntries.ts:189–201, 662–672, 856–871, 1090–1107;
  convex/projects.ts:582–596, 920–927; convex/statements.ts:199–209;
  convex/invoices.ts:548–558, 593–603, 1097–1116, 1312–1344, 1921–1937;
  convex/worksheetsHelpers.ts:356–376; convex/lib/retainerCycle.ts:198–218;
  convex/retainerPeriods.ts:302–330, 547–575; acknowledged in code at
  retainerPeriods.ts:286–288 and retainerCycle.ts:180–183
- Affected workflow: reports | T&M | retainer | worksheet | UI project pages
- User/business impact: at the target 1,000-task / 20,000-entry project, each
  of `projectOverview`, `projectMonthlyBreakdown`, `getSummary`,
  `getRetainerData`, `listProjectEntries`, `getRetainerStatement` needs
  ~21,000 document reads (> ~16,384 limit) and ~8 MB data (≈ read-size limit):
  the project page stops rendering entirely on a multi-year project. Below the
  limit, the project page runs 3–5 of these concurrently and re-runs them all
  on every entry write.
- Reproduction: seed one project with 17k entries; open project Overview.
- Expected: reads bounded by the requested window (month/tab).
- Actual: full history read and filtered in JS (e.g. date filters applied after
  the collect at timeEntries.ts:777–782).
- Root cause: `timeEntries` addressable only by task/user/org-date; the
  documented follow-up (`projectId` denormalization) was deferred.
- Existing test coverage: none at scale.
- Missing test: read-count assertion for `projectOverview` on a windowed month.
- Recommended fix: measurement first (insights on seeded data). Then one narrow
  schema change consistent with [project_mvp_dummy_data]: denormalize
  `projectId` onto `timeEntries` + index `by_orgId_projectId_date`, and switch
  the listed readers to range reads. Keep aggregate caching out of scope until
  measured.
- Migration/backfill impact: backfill `projectId` from task → batched migration
  (widen-migrate-narrow per convex-migration-helper conventions).
- Verification after fix: project page renders on a 100k-entry org; insights
  read counts scale with window size.

### [F-SCL-04] Timer state lives on the shared `users` document — invalidation amplification on every timer transition

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): none (T3 actually *benefits* — see positive note)
- Location: convex/schema.ts:18 (`timerTaskId` on `users` + timerStartedAt /
  timerAccumulatedMs / timerStatus); writers convex/timer.ts:18–22, 91–95,
  276–279, 294–296; enrichment readers e.g. convex/timeEntries.ts:61–66, 681–686
- Affected workflow: timer | all list UIs
- User/business impact: with 50 users starting/pausing/stopping timers all day,
  every transition rewrites that user's `users` doc and invalidates **every
  subscribed query that read it** (task lists, entry lists, comment threads,
  project Time tabs showing that user's name) — most of which are the expensive
  fan-out queries of F-SCL-03. Convex guidelines explicitly prohibit exactly
  this ("separate high-churn operational data … from stable profile data",
  guidelines.md:160).
- Positive counterweight (record, do not "fix" away): OCC on this doc is what
  makes `timer.stop` idempotent under double-click/two tabs (timer.ts:164–166) —
  any remediation must preserve single-active-timer-per-user semantics.
- Reproduction: subscribe a project Time tab; start/stop a timer as an
  enriched user; observe query re-execution.
- Root cause: convenience of storing timer fields on the auth-loaded user doc.
- Existing test coverage: components/timer-provider.test.tsx (client only).
- Missing test: none testable at unit level; note for load measurements.
- Recommended fix: measure first (insights: query execution counts). Longer
  term: dedicated `timers` table keyed by userId (unique index), preserving the
  OCC idempotency property.
- Migration/backfill impact: small table move; timer state is transient so a
  cutover window is cheap.
- Verification after fix: timer transitions no longer invalidate entry-list
  queries.

### [F-SCL-05] Invoice finalization writes `orgSettings` — org-wide invalidation per finalize; numbering contention is correct but expensive

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): none (numbering is gapless and idempotent)
- Location: convex/invoices.ts:2950–2958 (number allocation patches
  `orgSettings`); `getOrgSettings` read from virtually every financial query
  (convex/lib/orgHelpers.ts; e.g. timeEntries.ts:86, invoices.ts:456)
- Affected workflow: invoicing | all surfaces
- User/business impact: `orgSettings` is in the read set of nearly every active
  subscription (timezone/rounding). Each finalization patches it ⇒ one invoice
  issue re-executes essentially every open query in the org, including the
  F-SCL-01 org scan. Two admins finalizing concurrently OCC-serialize on the
  doc — correct (gapless numbers, `invoice.number == null` guard at
  invoices.ts:2950) but each retry replays a transaction that already carries
  the F-SCL-02-scale settle walk.
- Reproduction: open several dashboards; finalize an invoice; observe global
  re-execution.
- Root cause: sequence counter co-located with universally-read settings.
- Recommended fix: measure; then move `nextInvoiceNumber` to its own
  single-purpose document so numbering writes stop invalidating
  timezone/rounding readers. No behavior change.
- Migration/backfill impact: one-doc migration; trivial.
- Verification after fix: finalize no longer invalidates unrelated queries.

### [F-SCL-06] `invoiceLineItems.timeEntryIds` grows without bound toward the 8,192-array / 1 MB document caps

- Severity: Medium
- Confidence: Confirmed (cap documented; overflow scenario realistic for
  catch-all tasks)
- Affected invariant(s): A5/W2 rely on this array as the canonical set — if a
  line can't hold the set, canonical membership itself breaks
- Location: convex/schema.ts:341 (field), 318–344 (table);
  writers convex/invoices.ts:1780–1797 (create), 2055–2062 + 2059 (refresh
  append); readers lib/settleEntries.ts:52–70; worksheetsHelpers.ts:296–312;
  platform caps guidelines.md:75–77
- Affected workflow: T&M | retainer invoice | worksheet
- User/business impact: line grouping is per (category, task[, rate]) —
  invoices.ts:1493–1512 — so one busy catch-all task across a 12-month cycle at
  50 users can exceed 8,192 entry IDs ⇒ line-item insert/patch throws and the
  invoice cannot be created/refreshed. Below the cap, refresh rewrites a
  multi-hundred-KB document per merge.
- Reproduction: seed >8,192 open billable entries on one task; `createInvoice`.
- Root cause: unbounded child list stored as an array field — the exact pattern
  guidelines.md:159 prohibits ("create a separate table for the child items").
- Existing test coverage: none.
- Missing test: createInvoice with 9k single-task entries.
- Recommended fix: measure realistic per-line cardinality first. If hardening is
  needed, a join table (`invoiceLineEntryLinks`) or an index on
  `timeEntries.invoiceId` replaces the array as the canonical set — note this
  contradicts the deliberate no-index decision at lib/settleEntries.ts:17–24,
  so it needs a product-owner decision, not a drive-by refactor.
- Migration/backfill impact: backfill links from existing arrays; keep arrays
  read-compatible during transition.
- Verification after fix: canonical-set queries agree pre/post migration.

### [F-SCL-07] Cycle worksheet export: ×N-month read amplification in one transaction, then AI wall-clock past the action timeout

- Severity: Medium
- Confidence: Confirmed (read path); Strong evidence (timeout arithmetic)
- Affected invariant(s): W6 (partial failure surfaces), availability of W2 outputs
- Location: convex/worksheetsHelpers.ts:791–835 (per-month re-read of tasks +
  ALL entries), 433–478 (buildTaskRows: per-task subtasks + comments + a
  SECOND full entry read per task at 473–478); convex/worksheets.ts:398–441
  (`exportCycle`), 158–161 (single batch); convex/lib/worksheetAi.ts:328–371
  (concurrency 4, one retry); timesheets.ts:129–147 (client-wide loop, same
  transaction shape)
- Affected workflow: worksheet | AI | agent timesheet
- User/business impact: for cycle C (300 tasks, 12,000 entries), the collect
  transaction reads ≈ 12 × 12,300 + per-task re-reads ≈ 160k+ docs ⇒ the export
  fails at the read limit before any CSV/AI work. On smaller data it succeeds,
  but ~600–1,000 AI-eligible tasks at concurrency 4 (~2–4 s/call) ≈ 8–17 min ⇒
  exceeds the ~10-minute action timeout after paying for most of the calls.
  Low-tier BYOK keys 429-throttle earlier, degrading rows to
  "[summary unavailable]" (honest via stats, but the deliverable quality
  collapses at exactly the large-client sizes where worksheets matter most).
  Re-exports re-pay all AI calls (no output caching).
- Reproduction: retainer project, cycleLength 12, ≥1,500 tasks+entries combined
  ×13; run Export cycle.
- Root cause: per-month re-walk instead of one range read; double entry read per
  task ("lifecycle" AI scope); all-in-one action with no checkpointing.
- Existing test coverage: worksheetAi.test.ts (pure parsing only).
- Missing test: TASK-10 item — export action against seeded large fixture;
  assert bounded reads and graceful partial completion.
- Recommended fix: measurement first (time a 100/300/1,000-task export on
  seeded data). Then: hoist the task/entry read out of the month loop; reuse the
  in-scope `taskEntries` for AI notes instead of the second read; for very large
  exports, chunk AI work across scheduled action steps with persisted partial
  outputs.
- Migration/backfill impact: none.
- Verification after fix: 1,000-task cycle export completes; stats reconcile
  (aiSucceeded + aiSkipped + aiFailed = total).

### [F-SCL-08] Whole-table and cross-org maintenance mutations (backfill, cron) are single-transaction

- Severity: Low (internal-only today; becomes High if run on production-sized data)
- Confidence: Confirmed (self-acknowledged in code)
- Affected invariant(s): none
- Location: convex/settleEntries.ts:44 (`backfillSettledFromInvoiceId` — full
  `timeEntries` table collect, warning at 36–38); convex/retainerCron.ts:22–50
  (`generateMonthlyPeriods` — all active retainer projects across ALL orgs in
  one mutation); also cross-org table scans convex/users.ts:142,
  convex/agents.ts:364–367 (whole `users`/`orgMembers` collects)
- Affected workflow: ops/maintenance | retainer cron
- User/business impact: the backfill dies at ~16k total entries; the cron dies
  once total active retainer projects across all customers exceeds transaction
  bounds — silently skipping period creation for everyone that month (the ready
  feed tolerates missing rows, so impact is deferred, not corrupting).
- Recommended fix: convert both to the batched self-rescheduling pattern
  (guidelines.md:248) before any production launch; index the `users`/`orgMembers`
  lookups.
- Verification after fix: cron completes per-org batches; backfill is chunked.

### [F-SCL-09] Per-page N-way fan-out subscriptions on daily task surfaces

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): none
- Location: convex/timeEntries.ts:119–148 (`sumByTasks`, 100-task cap at
  125–127, one per-task entry collect each); subscribers
  app/(dashboard)/tasks/page.tsx:176, app/(dashboard)/my-tasks/page.tsx:128;
  convex/timeEntries.ts:40–79 (`listByTask` member-filtering AFTER reading all
  task entries)
- Affected workflow: UI (Tasks, My Tasks, task detail)
- User/business impact: each page load runs up to 101 queries inside one
  transaction and re-runs on any entry write touching a visible task; per-task
  history is unbounded, so a long-lived task (years of entries) inflates every
  board render. Client-side dedupe of identical (query, args) pairs works
  correctly — no duplicate-subscription defect found (`listToday` co-mounts
  dedupe; timer `getState` is single).
- Recommended fix: none now; fold into the F-SCL-03 index work (a
  `by_taskId`-summed denormalized counter or windowed reads) after measurement.

Positive verification (recorded, not a finding): **two-admin concurrency is
sound end-to-end** — close, cycle close, invoice create/resume, finalize
numbering, refresh, and timer stop all combine OCC retries with explicit state
guards such that the loser gets a clean error or a no-op; no duplicated ledger
rows, duplicate invoices, duplicate settlements, or gapped/duplicated invoice
numbers were reachable in trace (evidence in Sweep §7–8 above).

---

## Worst-case estimates (close, invoice creation, worksheet export)

Model (spec targets): org = 50 users, 100,000 entries, ~4,000 tasks, ~40
projects, ~200 invoices. Large project P = 1,000 tasks / 20,000 entries.
12-month cycle C = 300 tasks / 12,000 project entries / 9,000 in-cycle billable
entries. Entry doc ≈ 400 B. Limits used: ~16,384 docs read, ~8,192 docs written
per transaction (platform defaults — verify against deployment), ~10-min actions.

| Operation | Docs read | Docs written | Limit verdict |
|---|---:|---:|---|
| Sidebar badge / Ready feed (`enumerateReadyRows`) | ≈ 104,000 | 0 | ~6.4× over read limit; breaks at ~16k org docs ≈ **<2 months** of 50-user usage |
| `projectOverview(P)` (and each sibling project query) | ≈ 21,100 (~8 MB) | 0 | over read limit AND at the ~8 MiB read-size cap |
| `closePeriod` (one month of a 12k-entry project) | ≈ 24,600 | ≈ 750 + 1 | over read limit |
| `closeRetainerCycle` (cycle C) | ≈ 160,000 (13 full project walks) | ≈ 9,012 | ~10× over read limit, ~1.1× over write limit — **cycle permanently uncloseable**; rollback keeps data clean |
| `createInvoice` (cycle C) | ≈ 12,400 | ≈ 9,000 entry stamps + invoice + lines | over write limit (over read limit too on bigger projects) |
| Finalize cycle invoice (settle walk + retainer stale gate) | ≈ 21,400 | ≈ 9,000 | over both |
| Void / reopen (unsettle walk) | ≈ same as finalize | ≈ per-entry | over both |
| `exportCycle` collect transaction (cycle C) | ≈ 160,000+ (per-month walk + double per-task entry read + comments/subtasks) | 0 | over read limit; below the limit, 600–1,000 AI-eligible tasks ⇒ 8–17 min ⇒ over the ~10-min action timeout; BYOK 429s degrade rows to "[summary unavailable]" |
| `timer.stop` / entry create/update | O(10) | 1–2 | fine at all targets |

Break-even points (approx., 400 B docs): any single project crosses the
project-query read limit at ~15–16k tasks+entries; the org-wide badge crosses at
~16k org-wide docs; cycle close crosses the write limit at ~8.2k in-cycle
entries and the read limit at ~1.2k project docs × (cycleLength+1).

---

## Roadmap notes ("before scale" group input for TASK-11)

Ordering principle honored from the task card: **measure before refactoring** —
none of these should be built blind; all are gated on a seeded load measurement
(convex-test or dev deployment with 20k–100k synthetic entries + `npx convex
insights --details`), because the exact platform limits and per-doc costs must
be confirmed against the deployed Convex version first. Absence of insights
warnings today proves nothing (dummy-data scale).

Before scale (ordered):

1. **Load-measurement harness first** (blocks everything): seed 20k/100k-entry
   orgs; record per-function read/write counts for the F-SCL-01/02/03 paths.
   This doubles as the regression budget for every later fix.
2. **F-SCL-01** — split nav badge from the ready feed; denormalize per-project
   "ready" state or paginate the feed. Highest leverage: it is the first thing
   to die and it amplifies everything else via the sidebar subscription.
3. **F-SCL-03** — `timeEntries.projectId` denormalization +
   `by_orgId_projectId_date` index; convert the ~12 fan-out readers to range
   reads. This single schema change removes the ×(tasks) factor from close,
   invoice, statements, worksheets and overview simultaneously. MVP-stage
   direct-narrow schema change is sanctioned ([project_mvp_dummy_data]).
4. **F-SCL-02** — batch settlement stamping (take-n + scheduler continuation)
   in close/cycle-close/settle/unsettle; hoist the per-month re-walk to one
   cycle-range read. Do after (3) so the batches ride the new index.
5. **F-SCL-07** — reuse in-scope entries for AI notes (drop the second per-task
   read), hoist the cycle month loop; chunk AI work across scheduled steps for
   large exports; consider persisting AI outputs per (period, taskId) — which
   also intersects TASK-06's H4 fix.
6. **F-SCL-04/05** — move timer state off `users`, move `nextInvoiceNumber`
   off `orgSettings` (pure invalidation hygiene; cheap, do alongside 3–4).
7. **F-SCL-06** — decide array vs join-table for canonical invoice membership
   (product decision; contradicts the documented no-index rationale in
   lib/settleEntries.ts:17–24 — needs owner sign-off).
8. **F-SCL-08** — batch the backfill + cron before any multi-tenant production
   deployment.

Accepted-for-now (document, don't fix): per-task N+1 is code-acknowledged with a
named follow-up; two-admin concurrency semantics are sound and must be
*preserved* by any batching work (idempotent re-entry via `closedAt` /
`settledAt` guards is what makes scheduler continuations safe here).

<!-- TASK-09 end -->
