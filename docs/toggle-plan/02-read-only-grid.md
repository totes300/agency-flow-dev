# Slice 2 — Complete read-only grid

**Type:** HITL — ends with a visual parity review against the mockup · **Blocked by:** [Slice 1](01-tracer-first-bar.md) · **Status:** ✅ approved (2026-07-05, incl. month zoom + continuous timeline addenda; capacity story 8 dropped)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Frontend* (grid layout, URL state), *Module Design* (planner date & lane math, planner URL state), *Further Notes* (design provenance).

## What to build

Everything the board shows before anything is draggable — full visual parity with `docs/mockups/planner-mockup.html` in read-only form.

- Pure lib module for lane packing (greedy first-fit by start date), date-range overlap/clamping, inclusive span math, workday counting, capacity calculation, and part-badge ordering — unit tested.
- Overlapping bars stack into lanes; rows grow to fit; bars clipped at the visible range render squared-off on the clipped edge.
- Part badges (`1/2`, `2/2`, …) on split tasks; hover/selection highlights sibling segments of the same task.
- Done tasks: bars stay, dimmed with a check indicator.
- Capacity in the rail: planned days vs working days in view (weekend cells excluded from both), amber when overbooked.
- Week navigation (prev / next / Today), Week / 2-weeks zoom, member row filter — all URL-persisted following the hand-rolled `useSearchParams` helper convention (copy the Workday query-args hook pattern; do **not** introduce nuqs call sites).
- Content-aware loading skeleton mirroring the grid; dedicated empty state for no-members / no-plan.

**Demo:** navigate weeks, switch zoom, filter members via URL, see a split task's badges and sibling highlight — everything matching the mockup pixel-for-pattern.

## Acceptance criteria

- [ ] Lane packing, overlap/clamp, workday count, capacity, and part-badge ordering are pure functions with unit tests (overlap chains, ties, single-lane, week-boundary cases)
- [ ] Overlapping segments never visually overlap; row height grows per lane count
- [ ] Range-clipped bars render with squared edges on the clipped side
- [ ] Split tasks show part badges; hovering or selecting a bar outlines its siblings
- [ ] Done-task bars are dimmed with a check indicator and remain visible
- [x] ~~Rail shows planned/available workdays per person, amber when over~~ — REMOVED by owner decision at review (2026-07-05); story 8 dropped
- [ ] Week anchor, zoom, and member filter live in URL search params; back button and link sharing work; defaults are dropped from the URL
- [ ] Skeleton mirrors the grid layout (rail + day columns + bar-shaped placeholders); empty state component exists
- [ ] `npx tsc --noEmit` clean; unit tests pass; backlog.md entry written
- [x] **HITL stop:** approved by Adam 2026-07-05 (with month zoom + continuous-timeline changes requested and shipped during review)

## User stories addressed

2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14
