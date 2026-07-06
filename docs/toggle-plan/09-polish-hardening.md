# Slice 9 — Final polish + hardening

**Type:** HITL — ends with the user's final review of the whole feature · **Blocked by:** Slices 1–8 · **Status:** not started

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Delivery slices* (slice 4), *Testing Decisions* (manual verification checklist), *Out of Scope* (do not creep into it).

## What to build

The closing pass: verify the whole feature against the mockup and the PRD's user stories, fix gaps, and finish the paper trail. No new capabilities beyond the listed items.

- **Mockup parity audit:** walk the mockup's full interaction spec table and confirm identical behavior in the real build (this is the PRD's definition of done for interactions). Fix any drift.
- **User-story sweep:** verify all 43 stories, especially cross-slice seams — member read-only across *every* surface (bars, panel, drawer ×, draw), done-task styling everywhere, split-task badges after every mutation path.
- **Due-date markers on bars** (optional, small): a subtle marker when a bar's task has a due date inside the visible range; skip if it muddies the bars — decide with the user at the HITL review.
- **Performance pass:** measure with React DevTools Profiler under a realistic load (hundreds of tasks, tens of segments); optimize only what measurement shows (project rule: measure before optimizing).
- **Narrow-viewport audit:** grid scrolls in its own container, rail sticky, panel stacks below, drawer usable; read-only usability on mobile confirmed.
- **Paper trail:** finalize `docs/backlog.md` Phase 10 section (all tasks checkboxed, verification section, "TODOs deferred to later phases" listing every stub — e.g. plan-vs-actual overlay, notifications, server-side panel search); update the README status table in this folder to complete.

## Acceptance criteria

- [ ] Every row of the mockup's interaction spec verified in the real build (checklist recorded in the backlog verification section)
- [ ] All 43 PRD user stories pass a manual sweep; discrepancies fixed or explicitly logged as deferred
- [ ] Member accounts verified read-only on every surface; admin verified on every mutation path
- [ ] Profiler run documented; any applied optimizations justified by measurements
- [ ] Narrow-viewport behavior verified
- [ ] `npx tsc --noEmit` clean; full test suite green; backlog.md Phase 10 section complete with deferred-TODOs list
- [ ] **HITL stop:** final walkthrough with the user; feature is done only on their approval

## User stories addressed

Verification sweep across 1–43 (no new stories).
