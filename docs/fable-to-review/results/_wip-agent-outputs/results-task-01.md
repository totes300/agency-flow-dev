<!-- TASK-01 begin -->
# TASK-01 — Time-entry writer trace (Phase 1; T1–T8, H1, H6 writer half)

Method: static code trace on branch `agentic` (commit `660d28f` at plan time). Verdicts qualified per locked decision #2 — no test was executed against a live deployment; "proven" always means "proven by trace". All paths are absolute-relative to repo root `/Users/tothadam/claude_code_projects/agency-flow-dev`.

Files read completely: `convex/timer.ts`, `convex/timeEntries.ts` (writers), `convex/lib/timer.ts`, `convex/lib/timerEntry.ts`, `convex/lib/rounding.ts`, `convex/lib/dateValidation.ts`, `convex/lib/settleGuards.ts`, `convex/lib/entryStatus.ts`, `convex/lib/settleEntries.ts`, `convex/lib/rates.ts`, `convex/lib/orgHelpers.ts` (rate/currency helpers), `convex/lib/auth.ts` (auth context), `convex/schema.ts` (timeEntries + user timer fields), `convex/tasks.ts` (archive/delete paths), `convex/projects.ts` (archive/remove), `convex/clients.ts` (archive/remove), `components/timer-provider.tsx`, `components/timer/*`, `lib/hooks/use-timer.ts`, `lib/duration.ts` (parse), `lib/workday.ts` (client date anchoring), plus `AGENTS.md` and `convex/_generated/ai/guidelines.md`.

---

## 01-system-map — Writer graph

### Ledger row shape (source of truth)

`timeEntries` table — `convex/schema.ts:361-425`. Key fields: `date` (YYYY-MM-DD, org tz), `startedAt` (epoch ms), `durationMinutes` (`v.number()` — no integer/finite constraint at schema level), `isBillable`, `method: "timer" | "manual"`, snapshot triple `costRate`/`billableRate`/`rateCurrency` (all required), `snapshotCategoryId`, `invoiceId?`, settlement quad `settledAt/settledReason/settledPeriodStart/settledPeriodEnd`, `skippedThrough?`, `createdBy` (actor), `userId` (owner). Indexes: `by_orgId`, `by_taskId`, `by_userId_date`, `by_orgId_date` (schema.ts:420-424).

Timer state lives on the **user document** (`convex/schema.ts:18-21`): `timerTaskId`, `timerStartedAt`, `timerAccumulatedMs`, `timerStatus` ("running" | "paused"). One timer per user, org-independent fields on the global user doc.

### Writers (complete inventory)

Two writer families create ledger rows; every creation funnels through exactly one of two code paths:

```
A. Manual family
   timeEntries.create (mutation, convex/timeEntries.ts:209-312)   method:"manual"

B. Timer family — single shared writer insertTimerEntry (convex/lib/timerEntry.ts:30-109)
   B1. timer.stop        (convex/timer.ts:156-260)  create-at-stop, server-measured or overrideMinutes
   B2. timer.commitEntry (convex/timer.ts:325-386)  "Save as 1m" escape hatch, today-anchored
   B3. autoSaveTimersForTasks (convex/lib/timerEntry.ts:123-214)  task-archive rescue,
       called from tasks.archive (convex/tasks.ts:1363) and tasks.bulkUpdate case "archive" (convex/tasks.ts:1706)

Mutators of existing rows
   timeEntries.update              (convex/timeEntries.ts:314-486)  duration/note/date/startedAt/billable/task-move
   timeEntries.remove              (convex/timeEntries.ts:488-520)  hard delete (guarded)
   timeEntries.bulkUpdateBillable  (convex/timeEntries.ts:545-598)  admin, per-task, skips locked rows

Settlement-state writers (T7 transitions; deep trace owned by TASK-05, listed for completeness)
   settleInvoiceEntries / unsettleInvoiceEntries (convex/lib/settleEntries.ts:85-191) ← convex/invoices.ts:2996,3006,3011,3280
   invoiceId stamping at draft creation (convex/invoices.ts:2086), line-item removal clears it (convex/invoices.ts:2758)
   closePeriodInternal / closePeriod / reopenPeriod (convex/retainerPeriods.ts:290-, 398-, 505-) stamp/clear "retainer_included"

Cascade deleters of ledger rows
   tasks.remove (convex/tasks.ts:1465-1522) → cascadeDeleteTaskData (convex/lib/task_helpers.ts:129-149) deletes entries by task
   tasks.bulkUpdate case "delete" (convex/tasks.ts:1718-1742) — blocks when any logged time exists (1722-1726)

Timer-state destroyers (no entry written)
   timer.discard (convex/timer.ts:301-312)                    user-confirmed discard
   projects.archive (convex/projects.ts:368-402)              WIPES running timers, no rescue  ← F-TMR-02
   projects.remove (convex/projects.ts:1189-1248)             BLOCKS on running timers (1220-1228) and on entries (1201-1209)
   tasks.remove / bulkUpdate "delete" (convex/tasks.ts:1512-1518, 1728-1736)  clears timers after entry guards + deleteImpact warning
   clients.remove (convex/clients.ts:279-347)                 deletes projects with NO entry/timer guard (TODOs :286, :333) ← F-TMR-01
   clients.archive (convex/clients.ts:248-262)                no cascade at all (TODO :260) — timers keep running, entries keep landing

Dev-only writers (not public surface): convex/devSeedArloJune.ts:223+ and convex/migrations/{seedInvoicingScenarios,wipeAllTimeEntries,deleteLegacyTimeEntries}.ts — all `internalMutation`.
No writer exists for `skippedThrough` — the schema comment (convex/schema.ts:406-418) references an admin-only `skipEntries` mutation that is not present in `convex/` (rg over non-generated sources matches only schema, `convex/lib/billingScope.ts`, and its test).
```

### Phase-1 writer table

