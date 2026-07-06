# Slice 8 — In-place task creation

**Type:** AFK · **Blocked by:** [Slice 6](06-tasks-panel.md) (composer) and [Slice 3](03-drag-core.md) (draw gesture) · **Status:** ✅ done (2026-07-06)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Backend API* (createTaskWithSegment), *User Stories* 32–35.

## What to build

Creating tasks without leaving the Planner, both ways (admins only).

- **`createTaskWithSegment` mutation:** atomic — creates the task with the same defaults as inline-add on `/tasks` (default status resolution, fractional sort key, creator handling; no category) and inserts the segment in the same mutation. Admin-gated, org-validated, date invariant enforced. Tested, including task defaults equivalence.
- **Draw-to-create:** press and drag across empty cells in a person's row (crosshair cursor on empty grid): a neutral-gray "New task" bar sketches out snapped day-by-day (both drag directions), with live lane reflow. On release, a small popover anchored to the drawn bar asks for **title + project**; Enter calls `createTaskWithSegment`; Escape or outside click cancels and removes the preview. Failure keeps the popover and typed title, shows an error toast.
- **Quick-add composer:** the "+ New task" toolbar button opens (and focuses) a composer at the top of the panel list (title input + project select). Enter creates an **unscheduled** task via the existing task-create mutation, which appears at the top of the list (newest-first); the composer stays open and refocuses for rapid capture. Escape closes it.
- Draw-to-create and empty-cell interactions are disabled for members.

**Demo:** draw Wednesday–Friday on a teammate's row, type a name, Enter — task exists, scheduled, correct project; then capture three tasks in a row via the composer without touching the mouse.

## Acceptance criteria

- [x] `createTaskWithSegment` is atomic and produces tasks indistinguishable from `/tasks` inline-add defaults (verified by test)
- [x] Drawing works in both directions, snaps day-by-day, shows the day count, reflows lanes live
- [x] Popover: Enter creates task + segment; Escape/outside click cancels cleanly; failure preserves input + shows toast
- [x] Composer: Enter adds an unscheduled task to the top of the panel and stays open focused; Escape closes; failure preserves input + shows toast
- [x] Members get no crosshair, no draw, no composer; server rejects their creates
- [x] `npx tsc --noEmit` clean; tests pass; backlog.md entry written

> **Owner feedback applied mid-slice (2026-07-06):** the plain project
> `<select>` was replaced with a searchable Popover+Command picker (grouped
> by client, matches project AND client names — hundreds of clients must be
> findable), picking a project returns focus to the title input so Enter
> always creates, and an explicit primary **Create task / Add task** button
> was added to both forms (Enter-only was undiscoverable). A second
> ruling replaced the crosshair cursor with a Notion-style hover "+" day
> placeholder (normal arrow everywhere; see backlog addendum + the
> `feedback-no-crosshair-cursor` memory).

## User stories addressed

32, 33, 34, 35
