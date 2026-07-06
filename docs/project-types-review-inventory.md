# Project Types Review — Full Inventory (2026-07-04)

Methodical review of the three billing types (monthly retainer, T&M, fixed) across
project setup → time measurement → reporting/invoicing. Four parallel deep reviews
(retainer, T&M, fixed, shared time/reporting infra) were run over the actual code;
every finding below carries a file reference. Findings marked **verified** were
independently re-checked against source by the synthesizing reviewer.

Legend: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · ⚪ LOW

---

## 0. Cross-cutting (affects all three project types)

### Logic

- ✅ **FIXED 2026-07-05** — 🔴 **Task delete destroys invoiced/settled time entries** (verified; found independently by two reviewers).
  *Resolution:* delete is now impact-aware with in-place resolution (no dead-end errors):
  - `tasks.deleteImpact` query reports entry counts/minutes (total + invoiced/settled) across the task tree.
  - Shared `DeleteTaskDialog` (`components/tasks/delete-task-dialog.tsx`) replaces the plain confirm at
    all 4 call sites (detail header, drawer header, subtask list, tasks page): no logged time → plain
    destructive confirm; unlocked logged time → "Archive instead" (recommended) or explicit
    "Delete task + logged time"; invoiced/settled time → delete impossible, one-click "Archive task".
  - `tasks.remove` enforces server-side: locked entries always throw; unlocked entries require the
    explicit `deleteEntries: true` consent flag. Bulk delete skips tasks with entries via the existing
    `skipped`-with-reason mechanism. `taskHasTimeEntries` helper added to `convex/lib/task_helpers.ts`.
  `cascadeDeleteTaskData` (`convex/lib/task_helpers.ts:112-118`) deletes every entry on the task
  unconditionally; called from `tasks.remove` and bulk delete (`convex/tasks.ts:1391-1418`, `:1613-1630`).
  This bypasses the locks `timeEntries.remove` enforces (`convex/timeEntries.ts:486-495`) and the
  block `projects.remove` has (`convex/projects.ts:1174-1187`). Deleting a task whose hours sit on a
  finalized invoice leaves the invoice's `timeEntryIds` dangling — the "canonical set"
  (`convex/lib/settleEntries.ts:48-72`) silently shrinks; void/unsettle later no-ops; project
  overview `invoicedAmount` shrinks; closed retainer statements recompute lower.
  **Fix:** block task delete when any entry has `invoiceId`/`settledAt` (or when any entry exists,
  mirroring the project rule) and steer to archive.

