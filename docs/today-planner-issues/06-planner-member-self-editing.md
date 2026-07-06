# 06 — Planner member self-editing + completed bar rendering

**Type**: AFK — **CUTTABLE**: if drag-interaction gating balloons, ship 01–05 and move this to a fast-follow. The server-side permissions landed in 02, so nothing else depends on this slice.
**Blocked by**: 02
**Unblocks**: —

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Implementation Decisions (Planner UI), § User Stories 42–44, 46

## What to build

The Planner becomes a self-scheduling surface for everyone: **members get full edit affordances on their own row — and only there — while completed tasks' bars read as history.** Pure UI gating; the server has enforced admin-or-self since slice 02.

### Schema

- None.

### Backend (Convex)

- None expected. Verify `weekGrid` / `taskPanel` return whatever the client needs to know "is this row mine" (viewer's userId is available via the standard auth context on the client — no new fields anticipated).

### Frontend

- **Editability predicate**: one derived flag per row — `isAdmin || row.userId === me` — threaded through the Planner components (`PlannerRow`, `PlannerBar`, draw-to-create, quick-create popover, resize/drag handles). Non-editable rows: no create-on-drag placeholder, no drag/resize cursors or handles, bars read-only (click still opens the task).
- Members must not be able to drag a bar **across rows** (reassignment stays admin-only): vertical drag disabled for members even on their own bars; horizontal move/resize allowed.
- **Completed task bars**: dimmed with a leading check glyph (per prototype), in both member and admin views. History stays visible; nothing is deleted or trimmed on completion.
- Hover affordances follow the existing quiet pattern — no new visual language; the row of the current viewer needs no special highlight beyond the existing member filter behaviour.

### Tests

- None new on the server (permission matrix covered in 02). UI-level: extend any existing planner interaction tests if present; otherwise manual verification per acceptance criteria.

## Acceptance criteria

- [ ] As a member: I can draw-to-create, move, resize, and delete bars in **my own row**; all of this is inert on teammates' rows (no handles, no placeholder, no drop).
- [ ] As a member: I cannot drag my bar into another user's row; as an admin I still can.
- [ ] A stale/hostile client attempting a cross-user edit as member is rejected server-side (spot-check — behaviour from slice 02).
- [ ] Completed tasks render dimmed with a check in every Planner view; clicking them still opens the task detail.
- [ ] Admin experience is unchanged in every interaction.
- [ ] `npx tsc --noEmit` 0 errors.

## User stories addressed

42–44, 46