| Writer | Entrypoint | Authorization | Duration source | Date+tz source | Rounding | Owner vs actor | Rate snapshot | Settle guards | Transaction boundary | Error/retry | Audit log |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Manual create | `timeEntries.create` timeEntries.ts:209 | `getAuthContext` (auth.ts:45); on-behalf requires `isAdmin` + `validateAssignees` (timeEntries.ts:224-229); task org-checked :235 | client `durationMinutes` (v.number) | `date := getDateInTimezone(args.startedAt, orgTz)` :253; client `date` must match or reject :254-258; tz = `orgSettings.timezone ?? "America/New_York"` :244 | `roundMinutes(x,1)` = `Math.ceil` :249; reject ≤0 :250; **no max** | owner = `args.userId ?? auth.userId`; `createdBy = auth.userId` :295 | `resolveRateSnapshot(owner, task, project, isBillable)` :270-276, at write time | `assertEntryDateOpen` on resolved date :264 (retainer closed period + finalized-invoice cover, settleGuards.ts:44-109) | single Convex mutation (all-or-nothing) | throws ConvexError; no partial writes | `logActivity "time_entry_logged"` :298-308 |
| Timer stop | `timer.stop` timer.ts:156 | `getAuthContext`; operates only on caller's own timer fields | server: `totalElapsedMs(timerStartedAt, Date.now(), accumulatedMs)` :181-185, capped `MAX_TIMER_MS` 16h (lib/timer.ts:14); or client `overrideMinutes` (0 < x ≤ 1440) :167-174 | `insertTimerEntry`: prefer real `sessionStartedAt` (running) else synthetic `now − rounded·60 000` (timerEntry.ts:71-73); `date = tzDay(startedAt)`; settled start-day ⇒ fall back to today :75-83 | `roundMinutes(msToMinutes(ms),1)` ceil (timerEntry.ts:52); <30 s & no override ⇒ discard, no row (timer.ts:211-225) | owner = actor = caller (timer.ts:232-233) | at **stop time** (timerEntry.ts:61-67) — not at start | `findEntryDateBlocker` w/ today-fallback + final guard (timerEntry.ts:76-87) | stop + insert + timer-clear in ONE mutation; failure rolls back and timer keeps running (comment timer.ts:150-153) | 2nd stop throws "No active timer" (timer.ts:164-166) — fields cleared :244 | **none** |
| Short-timer recovery | `timer.commitEntry` timer.ts:325 | `getAuthContext`; task org + archived + project org checks :342-352 | client `durationMinutes`, reject ≤0 :336-338; **no max** | forced to TODAY in org tz :357-363; synthetic anchor clamped into today :365-369 | ceil via insertTimerEntry; NaN/±Inf crash at `getDateInTimezone(synthetic)` before insert (RangeError → abort, no write) | owner = actor = caller :372-374 | at call time | today can't be settled ⇒ final guard passes (timerEntry.ts:86-87) | single mutation | not idempotent — each call inserts a new row | **none** |
| Task-archive autosave | `autoSaveTimersForTasks` timerEntry.ts:123 via tasks.ts:1363/1706 | archive: admin or assignee (tasks.ts:1347); rescue iterates all org members | server elapsed per member, same 16h cap (timerEntry.ts:163-168) | same as stop (sessionStartedAt when running) | ceil; <30 s cleared w/o entry :178-181 | **owner = timer's member; `createdBy` = archiving admin** (timerEntry.ts:34-37, 193-194) — R5-correct | owner's rate (timerEntry.ts:61-67) | same as stop | per-member try/catch: on failure timer LEFT RUNNING, reported to caller (timerEntry.ts:205-210) | degradation by design | **none** |
| Edit | `timeEntries.update` timeEntries.ts:314 | own entry or admin :331-333 | client `durationMinutes` (optional), ceil, reject ≤0 :352-357; **no max** | invariant re-checked when date or startedAt sent: `nextDate === tzDay(nextStartedAt)` else reject :366-379 (server never re-anchors; client uses `reanchorStartedAt`, lib/workday.ts:104-121) | ceil | owner immutable; rate re-resolution uses `entry.userId` :457-463 | **re-snapshot only when billable flag or task changed** :447-468; duration/date edits keep old snapshot | invoice/settled hard-lock :339-346; closed-period guard on date/task change :427-438; cross-project task move rejected :409-411 | single mutation | throws | logs only duration change :472-484 (billable/date/task moves unlogged) |
| Delete | `timeEntries.remove` timeEntries.ts:488 | own or admin :496-498 | n/a | n/a | n/a | n/a | n/a | invoice/settled hard-lock :501-508 | single mutation | throws | `time_entry_deleted` :510-516 |
| Bulk billable | `timeEntries.bulkUpdateBillable` timeEntries.ts:545 | admin only :555 | unchanged | unchanged | n/a | per-entry owner re-snapshot :577-583 | re-snapshot cost+bill+currency+category :585-592 | skips `invoiceId`/`settledAt` rows :573-574 | single mutation over `.collect()` of task's entries | throws | **none** |

### Client half (T1/T2/T3 relevant)

- `components/timer-provider.tsx:66-178` — display state only; elapsed is recomputed each second from server `startedAt`/`accumulatedMs` (:95-102). The client never sends an elapsed counter; `stopTimer` sends no duration (:120-123).
- Stop button `components/timer/floating-timer-widget.tsx:67-105` (`handleCommit`) has **no in-flight guard** — a double click fires two `timer.stop` calls; the second throws "No active timer" → error toast, **no duplicate row**. Same pattern in `components/tasks/inline-time-cell.tsx:143-161` and task-switch path :250-275.
- Post-stop form `components/timer/timer-commit-form.tsx:25-73` edits/deletes the already-persisted entry; abandoning it keeps the measured values (T2 by design). Line 119 renders the literal label `exact` beside the **ceiled** minutes (H1).
- Stale dialog `components/timer/stale-timer-dialog.tsx:58-81` — single atomic `stopTimer({overrideMinutes})`, `saving` double-click guard :60, prefill capped to 16h :49.
- Under-30s toast "Save as 1m" (floating-timer-widget.tsx:84-97) calls `timer.commitEntry` — not idempotent server-side.

### Duplicated derivations / sources of truth

- Org timezone fallback duplicated: server `convex/lib/timer.ts:6` and client `lib/hooks/use-org-timezone.ts` (declared mirror; comment at lib/timer.ts:2-5).
- 16 h cap duplicated: `convex/lib/timer.ts:14` and `components/timer/stale-timer-dialog.tsx:21` (comment-declared mirror).
- 8 h stale threshold duplicated: `convex/timer.ts:12` and `stale-timer-dialog.tsx:20`.
- date↔startedAt invariant enforced server-side (create/update) and re-derived client-side (`lib/workday.ts:44-59,79-121`); server rejects rather than trusts client anchoring — safe direction.
- elapsed-ms computation duplicated between `timer.stop` (timer.ts:181-185), `autoSaveTimersForTasks` (timerEntry.ts:163-168) and `tasks.deleteImpact` (tasks.ts:1442-1448) — three hand-rolled copies of the same cap+sum.

---

## 02-invariant-verdicts — T1–T8 (draft)

