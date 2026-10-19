# Research: "Today" plan-segment surfaces & the sun gesture

Ticket: inventory every surface / code path that creates, removes, or displays "today" plan
segments (the `planSegments` table / the sun "Add to today" gesture), plus the authorization
model, to prepare a spec that changes the gesture target from **the caller** to **the task's
assignee(s)**.

All paths relative to repo root `/Users/tothadam/claude_code_projects/agency-flow-dev`.
Line numbers are from the current `agentic` branch working tree (2026-07-19).

---

## 1. Summary table of surfaces

| # | Surface | Component / function | Mutation hit | Plans for | Guard |
|---|---------|----------------------|--------------|-----------|-------|
| S1 | `/tasks` list rows (sun chip) | `components/tasks/task-row.tsx:180-183` → `AddToTodayButton` | `planner.addToToday` / `planner.removeFromToday` | **Caller** (implicit) | Self-scoped by construction (`getMyTaskPlanContext`, `convex/planner.ts:735-757`) |
| S2 | `/tasks` bulk selection toolbar | `components/tasks/bulk-toolbar.tsx:91,114-131` (`AddToTodayAction`) | `planner.bulkAddToToday` | **Caller** (implicit) | Self-scoped by construction (`convex/planner.ts:802-846`) |
| S3 | My Tasks — Today-group rows (remove sun) | `components/my-tasks/my-task-row.tsx:148-152` (`isTodayRow` → `todayImplied`) | `planner.removeFromToday` | **Caller** | Self-scoped |
| S4 | My Tasks — status-group rows (add sun) | same `my-task-row.tsx:148-152` (`isTodayRow`/`earlier` false) | `planner.addToToday` | **Caller** | Self-scoped |
| S5 | My Tasks — Earlier rows ("Move to today") | `components/my-tasks/today-earlier-section.tsx:73` → `my-task-row.tsx:151` (`moveToToday`) | `planner.addToToday` (copy-only difference, `components/add-to-today-button.tsx:41-45`) | **Caller** | Self-scoped |
| S6 | Task detail drawer — "Plan" section | `components/planner/task-plan-section.tsx:36-51` | `planner.addToToday`, `planner.removeSegment` | **Caller** (add); segment owner (remove) | Self-scoped (add); `assertCanManagePlanFor` (remove, `convex/planner.ts:722`) |
| S7 | My Tasks Today-group inline add | `components/my-tasks/my-tasks-inline-add.tsx:26,31-33` (`today` flag, set at `components/my-tasks/my-tasks-list.tsx:243`) | `planner.createTodayTask` | **Caller** (also assigns caller: `convex/planner.ts:991`) | Member-callable, self-scoped by construction |
| S8 | Planner board (drag / draw / resize / delete) | `lib/hooks/use-planner-mutations.ts:32,77,133,237`; `components/planner/planner-grid.tsx:143` | `planner.createSegment`, `updateSegment`, `removeSegment`, `createTaskWithSegment` | **Explicit `userId` arg** (any row) | `assertCanManagePlanFor` admin-or-self (`convex/planner.ts:559,602-603,649,722`) |
| S9 | My Tasks Today reorder (drag) | `components/my-tasks/my-tasks-list.tsx:59,158` | `planner.reorderTodayTask` | **Caller** (patches own covering segments' `todaySortKey`) | Self-scoped (`convex/planner.ts:917`) |
| S10 | Task hard-delete cascade | `convex/lib/task_helpers.ts:135-141` | (internal delete of all task segments) | n/a — all users' segments | Caller of task delete |
| S11 | Dev seed | `convex/planner.ts:1043-1133` (`seedDemo`, `internalMutation`) | arbitrary members | internal-only |

Display-only consumers (no writes): `planner.weekGrid` (`convex/planner.ts:89-258`),
`planner.taskPanel` (`:292-406`), `planner.taskSegments` (`:435-488`),
`planner.myTodayTaskIds` (`:495-522`), `myTasks.listMyTasks` (`convex/myTasks.ts:45-233`),
`myTasks.myTasksCount` (`convex/myTasks.ts:243-284`).

---

## 2. Data model

### 2.1 `planSegments` table — `convex/schema.ts:662-685`

Fields: `orgId`, `taskId`, `userId` (**one person per segment** — the "row" it renders on),
`startDate`/`endDate` (`YYYY-MM-DD` inclusive), optional `laneOrder` (Planner stacking),
optional `todaySortKey` (manual My-Tasks Today ordering), `createdAt`, `updatedAt`,
`createdBy`.

Indexes: `by_orgId_taskId` (`schema.ts:681`), `by_orgId_startDate` (`:682`),
`by_orgId_userId_startDate` (`:685`, the covering-today lookup).

Load-bearing schema comment, `convex/schema.ts:659-661`:

> "Segments reference the task; the task's assigneeIds are NOT used for row placement."

So today's design deliberately decouples plan rows from assignment — the requested change
partially reverses that decision for the sun gesture.

### 2.2 Task assignees — `convex/schema.ts:131`

`assigneeIds: v.array(v.id("users"))` — **multiple assignees, always an array, may be
empty** (e.g. `createTaskWithSegment` inserts `assigneeIds: []`, `convex/planner.ts:686`).
Any "plan for assignee(s)" spec must define behavior for 0 and N > 1 assignees.

---

## 3. Authorization model

### 3.1 `assertCanManagePlanFor` — `convex/lib/auth.ts:120-127`

```ts
export function assertCanManagePlanFor(auth: AuthContext, targetUserId: Id<"users">): void {
  if (auth.isAdmin) return;
  if (auth.userId === targetUserId) return;
  throw new ConvexError("You can only manage your own plan");
}
```

`AuthContext` comes from `getAuthContext` (`convex/lib/auth.ts` ~`:40-76`): server-derived
`userId`, `orgId`, `orgRole`, `isAdmin` (`orgRole === "admin"`, Clerk org role). Stated
permission model (`convex/planner.ts:524-529`): **admins manage every row; members manage
segments on their OWN row only** (create with own userId, touch only own segments, no
reassigning to others).

### 3.2 Cross-org / membership guard

`assertOrgMember` (`convex/planner.ts:532-544`) — a segment's target `userId` must belong to
the caller's org. Used by `createSegment` (`:567`), `updateSegment` (`:605`),
`createTaskWithSegment` (`:661`). The self-scoped Today mutations skip it (the caller is a
member by construction).

### 3.3 Self-scoping helper — `getMyTaskPlanContext`, `convex/planner.ts:735-757`

Shared by `addToToday` / `removeFromToday` / `reorderTodayTask`. Resolves:
- `orgId`, `userId` from `getAuthContext` (`:739`) — **the caller, never a parameter**;
- org-owned task check (`:741-742`);
- "today" in **org timezone** via `getOrgSettings` + `getDateInTimezone` with
  `ORG_TIMEZONE_FALLBACK` (`:744-746`);
- `myCoveringToday` = the task's segments where `s.userId === userId` and the segment covers
  today (`:748-754`).

Because the target is always `auth.userId`, these mutations are "member-callable by
construction" (`:731-733`) — there is **no role check at all** on the sun path today.

---

## 4. Per-writer detail (every code path that writes `planSegments`)

### W1. `planner.addToToday` — `convex/planner.ts:764-788`
- **Plans for:** caller (`userId` from `getMyTaskPlanContext`; insert `:776-785` with
  `userId`, `createdBy: userId`).
- **Guards:** org-owned task; rejects archived tasks (`:770-772`). No role check.
- **Idempotency:** if any of *my* segments covers today → `{ added: false }` no-op (`:773`).
- **Shape:** one-day segment `startDate = endDate = today` (org tz).
- **If target → assignee(s):** insert loop per assignee; idempotency check must run per
  assignee (`segs.some(s => s.userId === assigneeId && covers(today))`); needs a rule for
  `assigneeIds = []` (fallback to caller? refuse?); `assertCanManagePlanFor` would reject a
  member planning for a co-assignee — the rule must be explicitly relaxed for this gesture or
  the mutation kept guard-free-but-assignee-scoped. `createdBy` stays the caller (audit).

### W2. `planner.bulkAddToToday` — `convex/planner.ts:796-852`
- **Plans for:** caller (insert `:837-846`).
- **Guards:** per-task org check (`:816`), archived skip (`:820`); returns honest counts
  `{ added, alreadyPlanned, skippedArchived, notFound }` (`:850`).
- **Idempotency:** per task, caller-scoped (`:829-834`).
- **If target → assignee(s):** counts semantics change (a task can be "added" for 2 of 3
  assignees and "alreadyPlanned" for 1) — toast copy in
  `components/tasks/bulk-toolbar.tsx:119-129` must be respecified. Read amplification: one
  segment scan per task **per assignee** or a smarter per-task grouping.

### W3. `planner.removeFromToday` — `convex/planner.ts:860-902`
- **Removes for:** caller only — surgery over `myCoveringToday` via `planRemovalOps`
  (`convex/lib/todayPlan.ts:129-157`): single-day delete, trim, or split (split remainder
  inherits `laneOrder`, `:886-896`).
- **If target → assignee(s):** the add/remove pair becomes asymmetric. Decide whether the
  remove sun also removes for all assignees (a member deleting *someone else's* plan — a
  real authz escalation `assertCanManagePlanFor` currently forbids) or stays self-scoped
  (then the chip can appear "stuck on" for a non-assignee who added).

### W4. `planner.reorderTodayTask` — `convex/planner.ts:910-928`
- Patches `todaySortKey` on the **caller's** covering segments (`:917,924-926`). Ordering is
  per person; unaffected by the target change (still self-scoped) — no change needed.

### W5. `planner.createTodayTask` — `convex/planner.ts:940-1019` (inline add, S7)
- **Plans for:** caller; also **assigns the caller**: task insert `assigneeIds: [userId]`
  (`:991`), segment insert for `userId` (`:1006-1015`). First in-progress status (`:961-968`).
- **Hit from:** `MyTasksInlineAdd` with `today` flag
  (`components/my-tasks/my-tasks-inline-add.tsx:26,31-33`; flag set only at
  `components/my-tasks/my-tasks-list.tsx:243` inside the Today group; the non-today variant
  at `:308` calls `tasks.create` instead).
- **If target → assignee(s):** already consistent (caller == sole assignee); no change.

### W6. `planner.createSegment` — `convex/planner.ts:549-582` (Planner drag/⌥-split, S8)
- **Plans for:** explicit `args.userId` (the board row). Guards: `assertCanManagePlanFor`
  (`:559`), org-owned active task (`:561-565`), `assertOrgMember` (`:567`),
  `assertSegmentRange` (`:568`, invariant `endDate >= startDate`, defined `:72-78`).
- **If target → assignee(s):** unchanged — the Planner is explicitly row-targeted; it is the
  model the sun gesture would converge toward, and its admin-or-self guard is the invariant
  the new gesture would breach for member callers.

### W7. `planner.updateSegment` — `convex/planner.ts:588-619`
- Move/resize/reassign/restack. Double guard: own segment (`:602`) **and** no reassignment
  to others for members (`:603`). Unchanged by the spec, but note it is the only existing
  precedent for "reassign", and it forbids members doing it.

### W8. `planner.createTaskWithSegment` — `convex/planner.ts:635-713` (draw-to-create, S8)
- Task + first segment atomically; task gets `assigneeIds: []` (`:686`) — the doc comment
  (`:632-633`) states the segment's row user is deliberately **not** assigned. Guard
  admin-or-self (`:649`). If "plan follows assignee" becomes the mental model, this
  empty-assignee choice is worth revisiting in the same spec (else Planner-created tasks are
  never sun-targetable to anyone).

### W9. `planner.removeSegment` — `convex/planner.ts:716-725`
- Deletes one segment; guard `assertCanManagePlanFor(auth, seg.userId)` (`:722`). Used by the
  Planner board and the task drawer's × (`components/planner/task-plan-section.tsx:36-43`,
  UI-gated by `isAdmin || seg.isMine`, `:72`).

