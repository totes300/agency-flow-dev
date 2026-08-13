# TASK-02 — Rate trace: resolution, snapshots, locked currency model

Reviewer: TASK-02 agent. Date: 2026-07-12. Branch `agentic`, commit `660d28f` (per plan baseline; worktree clean at read time).
Method: static code trace only (locked decision #2). All verdicts qualified "by trace".
Preconditions honored: read `AGENTS.md`, `CLAUDE.md`, `convex/_generated/ai/guidelines.md` in full before Convex reasoning.

<!-- TASK-02 begin -->

## 01-system-map — Rate-resolution graph + decision table

### Storage (all paths absolute from repo root `/Users/tothadam/claude_code_projects/agency-flow-dev/`)

| Table | Key shape | Value | Currency dimension | Schema |
|---|---|---|---|---|
| `userRates` | `(orgId, userId, currency)` unique via index `by_orgId_userId_currency` | `costRate` | explicit, `currencyValidator` (15-code literal union, `convex/lib/validators.ts:6-8`, `convex/lib/constants.ts:3-6`) | `convex/schema.ts:430-439` |
| `categoryRates` | `(orgId, workCategoryId, currency)` via `by_orgId_workCategoryId_currency` | `defaultBillRate` | explicit | `convex/schema.ts:442-451` |
| `projectRateOverrides` | `(projectId, workCategoryId)` via `by_projectId_workCategoryId` | `billableRate` | **implicit** — no currency column; bound to the project's client currency by construction | `convex/schema.ts:454-464` |
| `timeEntries` snapshot | per entry | `costRate`, `billableRate`, `rateCurrency` (all required — `v.number()`/`v.string()`, not optional), plus `snapshotCategoryId` | `rateCurrency` = client currency at write time | `convex/schema.ts:376-379`; D1 invariant comment `convex/schema.ts:347-360` |

Currency source of truth: `client.currency` → `getProjectCurrency` (`convex/lib/orgHelpers.ts:17-26`). `client.currency` immutable after creation (`convex/clients.ts:178` — update args exclude it); `project.clientId` immutable (`convex/projects.ts:295-306` update args exclude `clientId` and `billingType`). There is no `projects.currency` field (removed per D1; `convex/schema.ts:202` comment).

### Rate mutations (complete inventory)

| Mutation | Auth | Validation | Effect on stored entry snapshots |
|---|---|---|---|
| `userRates.upsert` | `requireAdmin` (`convex/userRates.ts:38`) | `costRate < 0` rejected only (`convex/userRates.ts:40-42`); user org-membership via `validateAssignees` (`:45`, impl `convex/lib/task_helpers.ts`) | none — patches/inserts only the `userRates` row (`:56-71`) |
| `userRates.remove` | `requireAdmin` + org ownership check (`convex/userRates.ts:78-83`) | — | none — deletes only the rate row |
| `categoryRates.upsert` | `requireAdmin` (`convex/categoryRates.ts:37`) | `defaultBillRate < 0` rejected only (`:39-41`); category org check (`:44-46`) | none |
| `categoryRates.remove` | `requireAdmin` + org check (`:80-84`) | — | none |
| `projectRateOverrides.upsert` | `requireAdmin` (`convex/projectRateOverrides.ts:28`) | `billableRate < 0` rejected only (`:30-32`); project + category org checks (`:35-44`) | none |
| `projectRateOverrides.remove` | `requireAdmin` + org check (`:78-81`) | — | none |
| `orgSettings.create` (onboarding) | `requireAdmin` (`convex/orgSettings.ts:67`) | seeds `categoryRates` only when `defaultBillRate >= 0` (`:132`), currency = org `defaultCurrency` only (`:136`, comment `:112-114`) | n/a (creation-time seed) |

No mutation anywhere patches `timeEntries.costRate/billableRate/rateCurrency` except the three entry writers below. Settlement helpers patch only settlement fields (`convex/lib/settleEntries.ts:102-108, 171-189`). Invoice/statement/worksheet/report code reads snapshots only (`convex/lib/projectSummary.ts:192,196,292,428`; `convex/lib/readyToInvoice.ts:285`; `convex/invoices.ts:566,1495-1506,2006-2016`; `convex/agentReports.ts:89-91`; `convex/projects.ts:933-934`; `convex/timeEntries.ts:941,952,968,1128,1252`).

### Resolution pipeline

```
entry writer
  └─ resolveRateSnapshot(ctx, {userId=ENTRY OWNER, orgId, task, project, isBillable})   convex/lib/orgHelpers.ts:37-117
       1. currency = getProjectCurrency(project) = client.currency                      orgHelpers.ts:50, 17-26
       2. userCostRate = userRates[orgId, ownerId, currency] ?? null                    orgHelpers.ts:53-60  (exact pair, NO fallback, NO conversion)
       3. billable resolution (only if isBillable && billingType !== "non_billable"):   orgHelpers.ts:66-100
            retainer            → resolvedBillableRate = 0                              orgHelpers.ts:67-71
            no task.workCategoryId → error "Set a category on this task…"               orgHelpers.ts:72-74
            projectRateOverrides[projectId, categoryId]  (currency-agnostic lookup)     orgHelpers.ts:77-85
            else categoryRates[orgId, categoryId, currency] ?? null                     orgHelpers.ts:87-93
            null → error "Set a billable rate for this category in {currency}"          orgHelpers.ts:96-98
       4. resolveRate (pure)                                                            convex/lib/rates.ts:34-68
            userCostRate null → THROW "Set a cost rate for this user in {currency}"     rates.ts:35-40
            !isBillable || nonBillableProject → billableRate = 0                        rates.ts:42-51
            billable, rate null → THROW                                                 rates.ts:53-58
            snapshot { costRate, billableRate, rateCurrency: currency }                 rates.ts:60-67
```

Pure resolver covered by `convex/lib/rates.test.ts` (incl. zero-cost-rate-is-valid at `:89`, retainer→0 at `:47-57`).

### Every `resolveRateSnapshot` call site (exhaustive; verified by `rg` over `convex/` excluding `_generated`)

| # | Caller | Snapshot moment | Owner passed | Actor recorded |
|---|---|---|---|---|
| 1 | `timer.start` — `convex/timer.ts:82-88` | **validation only**; result discarded (blocks start if rates missing) | starter | n/a (no write) |
| 2 | `timer.previewRateForTask` — `convex/timer.ts:105-139` | read-only preview; **no UI consumer exists** (`rg previewRate components app lib` → 0 hits) | caller | n/a |
| 3 | `timer.stop` → `insertTimerEntry` — `convex/timer.ts:230-242` → `convex/lib/timerEntry.ts:61-67` | **at stop** (ledger write). On throw, transaction rolls back and the timer keeps running (`timer.ts:150-152` comment; behavior is transactional rollback) | timer owner (`ownerId: userId`, `timer.ts:232`) | `createdBy: userId` (self) |
| 4 | `timer.commitEntry` (under-30s "Save as 1m") — `convex/timer.ts:371-382` → `timerEntry.ts:61` | at commit | caller | self |
| 5 | Task-archive auto-save `autoSaveTimersForTasks` — `convex/lib/timerEntry.ts:123-214`, callers `convex/tasks.ts:1363` (archive) and `:1706` (bulkUpdate archive) | at archive; per-member; on failure the member's timer is **left running** and failure reported (`timerEntry.ts:205-210`) | **timer owner** `ownerId: member.userId` (`timerEntry.ts:193`) | **admin actor** `createdBy: opts.actorUserId` (`timerEntry.ts:194`) |
| 6 | `timeEntries.create` (manual, incl. admin-on-behalf) — `convex/timeEntries.ts:270-276` | at creation, current rates regardless of backdated `date` | `entryUserId` (owner; admin-on-behalf gated at `:224-230`) | `createdBy: auth.userId` (`:295`) |
| 7 | `timeEntries.update` — `convex/timeEntries.ts:457-468` | **only when** `billableChanged \|\| taskChanged` (`:447-451`); duration/note/date/startedAt edits keep the stored snapshot | `entry.userId` (`:458` — owner, even when an admin edits) | `updatedAt` only; activity log actor `userId` (`:473-483`) |
| 8 | `timeEntries.bulkUpdateBillable` — `convex/timeEntries.ts:577-592` | at bulk toggle, per entry, current rates; locked entries skipped (`:573-574`) | `entry.userId` per entry (`:578`) | admin (mutation is admin-only, `:555`) |

Non-production writers (dev/internal only, all `internalMutation`): `convex/devSeedArloJune.ts:314-326` (hardcodes `costRate: 40`, currency from client), `convex/migrations/seedInvoicingScenarios.ts:298-309` (hardcodes `costRate: 0`; comment `:281` says it mirrors `resolveRateSnapshot`), `convex/migrations/deleteLegacyTimeEntries.ts:17` (deletes pre-model entries missing snapshots). These bypass resolution but cannot be called from clients.

### Decision table — effective snapshot by project type × entry billability

| billingType | entry isBillable | costRate | billableRate | rateCurrency | missing-rate behavior |
|---|---|---|---|---|---|
| `t_and_m` / `fixed` | true | `userRates(owner, ccy)` else THROW | override(`project`,`cat`) → `categoryRates(cat, ccy)` else THROW; no category on task → THROW | client currency | blocked before write (timer start `timer.ts:82`; manual create `timeEntries.ts:270`; stop rollback keeps timer) |
| `t_and_m` / `fixed` | false | `userRates(owner, ccy)` else THROW | `0` (`rates.ts:42-51`) | client currency | cost rate still required |
| `retainer` | true | same | **`0` by design** (`orgHelpers.ts:67-71`; revenue is period/cycle-level) | client currency | cost rate required; category NOT required for retainer (branch at `orgHelpers.ts:67` precedes the category check) |
| `retainer` | false | same | `0` | client currency | same |
| `non_billable` | any | same | `0` (`rates.ts:42`, `isNonBillableProject` from `orgHelpers.ts:105`) | client currency | cost rate required |

Duplicated derivations: none found — one resolver, one helper, single writer helper for all timer-born entries (`timerEntry.ts:1-19` header documents exactly this).

## 02-invariant-verdicts — R1–R5 (draft)

| Inv | Verdict | Evidence & qualification |
|---|---|---|
| **R1** Snapshot completeness | **partially proven (by trace)** | Presence is structural: all three fields are required by schema (`convex/schema.ts:376-378`) and every production writer routes through `resolveRateSnapshot`, which throws rather than writing null/partial snapshots (`convex/lib/rates.ts:35-40,53-58`). Legacy backfill paths removed (`convex/timeEntries.ts:600-601`); legacy entries deleted by `convex/migrations/deleteLegacyTimeEntries.ts`. Qualification: numeric **validity** is not guaranteed — a configured NaN/Infinity cost or bill rate passes the `< 0` guards and is snapshotted verbatim (F-RAT-01), making a syntactically complete but semantically invalid snapshot possible. Dev seeds bypass resolution but are `internalMutation` only. |
| **R2** Historical stability | **proven (by trace)** | `userRates.upsert/remove`, `categoryRates.upsert/remove`, `projectRateOverrides.upsert/remove` touch only their own rows (cited above); no code path cascades a rate edit/delete into `timeEntries`, invoices, or closed reports. Locked entries (invoiceId/settledAt) additionally reject edit/delete/re-rate (`convex/timeEntries.ts:339-346, 501-508, 573-574`). Deleting a rate mid-timer cannot corrupt history: `timer.stop` throws and rolls back, timer keeps running (`convex/timer.ts:150-152`). |
| **R3** Snapshot timing policy | **proven (by trace)** — policy is coherent: **rates resolve at ledger-write time, always.** (a) Timer spanning a rate change: resolved at **stop**, entire duration gets the stop-time rate (`convex/lib/timerEntry.ts:61-67`; `timer.start` only pre-validates, `convex/timer.ts:82-88`). (b) Backdated manual entry: rates current at creation, the backdated date has no effect (`convex/timeEntries.ts:270`). (c) Edit after a rate change: snapshot **kept** unless billability or task changed; those trigger re-resolution at current rates (`convex/timeEntries.ts:447-468`) — see F-RAT-03 for the silent-costRate-rewrite visibility flag. (d) Move to another task (same project enforced, `:408-411`): re-snapshot at current rates + `snapshotCategoryId` update (`:412-413,464-467`). (e) Former member: `deleteMembership` removes only the `orgMembers` row (`convex/orgMembers.ts:117-133`); entries and their snapshots untouched; new on-behalf entries blocked by `validateAssignees` (`convex/timeEntries.ts:228`). No historical mutation from settings changes. Per instruction, no rate-versioning recommendation is made. |
| **R4** Rate resolution order | **proven (by trace)** | cost = user+currency exact pair (`convex/lib/orgHelpers.ts:53-60`); billable = project override → category+currency default (`:77-94`); retainer entry `billableRate = 0` (`:67-71`, test `convex/lib/rates.test.ts:47-57`); non-billable entry/project = 0 (`convex/lib/rates.ts:42-51`); currency = client currency (`orgHelpers.ts:50`). Note: the override lookup is **not currency-scoped** (index `by_projectId_workCategoryId`, `convex/schema.ts:463`) — sound only because client currency and `project.clientId` are immutable; see F-RAT-02 for the one drift path that undermines this at the task level. |
| **R5** Actor versus owner | **proven (by trace)** | Admin-on-behalf: rate resolved for `entryUserId` (owner) while `createdBy: auth.userId` preserves the actor (`convex/timeEntries.ts:270,295`); member-for-other-member rejected (`:224-227`). Archive auto-save: `ownerId: member.userId` vs `createdBy: opts.actorUserId` (`convex/lib/timerEntry.ts:193-194`, invoked `convex/tasks.ts:1363,1706`). Edits re-snapshot with `entry.userId`, never the editing admin (`convex/timeEntries.ts:458`; `bulkUpdateBillable` `:578`). Activity log records the acting user (`:298-308`). |

### Hypothesis dispositions owned by this task

- **H2 (rate effective date):** **confirmed as described, and the policy is well-defined in code.** Rate rows are overwritten in place (`userRates.ts:56-61` patches `costRate`); a backdated manual entry receives creation-time rates (`timeEntries.ts:270`); a timer re-resolves at stop, not start (`timerEntry.ts:61` vs `timer.ts:82` discarded result). This is a single consistent rule — write-time resolution — not an inconsistency. Flagged residue: the rule is nowhere surfaced to users (TASK-07 scope), and the edit-path re-snapshot silently rewrites `costRate` (F-RAT-03).
- **H6 (rate half):** **confirmed** — NaN/Infinity/extreme magnitudes pass all three rate upserts (F-RAT-01). Negative values are rejected; zero is accepted as intentional.
- **H9 (code half):** **split.** Writers always select the exact `(owner, project-currency)` pair with no fallback and no conversion — confirmed correct. Coverage auditability — **absent**: no query computes "users missing a cost rate for actively used client currencies"; `timer.previewRateForTask` exists for inline warnings but has zero UI consumers; D1 plan §4.4 (G4 proactive warnings) is explicitly optional and unimplemented (`docs/d1-currency-integrity-plan.md:103-113`). See F-RAT-04.

## 04-findings — F-RAT-*

### [F-RAT-01] Rate upsert mutations accept NaN, Infinity, and unbounded magnitudes

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): R1, T8, H6
- Location: `convex/userRates.ts:40` (`if (args.costRate < 0)`), `convex/categoryRates.ts:39`, `convex/projectRateOverrides.ts:30`, `convex/orgSettings.ts:132` (`>= 0` blocks NaN but admits `Infinity`); all args are bare `v.number()` — Convex admits IEEE-754 specials (`convex/_generated/ai/guidelines.md:73`)
- Affected workflow: rates
- User/business impact: `NaN < 0 === false` and `Infinity < 0 === false`, so a crafted (or buggy future) client call stores NaN/Infinity as a configured rate. The next entry write snapshots it verbatim (`convex/lib/orgHelpers.ts:60,85,93`; NaN is not `null`, so the missing-rate throw does not fire), after which every aggregate consuming the snapshot becomes NaN/Infinity silently — e.g. `totalActualCost += (e.durationMinutes / 60) * (e.costRate ?? 0)` (`convex/timeEntries.ts:941`), project summary cost/value (`convex/lib/projectSummary.ts:192,196`). One poisoned entry NaN-poisons the whole project total with no error anywhere.
- Reproduction: call `api.userRates.upsert` with `costRate: NaN` (Convex serializes NaN); log 1 minute on any task of a project in that currency; open project overview.
- Expected result: mutation rejects non-finite values.
- Actual result: rate row stored; snapshot stored; totals render NaN.
- Root cause: guards test only `< 0`/`<= 0`; no `Number.isFinite` / upper bound.
- Existing test coverage: none (`convex/lib/rates.test.ts` never passes non-finite input; no Convex integration tests exist).
- Missing test: convex-test — `userRates.upsert` with NaN/Infinity/1e300 throws; same for `categoryRates.upsert`, `projectRateOverrides.upsert`.
- Recommended fix: shared `assertFiniteNonNegative(value, label, max?)` applied in all four mutations (and a sane ceiling, e.g. 1e6/h).
- Migration/backfill impact: none for dummy data (MVP); production would need a one-shot scan for non-finite rate rows/snapshots.
- Verification after fix: the three new tests fail before, pass after.

