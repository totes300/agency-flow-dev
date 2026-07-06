# 01 — Tracer: Planner plan appears in My Tasks Today

**Type**: AFK
**Blocked by**: none
**Unblocks**: 02, 05

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Solution, § Implementation Decisions (derivation rule, plan-wins-over-assignment, suppression, timezone), § Module Design (`todayPlan` helpers, My Tasks queries)

## What to build

The thinnest complete path proving the architecture: **a plan segment covering today makes the task appear in a new derived Today group at the top of My Tasks** — live, deduped, suppressed from the status groups below, with the suppression made visible. Read path only; the sun gesture comes in slice 02 (an admin can already create segments via the existing Planner, which is the demo vehicle).

### Schema

- New index on `planSegments`: `by_orgId_userId_startDate` (`["orgId", "userId", "startDate"]`).

### Backend (Convex)

- New pure helper module `convex/lib/todayPlan.ts` (no ctx dependency, mirroring `myTaskHelpers.ts` style):
  - `segmentCoversDate(seg, date)` — inclusive string comparison.
  - `partitionMyDay(tasks, mySegments, todayStr, earlierWindowDays)` → `{ todayTaskIds, earlierTaskIds }`. Today: any segment covering today, task not archived, deduped per task. Earlier: newest-segment-ended-before-today within the window, no coverage today, not completed. (Earlier is consumed by slice 03; build the partition here so the contract is complete.)
  - Default ordering contract: today tasks ordered by earliest covering-segment `createdAt` (arrival order, append at bottom).
- `listMyTasks` rework (`convex/myTasks.ts` + `convex/lib/myTaskHelpers.ts`):
  - Fetch caller's segments via the new index, `startDate` bounded to `[today − 60d, today]`, filter `endDate ≥ today`.
  - **Today group first** in the returned groups: key `today`, enriched tasks, ordered per the contract above. Membership ignores `assigneeIds` (the plan wins) — Today tasks are loaded by segment `taskId`, not only from the assigned set.
  - Tasks in Today are **suppressed** from the visible status groups; each status group gains `inTodayCount` for its header hint.
  - Completed-today logic unchanged: done/review-type tasks updated today go to `completed_today`, never to Today.
  - `hiddenCount` stays correct (Today members are visible, not hidden).

### Frontend

- `MyTasksList` / `MyTasksGroup`: render the Today group at the top — sun glyph header, count, muted hint text ("the Planner's plan for today"); rows show the task's normal status badge (plan membership and workflow state are independent facts).
- Assignment-mismatch indicator on Today rows: small dimmed avatar of the actual assignee (dashed empty circle when unassigned) with tooltip "Assigned to {name} — planned for you today". Uses the shared avatar component; no pills.
- Status group headers: muted `· N in Today` text when `inTodayCount > 0`.
- Today empty state (dedicated component per the empty-state convention): points at both gestures — sun icon and Planner scheduling.
- `MyTasksSkeleton`: updated for the new group order (content-aware).

### Tests

- `convex/lib/__tests__/todayPlan.test.ts`: covering on first/last/middle day of a multi-day segment; single-day; boundary exclusive cases (ends yesterday / starts tomorrow); dedupe of overlapping segments; archived task exclusion; Earlier windowing at exactly 14 days; ordering by segment createdAt.
- Extend `convex/lib/__tests__/myTasks.test.ts`: a task is in exactly one of Today / status group / completed_today; `inTodayCount` matches suppressed count; unassigned-but-planned task appears in Today.

## Acceptance criteria

- [ ] As admin, drag a bar covering today onto my Planner row → the task appears at the top of My Tasks → Today without reload (Convex reactivity).
- [ ] A Wed–Fri segment shows the task in Today on all three days (verify by changing the segment range).
- [ ] Two overlapping segments for the same task produce one Today row.
- [ ] A task in Today does not appear in its status group below; the group header shows `· 1 in Today`.
- [ ] A task planned for me but assigned to a teammate appears in my Today with the dimmed avatar + tooltip; the teammate's segments never appear in my Today.
- [ ] Completing a Today task (status → review/done type) moves it to Completed today.
- [ ] Empty Today renders the teaching empty state; skeleton mirrors the new layout.
- [ ] All new/updated helper tests green; `npx tsc --noEmit` 0 errors.

## User stories addressed

1–9, 27–29, 33, 35, 38, 49–51
