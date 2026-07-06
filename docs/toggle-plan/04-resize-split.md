# Slice 4 — Resize + ⌥-split

**Type:** AFK · **Blocked by:** [Slice 3](03-drag-core.md) · **Status:** ✅ done (2026-07-05)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Backend API* (createSegment), *Frontend* (drag engine, resize + copy modes), *Solution* (splitting rationale).

## What to build

The remaining two drag modes on top of the slice-3 engine.

- **Resize:** edge handles on both ends of a bar (visible affordance on hover). Dragging an edge snaps **the bar itself** to day boundaries live — no separate preview element for resize. Minimum one day. The bar's day-count label updates during the drag. Commits via `updateSegment`.
- **⌥-split (copy):** holding Alt/Option during a move drag switches to copy mode (cursor changes, original bar stays visible at full opacity); releasing creates a **new segment of the same task** at the target via a new `createSegment` mutation (admin-gated, validated, tested). Toggling Alt mid-drag switches modes live.
- Part badges and sibling highlight update immediately after a split (they exist from slice 2; this slice makes them appear through user action).

**Demo:** stretch a 1-day bar to 3 days by its right edge; ⌥-drag a bar to next week and watch `1/2` / `2/2` badges appear on both parts; click each part — same task.

## Acceptance criteria

- [x] `createSegment` rejects non-admins, cross-org ids, and invalid date ranges (verified by tests)
- [x] Left and right edge resize snap day-by-day live on the bar itself, minimum one day, with the day-count label updating mid-drag
- [x] Resizing to `endDate < startDate` is impossible in the UI and rejected by the server
- [x] ⌥-drag drops a new segment of the same task; the original segment is unchanged; Alt can be toggled mid-drag
- [x] After a split, part badges and sibling hover-highlight reflect the new segment count without a refresh
- [x] Both operations are optimistic with rollback + error toast
- [x] `npx tsc --noEmit` clean; tests pass; backlog.md entry written

## User stories addressed

16, 19, 43