### W10. Task delete cascade — `convex/lib/task_helpers.ts:132-142`
- Hard task delete removes **all** of the task's segments via `by_orgId_taskId`. No change.

### W11. `planner.seedDemo` — `convex/planner.ts:1043-1133`
- Dev-only `internalMutation` (CLI-reachable only); wipes and inserts arbitrary members'
  segments (`:1077-1085,1120-1129`). No change.

---

## 5. Display paths — whose segments count

### R1. Derived Today/Earlier partition — `convex/lib/todayPlan.ts`
- `partitionMyDay` (`:188-258`) partitions **"MY plan segments"**; its contract is explicit:
  "Segments for other users must not be passed in — planning is personal" (`:187`).
- Today membership: any segment covering today (`segmentCoversDate`, `:77-82`), task not
  archived, not completed today (`isCompletedToday`, `:91-100` — done/review updated today).
- Ordering: manual `todaySortKey` (min across covering segments) → arrival order (earliest
  covering-segment `createdAt`) (`:216-248`).
- Earlier: newest segment `endDate` before today within `EARLIER_WINDOW_DAYS = 14` (`:20`),
  task not done/review (`:230-237`).
- Scan guard `SEGMENT_SCAN_WINDOW_DAYS = 60` (`:27`) bounds every covering-today index read.