| Inv | Verdict | Evidence | Findings |
|---|---|---|---|
| T1 Server authority | **partially proven (by trace)** | All timer segments measured from server `Date.now()` stored on the user doc (timer.ts:90-96, 271-281, 293-297); stop computes duration server-side (timer.ts:177-185); client never supplies an elapsed counter (timer-provider.tsx:120-123). Exception: `stop.overrideMinutes` is client-supplied, accepted on ANY stop (not only stale), and leaves **no audit marker** — the row is `method:"timer"`, indistinguishable from measured time (timer.ts:167-174, 230-242; timerEntry.ts:89-106). The correction flow is explicit but not audited, so the T1 exception clause is not fully met. | F-TMR-05 |
| T2 No lost measured time | **violated** | Core stop path is exemplary: create-at-stop persists the entry in the same transaction as the timer clear (timer.ts:230-244); rollback keeps the timer alive; abandoning the post-stop form loses nothing (timer-commit-form.tsx:25-30). BUT `projects.archive` silently wipes running/paused timers with no entry (projects.ts:386-397), and `clients.remove` deletes projects out from under running timers, whose eventual stop hits the dangling branch and discards the measurement (clients.ts:324-335 + timer.ts:191-207). | F-TMR-01, F-TMR-02 |
| T3 No double-counted time | **proven (by trace)** | `stop` clears all four timer fields in the same transaction that inserts the entry (timer.ts:230-244); any second stop — double click, second tab, replay — sees `!user.timerTaskId` and throws (timer.ts:164-166). Convex mutations are serializable transactions, so two concurrent stops cannot both observe the running state. Task-switch stops once then starts (inline-time-cell.tsx:250-275); `timer.start` rejects while a timer exists (timer.ts:64-66). Residual: `commitEntry` is not idempotent (each call inserts) — reachable only from the one-shot toast action; flagged to TASK-08 for UI verification. No duplicate-row path found. | — |
| T4 Exactness is explicit | **partially proven (by trace)** | What is stored is precisely documented in code: whole-minute CEILING of measured ms (`roundMinutes(raw,1)` = `Math.ceil`, rounding.ts:6-10, applied timerEntry.ts:52, timeEntries.ts:249,354); sub-30 s stops discarded (timer.ts:211-225); 16 h stale cap (timer.ts:185, timerEntry.ts:163-168); override ≤ 24 h (timer.ts:170-174). Raw milliseconds are returned transiently in `StopResult.elapsedMs` but never persisted — **not recoverable** from the ledger. Violation of the labeling clause: the commit form labels the ceiled value "exact" (timer-commit-form.tsx:119), and the schema comment claims `durationMinutes` is rounded by `orgSettings.roundingMinutes` (schema.ts:366-369), which has been false since the 2026-07-05 raw-ledger decision (timerEntry.ts:48-51). | F-TMR-06 |
| T5 Date/time consistency | **proven (by trace), with two qualifications** | Invariant `date === tzDay(startedAt, orgTz)` is enforced at every write: derived+rejected on create (timeEntries.ts:253-258), re-checked on update (:366-379), constructed on timer paths (timerEntry.ts:73-87; commitEntry today-anchor timer.ts:357-369). `getDateInTimezone` uses `Intl.DateTimeFormat` with the org zone (lib/timer.ts:48-62) — DST spring/fall and midnight crossing map to the correct calendar day; durations are real elapsed ms, unaffected by offset changes. Overnight timers file the full duration under the session start day; settled start-day falls back to today (timerEntry.ts:75-83) keeping the invariant. Qualifications: (1) paused-timer stops lose the real session start (`pause` clears `timerStartedAt`, timer.ts:276-280) and fabricate `startedAt = now − duration` (timerEntry.ts:71-73) — invariant holds but the day can differ from when work actually happened; (2) `orgSettings.timezone` is validated only for length ≤100 (orgSettings.ts:70,180) — an invalid IANA string makes every write throw `RangeError` (org-wide outage, no corruption). | F-TMR-07, F-TMR-09 |
| T6 One canonical writer policy | **partially proven (by trace)** | All creations flow through exactly two implementations sharing `roundMinutes`, `resolveRateSnapshot` (always the OWNER's rate), the settled-scope guard, and the date invariant. Documented, intentional differences: timer anchors dates server-side while manual accepts any `startedAt`. Undocumented drift: (a) duration caps — timer 16 h / override 24 h vs **no cap at all** on create/update/commitEntry; (b) audit — manual create/edit/delete log activity, all timer-family writes log nothing, and update logs only duration changes; (c) archive policy — task archive rescues timers, project archive wipes them, client archive does nothing. | F-TMR-02, F-TMR-04, F-TMR-08 |
| T7 Locked history | **partially proven (by trace)** | Entry-level guards are complete and two-axis: `invoiceId` (status-aware message, timeEntries.ts:26-36, 339-341, 501-503) and `settledAt` (:342-346, 504-508); bulk billable skips locked rows (:573-574); date/task moves re-run the closed-period guard (:427-438); cross-project moves rejected (:409-411; tasks.ts:1157-1159, 1673-1676); task delete blocks on locked entries and requires explicit consent for free ones (tasks.ts:1484-1502); unsettle transitions preserve `retainer_included` under still-closed periods (settleEntries.ts:145-189). HOLE: `clients.remove` deletes the project layer above settled-without-invoice entries with no time-entry guard (clients.ts:286 TODO), stranding closed financial history. | F-TMR-01 |
| T8 Valid numeric domain | **violated** | Negative and zero rejected everywhere (`rounded <= 0` after ceil); integers guaranteed by ceil. But `v.number()` admits IEEE-754 specials and every guard is a `<=`/`>` comparison that **NaN passes**: `timeEntries.create` inserts `durationMinutes: NaN` (timeEntries.ts:249-250 — `Math.ceil(NaN)=NaN`, `NaN<=0` false → :279-296 insert); `timeEntries.update` patches NaN (:352-357); `timer.stop({overrideMinutes: NaN})` passes both bounds checks (timer.ts:167-174 — `NaN<=0` and `NaN>1440` both false) and inserts NaN (running-timer path keeps a valid `startedAt`, so no crash intercepts it). `Infinity` additionally passes create/update (no upper bound). One NaN row poisons every downstream sum. Also unbounded finite magnitudes (e.g. 10⁹ minutes) accepted by create/update/commitEntry; `startedAt` accepts any epoch incl. far future. `commitEntry` self-immunizes against NaN/±Inf only accidentally (synthetic-date computation throws RangeError before insert, timer.ts:367-369). | F-TMR-03, F-TMR-04 |

### Hypothesis dispositions (this task's ownership)

- **H1 (timer ledger not fully raw): CONFIRMED.** `roundMinutes(raw, 1)` ceils to the next whole minute before storage (rounding.ts:8 via timerEntry.ts:52; same on manual create timeEntries.ts:249). 61 s → 2 min; 30 s → 1 min; mean inflation ≈ +29.5 s per entry, strictly upward, systematic. This is a documented product decision ("RAW LEDGER … ceiled to a whole minute only", timerEntry.ts:48-51), so the defect is honesty, not math: the UI labels the ceiled value "exact" (timer-commit-form.tsx:119) and the schema comment describes the pre-2026-07-05 policy (schema.ts:366-369). Raw milliseconds are NOT recoverable: `elapsedMs` exists only in the transient `StopResult`; the row stores `startedAt` + rounded minutes and no end timestamp.
- **H6 writer half (numeric specials bypass validation): CONFIRMED** — see T8. Exact bypasses: `timeEntries.create.durationMinutes` (NaN, +Inf), `timeEntries.update.durationMinutes` (NaN, +Inf), `timer.stop.overrideMinutes` (NaN only; +Inf caught by the 1440 bound). `timer.commitEntry` crashes safely on specials. Rate-field halves belong to TASK-02.

---

## 04-findings — F-TMR-*

### [F-TMR-01] Deleting a client destroys uninvoiced logged time and strands running timers

- Severity: Critical
- Confidence: Confirmed
- Affected invariant(s): T2, T7, A1/A4 (downstream), R2
- Location: `convex/clients.ts:279-347` (`clients.remove`); missing guards flagged by the code's own TODOs at `convex/clients.ts:286` ("block if time entries exist") and `:333` ("cascade delete tasks"). Contrast with `convex/projects.ts:1196-1228` (`projects.remove`) which blocks on both entries and running timers. Dangling-timer discard branch: `convex/timer.ts:191-207`.
- Affected workflow: manual entry, timer, T&M, retainer, report
- User/business impact: An admin deletes a client (invoice guard passes because nothing was invoiced yet — exactly the revenue at risk). Every project of that client is deleted; tasks and time entries survive but point at a dead project. Project-scoped billing/reporting surfaces enumerate project→tasks→entries, so the hours disappear from billing forever while still appearing in My Time / task views (surfaces disagree). Any member with a running timer on those tasks keeps a dangling timer; their next stop takes the `!project` branch and **discards the measured time**. Entries also become partially uneditable (billable toggle re-resolution hits "Project not found", `convex/timeEntries.ts:454-455`).
- Reproduction: Org with client C → project P → task T; member logs 2 h on T (no invoice); second member starts a timer on T. Admin calls `clients.remove(C)`. Observe: P deleted, entry orphaned from all project reporting, running member's later `timer.stop` returns `discarded: true` with `entryId: null`.
- Expected result: deletion blocked while any project of the client has time entries or running timers (message parity with `projects.remove`), or an explicit consent + cascade design.
- Actual result: projects deleted unconditionally after the invoice-only guard; entries and timers stranded.
- Root cause: known-debt TODOs never implemented after Phase 7 introduced time entries.
- Existing test coverage: none (zero Convex integration tests repo-wide).
- Missing test: convex-test — seed client/project/task/entry + running timer; expect `clients.remove` to throw; second case with invoice present already covered by the invoice guard.
- Recommended fix: replicate `projects.remove`'s two guards (entries: projects.ts:1201-1209; timers: projects.ts:1220-1228) inside the `clients.remove` project loop.
- Migration/backfill impact: none (guard only). Optionally a one-shot integrity scan for entries whose task's `projectId` no longer resolves.
- Verification after fix: the two convex-test cases above fail before, pass after.

### [F-TMR-02] Archiving a project silently wipes running timers (no rescue, no trace)

- Severity: Critical
- Confidence: Confirmed
- Affected invariant(s): T2, T6
- Location: `convex/projects.ts:368-402` (`projects.archive`), timer wipe at :386-397 under the misleading comment "Stop running timers" :375. Correct pattern exists at `convex/tasks.ts:1341-1372` (`tasks.archive` → `autoSaveTimersForTasks`, `convex/lib/timerEntry.ts:123-214`).
- Affected workflow: timer
- User/business impact: Admin archives a project while a member has a running or paused timer on one of its tasks (normal end-of-engagement action). The member's measured hours are destroyed with no entry, no toast, no return value, no log — the exact failure mode the 2026-07-05 task-archive hardening eliminated (timerEntry.ts:112-121 documents that rationale).
- Reproduction: member starts timer on task in project P (≥30 s); admin runs `projects.archive(P)`; member's timer state is gone and no `timeEntries` row exists.
- Expected result: same rescue as task archive — commit elapsed time per member (owner = member, `createdBy` = admin), report failures, leave failing timers running.
- Actual result: four timer fields cleared for every member with a timer on any project task; measurement lost.
- Root cause: `projects.archive` predates the task-archive rescue and was never retrofitted; the stale comment says "stop" but the code deletes state.
- Existing test coverage: none.
- Missing test: convex-test — running timer on project task, archive project, assert an entry exists with the member's minutes and `createdBy` = admin.
- Recommended fix: compute `projectTaskIds`, call `autoSaveTimersForTasks` (identical to tasks.ts:1363), return `{saved, failed}` for the toast.
- Migration/backfill impact: none.
- Verification after fix: test above; manual: archive with a live timer, observe auto-saved entry toast.

### [F-TMR-03] NaN (and Infinity) reach `durationMinutes` through three public writers

- Severity: High
- Confidence: Confirmed
- Affected invariant(s): T8, H6 (writer half — confirmed)
- Location: `convex/timeEntries.ts:249-250` + insert :279-296 (`create`); `convex/timeEntries.ts:352-357` + patch :470 (`update`); `convex/timer.ts:167-174` + `convex/lib/timerEntry.ts:52-54,89-106` (`stop` with `overrideMinutes: NaN`). Root guard: `convex/lib/rounding.ts:6-10` (`Math.ceil(NaN) === NaN`, `NaN <= 0 === false`).
- Affected workflow: timer, manual entry
- User/business impact: One row with `durationMinutes: NaN` turns every aggregate that includes it into NaN — task sums (timeEntries.ts:141), My Time today (:166), project overview, retainer usage, invoice drafts. Convex `v.number()` explicitly admits NaN/±Inf (convex/_generated/ai/guidelines.md line 73). Not reachable from the shipped UI (`parseDuration` returns positive ints or null, lib/duration.ts:15-40), but these are public mutations callable by any authenticated member with a hand-crafted client.
- Reproduction: authenticated call `api.timeEntries.create({taskId, durationMinutes: NaN, startedAt: Date.now()})` → row inserted with NaN. Or `api.timer.stop({overrideMinutes: NaN})` on a running timer. `Infinity` likewise via create/update (no upper bound); `timer.stop` rejects Infinity via the 1440 check; `commitEntry` crashes on specials before insert (timer.ts:367-369 — RangeError, no write).
- Expected result: reject non-finite and non-safe numbers at every numeric arg.
- Actual result: NaN/Infinity stored in the ledger.
- Root cause: all validation is ordering comparisons (`<= 0`, `> MAX`), which NaN fails to trip; no `Number.isFinite`/`Number.isSafeInteger` layer.
- Existing test coverage: `convex/lib/rounding.test.ts` covers 0/negative/positive — no NaN/Inf case.
- Missing test: unit — `roundMinutes(NaN,1)`/`roundMinutes(Infinity,1)` expected behavior; convex-test — each writer rejects NaN/±Inf for `durationMinutes`, `overrideMinutes`, `startedAt`.
- Recommended fix: a tiny `assertFiniteMinutes(x, max)` helper applied in `create`, `update`, `stop`, `commitEntry` (and `startedAt` range check); alternatively harden `roundMinutes` to throw on non-finite input.
- Migration/backfill impact: scan for existing non-finite rows (dummy-data stage → likely none).
- Verification after fix: new tests fail before / pass after.

### [F-TMR-04] No upper bound on manual durations or `startedAt` (fabricated magnitudes, future dates)

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): T8, T6
- Location: `convex/timeEntries.ts:249-250` (create — ceil + `<=0` only), `:352-357` (update), `convex/timer.ts:336-338` (commitEntry — `<=0` only). Contrast: timer measurement capped 16 h (`convex/lib/timer.ts:14`, timer.ts:185) and override capped 24 h (timer.ts:170-174). `startedAt: v.number()` accepted with no range check (timeEntries.ts:213, insert :284); future dates produce valid future `date` strings.
- Affected workflow: manual entry
- User/business impact: a member can log 1,000,000,000 minutes on today (via `commitEntry` or `create`), or an entry dated years into the future/past (subject only to the retainer closed-period guard). Billing/report surfaces render absurd totals; a fat-fingered `durationMinutes` in an API integration silently corrupts monthly totals.
- Reproduction: `api.timer.commitEntry({taskId, durationMinutes: 1e9, isBillable: true})` → inserted, dated today (the synthetic anchor lands pre-today so it re-anchors to `now`, timer.ts:365-369).
- Expected result: a sanity ceiling consistent with the timer family (e.g. ≤ 24 h per entry) and a bounded `startedAt` window, or a documented product decision to allow both.
- Actual result: unbounded.
- Root cause: caps were added to timer paths during the 2026-07-05 hardening but never to the manual family.
- Existing test coverage: none.
- Missing test: convex-test — create/update/commitEntry reject > cap; document the intended future-date policy in a test either way.
- Recommended fix: shared max-minutes constant + validation in the three writers; decide and enforce (or explicitly allow) future `startedAt`.
- Migration/backfill impact: none.
- Verification after fix: tests above.

