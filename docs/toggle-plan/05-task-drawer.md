# Slice 5 — Task drawer integration

**Type:** AFK · **Blocked by:** [Slice 2](02-read-only-grid.md) (parallelizable with 3/4) · **Status:** ✅ done (2026-07-05)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Frontend* (task detail), *Module Design* (task detail "Plan" section), *User Stories* 36–39.

## What to build

Clicking a bar opens the **existing** task detail drawer — the same component and URL mechanism as `/tasks`. No bespoke drawer.

- Mount the existing drawer component on the Planner page, driven by the `?detail=<taskId>` search param via the existing helpers. ~~Respect the user's drawer/modal view preference exactly as `/tasks` does.~~ **Deviation (owner ruling, 2026-07-06):** the Planner always uses the drawer on desktop — the fullscreen modal covers the board and its pointer-down-outside dismissal swallows bar clicks (clicking another task closed the modal instead of opening it). Mobile still gets the modal.
- `taskIds` for prev/next navigation ordered by first visible segment (row order, then start date).
- Extend the existing task metadata component with a **"Plan" section** (stacked-layout variant, below the existing fields, separated by a hairline): every sitting of the task listed as *date range · person · duration · part n/m*, plus a per-segment unschedule (×) for admins, calling `removeSegment` with error handling. "Not scheduled" state when the task has no segments. The section renders wherever the metadata component is used, not only on the Planner.
- Clicking a bar both selects it and opens the drawer (selection ring visible behind the overlay); Escape closes the drawer first, then clears selection.

**Demo:** click a split task's bar — the familiar drawer slides in, the Plan section lists both sittings; copy the URL, open in a new tab, same task opens; × one sitting and watch the board update behind the drawer.

## Acceptance criteria

- [x] Clicking a bar opens the existing drawer via `?detail=`; direct navigation to a `?detail=` URL on `/planner` opens it too
- [x] Prev/next navigation walks visible tasks in board order
- [x] The metadata Plan section lists all segments of the task (date range, person, duration, part index) sorted by start date, with a "not scheduled" state
- [x] Per-segment × unschedules (admin only, hidden for members) with optimistic update + error toast; the timeline behind updates live
- [x] Escape closes the drawer before clearing bar selection
- [x] The segments-of-task read is org-scoped (verified by test if a new query is added)
- [x] `npx tsc --noEmit` clean; backlog.md entry written

## User stories addressed

36, 37, 38, 39