### R2. `myTasks.listMyTasks` — `convex/myTasks.ts:45-233`
- Reads the **caller's** segments via `by_orgId_userId_startDate` (`:76-85`), then
  `partitionMyDay` (`:96-97`). Key semantic already in place: **"The plan wins over
  assignment: Today candidates come from segment taskIds, not from the assigned set"**
  (`:87-89`) — so a segment planted on an assignee's row by someone else *will* surface in
  that assignee's Today group with zero changes here. `:178-196` even keeps a task planned
  for me but assigned to someone else in my Completed-today burndown.
- `filterMyTasks` (`convex/lib/myTaskHelpers.ts:101-111`) scopes the status groups by
  `assigneeIds.includes(userId)`; `groupByStatus` (`:130-216`) suppresses Today members from
  status groups ("· N in Today" hint).

### R3. `myTasks.myTasksCount` — `convex/myTasks.ts:243-284`
- Sidebar badge: same caller-scoped index read (`:253-262`) + `partitionMyDay` (`:276-281`).

### R4. `planner.myTodayTaskIds` — `convex/planner.ts:495-522`
- The **caller's** task ids with a covering-today segment; powers the sun chip state on
  every `/tasks` row (`app/(dashboard)/tasks/page.tsx:190-196`, passed as
  `inToday={inTodaySet.has(task._id)}` at `:327`).

