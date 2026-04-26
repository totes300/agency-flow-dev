# Slice 9 — Overtime + edge cases + final verification

## Parent PRD

`docs/workdays-prd.md`

## What to build

The remaining edge-case visuals plus the final verification gate. Everything that makes the page feel "finished" instead of "almost finished."

This includes:

- **Overtime visuals** in `workday-day-cell.tsx`:
  - When a day's `totalMinutes > 480` (>8h), the day-stack `height` grows past 320px to fit content (no clipping).
  - A hairline `--border-strong` line draws at the 320px mark with a tiny "8h" label flush right.
  - Day total renders in `var(--danger)` and shows a `+Xh` pill (e.g. `+2h`).
- **Per-cell empty hint:** when a day cell has zero entries, render a quiet "No work logged" muted text top-aligned inside the day-stack (NOT a full empty state).
- **Week-level empty state:** when the entire visible grid has zero entries across the team, render `components/workday/workday-empty-state.tsx` (composing `<EmptyState>` from `components/empty-state.tsx`) centered in the grid area, while still rendering all member rows in their identity columns (preserves team awareness — see story 26 + 27 nuance).
- **Convex test (overtime):** seed a day with >8h of entries; assert `totalMinutes` returns the true total without clipping. Overtime is purely a render concern; the data must not change.
- **Backlog tracking:** add Phase 8 entry to `docs/backlog.md` with task-level checkboxes per CLAUDE.md "backlog tracking is mandatory."
- **Verification checklist run:** walk the entire `docs/workdays-plan.md` §9 list, check each item, and tick off in the backlog entry.

## Acceptance criteria

- [ ] A day with >8h logged renders its total in `var(--danger)` plus a `+Xh` pill (e.g. `+2h` for 10h).
- [ ] An "8h" hairline marker (in `--border-strong`) renders at the 320px mark on overtime days, with the "8h" label flush right.
- [ ] Overtime days don't clip — the day-stack expands to fit content.
- [ ] A day cell with zero entries shows a muted "No work logged" hint, top-aligned inside the day-stack.
- [ ] When the entire visible week has zero entries, `<WorkdayEmptyState>` renders centered in the grid area; member rows still render in their identity columns with zero totals.
- [ ] Empty state uses the shared `<EmptyState>` component (memory `feedback_no_custom_components.md`).
- [ ] Convex test: seeding a day with 10h of entries returns `totalMinutes === 600`. (Render is a separate concern.)
- [ ] All items in `docs/workdays-plan.md` §9 verification checklist pass:
  - [ ] `npx tsc --noEmit` zero errors
  - [ ] `npm run lint` clean
  - [ ] `weekGrid` query runs cleanly in Convex dev console
  - [ ] Visual diff vs. prototype near-zero on header, user-row card chrome, all four box tiers, hover popover, week picker, member filter
  - [ ] Click box → drawer opens
  - [ ] Click entry row in popover → drawer opens (optionally on the entry)
  - [ ] Week picker, weekend toggle, member filter all round-trip via URL
  - [ ] Member sees only own row; admin in another org sees zero leaks
  - [ ] Loading skeleton matches final layout dimensions exactly
  - [ ] Day total turns red + shows `+Xh` pill on overtime
  - [ ] 8h hairline appears on overtime days
  - [ ] Tiny entries render as slivers; hover popover still surfaces detail
  - [ ] Empty week renders centered empty-state, rows still visible
- [ ] `docs/backlog.md` updated with Phase 8 entry, task-level checkboxes, verification section, and "TODOs deferred to later phases" listing every stub from PRD §"Out of scope" with the phase that will pick them up.

## Blocked by

- Blocked by #05 (weekend toggle — verification covers it)
- Blocked by #08 (visual polish — overtime visual layers on top)

## User stories addressed

- 26 (week-level empty state, rows still visible)
- 27 (per-cell "No work logged" hint, not a full empty state)
- 28 (overtime: red total + `+Xh` pill + 8h hairline)
- Plus a final pass on 1, 2, 3, 4, 5, 25, 28, 30, 31, 32, 33 via the verification checklist.

## Notes

- **Slivers (<18px)** ship in slice 8, not here — this slice covers overtime + zero-entry states + final verification.
- **Per-user weekly capacity overrides are explicitly v2+** (PRD §"Out of scope"). 8h is hardcoded for everyone in v1.
- **PTO / "Off" labels are explicitly v2+.** A member with zero entries shows zero, not "Off."
- **Backlog "TODOs deferred to later phases":** include the entry-deep-link in drawer (from slice 7) if it shipped without entry-scroll, plus drag/inline-create/inline-edit/hour-grid view (all v2+).