### [F-RAT-02] Two-step task project move bypasses the time-entry guard and breaks the D1 rateCurrency invariant

- Severity: High
- Confidence: Confirmed (code trace; two-step but uses only normal public mutations)
- Affected invariant(s): R4 (currency), A1/A2 (downstream), D1 invariant `convex/schema.ts:347-360`
- Location: `convex/tasks.ts:1152-1161` (`update`): the guard `if (args.projectId !== null && task.projectId && args.projectId !== task.projectId)` (`:1157`) skips both (a) setting `projectId: null` on a task **with** entries, and (b) setting a new project when `task.projectId` is already `undefined`. Same pattern in `bulkUpdate` (`convex/tasks.ts:1674-1677`: `if (task.projectId) { …hasEntries check… }`).
- Affected workflow: manual entry / rates / reporting
- User/business impact: Step 1 — unassign the project from a task that has logged time (allowed; its entries immediately vanish from every project-scoped total since project scope is derived via `task.projectId`). Step 2 — assign the task to a different project, possibly under a client with a **different currency** (guard skipped because `task.projectId` is now undefined). All historical entries move into project B's scope carrying project A's `rateCurrency`/rates. `projects.getSummary` and all project aggregates sum money without currency partitioning (that is D1's stated rationale, `convex/schema.ts:349-352`), so totals silently mix EUR and HUF magnitudes. The schema comment claims "Drift vectors eliminated" via client/clientId immutability — task mobility is the unclosed vector.
- Reproduction: task T in project P1 (client EUR) with one entry → `tasks.update {projectId: null}` → `tasks.update {projectId: P2}` (client HUF) → open P2 overview.
- Expected result: either both steps blocked for tasks with entries, or entries re-scoped safely.
- Actual result: entries counted in P2 totals with EUR snapshots; no error.
- Root cause: guard checks only the direct A→B transition, not A→null (entry orphaning) or null→B (re-homing).
- Existing test coverage: none.
- Missing test: convex-test — task with entries: (1) `update {projectId: null}` rejected (or entries handled); (2) null→B transition rejected when entries exist.
- Recommended fix: extend the guard to `args.projectId !== task.projectId` in **any** direction when `hasEntries` (including to/from null), same in `bulkUpdate`. Smallest change; preserves the locked currency model.
- Migration/backfill impact: none if fixed before real data; an integrity sweep (`entry.rateCurrency === client.currency(task.projectId.clientId)`) would catch any existing drift.
- Verification after fix: the two tests above; manual repro path now throws.

### [F-RAT-03] Billability toggle and task move silently re-rate historical entries (including costRate) at current rates

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): R3 (unclear behavior flag — policy itself is consistent), A2
- Location: `convex/timeEntries.ts:447-468` (`update`: re-snapshot on `billableChanged || taskChanged`), `convex/timeEntries.ts:577-592` (`bulkUpdateBillable`: re-snapshot of every unlocked entry for the task)
- Affected workflow: manual entry / rates / reporting
- User/business impact: an entry logged in January at costRate 40 keeps 40 through any duration/note/date edit, but the moment its billability is toggled (or the task's billability is bulk-applied, a routine admin action after changing a task's billable flag), the entry's `costRate` **and** `billableRate` are silently replaced with today's configured rates. Labor-cost history changes with no activity-log record (`logActivity` fires only for duration changes, `:472-483`; `bulkUpdateBillable` logs nothing) and no UI indication. Two entries with identical measured work in the same month can carry different cost rates depending on whether someone later touched billability. This is the only path by which a rate settings change retroactively reaches an existing entry.
- Reproduction: create entry; raise the owner's cost rate; toggle the entry non-billable→billable (or run bulk toggle); read `costRate`.
- Expected result: either only `billableRate` is re-resolved (cost basis preserved), or the change is explicit/audited.
- Actual result: full snapshot silently replaced.
- Root cause: re-resolution reuses the whole `RateSnapshot` because billableRate legitimately depends on billability; costRate rides along.
- Existing test coverage: none.
- Missing test: convex-test — billability toggle after a cost-rate change: assert chosen policy (costRate preserved OR change audit-logged).
- Recommended fix (smallest): keep `entry.costRate` on billability-only changes (re-resolve only `billableRate`/`rateCurrency`); for task moves keep full re-snapshot but write an activity-log record with old→new rates. Do not version rates.
- Migration/backfill impact: none.
- Verification after fix: test above; activity log shows re-rate events.

