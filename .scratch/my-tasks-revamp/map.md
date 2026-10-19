---
title: My Tasks revamp — wayfinder map
labels: [wayfinder:map]
created: 2026-07-19
---

## Destination

An implementation-ready, hand-off **spec** for the My Tasks revamp: a today-first
layout with Earlier and the status groups visually demoted; a redesigned My Tasks
row where the title dominates and category badges stop overpowering it; and a
unified **assignee-scoped** sun ("Add to today") gesture on every surface it
appears. The spec is the deliverable — building it is a separate effort.

## Notes

Standing decisions from the charting session (2026-07-19, grilled with the owner):

- **Mental model**: "mai terv elöl, többi tompítva" — Today is the hero; Earlier
  and the status groups stay on the screen but visually demoted/collapsed.
- **Sun gesture**: plans for the task's **assignee(s)**, never the presser, on
  every surface (My Tasks, Tasks list, task detail, bulk, Planner-adjacent).
  Today's implementation is deliberately self-scoped
  ([convex/planner.ts:764](../../convex/planner.ts) `addToToday`) — the spec
  reverses that. Edge semantics are an open ticket.
- **Scope**: My Tasks screen revamp + sun semantics everywhere. The row redesign
  applies to **My Tasks rows only** (full Tasks-list row unification ruled out).
- **Row/badge**: fresh prototype round — do NOT just apply the previously
  approved badge hierarchy; but standing feedback still binds: no bordered
  pills, no primary-filled badges ("AI slop", 2 strikes), Linear-style quiet
  rows, filled icons over pills.

Skills/context every session should load: `/prototype` for prototype tickets;
grilling one question at a time, fundamentals before edge cases; memory files
`feedback_no_pill_badges`, `feedback_badge_design`, `feedback_time_cell_design`,
`feedback_grilling_priorities`. Key code: `components/my-tasks/*`,
`components/add-to-today-button.tsx`, `convex/planner.ts`,
`convex/lib/todayPlan.ts`, `convex/lib/myTaskHelpers.ts`.

Tracker: local markdown per [docs/agents/issue-tracker.md](../../docs/agents/issue-tracker.md).
Assets live in `assets/` next to this map.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Research — inventory of every sun/plan-segment surface and its authz](tickets/04-sun-surface-inventory.md) — 9 surfaces; all sun paths plan for the caller implicitly; only Planner CRUD takes explicit userId (admin-or-self); `assigneeIds` is a possibly-empty array; risk points: authz invariant, `/tasks` chip state, remove symmetry, per-assignee idempotency.
- [Today-first layout — what exactly gets demoted, and how](tickets/01-today-first-layout-prototype.md) — Winner: **Today | Earlier | All work** quiet tabs (variant F, 4 prototype rounds); Done block on the Today tab (not a tab); Earlier = own full-color tab (plan debt); All work = status overview, collapsible sections default open, "· N in Earlier" hints; duplication resolved by meaning; single left alignment line.

## Not yet specified

- **Sidebar My Tasks count semantics** — if sections collapse or dedup, what does
  the sidebar count mean? Depends on the layout prototype's outcome.
- **Earlier window semantics** — does the 14-day window and "move or let go"
  framing survive the today-first layout? Revisit after the layout decision.
- **Assignee notification** — when an admin plans someone's day, does the
  assignee get an inbox signal? Depends on the sun-semantics grilling.
- **Back-compat of existing segments** — segments admins already created on
  their own rows for others' tasks: migrate, leave, or ignore? Depends on the
  sun-semantics grilling.
- **Copy/toast changes** — sun-gesture toasts currently say "your Planner row";
  wording across surfaces once the new semantics are locked.

## Out of scope

- **Tasks-list row unification** — extending the new row design beyond My Tasks;
  the owner scoped the redesign to My Tasks rows only (charting, 2026-07-19).
- **Planner screen redesign** — only the sun gesture's semantics touch the
  Planner; its UI is untouched.
- **Sidebar badge system changes** — locked by standing feedback
  (`feedback_notification_badge_red_fill`); counts may be re-derived but the
  badge component/style is not in play.
