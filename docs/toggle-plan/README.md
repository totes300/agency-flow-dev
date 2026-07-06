# Toggle Plan — Planner delivery plan (Phase 10)

Local work-item breakdown of the Planner PRD into **tracer-bullet vertical slices**. Each slice cuts through every layer end-to-end (schema → Convex → UI → tests) and is demoable on its own. Build the thinnest complete path first, get feedback, then expand.

- **PRD:** [00-prd-phase-10-planner.md](00-prd-phase-10-planner.md)
- **Interactive design reference:** `docs/mockups/planner-mockup.html` (open in a browser; it is the behavioral spec)

## How to work this plan

1. Take slices in dependency order. A slice is done when every acceptance criterion is checked, `npx tsc --noEmit` is clean, its tests pass, and its `docs/backlog.md` entry is written.
2. **HITL slices end with a stop:** present the result to the user (Adam) and wait for approval before starting dependent slices. AFK slices can be completed without interaction.
3. Update the status table below as slices progress.

## Slices

| # | Slice | Type | Blocked by | Status |
|---|-------|------|-----------|--------|
| 1 | [Tracer bullet: first bar on the board](01-tracer-first-bar.md) | AFK | — | ✅ done (2026-07-05) |
| 2 | [Complete read-only grid](02-read-only-grid.md) | **HITL** | 1 | ✅ approved (2026-07-05) |
| 3 | [Drag core: move, reassign, unschedule](03-drag-core.md) | **HITL** | 2 | ✅ approved (2026-07-05) |
| 4 | [Resize + ⌥-split](04-resize-split.md) | AFK | 3 | ✅ done (2026-07-05) |
| 5 | [Task drawer integration](05-task-drawer.md) | AFK | 2 | ✅ done (2026-07-05) |
| 6 | [Tasks panel + drag-to-schedule](06-tasks-panel.md) | AFK | 3 | ✅ done (2026-07-06) |
| 7 | [Panel filters](07-panel-filters.md) | AFK | 6 | ✅ done (2026-07-06) |
| 8 | [In-place task creation](08-inplace-create.md) | AFK | 3, 6 | ✅ done (2026-07-06) |
| 9 | [Final polish + hardening](09-polish-hardening.md) | **HITL** | 1–8 | not started |

## Dependency graph

```
1 ──► 2 ──► 3 ──► 4
      │     ├──► 6 ──► 7
      │     │    └──► 8 (also needs 3)
      └──► 5
4,5,7,8 ──► 9
```

Slices 4, 5, 6 are parallelizable once their blockers land (5 only needs 2; 4 and 6 need 3).