### R5. `planner.taskSegments` — `convex/planner.ts:435-488`
- Task drawer Plan section: all sittings, each with `isMine` (`:474`) and `coversToday`
  (`:475`); **`canAddToToday` is caller-relative**: task active AND no covering segment *of
  mine* (`:483-484`). Consumed by `components/planner/task-plan-section.tsx:32-35,64,113`.

### R6. `planner.weekGrid` / `planner.taskPanel` — `convex/planner.ts:89-258, 292-406`
- The Planner board (rows for all members; segments joined to task data) and the task panel
  (`plannedDays`/`segmentCount` per task). Pure readers; unaffected except that
  assignee-targeted suns will make bars appear on other people's rows.

### R7. `AddToTodayButton` — `components/add-to-today-button.tsx:32-127`
- The single shared chip; props `taskId`, `inToday`, `moveToToday` (Earlier copy variant,
  `:41-45` — same mutation), `todayImplied` (Today group drops the redundant badge, `:47-53`).
  Fires `addToToday`/`removeFromToday` with **only `taskId`** (`:74,:77`). Success toast:
  "Added to today — visible in **your** Planner row" (`:82`; same copy in
  `task-plan-section.tsx:48`).

---

## 6. Implications for assignee-scoping (every code point that must change)

### Must change (server)
1. `planner.addToToday` (`convex/planner.ts:764-788`) — target set becomes
   `task.assigneeIds` (loop insert); per-assignee idempotency; empty-assignee fallback rule;
   decide `createdBy` (caller) vs `userId` (assignee) semantics — schema already separates
   them (`schema.ts:678`).
2. `planner.bulkAddToToday` (`:796-852`) — same, plus result-count semantics and toast copy
   (`components/tasks/bulk-toolbar.tsx:119-129`).
