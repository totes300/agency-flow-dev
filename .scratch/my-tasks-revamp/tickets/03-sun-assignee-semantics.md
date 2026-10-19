---
title: Sun gesture — assignee-scoped semantics and edge cases
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

The sun gesture now plans for the task's **assignee(s)**, not the presser
(locked at charting). Grill the edge semantics until the API contract is
specifiable:

- **Zero assignees**: disabled? prompt to assign first? fall back to presser?
- **Multiple assignees**: plan for all of them? a picker? first assignee?
- **Non-admin** pressing the sun on a task assigned to someone else: hidden,
  disabled, or error? (Authz base exists: `assertCanManagePlanFor` in
  `convex/planner.ts`.)
- **Presser == assignee** (the whole My Tasks screen): unchanged self path —
  confirm this stays idempotent per assignee.
- **Bulk sun** (`bulkAddToToday`, Tasks selection toolbar) on a mixed selection
  (some mine, some others', some unassigned): per-task behavior + honest counts.
- **Remove side**: whose segment does "Remove from today" remove when the
  presser isn't the assignee?
- Earlier rows' "Move to today" framing — survives as-is?

Output: a decided behavior table the spec can lift verbatim.

Research inputs (from the closed inventory ticket,
[assets/research-sun-surfaces.md](../assets/research-sun-surfaces.md)): tasks
store `assigneeIds` as a possibly-EMPTY array (Planner-created tasks get `[]`
by design); the `/tasks` sun-chip state is derived from the CALLER's segments
(`myTodayTaskIds`), so a non-assignee's click wouldn't flip the chip — the
grilling must also decide what the presser SEES after pressing; and
`removeFromToday` on someone else's plan is a permission escalation to decide
explicitly.
