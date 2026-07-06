# 03 — Today experience complete: Earlier, reorder, inline-add, badge, confetti

**Type**: AFK
**Blocked by**: 02
**Unblocks**: —

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Implementation Decisions (Earlier window, Today ordering, inline-add, sidebar badge), § User Stories 17, 30–32, 34, 36–37

## What to build

Everything that makes the Today group a complete daily cockpit: **yesterday's leftovers, manual ordering, one-gesture task creation, the sidebar number, and the celebration** — all on the primitives from 01–02.

### Schema

- `planSegments`: new optional `todaySortKey` (fractional string key, same mechanism as the existing reorder infrastructure). Manual ordering within Today; unset falls back to segment `createdAt` (arrival order).

### Backend (Convex)

- `listMyTasks`: Today ordering honours `todaySortKey` (min across a task's covering segments) before the `createdAt` fallback; return the Earlier list (already partitioned in 01) as a nested payload of the Today group.
- New mutation `reorderTodayTask(taskId, beforeKey, afterKey)`: self-scoped; writes `todaySortKey` onto the caller's covering segment(s) using the existing fractional-key helper (`lib/reorder` neighbor-key pattern).
- `myTasksCount` reworked: returns the caller's **remaining Today count** (Today members not completed), computed via the same `todayPlan` partition — cheap, index-backed.
- Constant `EARLIER_WINDOW_DAYS = 14` in the today-plan constants.

### Frontend

- **Earlier subsection** inside the Today group: expanded by default, collapsible (chevron + `Earlier · N` muted header); rows render dimmed with status badge; hover action **Move to today** → `addToToday` (old segment stays as history — never auto-carried). Section hidden when empty.
- **Manual reorder** within Today: reuse the existing `MyTasksSortableRow` + optimistic-order pattern from `MyTasksList`, targeting `reorderTodayTask`. New arrivals append at the bottom; reordering never reshuffles on status changes.
- **Inline-add in the Today group**: `MyTasksInlineAdd` variant that creates the task with the org's first **In progress**-type status (by sortOrder), `assigneeIds = [me]`, then `addToToday` — one gesture, atomically perceived (sequential calls with error rollback toast are acceptable; a combined mutation is cleaner if trivial).
- **Sidebar badge** (`nav-main` consumer of `myTasksCount`): shows remaining Today count, **hidden entirely at zero**.
- **Celebration re-key**: `TodayAllDoneState` + confetti trigger when the Today group empties while Completed today has entries (replaces the "primary status group empty" heuristic).
- Skeleton updated for Earlier presence.

### Tests

- `todayPlan` / helper tests: Earlier boundary at exactly 14 days (day 14 in, day 15 out); Move-to-today leaves the old segment untouched; ordering — `todaySortKey` beats `createdAt`, unset appends.
- Count logic: completed Today tasks don't count; Earlier tasks don't count.

## Acceptance criteria

- [ ] A task planned yesterday and unfinished shows under Earlier (open by default); Move to today creates a fresh one-day segment and the row jumps to the Today list; the Planner keeps yesterday's bar.
- [ ] A leftover from 15 days ago does not appear; 14 days ago does.
- [ ] Collapsing Earlier persists for the session; empty Earlier renders nothing.
- [ ] Drag-reordering Today rows persists across reloads and other users' changes; completing a task doesn't reshuffle the rest.
- [ ] Inline-add in Today creates an In progress task assigned to me, already in Today, in one flow; on mutation failure a toast appears and no half-state remains visible.
- [ ] Sidebar badge equals the visible remaining Today count all day and disappears when the last task completes — at which point the confetti/all-done state fires in the Today group.
- [ ] Tests green; `npx tsc --noEmit` 0 errors.

## User stories addressed

17, 30–32, 34, 36–37