### [F-RAT-04] No per-user/per-currency coverage audit exists; the rate-preview query is dead code

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): H9, locked-model checklist items 6–8
- Location: absence — no query over `userRates` × active client currencies (only consumers of `userRates` are `convex/lib/orgHelpers.ts` and `convex/userRates.ts`); `timer.previewRateForTask` (`convex/timer.ts:105-139`) has zero component consumers (`rg previewRate components app lib` → no hits); D1 plan §4.4 proactive warnings marked optional and unimplemented (`docs/d1-currency-integrity-plan.md:103-113`); rate dialogs list all 15 currencies unconditionally (`components/settings/settings-user-rates.tsx:176-180`)
- Affected workflow: rates / UI
- User/business impact: an admin cannot see which team members lack a cost rate in a currency actively used by clients/projects until a member's timer start or manual entry throws "Set a cost rate for this user in EUR". Nothing is *lost* (the block happens before work is measured or at stop with the timer kept alive), but the discovery moment is the worst one, and the fix path crosses to Settings without a link. Meanwhile a purpose-built preview query already exists unused.
- Reproduction: new member + EUR project; member opens a task and hits Start.
- Expected result: admin saw the gap beforehand (coverage view / team-tab warning); member sees an actionable pointer.
- Actual result: ConvexError toast at timer start; no coverage surface anywhere.
- Root cause: G4 of the D1 plan deprioritized; preview query shipped without its UI.
- Existing test coverage: n/a.
- Missing test: (after building) query test: coverage matrix = users × distinct currencies of clients having non-archived projects.
- Recommended fix: implement the coverage query (active currencies = distinct `client.currency` for clients with active projects; cross with `userRates`) + surface per D1 §4.4; wire `previewRateForTask` into timer buttons/entry forms. Detailed UX design is TASK-07's mandate — this finding fixes the code-capability gap only.
- Migration/backfill impact: none (read-only additions).
- Verification after fix: coverage view shows the seeded missing pair from the golden fixture.

