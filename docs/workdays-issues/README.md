# Workday — Issue Slices

Vertical tracer-bullet slices for `docs/workdays-prd.md`. Each slice cuts through every layer (schema/query/UI/test as applicable) and is independently demoable.

Execute in order — later slices depend on earlier ones.

| # | Slice | Blocked by |
|---|-------|-----------|
| [01](01-tracer-member-sees-own-week.md) | Tracer: a member sees their own week | — |
| [02](02-admin-sees-full-team-grid.md) | Admin sees the full team grid | #01 |
| [03](03-week-navigation.md) | Week navigation (arrows + calendar popover + URL state) | #01 |
| [04](04-admin-member-filter.md) | Admin member filter (searchable popover) | #02, #03 |
| [05](05-weekend-toggle.md) | Weekend toggle (5↔7 day grid) | #03 |
| [06](06-started-at-chip.md) | Manual-log "Started at" chip | #01 |
| [07](07-hover-popover-and-drawer.md) | Hover popover + click-to-drawer + drawer prev/next | #01 |
| [08](08-adaptive-tiers-and-visual-polish.md) | Adaptive box content tiers + Notion-grade visual polish | #01 |
| [09](09-overtime-edge-cases-final-verification.md) | Overtime + edge cases + final verification | #05, #08 |

## Possible parallelization after #01 lands

Once slice 1 is in, several branches can run in parallel:

- **Path A:** #02 → #04
- **Path B:** #03 → #05
- **Path C:** #06 (independent UX upgrade)
- **Path D:** #07 (interaction layer)
- **Path E:** #08 (visual polish)

Slice #09 closes everything — it depends on #05 and #08 and runs the full verification checklist.

## Companion docs

- `docs/workdays-prd.md` — product spec, user stories, decisions
- `docs/workdays-plan.md` — implementation plan + verification checklist (§9)
- `docs/workday-prototype.html` — visual source of truth (open in browser while building #08)