### [F-TMR-05] `timer.stop` accepts an unaudited client-supplied duration on ANY stop, recorded as measured timer time

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): T1, T4
- Location: `convex/timer.ts:167-174` (validation), `:236` (`rawMinutes: args.overrideMinutes ?? msToMinutes(elapsedMs)`); row written with `method: "timer"` and no override marker (`convex/lib/timerEntry.ts:89-106`); no activity log (see F-TMR-08). UI exposes overrides only in the stale dialog (`components/timer/stale-timer-dialog.tsx:73`), but the mutation does not require `isStale`.
- Affected workflow: timer
- User/business impact: any member can run a timer for 31 s and stop it with `overrideMinutes: 1440`, minting a 24 h entry that is byte-identical to server-measured time. T1 permits corrections only through an "explicit and audited" flow; this one is explicit but leaves zero audit trail (`createdBy` = owner, no flag, no log), so an agency cannot distinguish measured hours from asserted hours after the fact. (Members can also fabricate via `create`, but those rows honestly say `method:"manual"`.)
- Reproduction: start timer, wait 31 s, call `api.timer.stop({overrideMinutes: 1440})` → 24 h `method:"timer"` row.
- Expected result: override recorded (e.g. `overrideApplied: true` on the row or an activity-log event carrying measured vs asserted minutes), and/or override permitted only when `elapsedMs ≥ STALE_THRESHOLD_MS`.
- Actual result: silent, unmarked substitution of the measurement.
- Root cause: stale-dialog escape hatch implemented as an unconditional mutation arg.
- Existing test coverage: none.
- Missing test: convex-test — stop with override stores an audit marker; stop with override below stale threshold behaves per decided policy.
- Recommended fix: persist the measured `elapsedMs` (or a boolean + delta) whenever `overrideMinutes` is used; optionally gate on staleness.
- Migration/backfill impact: additive optional field — none.
- Verification after fix: test above; row inspection shows the marker.