- ✅ **FIXED 2026-07-05** — 🟡 **Rounding policy conflict: the ledger is rounded at creation, then invoices round again.**
  *Resolution (global rounding rework, founder-approved model):* ONE rule — "the ledger is raw;
  rounding is an invoice-time presentation, never a data mutation" (Toggl/Harvest/Clockify model).
  - **Storage:** timer + manual entries store exact minutes (whole-minute ceil only); the workspace
    setting no longer touches the ledger.
  - **Setting renamed** "Invoice rounding" (Settings → General + onboarding); copy states
    timesheets keep exact time. Options simplified per founder review: "Exact — to the minute" /
    5m / 15m / 30m (6m dropped — 0.1h is a legal-billing convention, noise for agencies; legacy
    stored 6 still validates).
  - **Invoice:** `createInvoice.roundingMinutes` optional → defaults from workspace; line
    `quantityMinutes` stores RAW sums, `quantity`/`amount` derived (amount from minutes — the T&M
    quantization drift is gone); `updateInvoiceRounding` mutation + sidebar picker (None/5/6/15/30)
    re-round losslessly; retainer recalc uses the invoice's own rounding snapshot.
  - **Promise = invoice:** T&M ready rows and `projectOverview.openAmount` run the same per-group
    rounded math as `createInvoice`, so banner/inbox amounts equal the generated draft. (Retainer
    overage-promise alignment lands with the used-minutes unification in shortlist #8.)
  Original finding:
  Entry creation ceils `durationMinutes` to `orgSettings.roundingMinutes`
  (`convex/timer.ts:167`, `convex/timeEntries.ts:231,339`; `convex/lib/rounding.ts:6-10`).
  Invoice generation then ceils grouped sums again (`convex/invoices.ts:988,1685`;
  `convex/lib/retainerBalance.ts:81`). With 15-min rounding, ten 7-minute entries store 150m
  (raw is 70m) and then round again at invoicing — systematic double-ceiling against the client.
  Statements that read "RAW" (`convex/statements.ts:284-290`) are reading already-rounded values,
  in tension with the stated raw-ledger-until-invoice principle. Changing `roundingMinutes`
  mid-flight leaves a heterogeneous ledger, and raw duration is discarded so it can never be
  re-normalized. Meanwhile, invoice-level rounding is hardwired to 0 by the only UI caller
  (`lib/hooks/use-generate-invoice.ts:65`) — the invoice rounding machinery is unreachable.
  **Fix (policy decision):** store raw minutes (`rawDurationMinutes`) and round only at invoice
  time, with a rounding picker (none/6/15/30) on the draft page defaulting from org settings.

- 🟡 **Financial data exposed to non-admin members.** `projectOverview` (returns `totalActualCost` —
  a salary proxy — plus `openAmount`/`invoicedAmount`), `projectMonthlyBreakdown`, and
  `getRetainerData` have no admin gate (`convex/timeEntries.ts:829-831`, `:1039-1043`,
  `convex/projects.ts:503-504`); `listProjectEntries` returns `costRate` on member-readable rows
  (`convex/timeEntries.ts:717,747`); `listByTask`/`listToday` spread whole entry docs including
  rates (`convex/timeEntries.ts:53-59,92-98`). This contradicts `getSummary`, which carefully
  strips money for members (`convex/lib/projectSummary.ts:223-231`).
  **Fix:** gate money fields by `isAdmin` in these queries, same pattern as `getSummary`.

### Timer (shared measurement layer)

- ✅ **FIXED 2026-07-05** — 🟠 **Archiving/deleting a task silently discards a running timer's elapsed time.**
  *Resolution:* archive (single + bulk) now auto-saves affected running/paused timers as real
  entries via `autoSaveTimersForTasks` (`convex/lib/timerEntry.ts`) — note "Auto-saved when the
  task was archived", owner attribution, admin as `createdBy`. If the entry can't be created
  (e.g. missing rate) the timer is LEFT RUNNING and the admin is told. Archive toasts name whose
  time was saved (`toastArchiveSuccess`). Delete can't preserve entries (task goes away), so
  `deleteImpact` reports running timers and the delete dialog warns "A running timer (Xh) will be
  discarded." Original:
  `tasks.archive`/`remove`/bulk ops clear all four timer fields with no committed entry and no
  notification (`convex/tasks.ts:1356-1365`, `:1599-1624`). **Fix:** auto-commit the accumulated
  time (the rate snapshot is resolvable) or notify the owner.

- ✅ **FIXED 2026-07-05** — 🟠 **Stop→commit is two-phase; elapsed time lives only in client memory in between.**
  *Resolution:* create-at-stop (Toggl model). `timer.stop` persists the entry and clears the timer
  in ONE transaction (`insertTimerEntry`, `convex/lib/timerEntry.ts`); duration is the SERVER's
  measurement. The commit form now EDITS the created entry (Save = update, Delete entry =
  confirmed remove) — closing the tab keeps the measured time. Rate failure rolls back the whole
  mutation so the timer keeps running (fix config, stop again). Under-30s stops return
  `discarded: true` with a "Save as 1m" toast action. The stale-timer dialog saves via one atomic
  `stop({ overrideMinutes })` call (no more stop-then-commit double window) and now PREFILLS the
  measured duration. Original:
  `timer.stop` clears server state before any entry exists (`convex/timer.ts:193`); the duration
  sits in React state until Save (`components/timer/floating-timer-widget.tsx:38-78`). Tab close,
  crash, or the unconfirmed post-stop "Discard" (`timer-commit-form.tsx:102-104`) loses the session.
  **Fix:** make stop atomic (stop returns a draft entry) or keep server timer state until commit.

- ✅ **FIXED 2026-07-05** — 🟠 **`timer.commitEntry` skips guards that `timer.start` and `timeEntries.create` enforce.**
  *Resolution:* normal stops no longer flow through `commitEntry` at all (create-at-stop uses the
  server-measured duration — the arbitrary-duration hole is gone by design). The remaining
  escape hatch (`commitEntry`, "Save as 1m") gained the archived-task guard and anchors the date
  within TODAY (a long duration can never file under yesterday; other dates → manual logging).
  `insertTimerEntry`'s anchoring rule: overnight sessions file under their start day, falling back
  to today when that day is settled — a stop can never strand. Original:
  no `task.archivedAt` check, no member-assignment check (`convex/timer.ts:269-300` vs
  `convex/timeEntries.ts:219`, `convex/timer.ts:74-76`). Also its synthetic
  `startedAt = now − duration` is not clamped to org-tz midnight (`convex/timer.ts:305-307`),
  so a long duration committed in the morning files under *yesterday* — and if yesterday is in a
  closed retainer period, the commit hard-fails with no date control to escape.
  **Fix:** replicate both guards; clamp like `anchorStartedAt` (`lib/workday.ts:93-99`); add a
  date field to the commit form.

- 🟡 **Cross-org invisible-timer lockout.** Timer state is per-Clerk-user; in another org
  `getState` returns null (no widget) but `start` errors "A timer is already running"
  (`convex/timer.ts:37-38`, `:64-66`) — no way to stop it from org B.
- ✅ **FIXED 2026-07-05** — 🟡 **Running-timer discard dialog understates loss** — now uses the live
  `elapsedMs` tick; also the post-stop "Discard" (previously unconfirmed, lost the session) became a
  confirmed "Delete entry" on an already-persisted entry.
- 🟡 **Time-log "started at" offset presets can cross midnight and hard-fail** — clamp, then
  subtract offset un-clamps (`components/tasks/time-log-form.tsx:123`). Re-clamp after offset.
- 🟡 **Members can manually log time on tasks not assigned to them** (`convex/timeEntries.ts:202-232`
  has no assignee check) while the timer path enforces it — the assignment rule is decorative.
  Confirm intent; if unintended, mirror the timer check.
- ⚪ Timer race with period close can strand a pending commit (`convex/timer.ts:305-317`).
- ✅ **FIXED 2026-07-05** — ⚪ "Timer under 30s" branch nearly unreachable — the threshold moved
  server-side (`stop` returns `discarded: true` below 30s of raw elapsed) so it actually fires;
  the stale dialog also now prefills the measured duration instead of opening empty.
- ⚪ Workday popover renders synthetic noon-anchored `startedAt` as real clock spans for manual
  entries (`components/workday/workday-task-popover.tsx:81-98`). Hide ranges for `method:"manual"`.

### Reporting/export layer

- 🟡 **Cycle worksheet AI summaries collide across months** — outputs keyed by `taskId` but cycle
  rows are per-month-per-task; the last month's summary overwrites all earlier months
  (`convex/worksheetsHelpers.ts:504-507`, `:770-789`; `convex/worksheets.ts:165-177`).
  **Fix:** key by `taskId|monthLabel`.
- 🟡 **CSV formula-injection guard mangles intentional values** — `'`-prefixes `== March 2026 ==`
  dividers, `+8:00`, `-4:00` (`lib/csv.ts:23,44-46`; `worksheetsHelpers.ts:924,962-974`). Clients
  see `'+8:00` in deliverables. Guard free-text columns only; express sign in labels.
- ⚪ Cycle export resolves "today" in UTC not org tz (`worksheetsHelpers.ts:732`).

### Efficiency (all types)

- 🟠 **`enumerateReadyRows` is an org-wide full scan, subscribed reactively on every admin page**
  (found by three reviewers). It walks all projects → tasks → entries → invoices
  (`convex/invoices.ts:442-665`) and backs both the billing inbox and the always-on sidebar badge
  (`getInvoicingNavSignals`, `convex/invoices.ts:702-738`; `components/nav-main.tsx:52`). Every
  time-entry write re-runs it for every connected admin. #1 scalability item.
  **Fix:** maintain per-project billing-state aggregates on write, or a cheap denormalized count
  for the badge.
- 🟠 **No `projectId` on `timeEntries`** → every project surface does a per-task N+1 over full
  entry history: `listProjectEntries`, `projectOverview`, `projectMonthlyBreakdown`, `getSummary`,
  `getRetainerData`, `createInvoice`, `getRetainerStatement`, worksheet scope resolution.
  **Fix:** denormalize `projectId` + `by_orgId_projectId_date` index — collapses ~8 call sites to
  single range reads and enables server-side date filtering. (MVP dummy-data posture makes this a
  direct-narrow change.)
- 🟡 Project overview tab mounts 4 queries that each independently re-fetch all tasks+entries
  (`getSummary`, `projectOverview`, `projectMonthlyBreakdown`, `getProjectInvoiceMetrics`).
  Consolidate into one overview query.
- 🟡 "Fixed billed" recomputed by five near-identical invoice×lineItems loops
  (`convex/invoices.ts:813-826, 1001-1021, 1796-1820, 2013-2031, 512-523`) — and one of them
  (`enumerateReadyRows:518`) already forgot the org filter the others have. Extract one helper.
- 🟡 Cycle export re-reads the whole project ledger once per month; `buildTaskRows` re-queries
  subtasks and comments per task per month (`worksheetsHelpers.ts:752-768`, `:404-424`). Fetch once, bucket in JS.
- ⚪ `listProjectEntries` returns unbounded arrays with full hydration (`convex/timeEntries.ts:819`) —
  the workday query has a 10k cap; this has none. Add cap/pagination.
- ⚪ Per-row `ctx.db.get` loops in `listInvoices`/`listAllInvoices` (`convex/invoices.ts:134-147`, `:249-263`).

### Missing capabilities (cross-cutting, ranked)

1. **Reports module** — `/reports` is in CLAUDE.md's route list but the route doesn't exist.
   Team utilization, billable %, org-wide unbilled with aging, per-client hours have no home.
2. **Real dashboard** — `app/(dashboard)/dashboard/page.tsx:29-43` renders hardcoded `0` /
   `0h` literals. Worse than empty: wrong data on the landing page.
3. **Budget/threshold alert engine** — the notifications system handles mentions/assignments only;
   nothing fires at 80%/100% of any budget (retainer or fixed). Wire threshold events into the
   existing inbox fan-out.
4. ✅ ~~**Draft refresh / add-to-draft**~~ SHIPPED 2026-07-05 — `refreshInvoiceDraft` + stale
   callout + finalize gates (hard for retainer, soft for T&M/Fixed). See per-type sections.
5. **Personal editable timesheet (week view)** — `/my-time` is today-only and read-only; the
   Harvest/Toggl core loop (review + fix your week) doesn't exist.
6. **Org-wide time lock / approval** ("lock entries before date X").
7. **Per-entry audit history** — money-bearing edits leave no per-entry trail.
8. **Idle detection / timer nudges**; timer visibility outside the app (title/favicon).

---

## 1. Monthly Retainer

### Logic

- ✅ **FIXED 2026-07-05** — 🟠 **Backdated entries into an invoiced period are stranded forever (silent revenue leak).**
  *Resolution:* `assertEntryDateOpen` (all three write paths: create, timer commit, date/task move)
  gained a finalized-invoice arm — a date covered by a non-void, non-draft retainer invoice's period
  is rejected with a recovery-path message naming the invoice: "This period is already invoiced
  (INV-042). Pick a date outside the period, or void that invoice to log time here." Pure predicate
  `pickCoveringFinalizedInvoice` unit-tested (drafts/voids never block; boundaries inclusive).
  Invoiced = settled, same mental model as closed periods. Original finding:
  `assertEntryDateOpen` only blocks *admin-closed* periods (`convex/lib/settleGuards.ts:42-68`);
  a period covered by a finalized overage invoice has no `closedAt` and can never get one
  (`findConflictingInvoice` blocks close, `convex/retainerPeriods.ts:86-99`). Backdated entries are
  accepted, skipped by recompute (`convex/projects.ts:817-823`), deduped out of the ready feed, and
  blocked from re-generation (`convex/invoices.ts:1514-1517`). Never billed, never settleable, never surfaced.
  **Fix:** extend `assertEntryDateOpen` to reject/warn on dates covered by a non-void retainer
  invoice, or emit an inbox row "N unbilled entries inside an invoiced period."

- ✅ **FIXED 2026-07-05** — 🟠 **Retainer drafts go stale; late entries never join and strand on finalize.**
  *Resolution (draft refresh, all types):* `collectRefreshableEntries` (one shared definition) powers
  three things: (1) `getInvoice` returns a `staleEntries` signal → amber "N entries (Xh) logged since
  this draft was created · Refresh draft" callout in the sidebar; (2) `refreshInvoiceDraft` mutation —
  append-only: fresh entries become new time lines (grouped like `createInvoice`), manual rows /
  relabels / partial fixed amounts untouched; retainer recomputes balance, T&M/Fixed recompute
  subtotal and widen the stored period; (3) finalize gates — retainer is HARD-blocked server-side
  when stale (stranding prevention), T&M/Fixed get a soft confirm ("refresh or finalize without
  them"). Entry-lock error copy is now status-aware (draft ≠ void). Original finding:
  Entries are stamped only at draft creation (`convex/invoices.ts:1432-1453`); resume returns the
  draft untouched (`:1500-1513`); no recalc-from-entries path. Finalize → the period is
  invoice-covered → issue above. Overage undercounted. **Fix:** on draft open, diff line
  `timeEntryIds` vs current eligible entries; "N entries logged since draft — Refresh" one-click rebuild.

- ✅ **FIXED 2026-07-05** — 🟠 **Partially reopened rollover cycle can deadlock.**
  *Resolution:* one definition of "used minutes". `createInvoice` now includes entries settled by a
  PERIOD CLOSE (`retainer_included`) in its collection — the invoice bills the true cycle aggregate
  (and the document shows the full cycle's work), so whatever the close gate flags as overage the
  invoice can actually bill. Both doors can never be locked at once. Void unsettles everything and
  frees the period for re-billing. Original: Cycle-close gate counts ALL billable
  minutes (`convex/lib/retainerCycle.ts:185-212`) while `createInvoice` counts only unsettled
  (`convex/invoices.ts:1441-1446`). Reopen one month, edit hours up past budget → "Close cycle"
  errors (overage must be invoiced) AND "Generate" errors (no overage found). Recovery
  (reopen every month) is undiscoverable. **Fix:** make both sides use one definition; add a
  "Reopen cycle" action for cycle-closed groups.

- ✅ **FIXED 2026-07-05 (gates)** — 🟡 **UI and invoice disagree about overage when rounding is set.**
  *Resolution:* `sumBillableMinutes` now groups per (task, category) and rounds up with the
  workspace default — the SAME math `createInvoice` bills — and both close gates pass it, so
  "may this close / is there overage?" is decided with invoice numbers. Cycle context sums the
  full contiguous range once (per-cycle grouping, not per-month). Residue: the ready-feed /
  breakdown retainer PROMISE amounts still display raw sums (slightly lower than the draft when
  rounding > exact) — noted as remaining polish. Original: Invoice math rounds per task
  group (`convex/lib/retainerBalance.ts:79-84`); every UI surface sums raw
  (`convex/projects.ts:706`, `retainerCycle.ts:204-211`, `readyToInvoice.ts:260-262`). The
  banner promises one number, the generated draft bills a higher one; or raw-within-budget closes a
  period the invoice engine considers overage. **Fix:** gate/promise with the invoice's math, or
  annotate "increases after rounding."

- ✅ **FIXED 2026-07-05** — 🟡 **`createInvoice`/`recalcRetainerBalance` still use legacy defaults.**
  *Resolution:* all six sites in `invoices.ts` (period derivation, balance section, snapshot write,
  recalc fallbacks, retainerUsage read) now use creation-consistent `?? 1 / ?? false`; the retainer
  settings form initializes with 1/off too. Original: `rollover ?? true`,
  `cycleLength ?? 3`** (`convex/invoices.ts:1470-1471, 1726-1727, 1874-1875, 1105-1108`) that the
  read paths explicitly fixed to `?? 1 / ?? false` with a comment calling the old defaults a bug
  (`convex/invoices.ts:602-604`). The settings form also initializes "3"/on
  (`components/projects/settings-retainer.tsx:71-72,98-99`). One grep pass to align.

- ✅ **FIXED 2026-07-05** — 🟡 **Summary card applies pooled-cycle overage math to non-rollover multi-month cycles.**
  *Resolution:* `computeRetainerSummary` takes `rolloverEnabled` + per-month billable minutes; when
  rollover is off, overage = Σ per-month `max(0, worked − included)` (idle months don't absorb
  another month's overrun). Unit-tested both modes. Original:
  (`convex/lib/projectSummary.ts:406-424` ignores `rolloverEnabled`; config legal per
  `convex/projects.ts:246,460-481`). Monthly Breakdown shows overage due; Summary card shows 0.
  **Fix:** when rollover off, sum per-month `max(0, worked − included)`.

- ✅ **FIXED 2026-07-05** — 🟡 **UI offers a Close button the server always rejects.**
  *Resolution:* `decideRetainerRowCloseAction` returns null for ANY over-budget month (matching the
  server gate, which ignores the overage rate); test updated — it had enshrined the dead end. Original: — over-budget month with no overage
  rate: `lib/retainer-row-action.ts:165-166` returns "close-month" when `overageRate` is unset,
  but the server gate ignores the rate (`retainerBalance.ts:64-74`). Dead-end loop.
  **Fix:** return null for any over-budget row.

- 🟡 **"Pause retainer" barely does anything; the confirm copy is false.** `retainerStatus` is read
  only by the cron pre-creator (`convex/retainerCron.ts:25-27`) — periods are lazily created anyway.
  Ready rows, banners, accrual all continue. Dialog claims it "stops appearing in the billing queue"
  (`settings-retainer.tsx:342`). **Fix:** make pause real (skip in `enumerateReadyRows`, warn on new
  entries) or fix the copy. Also: no end-date/"ended" contract state exists at all.

- ⚪ `cycleLength`/`startDate` edits re-segment all history with no guard when finalized invoices or
  closed periods exist (`convex/projects.ts:407-494`). Cheap insurance: warn.
- ⚪ No first-month proration; startDate's day-of-month ignored; entries before start month belong
  to no cycle (`convex/lib/retainerCycle.ts:83-95`).
- ✅ **FIXED 2026-07-05** — ⚪ Close-block error said "Void or finalize" but finalizing doesn't
  unblock — copy now says void only.
- ⚪ All retainer-invoice entries get `settledReason:"invoiced"` including within-budget hours
  (`convex/invoices.ts:2635-2646`) — harmless now ($0 rate) but don't trust for revenue-per-hour later.

### UX

- **No portfolio-level retainer health.** `/projects` table shows no balance/utilization column;
  `CycleDots` (`components/cycle-dots.tsx`) is built and used nowhere. A PM must open every project.
- **No burn-rate/projection** — "at current pace this cycle lands at 112% around Jun 24" is
  computable from data already loaded; nothing forward-looking is shown.
- **No budget-threshold alerts** (see cross-cutting #3) — overage is discovered after month end.
- **Month-end is a click farm.** Every ended within-budget month — including zero-entry months
  (`readyToInvoice.ts:339-348`) — demands open modal → wait → confirm, per month per project.
  Add bulk close + auto-close for zero-entry months.
- **Close modal can fail after full review** — gates checked only on Confirm
  (`close-period-modal.tsx:93-94`). Pre-check on open; disable Confirm with inline reason.
- **Positive states styled as warnings** — "rollover"/"unused" badges are amber/yellow
  (`components/retainer-balance-badge.tsx:7-8`).

### Missing capabilities (ranked)

1. Budget alerts + pace projection (defining feature of retainer tooling).
2. Draft refresh / late-entry reconciliation (guarantee every minute lands on a document).
3. Retainer end lifecycle: end date, final settlement, unused-hours disposition, "ended" status.
4. Rollover policy options: carry caps, negative carry across cycles, proration.
5. Fee-collection reconciliation (Stripe check-mark per period; revenue math currently *assumes* fees collected).
6. Bulk/auto close.
7. Close/reopen audit trail (reopen erases `closedBy/closedAt`, `retainerPeriods.ts:555-559`; nothing in activityLog).
8. Client-facing report delivery (email/share-link with delivered-at record).

---

## 2. Time & Materials

### Logic

- ✅ **FIXED 2026-07-05** — 🟠 **Inbox "Generate" for a month row invoices ALL open entries, not that month** (verified).
  *Resolution:* `handleGenerate` in `invoice-list.tsx` now passes the row's month boundaries
  (`monthBounds` helper added to `lib/date-buckets.ts`, unit-tested incl. leap years) for `tm` rows.
  `createInvoice` with explicit dates does period-keyed draft resume (PRD US-43), so clicking the
  same month twice resumes that month's draft; the subject derives correctly from the bounded
  entries. Original finding:
  Ready feed emits per-closed-month rows with that month's amount (`convex/lib/readyToInvoice.ts:233-285`),
  but the click handler passes no dates for `tm` rows (`components/invoices/invoice-list.tsx:123-141`)
  and `createInvoice` with no range pulls everything open — including the in-progress month
  (`convex/invoices.ts:1572-1578`). Click "September $1,200" → get a draft with September + October +
  3 days of November, subject "September 2026" (`:1653-1661`). **Fix:** pass the row's month bounds;
  use a period-range subject label.

- ✅ **FIXED 2026-07-05** — 🟠 **Any open draft blocks billing newly logged time; no way to add entries to a draft.**
  *Resolution:* the "Refresh draft" flow (see retainer section) — the stale callout on the draft page
  pulls new entries onto the draft in one click; the misleading "void the invoice" error for
  draft-linked entries now says "remove it from the draft (or delete the draft) first". Original:
  Period-less generation resumes any existing draft (`convex/lib/invoiceCreation.ts:128-134`);
  the Overview banner keeps showing the new open amount and "Generate" just navigates to the stale
  draft (`components/projects/tm-overview.tsx:39-48`, `lib/hooks/use-generate-invoice.ts:75-80`).
  New hours are unbillable until the draft finalizes or is deleted. Draft-locked entries also show a
  wrong error ("delete or **void** the invoice first" — drafts can't be voided,
  `convex/timeEntries.ts:321-325`). **Fix:** "Add open entries to draft" action + "N new entries
  since draft" callout; fix the copy.

- 🟡 **Two conflicting definitions of "Billed" on the same page.** `computeTmSummary` counts
  draft-reserved entries as billed (`convex/lib/projectSummary.ts:198-209`); `projectOverview`
  keeps a separate draft bucket for exactly the opposite reason (`convex/timeEntries.ts:876-895`).
  Summary card inflates the moment a draft exists; Time tab disagrees.
  **Fix:** split "Billed / In draft / Unbilled" in the summary.

- 🟡 **Hours quantization makes the invoice differ from every other surface.**
  `createInvoice`: `round2(minutes/60)` then `round2(hours × rate)` (`convex/invoices.ts:1685-1690`);
  overview/summary/ready rows use full-precision `minutes/60 × rate`. 50 min @ $100 → promised
  $83.33, billed $83.00; the "ready to bill" number never reconciles to the draft.
  **Fix:** compute amount from `quantityMinutes` (already declared source of truth,
  `convex/schema.ts:329-333`); 2-decimal hours display-only.

- 🟡 **Archiving a T&M project silently hides unbilled revenue.** Ready feed skips archived
  (`convex/invoices.ts:468-469`); nothing warns at archive time; project vanishes from every
  billing queue with its open hours. **Fix:** warn "This project has $X unbilled" on archive
  and/or keep archived-with-open rows in the feed with a badge.

- ⚪ **Zero-rate project overrides silently bill $0** — `upsert` accepts 0
  (`convex/projectRateOverrides.ts:30-32`) and an override short-circuits the missing-rate error
  (`convex/lib/orgHelpers.ts:84-98`). Reject 0 or require explicit acknowledgment.
- ⚪ **Billable toggle rewrites historical `costRate`** to the current user rate
  (`convex/timeEntries.ts:442-452`, `:564-579`) — toggling an old entry after a raise silently
  changes past profitability. Re-resolve `billableRate` only.
- ⚪ `getInvoicePreview` is dead code already drifting from `createInvoice` math
  (`convex/invoices.ts:987-992`). Delete or wire in as pre-generate confirmation.

Verified-clean: rate precedence (project override → category rate, per currency); missing rate =
hard error, never $0; snapshot semantics consistent between billing and reports; `entry.isBillable`
rules everywhere with a proper mismatch dialog on task-billable toggles.

### UX

- **Invoice-time rounding picker unreachable** (hardwired 0 — see cross-cutting rounding item).
- **Line grouping fixed at (category, task, rate), task-title descriptions only**
  (`convex/invoices.ts:1599-1615`). No per-person/per-date/detailed modes, no dates on lines, no
  timesheet appendix — the visible gap vs Harvest on the client-facing document. Building blocks
  (`timeEntryIds` per line) exist.
- **No unbilled aging** — only a ≥30-day "since last invoice" chip
  (`components/invoices/invoice-banner.tsx:50,69-72`). Add 0-30/31-60/61+ buckets.
- **Inbox vs banner frame T&M differently** (closed months vs everything) — admin sees "$0 ready"
  and "$1,900 ready" simultaneously. Align copy: "$X from closed months · $Y accruing".
- **Members get dead-end errors on draft-locked entries** (told to void; can't, and it's wrong).

### Missing capabilities (ranked)

1. Add-to-draft / draft refresh (makes continuous billing possible at all).
2. Invoice-time rounding + line display options (person/date/detail grouping, timesheet appendix).
3. Re-price uninvoiced entries on rate/category change ("apply to N open entries?" — the billable
   toggle already has this exact pattern to extend).
4. Per-person billable rates (senior vs junior currently identical within a category).
5. Org-wide WIP/unbilled dashboard with aging (including the current month, which the inbox
   deliberately excludes).
6. T&M budget caps/alerts ("alert at $X or Y hours").
7. Client-facing T&M statement (statements are retainer-only).
8. Expense/materials lines with markup ("T&M" currently bills time only).
9. Tax/VAT (total = subtotal everywhere; NAV/EU ambitions make this unavoidable).

---

## 3. Fixed price

### Logic

- ✅ **FIXED 2026-07-05** — 🔴 **Milestone/partial billing is impossible; the PRD's own escape hatch was removed** (verified).
  *Resolution:* the fixed line's amount is editable on drafts again, now structured:
  `updateInvoiceLineItem` accepts amount edits on `lineType:"fixed"` clamped to
  `0 < amount ≤ fixedPrice − finalized fixed lines` (helper `getFixedBilledFinalized` in new
  `convex/lib/fixedBilling.ts`). Edit surface (per design review): the SIDEBAR's "Fixed fee"
  block (`FixedFeeBillingControl` in `invoice-sidebar.tsx`) — segmented bar (billed / this draft /
  remaining), editable amount, 25% / 50% / Remainder presets, "After this invoice" + "Remains"
  rows. The document canvas stays chrome-free (document = result, sidebar = controls, Stripe
  pattern). A finalize gate in `applyStatusTransition` re-checks the fixed
  line against the live remainder so stale drafts can't over-bill. The remainder math self-heals:
  finalizing a 50% line makes the next generate offer the remaining 50%.
  `docs/invoicing-prd.md:384-386` designed "user edits the amount for milestone billing (e.g. 50%
  deposit)"; `docs/invoicing-update-prd.md:262` deferred milestone UI *because* amount-editing was
  the fallback. But line edits on `lineType:"fixed"` are now rejected
  (`convex/invoices.ts:2294-2304`), the fixed line can't be removed (`:2448-2452`), negative manual
  lines are blocked (`:2308-2316`), and `createInvoice` always writes the full remaining balance
  (`:1821-1831`). The only invoice a fixed project can issue is 100% of the remainder — a 50%
  deposit, table stakes for fixed-fee agency work, has no path.
  **Fix:** re-allow draft amount edits on the fixed line (keep `amountOverridden`) or add a
  percentage/milestone picker at generation writing `remaining × pct`.

- ✅ **FIXED 2026-07-05** — 🟠 **`fixedPrice` edits are unguarded against billed amounts → negative or stale invoices**
  *Resolution:* `projects.update` rejects lowering `fixedPrice` below the finalized fixed-line sum;
  `createInvoice` throws when the fixed remainder ≤ 0 (no more zero/negative invoices burning
  gapless numbers); the finalize gate (see milestone-billing fix above) catches stale drafts whose
  fee changed after creation. Original finding kept below for context:
  (verified: `remaining = round2(fixedPrice − alreadyInvoiced)` with no check, `convex/invoices.ts:1821`).
  Lower a fully-billed fee 10,000 → 8,000 → next generate emits a **−2,000 fixed line and
  negative-total invoice**. Change the fee while a draft exists → finalization never recomputes →
  issued amount silently disagrees with the project (`convex/projects.ts:345-353` has only a `> 0`
  check; retainer edits require confirmation, fixed doesn't).
  **Fix:** block/confirm lowering below finalized-billed; recompute or warn on stale drafts at finalize.

- ✅ **FIXED 2026-07-05** — 🟡 **Fully-billed fixed projects can still mint numbered $0 invoices.**
  *Resolution:* `createInvoice` now throws "fully invoiced — nothing left to bill" when the fixed
  remainder ≤ 0, and the project Invoices-tab "Create Invoice" button disables (with tooltip) via
  `metrics.fixedRemaining`, agreeing with the Ready feed and banner.

- ✅ **FIXED 2026-07-05** — 🟡 **Time logged between fixed draft creation and finalization is stranded forever.**
  *Resolution:* the "Refresh draft" flow (see retainer section) — stale callout + one-click refresh +
  soft finalize confirm listing the missing hours. Original: Draft
  sweeps open entries at creation only; resume doesn't re-sweep (`convex/invoices.ts:1386-1398`);
  after finalization remaining = 0 so every billing affordance vanishes
  (`readyToInvoice.ts:194-199`) and those hours can never be settled (except the $0-invoice bug
  above). Client-facing work report undercounts. **Fix:** re-sweep on resume + "N open entries not
  on this draft" warning at finalize.

- 🟡 **Uncategorized time is invisible in the Budget table; total ≠ sum of rows.**
  Non-billable entries don't require a category (`convex/lib/rates.ts:42-51`), the "uncategorized"
  bucket is filtered out of the warning strip (`components/projects/fixed-overview.tsx:74`), and no
  estimate row can match it — but `totalActualMinutes` includes it. Footer disagrees with rows,
  budget % inflated, nothing explains why. **Fix:** render an "Uncategorized" row.

- ✅ **FIXED 2026-07-05** — 🟡 **(found in user testing) Extras billed beyond the fee were invisible
  on the Invoices-tab Budget card.** Manual lines added to partial fixed invoices pushed total
  invoiced to $6,800 while the card claimed "100% · $5,000 of $5,000" with no hint of the rest.
  *Resolution:* two-axis display — `getProjectInvoiceMetrics` now returns `fixedExtraBilled`
  (non-fixed line amounts on finalized invoices; time lines are $0 on fixed invoices), and
  `ProjectInvoicesFixedProgress` shows a "+$X extras" pill plus "· $Y total invoiced" in the
  subline. Fee progress stays fee-only (correct); extras can never hide again. The Overview summary
  already handled this via `contractValue = max(fee, totalBilledAcrossLineTypes)`.

- ⚪ `fully_invoiced` uses raw-float strict equality (`convex/lib/projectSummary.ts:296-319`) —
  becomes reachable the moment multi-invoice fixed billing exists. `round2` or epsilon.
- ⚪ Budget "Actual" keys on `snapshotCategoryId` and never migrates on task recategorization
  (`convex/tasks.ts:1164-1191`) — defensible ledger semantics, zero UI indication. Note it in the
  table or offer "move history".
- ⚪ `HealthBadge` + `BudgetProgress` are dead code (verified: zero usages); the phase-3 health
  column on `/projects` was never built (`components/projects/projects-table.tsx:51-57`).
- ⚪ `getSummary` accepts `dateRange` for fixed and silently ignores it (`convex/projects.ts:949-998`).

Verified-clean: no surface multiplies `billableRate` into fixed "revenue"; `non_billable` cleanly
excluded everywhere (summary, invoicing, ready feed) with rates zeroed; settlement uses a distinct
`"fixed_included"` reason so fixed hours are never mistaken for rate-driven revenue.

### UX

- **Margin is flattering-by-construction.** `revenue = max(fixedPrice, totalBilled)` from day 0
  (`convex/lib/projectSummary.ts:305-306`) — margin starts at lifetime max and only decays. Show
  projected-at-completion (`projectedCost = totalCost / max(budget%, ε)`) and tone by trajectory.
- **Over-budget has no visual alarm.** `ProgressCell` clamps at 100% and renders "143%" in muted
  grey (`components/ui/progress-cell.tsx:29-37`); Remaining goes negative as plain text; the
  purpose-built red-overage `BudgetProgress` sits unused. Red fill >100%, amber ≥80% — thresholds
  already exist in dead `getHealthStatus`.
- **No budget signal on the projects list** — the built `HealthBadge` belongs there.
- **Estimate editing split across two surfaces** (summary-card modal + Settings grid) while the
  Budget table where the numbers live is read-only; the settings grid deletes-by-omission on Save
  with no confirm (`components/projects/settings-budget-estimates.tsx:119-150`). Inline-edit the
  Overview table; make deletion explicit.
- **Seeded zero rows create noise** — `projects.create` seeds an estimate row for every active
  category (`convex/projects.ts:260-284`); new projects list every category at `00:00 / 00:00 / —`.
  Seed nothing; render rows with estimate OR actuals.
- **Post-full-billing scope creep is undetectable** — new hours after the final invoice land in
  `open` with no banner/badge/inbox row. Add: "3h logged since final invoice — scope creep or warranty?"
- **No scope control at generation** — one click sweeps everything; the server supports
  `startDate/endDate` but no fixed UI passes them (PRD presets exist server-side only).

### Missing capabilities (ranked)

1. Milestone/partial billing (deposit %, schedule) — without it the product can't bill the way
   fixed-fee agencies contract.
2. Budget alerts (thresholds exist only as dead code; even 200% burn is silent).
3. Remaining-budget forecast / completion projection ("at current burn you hit 100% on Aug 12").
4. % complete (earned value) input — makes mid-project margin honest and powers #3.
5. Fee/budget change history (fixedPrice and estimates mutate with no audit trail).
6. Portfolio roll-up (contracted vs billed vs cost vs margin across fixed projects).
7. Finalization completeness check (pairs with the stranded-entries fix).

---

## Priority shortlist (what I'd fix first)

| # | Item | Why first |
|---|------|-----------|
| 1 | ✅ ~~Block task delete when entries are locked (🔴 cross-cutting)~~ FIXED 2026-07-05 | Destroys the financial ledger today; one guard clause |
| 2 | ✅ ~~Fixed milestone/partial billing (🔴) + fixedPrice/€0 guards~~ FIXED 2026-07-05 | Product cannot bill how fixed-fee agencies contract |
| 3 | ✅ ~~Draft refresh / add-to-draft (all 3 types)~~ FIXED 2026-07-05 | Single mechanism kills 4 HIGH findings (stale drafts, stranded entries, blocked billing) |
| 4 | ✅ ~~T&M inbox month row → pass date bounds (🟠)~~ FIXED 2026-07-05 | One-line-ish fix; currently mis-bills across months |
| 5 | ✅ ~~Stranded-entry guard for invoiced retainer periods (🟠)~~ FIXED 2026-07-05 | Silent revenue leak with no recovery path |
| 6 | ✅ ~~Timer integrity trio: atomic stop-commit, archive auto-commit, commitEntry guards (🟠)~~ FIXED 2026-07-05 | Time is the raw material; today it can be silently lost |
| 7 | ✅ ~~Rounding policy: store raw, round at invoice only + draft rounding picker (🟡 policy)~~ FIXED 2026-07-05 | Aligns code with stated principle; unlocks the unreachable rounding feature |
| 8 | ✅ ~~Retainer reopen/close deadlock + legacy defaults (🟠/🟡)~~ FIXED 2026-07-05 | Correctness of the month-end flow |
| 9 | ✅ ~~`fixedPrice` edit guard + $0-invoice guard (🟠/🟡)~~ FIXED 2026-07-05 (with item 2) | Negative/zero invoices consume the gapless series |
| 10 | Admin-gate money fields in member-readable queries (🟡) | Cost rates are salary proxies |
| 11 | `timeEntries.projectId` + index; materialize ready-feed/badge (perf) | Every hot surface; MVP-cheap to do now, expensive later |
| 12 | Ship `/reports` + real dashboard + budget alerts | The "better than ClickUp/Notion" differentiators live here |

---

## Adversarial verification round (2026-07-05)

Three independent adversarial reviewers (timer lifecycle · invoice/rounding math · retainer flows +
settlement guards) were run over the session's full diff with explicit instructions to refute the
work. Every CONFIRMED finding was fixed the same day:

**Timer lifecycle** — core create-at-stop transaction verified sound (atomic, exactly-once, no
loss/duplication path, paused math correct, raw-ledger invariant holds on every write path). Fixed:
16h cap applied to archive auto-save + deleteImpact reporting (shared `MAX_TIMER_MS`); 24h server
ceiling on stale-dialog override + capped prefill; inline row stop button now routes through the
widget adjust form (was a silent ledger write / duplication bait); `projects.remove` blocks on
running timers (was the one true data-loss path); bulk archive reports timer rescues by name; bulk
delete copy matches server behavior; dangling-timer discard toast no longer lies.

**Invoice math** — fixed-fee partial-billing lane and T&M promise=invoice lane verified exact to
the cent; rounding picker verified lossless/idempotent. Fixed: `settleInvoiceEntries` no longer
overwrites `retainer_included` at finalize, and `unsettleInvoiceEntries` restores period settlement
for entries in still-closed periods (draft delete / void / revert can no longer corrupt a period
close); `refreshInvoiceDraft` merges into existing line groups instead of appending duplicates (per-
line re-rounding over-billed); refresh + staleness are period-bounded for T&M (a June draft can no
longer swallow July); explicit quantity edits set `amountOverridden` so the picker respects them;
`updateInvoiceRounding` validates increments strictly; dead divergent `getInvoicePreview` deleted.

**Retainer + guards** — original deadlock fix, settlement-guard coverage on all three write paths,
"today can never be settled" fallback guarantee, and legacy-default purge all verified holding.
Fixed: **retainer budget math is now RAW end-to-end** (meters, close gates, ready-feed promises AND
the invoice's used-minutes — rounding any single side reintroduced the close/generate dead-end at
the rounding boundary; rounding remains a T&M hourly-line presentation, and the picker is hidden +
server-rejected on retainer drafts); retainer time lines can't be removed from drafts (the stale
gate made removal an unwinnable loop — fix the entries instead); `reopenPeriod` blocks when a
non-void invoice covers the period; summary card counts overage only for ENDED months.

Accepted residual risks (documented, low): org-timezone moved westward can transiently re-cover
"today" (self-heals next day; stop rolls back safely); reviewers noted the timer/settlement core
has no convex-test coverage — flagged as the top testing follow-up.
