# Slice 1 — Tracer bullet: first bar on the board

**Type:** AFK · **Blocked by:** None — can start immediately · **Status:** ✅ done (2026-07-05)

## Parent PRD

[00-prd-phase-10-planner.md](00-prd-phase-10-planner.md) — sections: *Schema*, *Backend API* (weekGrid only), *Frontend* (route + grid layout basics), *Testing Decisions*.

## What to build

The thinnest complete path through every layer: a real `planSegments` record renders as a colored bar on a real person's row at `/planner`.

- `planSegments` table in the Convex schema exactly as specified in the PRD (fields, invariant, both indexes).
- Minimal `planner.weekGrid` query: rows for **all** org members (all-rows visibility for non-admins too — the deliberate difference from Workday), each row's segments joined to task title, project name, category color key, and statusType. Excludes segments of archived tasks. Org-scoped everywhere.
- Task hard-delete cascade: deleting a task deletes its segments (extend the existing delete path).
- `/planner` route (protected, visible to all members), nav entry in the shared navigation config, page as thin orchestrator.
- Minimal grid: `200px + repeat(days, 1fr)` layout, sticky people rail (avatar + name + role), day headers, weekend shading, today tint, two-line category-tinted bars positioned by date (naive stacking is fine — proper lane packing is slice 2). Fixed current-2-weeks range, no navigation yet.
- A seed mechanism (dev-only mutation or script) creating a few segments including one task with two segments, to make the slice demoable.

**Demo:** open `/planner`, see seeded bars on real teammates' rows, with correct colors and today highlighted.

## Acceptance criteria

- [x] `planSegments` table exists with the PRD's fields, `endDate >= startDate` enforced at write time, and both indexes
- [x] `weekGrid` returns all members' rows to a non-admin member (verified by test)
- [x] `weekGrid` never returns another org's segments (verified by test)
- [x] Segments of archived tasks are excluded from `weekGrid` (verified by test)
- [x] Deleting a task deletes its segments (verified by test)
- [x] `/planner` renders rows for every org member and bars for seeded segments, colored via `getCategoryColor` (gray when no category), title + project on two lines
- [x] Today column tinted, weekend columns shaded, rail sticky under horizontal scroll
- [x] `npx tsc --noEmit` clean; Convex tests pass; backlog.md entry written under `## Phase 10: Planner`

## User stories addressed

1, 4, 5, 40, 41, 42

## Notes

Read the generated Convex AI guidelines before writing backend code. Convex filenames must not contain hyphens. Mirror the Workday `weekGrid` args contract (`startDate`/`endDate` inclusive `YYYY-MM-DD` strings, optional `userIds`).