### [F-RAT-05] Member removal orphans userRates rows invisibly

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): none directly (R2 unaffected — snapshots stable)
- Location: `convex/orgMembers.ts:117-133` (`deleteMembership` deletes only the membership row); `components/settings/settings-user-rates.tsx:33,109-158` renders rates grouped under `orgMembers.listOrgMembers` results, so rates of removed members exist in `userRates.list` output but are never displayed or removable
- Affected workflow: rates / settings
- User/business impact: cruft rows accumulate; if the person later rejoins the org, years-old rates silently apply to their new entries (write-time resolution) without the admin ever seeing them in Settings.
- Reproduction: set a rate; remove the member via Clerk; open Settings → User Rates (row gone); re-add member; start timer → old rate snapshots.
- Expected/Actual: expected either cleanup on removal or visibility of orphaned rows; actual invisible persistence.
- Root cause: no cascade and no orphan rendering.
- Missing test: convex-test on the rejoin path asserting the intended policy.
- Recommended fix: smallest — show "former member" rate rows in Settings (removable); or delete `userRates` rows on membership deletion (historical entries unaffected either way — snapshots).
- Migration/backfill impact: optional one-shot orphan sweep.
- Verification after fix: rejoin scenario behaves per chosen policy.

### Legacy category cost-rate check (spec Terminology review) — CLEAN

