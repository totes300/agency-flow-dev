# Slice 6 — Tasks panel + drag-to-schedule

**Type:** AFK · **Blocked by:** [Slice 3](03-drag-core.md) · **Status:** ✅ done (2026-07-06)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Backend API* (taskPanel, createSegment), *Frontend*, *Default segment length*, *User Stories* 23–31.

## What to build

The picker that turns the board into a daily driver: a right-hand panel of real tasks, dragged onto the grid to schedule.

- **`taskPanel` query:** all active (non-archived) tasks with title, project name, client name, category color key, statusType, estimate, planned day count, segment count, createdAt. Org-scoped, tested.
- **Panel UI** (~288px right sidebar inside the page frame, toggleable via a toolbar "Tasks" button whose badge shows the unscheduled count; collapses below the grid on narrow viewports):
  - Cards: **title on top, client name below, category as colored dot** — no estimate text, no project grouping. Card visual: bordered, subtle shadow, hover lift (see mockup).
  - Ordered newest-created first.
  - Search box matching title + project + client (client-side; may use the existing URL-debounce helper).
  - Tabs: **Unscheduled** (default; zero segments, excluding done and archived) and **All** (every active task; scheduled ones dimmed with a "✓ planned" mark).
- **Drag-to-schedule** (admins): dragging a card follows the cursor as a floating card while over the panel and morphs into the snapped bar preview once over a row (slice-3 engine, panel mode); drop calls `createSegment`. Default span: `ceil(estimate / 480)` workdays-equivalent minus already-planned days, min 1; plain 1 day when estimate unset — **verify the estimate unit first** (PRD Open Question 1). Dropping outside the grid animates the card back and creates nothing. Dragging an already-scheduled task from All adds another sitting of the same task.
- Members see the panel read-only (cards render, not draggable); clicking a card opens the drawer (slice 5 wiring if present).

**Demo:** search a task, drag it onto Thursday for a teammate, watch it leave the Unscheduled tab; drag the same task again from All — second sitting, part badges appear.

## Acceptance criteria

- [x] `taskPanel` returns only the org's active tasks with all listed fields (verified by test)
- [x] Cards show title + client + category dot only; list is newest-first
- [x] Search matches title, project, and client
- [x] Unscheduled tab excludes done, archived, and already-scheduled tasks; All tab dims scheduled ones with a planned mark; toolbar badge equals the unscheduled count
- [x] Drag from panel: floating card over the panel, snapped bar preview over the grid, live lane reflow, correct default span rule, cancel on outside drop
- [x] Dropping an already-scheduled task creates an additional segment of the same task — never a duplicate task
- [x] Members cannot drag; server rejects their `createSegment` anyway
- [x] Optimistic create with rollback + error toast
- [x] `npx tsc --noEmit` clean; tests pass; backlog.md entry written

## User stories addressed

23, 24, 25, 26, 28, 29, 30, 31