### [F-TMR-06] Ceiled ledger value labeled "exact"; schema comment describes the abandoned rounding policy

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): T4, H1 (confirmed)
- Location: `components/timer/timer-commit-form.tsx:119` (literal `exact` beside `formatDuration(stopResult.roundedMinutes)`; the raw elapsed is shown separately at :92-95); `convex/schema.ts:366-369` ("durationMinutes is rounded by orgSettings.roundingMinutes" — false since the raw-ledger decision, `convex/lib/timerEntry.ts:48-51`); honest labels exist elsewhere (`lib/display-constants.ts:40` "Exact — to the minute").
- Affected workflow: timer, UI
- User/business impact: a 61-second stop stores and displays "2m" labeled "exact". Per T4, a rounded ledger must not be called exact without qualification; users reconciling against their own clocks (or clients auditing worksheets) see a value claimed exact that is up to 59 s inflated. The stale schema comment misleads future engineering into believing workspace rounding mutates the ledger.
- Reproduction: run timer 61 s → stop → commit form shows `0h 02m` with the "exact" suffix.
- Expected result: label such as "to the minute" / "rounded up"; schema comment updated to the invoice-time-only rounding rule.
- Actual result: bare "exact" on a ceiled value; contradictory schema doc.
- Root cause: label predates the rounding-policy decision; comment not updated with it.
- Existing test coverage: none.
- Missing test: n/a (copy change); component test may assert the qualified label.
- Recommended fix: change the suffix copy; fix schema comment.
- Migration/backfill impact: none.
- Verification after fix: visual.

