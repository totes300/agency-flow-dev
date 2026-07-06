# Today × Planner Unification — Implementation Slices

Parent PRD: [`docs/today-planner-prd.md`](../today-planner-prd.md)

Six tracer-bullet vertical slices. Each cuts through every layer (schema → Convex → UI → tests) and is independently demoable. Slice 01 is the thinnest complete path; everything else layers onto it.

## Dependency graph

```
01 tracer: plan appears in Today   (no blockers)
 ├─→ 02 sun gestures + permissions
 │    ├─→ 03 Today experience complete (Earlier, reorder, inline-add, badge)
 │    ├─→ 04 triage everywhere (/tasks, bulk, Plan section self-service)
 │    └─→ 06 Planner member self-editing (CUTTABLE to fast-follow)
 └─→ 05 Today status retirement + docs   (anytime after 01)
```

Recommended order: 01 → 02 → 05 → 03 → 04 → 06. After 02, slices 03/04/06 are parallelizable.

## Slices

| # | Slice | Type | Blocked by |
|---|-------|------|-----------|
| 01 | [Tracer: Planner plan appears in My Tasks Today](01-tracer-plan-appears-in-today.md) | AFK | none |
| 02 | [Sun gestures: add/remove + admin-or-self permissions](02-sun-gestures-and-permissions.md) | AFK | 01 |
| 03 | [Today experience complete: Earlier, reorder, inline-add, badge, confetti](03-today-experience-complete.md) | AFK | 02 |
| 04 | [Triage everywhere: /tasks rows, bulk action, Plan section self-service](04-triage-everywhere.md) | AFK | 02 |
| 05 | [Today status retirement + seed + docs](05-today-status-retirement.md) | AFK | 01 |
| 06 | [Planner member self-editing + completed bar rendering](06-planner-member-self-editing.md) | AFK · cuttable | 02 |

## Ground rules (from PRD + repo conventions)

- All "today" math in **org timezone** (`getDateInTimezone` / `todayInTimezone`); segment dates are inclusive `YYYY-MM-DD` strings.
- Plan segment mutations write **no** task activity-log events; status changes remain the only logged workflow events.
- No data migration: pre-launch demo data; slice 05 covers seed + reset.
- Design language: quiet ghost buttons, filled icons for active states, no bordered pills, muted counts as text, hover-revealed actions (always-visible muted on touch).
- `npx tsc --noEmit` must be 0 errors at the end of every slice; every mutation call has `.catch()` + `toastError`.
- On completion of all slices: add the phase entry to `docs/backlog.md` (checkboxes, verification, deferred TODOs) — owned by slice 05.