No legacy category cost-rate field, UI, migration, or calculation remains:
- `workCategories` schema has only `name/color/sortOrder/archivedAt/…` (`convex/schema.ts:467-476`); `projectCategoryEstimates` has only `estimatedMinutes` (`convex/schema.ts:232-240`) — the PRD-era `internalCostRate/clientBillingRate` fields were never kept.
- `defaultCostRate` appears only in historical docs (`docs/rates-refactor.md:51,179`, `docs/backlog.md:219`) — zero code hits.
- Legacy `countMissingCostRates`/`backfillMissingCostRates` removed (`convex/timeEntries.ts:600-601`); `convex/migrations/deleteLegacyTimeEntries.ts` purges pre-model entries.
- Category UI is bill-rate-only (`components/settings/settings-work-categories.tsx:135` uses `defaultBillRate`; onboarding `components/onboarding/step-categories.tsx:47-58` likewise); the only "Cost Rates" strings belong to User Rates (`components/settings/settings-user-rates.tsx:94-104`).

## Scenario matrix — Rates (code-level)

| Scenario | Backend behavior (cited) | Existing test coverage | Result |
|---|---|---|---|
| create / update / delete / recreate rate | upserts patch-or-insert on the unique key (`convex/userRates.ts:47-72`, `categoryRates.ts:49-74`, `projectRateOverrides.ts:46-71`); delete removes only the rate row; recreate = fresh row; stored snapshots never touched | none (mutations untested) | OK; snapshots stable (R2) |
| project override fallback to category default | override consulted first, category+currency default second (`convex/lib/orgHelpers.ts:77-94`); no auto-seeding of overrides at project creation (`convex/projects.ts:287-289` comment) | `rates.test.ts` covers pure branch only | OK |
| category missing on billable T&M/Fixed task | THROW "Set a category on this task before logging billable time" (`orgHelpers.ts:72-74`); retainer path bypasses the category requirement (`:67-71`) | none | OK (blocked, not silent) |
| cost rate missing | THROW "Set a cost rate for this user in {ccy}" (`rates.ts:35-40`); timer.start blocks upfront (`timer.ts:82`); stop rolls back and timer survives; archive autosave leaves the timer running (`timerEntry.ts:205-210`) | `rates.test.ts:22` | OK; discovery UX poor (F-RAT-04) |
| zero rate as intentional value | `0` passes `< 0` guards and is a *configured* rate, not "missing" (`rates.test.ts:89`) | yes (pure) | OK |
| NaN / Infinity / negative / extreme | negative rejected (`userRates.ts:40` etc.); NaN/Infinity/1e300 accepted and snapshotted | none | **FAIL — F-RAT-01** |
| currency change constraints | client currency immutable (`convex/clients.ts:178`); `project.clientId` + `billingType` not in update args (`convex/projects.ts:295-306`); override rows currency-agnostic but bound via immutability; **task→project mobility has a two-step bypass** (`convex/tasks.ts:1157-1160`, `:1674-1677`) | none | **FAIL — F-RAT-02** |
| historical entries before/after rate changes | unchanged by settings edits (R2); rewritten only by billability/task edits at current rates (`timeEntries.ts:447-468`, `:577-592`) | none | OK with flag — F-RAT-03 |