### [F-TMR-07] Org timezone accepted unvalidated — one bad string bricks every time write in the org

- Severity: Medium
- Confidence: Confirmed
- Affected invariant(s): T5
- Location: `convex/orgSettings.ts:70` and `:180` (`validateStringLength(args.timezone, 100)` is the ONLY check); consumed by `getDateInTimezone` (`convex/lib/timer.ts:48-62`) in every writer (`convex/timeEntries.ts:253`, `convex/timer.ts:358`, `convex/lib/timerEntry.ts:70`); `Intl.DateTimeFormat` throws `RangeError` on an invalid IANA zone.
- Affected workflow: timer, manual entry, reports (every date bucketing)
- User/business impact: if `orgSettings.timezone` is ever set to a non-IANA string (API call, future settings UI regression, import), every timer stop, commit, manual create, and date-touching update in the org throws an unhandled RangeError until the setting is fixed. No corruption (transactions abort), but a full time-logging outage whose error message points nowhere near the cause.
- Reproduction: set timezone to `"Not/AZone"` via `api.orgSettings.update`; any subsequent `timer.stop` throws RangeError.
- Expected result: reject invalid zones at write (`Intl.supportedValuesOf("timeZone")` membership or a construct-and-catch probe), and/or a defensive fallback in `getDateInTimezone`.
- Actual result: length check only.
- Root cause: missing domain validation.
- Existing test coverage: none.
- Missing test: convex-test — `orgSettings.update({timezone:"Not/AZone"})` rejected; unit — `getDateInTimezone` fallback behavior if added.
- Recommended fix: validate at the two orgSettings writers.
- Migration/backfill impact: none (existing values presumably valid).
- Verification after fix: tests above.

### [F-TMR-08] Audit-log asymmetry: timer-born entries and non-duration edits leave no activity trail

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): T6, T1 (audit clause)
- Location: `convex/lib/timerEntry.ts:89-108` (no `logActivity`); `convex/timer.ts` stop/commitEntry (none); `convex/timeEntries.ts:472-484` (`update` logs only when `durationMinutes` changed — billable flips, date moves, task moves unlogged); `convex/timeEntries.ts:545-598` (`bulkUpdateBillable` — none). Manual create/delete DO log (:298-308, :510-516).
- Affected workflow: timer, manual entry
- User/business impact: the task activity feed shows manually logged time but not timer-logged time (the majority path), and shows a duration edit but not a billability or date change — the edits with direct billing impact. Weakens after-the-fact dispute resolution and makes F-TMR-05 unobservable.
- Reproduction: stop a timer on a task → no `time_entry_logged` activity row; toggle an entry's billability → no activity row.
- Expected result: symmetric activity events for all entry creations and billing-relevant edits.
- Actual result: asymmetric.
- Root cause: `logActivity` calls added to the manual family only.
- Existing test coverage: none.
- Missing test: convex-test asserting activity rows per writer.
- Recommended fix: add `logActivity` in `insertTimerEntry` (or its callers) and for billable/date/task changes in `update`/`bulkUpdateBillable`.
- Migration/backfill impact: none.
- Verification after fix: feed shows timer entries.

### [F-TMR-09] Pausing destroys the real session start; paused stops fabricate `startedAt`

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): T5 (semantic), T4
- Location: `convex/timer.ts:276-281` (`pause` sets `timerStartedAt: undefined`, keeping only `accumulatedMs`); `convex/timer.ts:237-238` (stop passes `sessionStartedAt` only when status is "running"); `convex/lib/timerEntry.ts:71-73` (paused stop synthesizes `startedAt = now − rounded·60 000`).
- Affected workflow: timer
- User/business impact: work done 09:00–10:00, paused, stopped at 18:00 files with `startedAt ≈ 17:00` — wrong hour-of-day on the Workday grid and, if stopped after midnight, potentially the wrong calendar day relative to when the work happened (the ledger invariant still holds; the semantic claim "day the work began" from timerEntry.ts:11-13 does not, for paused stops). Deterministic and bounded; mostly a truthfulness issue on the Workday visualization.
- Reproduction: start 23:50, pause 23:55, resume-free stop at 00:30 → entry dated the NEW day with synthetic 00:25 start; work actually began yesterday.
- Expected result: preserve first-segment start (e.g. `timerFirstStartedAt`) across pauses and anchor to it.
- Actual result: synthetic anchor.
- Root cause: pause reuses `timerStartedAt` as the "current segment" marker, discarding session origin.
- Existing test coverage: none.
- Missing test: convex-test — pause-spanning-midnight stop files under session-start day.
- Recommended fix: optional extra field; low priority (document instead if accepted).
- Migration/backfill impact: additive field only.
- Verification after fix: test above.

### [F-TMR-10] Dead/stale writer documentation: phantom `skipEntries` mutation and misleading archive comment

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): none directly (review honesty)
- Location: `convex/schema.ts:406-418` — `skippedThrough` documented as "Set/cleared only by the admin-only `skipEntries` mutation (Slice 05)", but no such mutation exists (rg over `convex/` matches only schema, `convex/lib/billingScope.ts`, and its test — the field currently has NO writer); `convex/projects.ts:375` comment "Stop running timers" above code that wipes them (see F-TMR-02); `convex/clients.ts:260,286,333` TODOs documenting the missing cascades (see F-TMR-01).
- Affected workflow: n/a (documentation)
- User/business impact: future changes trust comments that describe unbuilt or contrary behavior.
- Reproduction: `rg -n "skipEntries" convex` → schema comment only.
- Expected/Actual, Root cause: doc drift from slice-based delivery.
- Existing test coverage / Missing test: n/a.
- Recommended fix: implement or re-comment; fold into F-TMR-01/02 fixes.
- Migration/backfill impact: none. Verification: comment review.

### [F-TMR-11] `timeEntries.create` and `timer.stop` trust the task→project link without an explicit project org check

- Severity: Low
- Confidence: Confirmed
- Affected invariant(s): tenancy hygiene (AGENTS.md "After ID-based reads, verify ownership")
- Location: `convex/timeEntries.ts:239-240` (`if (!project) throw` — no `project.orgId !== orgId` check); `convex/timer.ts:192-193` (same); contrast `timer.commitEntry` which does check (`convex/timer.ts:352`).
- Affected workflow: manual entry, timer
- User/business impact: no exploit found — `task.projectId` is only ever set through org-validated task writers (`convex/tasks.ts:1154-1155, 1577-1578`), so the invariant holds transitively. This is a defense-in-depth gap versus the repo's stated non-negotiable, and one drifted task row would silently produce a cross-org rate snapshot (`getProjectCurrency` reads the other org's client, `convex/lib/orgHelpers.ts:17-26`).
- Reproduction: none under current writers (requires pre-existing data drift).
- Expected result: `project.orgId !== orgId` rejection, matching `commitEntry`.
- Actual result: null-check only.
- Root cause: inconsistent hardening across the three call sites.
- Existing test coverage: none. Missing test: convex-test with a drifted fixture row.
- Recommended fix: add the two checks.
- Migration/backfill impact: none. Verification: tests.

