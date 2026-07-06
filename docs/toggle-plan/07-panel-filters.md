# Slice 7 — Panel filters

**Type:** AFK · **Blocked by:** [Slice 6](06-tasks-panel.md) · **Status:** ✅ done (2026-07-06)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Frontend* (URL state), *User Stories* 27.

## What to build

Filter chips inside the Tasks panel that narrow **only the panel list — never the timeline**. The board always shows the whole team's real plan.

- Chip row between the tabs and the list: **Project** (multi-select), **Client** (multi-select), **Category** (multi-select, options with color dots, including "No category"), **Due** (single-select: All / Overdue / Due in 7 days / No due date).
- Dropdown menus per chip (checkboxes / radio), close on outside click; active chips render solid with a count (`Project · 2`) or the selected option label; a "Clear" action appears when any filter is active.
- Filter state persists in URL search params following the hand-rolled helper convention; defaults are dropped from the URL; a filtered link restores the exact panel state.
- Filters compose with search and the active tab; the empty result state distinguishes "no tasks match" from "everything is planned".
- Overdue / next-7-days are computed against the org's today (reuse the existing timezone-aware today helper).

**Demo:** filter to one client + Overdue, share the URL, open it fresh — same narrowed panel, untouched timeline.

## Acceptance criteria

- [x] All four chips work with the specified select semantics and visual active states
- [x] Filtering changes the panel list only; timeline bars and capacity numbers are unaffected
- [x] Filter state round-trips through the URL (refresh + shared link); defaults produce a clean URL
- [x] Filters compose with search and tabs; Clear resets everything at once
- [x] Due filter uses org-timezone today for overdue / next-7-days boundaries
- [x] `npx tsc --noEmit` clean; backlog.md entry written

## User stories addressed

27