## Verified rate hierarchy brief (ground truth for TASK-07)

**The hierarchy as actually implemented** (matches the spec's intended mental model exactly):

```
currency  := client.currency of the task's project   (immutable; projects inherit it; never stored on project)
cost      := userRates[entry OWNER, currency]         exact pair; no fallback, no conversion, no default
bill      := retainer project        → 0  (always; revenue is period/cycle-level)
             non-billable entry/proj → 0
             T&M / Fixed billable    → projectRateOverrides[project, category]   (currency implied by project)
                                       → else categoryRates[category, currency]
                                       → else BLOCK with "Set a billable rate for this category in {ccy}"
             no category on task     → BLOCK (T&M/Fixed billable only)
snapshot  := { costRate, billableRate, rateCurrency, snapshotCategoryId } written onto the entry
```

**Snapshot moments (uniform rule: resolution happens at ledger-write time):**
- Timer: at **stop**, not start. Start and the (currently unused) `previewRateForTask` only pre-validate. A rate change mid-timer means the whole session gets the stop-time rate; a rate *deletion* mid-timer makes stop fail transactionally and the timer keeps running.
- Manual entry: at creation — current rates even for backdated dates.
- Edits: duration/note/date/startedAt never re-rate. Billability toggle or task move (same project only) re-rates the entry — including costRate — at current rates, silently (F-RAT-03).
- Nothing else ever rewrites a snapshot; rate-settings edits/deletes never touch history.

**Missing-rate behavior:** always a hard block with a currency-specific message *before* anything is written; measured timer work is never lost (rollback / left-running semantics). But discovery is reactive-only.

**Coverage-audit capability: none.** No backend query or UI shows (user × active-client-currency) gaps; the currency dropdown offers all 15 codes with no contextual narrowing; `timer.previewRateForTask` is built but unwired. (F-RAT-04 — TASK-07 owns the UX proposal; treat "no coverage surface exists today" as a code-verified fact.)

**Terminology ground truth for the UI review:** cost = person-owned, `userRates` only; bill = category/project-owned; retainer overage rate lives on the project/cycle level (`missing-overage-rate` machinery in `convex/lib/{readyToInvoice,billingScope,closeFlags}.ts` — TASK-05 scope), not on entries. No category cost-rate exists anywhere.

**Locked-model 8-point checklist (spec "Locked product decision"):**
1. Correct user+currency pair on every entry writer — **PASS** (call-site table above; all 6 writing paths pass the entry owner and the client currency).
2. Admin-on-behalf and archive-autosave use owner's rate, actor preserved — **PASS** (`timeEntries.ts:270/295`; `timerEntry.ts:193-194`).
3. Missing coverage detected before measured work can be lost — **PASS** (start-time block; stop rollback keeps timer; autosave leaves timer running), with the caveat that detection is reactive, not proactive.
4. Editing/deleting configured rates never touches stored snapshots — **PASS** (R2).
5. Project/client currency and `rateCurrency` cannot drift — **FAIL** (F-RAT-02 two-step task move).
6. UI makes currency coverage easy to configure and audit — **FAIL** at code level (no audit query/surface; F-RAT-04).
7. Admin can see which users are missing a rate for actively used currencies — **FAIL** (no such view; D1 G4 unimplemented).
8. Unnecessary currencies do not distract — **FAIL (minor)**: all 15 currencies offered unconditionally in every rate dialog (`settings-user-rates.tsx:176-180`); no narrowing to org-default/active client currencies.

No FX conversion, base-currency model, FX snapshots, or effective-dated rate versioning is proposed anywhere in this report, per the locked owner decision.

## Handoffs (for TASK-04 fixture and TASK-10 tests)

**For TASK-04 (golden fixture must exercise):**
1. Rate-change-mid-period rows: one user cost-rate upsert between two entries of the same user/project — expect the two entries to carry different `costRate` snapshots (write-time policy), and all aggregates to use snapshots, never current rates.
2. A timer that starts before and stops after a rate change — expect the **stop-time** rate on the whole duration (fixture note: mark this as intended-policy, not a bug).
3. Backdated manual entry created after a rate change with a date before it — expect the **new** rate.
4. An entry whose billability is toggled after a cost-rate change — expect full re-rate (documents F-RAT-03; if the fix lands, expectation changes to costRate-preserved).
5. Zero-cost-rate user (intentional value) — expect cost 0, no missing-rate error.
6. Missing EUR cost rate for one Org A member — expect timer.start/create blocked with "Set a cost rate for this user in EUR"; no entry row.
7. Project override on one category + category default in the same currency — expect override wins; delete the override mid-period — expect subsequent entries at category default, prior snapshots unchanged.
8. Retainer project entries — expect `billableRate === 0` on every entry regardless of category rates; category-less retainer task must still log billable time.
9. HUF high-magnitude rate (e.g. 30 000 Ft/h) — expect exact snapshot, no rounding at snapshot time.
10. Cross-org rate access rows: `userRates.remove`/`categoryRates.remove`/`projectRateOverrides.remove` with the other org's IDs — expect "Rate/Override not found" (`userRates.ts:80`, `categoryRates.ts:82`, `projectRateOverrides.ts:79`); `projectRateOverrides.listForProject` cross-org returns `[]` (`projectRateOverrides.ts:12`).

**For TASK-10 (tests that must exist; each fails before / passes after its fix):**
- `userRates.upsert` (+category/override upserts) rejects NaN, ±Infinity, 1e300 → F-RAT-01.
- Task with entries: `tasks.update {projectId: null}` and subsequent null→B rejected; same for `tasks.bulkUpdate` project action → F-RAT-02.
- Billability toggle after cost-rate change: assert chosen re-rate policy + audit record → F-RAT-03.
- Coverage query (once built): users × active client currencies matrix correctness → F-RAT-04.
- Member rejoin after removal: stale `userRates` row policy → F-RAT-05.
- Harness assertions (golden ledger): every fixture expectation in the TASK-04 list above, especially snapshot-stability across `userRates.remove` and invoice/settle lifecycles.
- Integration versions of the D1 §4.1 list (`docs/d1-currency-integrity-plan.md:62-75`) — currently only the pure resolver is tested; **zero** Convex integration tests exist for any rate mutation or writer.

<!-- TASK-02 end -->