---

## Scenario matrix — Timer + Manual entry (code-level)

Columns owned here: **Backend behavior** and **Existing test coverage**. UI column = TASK-08 (rows marked "code-level only" where TASK-08 must not attempt live repro). Baseline for all rows: there are ZERO Convex integration tests; every "covered" cell below is pure-unit only.

### Timer

| Scenario | Backend behavior (per code trace) | Existing test coverage |
|---|---|---|
| start → pause → resume → stop | Server timestamps only: start sets `timerStartedAt=Date.now()` (timer.ts:90-96); pause folds segment into `accumulatedMs`, clears `startedAt` (:271-281); resume sets fresh `startedAt` (:293-297); stop sums `accumulated + (now − startedAt)` (:181-185). Entry created at stop in same transaction (:230-244). | Pure helpers only: `convex/lib/timer.test.ts` (computeElapsedMs/totalElapsedMs). No integration test. |
| stop, tab closed before post-stop edit | Entry already persisted (create-at-stop); post-stop form only edits/deletes it (timer-commit-form.tsx:25-30). Nothing lost. | None. |
| mutation retry / double click | First stop clears timer fields in-transaction (timer.ts:244); replay/second click throws "No active timer" (:164-166). No duplicate. Client stop buttons lack in-flight guards → spurious error toast possible (floating-timer-widget.tsx:67-105). | None. |
| two browser tabs | Timer state is one server doc; both tabs subscribe via `timer.getState`. Concurrent stops serialize; loser throws (:164-166). No duplicate. | `components/timer-provider.test.tsx` covers context plumbing only. |
| task switch while running | Client stops (entry persisted), routes `StopResult` to widget via `pendingStopResult`, then starts new timer (inline-time-cell.tsx:250-275); `timer.start` rejects if a timer exists (timer.ts:64-66). | timer-provider.test.tsx:242-299 (pendingStopResult state only). |
| task archive / project deletion while running | Task archive: rescue commit per member, failures leave timer running (tasks.ts:1363, 1706; timerEntry.ts:123-214). Task delete: entry-guards then timers cleared, impact disclosed by `deleteImpact` (tasks.ts:1429-1462, 1512-1518). Project delete: BLOCKED on running timers (projects.ts:1220-1228). **Project archive: timers wiped, time lost — F-TMR-02. Client delete: timers stranded then discarded at stop — F-TMR-01.** | `convex/lib/__tests__/settleGuards.test.ts` (pure predicates only). Nothing on archive/rescue. |
| missing rate at start | `timer.start` pre-resolves the snapshot and throws a config-fix message before any time is spent (timer.ts:80-88); `previewRateForTask` offers the non-throwing check (:105-139). | `convex/lib/rates.test.ts` (pure resolver). |
| rate changed between start and stop | Snapshot resolved at STOP, not start (timerEntry.ts:61-67 runs inside `stop`) — stop-time rates win. Backdated manual entries get creation-time rates. Consistent moment per writer; policy documentation → TASK-02 (H2). | rates.test.ts (pure). |
| timer crosses midnight | Files ENTIRE duration under session start day: `startedAt = sessionStartedAt`, `date = tzDay(startedAt)` (timerEntry.ts:73-74). If start day became settled overnight → refile under today (:75-83). Paused-at-midnight caveat: F-TMR-09. | `getDateInTimezone` midnight tests (convex/lib/timer.test.ts:36-47) — pure, non-DST zones. |
| timer crosses DST | Duration = real elapsed ms (offset-immune); `date` via Intl in org zone (lib/timer.ts:48-62). No DST-specific branch needed or present. Code-level only for TASK-08. | No DST test exists. |
| under 30 seconds | `elapsedMs < 30_000` and no override → timer cleared, `discarded: true`, no row (timer.ts:211-225). "Save as 1m" toast escape → `commitEntry` (widget :84-97). | None. |
| exactly 30 seconds | `30_000 < 30_000` false → SAVED; 0.5 min → ceil → 1 minute stored. | rounding.test.ts `0.5 @ 1 → 1` (pure). |
| 60 seconds | 1.0 min → 1 minute stored. | rounding.test.ts `1 @ 1 → 1`. |
| 61 seconds | 61/60 ≈ 1.017 → ceil → **2 minutes stored** (H1 inflation). | rounding.test.ts `1.1 @ 1 → 2` (equivalent). |
| stale 8 h / max 16 h | `isStale` at ≥ 8 h (timer.ts:12,186) → client dialog; stop still permitted. Elapsed hard-capped at 16 h (timer.ts:185; lib/timer.ts:14); archive rescue applies the same cap (timerEntry.ts:163-168); dialog prefill mirrors the cap client-side (stale-timer-dialog.tsx:49). | timer-provider.test.tsx:302-376 (client stale derivation only). |
| override above allowed max | `overrideMinutes > 1440` rejected (timer.ts:170-174); `<= 0` rejected (:167-169). **NaN passes both — F-TMR-03.** No stale-ness precondition and no audit marker — F-TMR-05. | None. |
| browser clock manipulation | No effect on the ledger: every timestamp is server `Date.now()`; the client clock only skews the cosmetic tick (timer-provider.tsx:95-102). Code-level only. | n/a. |

### Manual entry