3. `planner.removeFromToday` (`:860-902`) — define symmetric behavior (remove for assignees
   vs stay self-scoped); if assignee-scoped, `planRemovalOps` surgery runs per assignee.
4. `getMyTaskPlanContext` (`:735-757`) — either grows a target-user parameter/plural variant
   or splits: "today in org tz + task check" vs "covering segments of user X".
5. `planner.taskSegments.canAddToToday` (`:483-484`) — "no covering segment of mine" must
   become "every assignee already covered" (or per-assignee detail), else the drawer
   affordance shows/hides wrongly.
6. `planner.myTodayTaskIds` (`:495-522`) — stays correct for the *viewer's* plan, but the
   `/tasks` chip semantics diverge: a non-assignee caller clicking the sun will not see
   `inToday` flip (their own segments unchanged). Either the chip state becomes
   "assignees are planned today" (new query over `by_orgId_taskId`) or the UI must show a
   different confirmation.
7. Authorization: `assertCanManagePlanFor` (`convex/lib/auth.ts:120-127`) currently forbids
   a **member** writing another user's segment. Assignee-targeting requires an explicit
   carve-out (e.g. "anyone may sun-plan a task for its assignees") or restricting the gesture
   to admins/assignees. This is the single riskiest decision — it breaches the documented
   invariant at `convex/planner.ts:526-529` and the tenancy stance that members manage only
   their own row. Also add `assertOrgMember`-style validation per assignee (stale
   `assigneeIds` after member removal; helper at `:532-544`).

### Must change (client)
8. `components/add-to-today-button.tsx` — toast copy `:80-84` ("your Planner row") and
   tooltip/labels; possibly a "planned for N people" state; prop `inToday` source (see 6).
9. `components/tasks/bulk-toolbar.tsx:114-131` — toast copy for per-assignee counts.
10. `components/planner/task-plan-section.tsx:45-51` — add-today copy `:48`; the section
    already displays per-person sittings so it needs no structural change.
11. `components/my-tasks/my-task-row.tsx:148-152` / `today-earlier-section.tsx:73` — the
    My Tasks add/"Move to today" suns: for self-assigned tasks behavior is identical
    (caller ∈ assignees), but define what happens on a My-Tasks row whose task has
    co-assignees (plan for all? just me? — Earlier "move" doubly so).

### Unchanged but load-bearing (verify, don't touch)
- `partitionMyDay` + `listMyTasks`/`myTasksCount` (`convex/lib/todayPlan.ts:188-258`,
  `convex/myTasks.ts:76-97,253-281`): already "plan wins over assignment" — segments planted
  on an assignee's row surface in *their* Today group automatically. This is what makes the
  feature work at all; keep the per-user index reads intact.
- `reorderTodayTask` (`convex/planner.ts:910-928`), Planner CRUD (`:549-725`), cascade
  delete (`convex/lib/task_helpers.ts:132-142`), `seedDemo`.

### Invariants at risk
- **Idempotency per (user, task, day)** — enforced only inside `addToToday`/`bulkAddToToday`
  (`:773`, `:829-834`), not by a DB uniqueness constraint. Per-assignee loops must preserve
  it or rapid clicks create duplicate one-day segments on assignees' rows.
- **Org-timezone "today"** — every write derives today from
  `getOrgSettings` + `getDateInTimezone` + `ORG_TIMEZONE_FALLBACK`
  (`convex/planner.ts:744-746, 804-806, 970-972`); any new code path must reuse this, never
  client-supplied dates.
- **Authz boundary** — enforced in Convex only (`AGENTS.md` invariant); UI gating like
  `task-plan-section.tsx:72` is cosmetic. The carve-out in point 7 must be a deliberate,
  documented server-side rule.
- **Notification/consent surprise** (product, not code): a member's sun-click would now
  mutate teammates' Today lists, sidebar badges (`myTasks.myTasksCount`) and Planner rows in
  real time; `removeFromToday` asymmetry can strand those entries.
- **Empty-assignee tasks** — `createTaskWithSegment` creates them by design
  (`convex/planner.ts:632-633,686`); without a fallback the sun becomes a no-op on the
  Planner's own tasks.
