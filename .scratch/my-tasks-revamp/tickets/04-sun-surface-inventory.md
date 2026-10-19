---
title: Research — inventory of every sun/plan-segment surface and its authz
labels: [wayfinder:research]
status: closed
assignee: claude (wayfinder charting session, 2026-07-19)
blocked-by: []
---

## Question

Inventory every surface and code path that creates, removes, or displays
"today" plan segments, plus the authorization model, so the spec's API-change
section is grounded in the real call graph. Cover at least: `addToToday`,
`bulkAddToToday`, `removeFromToday`, Planner segment CRUD, `MyTasksInlineAdd`'s
`today` flag, every `AddToTodayButton` call-site, and `assertCanManagePlanFor`
/ role checks. For each: file:line, who it plans for today, and what breaks if
the target becomes the assignee.

Output: `assets/research-sun-surfaces.md` with file:line citations.

## Resolution

Resolved 2026-07-19 by a research subagent. Full inventory:
[assets/research-sun-surfaces.md](../assets/research-sun-surfaces.md).

Gist: 9 product surfaces + 2 internal writers touch `planSegments`. Every sun
path (`addToToday`, `bulkAddToToday`, `removeFromToday`, `createTodayTask`,
`reorderTodayTask`) plans for the **caller implicitly** (no `userId` arg, no
role check); only the Planner board CRUD takes an explicit `userId`, gated by
`assertCanManagePlanFor` (admin-or-self). Tasks store `assigneeIds` as an
**array that may be empty**, so the spec needs 0-and-N rules. Display already
cooperates: `listMyTasks` is "plan wins over assignment", so assignee-targeted
segments surface in assignees' Today with no partition changes. Riskiest
points: the members-own-row-only authz invariant, `/tasks` sun-chip state
derived from the *caller's* segments, `removeFromToday` symmetry, and
per-(user,task,day) idempotency moving per-assignee. Client copy hardcodes
"your Planner row".