| Scenario | Backend behavior (per code trace) | Existing test coverage |
|---|---|---|
| today / past / future date | `create` accepts any `startedAt`; `date` derived from it (timeEntries.ts:253). Past dates allowed unless inside a settled retainer scope (:264). **Future dates allowed — no guard** (see F-TMR-04 note). | `assertValidDateString` has NO test; date-format guard at timeEntries.ts:232. |
| custom wall-clock start time | `startedAt` is authoritative; optional `date` must equal its tz-day or reject (:253-258). Client anchoring helpers in lib/workday.ts:79-121 (DST-safe by re-check, comment :44-47). | `lib/workday.test.ts` covers anchor/reanchor pure fns. |
| date/start mismatch | Rejected with explicit message on create (:254-258) and update (:371-376 — "also send a re-anchored startedAt"). Server never silently re-anchors. | None. |
| admin logs for another member | `args.userId` path requires `isAdmin` + `validateAssignees` (:224-229); snapshot uses OWNER's rates (:270-276 with `entryUserId`); `createdBy` = acting admin (:295). R5-correct. | None. |
| member attempts to log for another member | Rejected: "Only admins can log time for other users" (:225-227). | None. |
| backdated entry before a rate change | Gets the rates configured at CREATION time (resolveRateSnapshot reads current tables, orgHelpers.ts:37-117). No effective-dating — H2 documentation → TASK-02. | rates.test.ts (pure). |
| entry into closed/invoiced scope | Retainer: blocked by `assertEntryDateOpen` (create :264; update on date/task change :427-438; timer paths via `findEntryDateBlocker`) — closed period OR finalized covering invoice (settleGuards.ts:60-109). T&M/Fixed: backdating is ALLOWED by documented design — invoices are frozen snapshots; late entries roll to the next invoice (settleGuards.ts:10-17). | `convex/lib/__tests__/settleGuards.test.ts` — thorough PURE predicate coverage (boundaries, drafts, voids). No DB-level test. |
| task move within project | Allowed; re-snapshots rate + `snapshotCategoryId` for the OWNER (:398-414, 447-468); closed-period guard re-run (:427-438). | None. |
| attempted task move across projects | Rejected: "Target task must belong to the same project" (:409-411). Task-level project change likewise blocked when entries exist (tasks.ts:1157-1159 single, 1673-1676 bulk). | None. |
| billable toggle + bulk billable toggle | Single: `update` re-snapshots all three rate fields at current config (:440-468) — historical `costRate` can change on an old entry (hand-off to TASK-02/R3). Bulk: admin-only, skips `invoiceId`/`settledAt` rows, per-entry owner re-snapshot (:545-598). Neither logs activity (F-TMR-08). | None. |
| edit/delete after draft, finalization, settlement | Draft: blocked with draft-specific message (invoiceLockMessage :26-36 → "remove it from the draft first"). Finalized: "void the invoice first". Settled: "reopen the period first" (:339-346, :501-508). Only invoice/period lifecycle transitions (settleEntries.ts, retainerPeriods.ts) can unlock. | `convex/lib/__tests__/settleEntries.test.ts` (entryStatus derivation only — pure). |

---

## Handoffs (facts TASK-04 / TASK-08 / TASK-10 must know)

**Exact rounding semantics (fixture arithmetic — TASK-04):**
- Ledger stores `Math.ceil(rawMinutes)` — whole-minute CEILING, per entry, at write time (`convex/lib/rounding.ts:6-10` with increment 1; `convex/lib/timerEntry.ts:52`; `convex/timeEntries.ts:249,354`). 29 s timer → discarded; 30 s → 1 min; 60 s → 1 min; 61 s → 2 min; 8 h stale → 480 min; 16 h+ → capped 960 min.
- `orgSettings.roundingMinutes` NEVER touches the ledger — it is invoice-time presentation only (timerEntry.ts:48-51; the reader-side default is 1 at timeEntries.ts:905). Fixture "raw minutes" = stored `durationMinutes`, already ceiled.
- Raw elapsed ms is unrecoverable post-write; do not model sub-minute values in expected ledger sums.

**Date derivation rules (TASK-04 fixture, TASK-08 journey):**
- Invariant `date === tzDay(startedAt, orgSettings.timezone ?? "America/New_York")` — the fixture MUST seed `orgSettings.timezone = "Europe/Budapest"` or every date expectation shifts.
- Overnight running timers file the FULL duration under the session-start day. Paused-then-stopped timers anchor synthetically at `now − duration` (real start lost at pause — F-TMR-09), so a "timer paused across midnight" fixture row lands per the synthetic anchor, not the true start.
- Settled start-day → entry refiles under today (timerEntry.ts:75-83). "Today can never be settled" is an ASSUMPTION from comments (timerEntry.ts:14-17) — TASK-05 should verify close/finalize both require an ended period.
- Manual entries: any past date allowed (except settled retainer scope), FUTURE dates allowed, `startedAt` unbounded.

**Rate snapshot timing (→ TASK-02, fixture rate-change rows):**
- Snapshot moment = entry write: STOP time for timers (not start), creation time for manual (incl. backdated), and RE-SNAPSHOT at current config on billable-toggle or task-move edits (timeEntries.ts:447-468) and bulk billable (:577-592). Duration/date/note edits never re-snapshot.
- Owner's rate always; actor only in `createdBy` (create :295; archive rescue timerEntry.ts:193-194).
- Warning for TASK-02: `projectRateOverrides` lookup keys on `(projectId, workCategoryId)` with NO currency dimension (orgHelpers.ts:77-82) — trace currency-change drift.
- Retainer entries snapshot `billableRate = 0` (orgHelpers.ts:67-71); non-billable and non-billable-project → 0 (rates.ts:42-51); missing user cost rate always blocks (rates.ts:35-40).

**Idempotency and loss gaps (→ TASK-08 UI journey, TASK-10 tests):**
- `timer.stop` is state-guarded idempotent (safe double click / two tabs / retry at server); UI stop buttons have NO in-flight guard → expect a spurious "Failed to stop timer" toast on double click, no dup row.
- `timer.commitEntry` is NOT idempotent — the "Save as 1m" toast action would double-insert if sonner re-fires; verify one-shot behavior live.
- Project archive wipes running timers (F-TMR-02) and client delete strands them (F-TMR-01) — reproduce cautiously or code-level only.
- Discard dialog shows `Math.floor(elapsedMs/60000) || 1` minutes (floating-timer-widget.tsx:188) — displays "1m" even for a 5 s timer; minor honesty item for TASK-08.

**Test-plan seeds (→ TASK-10):** zero Convex integration tests exist anywhere on this chain; the pure tests that do exist (`convex/lib/{rounding,timer,rates}.test.ts`, `convex/lib/__tests__/settleGuards.test.ts`, `components/timer-provider.test.tsx`, `lib/{duration,workday}.test.ts`) prove helpers, never callers. Priority convex-test cases from this task: (1) clients.remove guard (F-TMR-01), (2) projects.archive rescue (F-TMR-02), (3) NaN/Inf rejection on create/update/stop (F-TMR-03), (4) manual duration cap (F-TMR-04), (5) override audit marker (F-TMR-05), (6) 30 s/61 s stop rounding integration, (7) DST + midnight + Europe/Budapest date filing, (8) settled-scope create/update guards at DB level, (9) invalid-timezone rejection (F-TMR-07), (10) stop double-call yields exactly one row.

<!-- TASK-01 end -->
