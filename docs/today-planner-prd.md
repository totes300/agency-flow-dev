# PRD: Today × Planner Unification

> **Supersedes**: `docs/today-tab-prd.md` (the original status-based "Today focus" My Tasks spec).
> **Companion artifacts**: interactive HTML prototype (Claude artifact, 2026-07-06) demonstrating every interaction below; the long design-review conversation that produced these decisions.
> **Status**: Approved for implementation.

## Problem Statement

Scheduling a task in the Planner and choosing what to work on today are the same mental act — "this is when I do this" — but the product treats them as two unrelated systems. The Planner stores per-person, per-date plan segments; the My Tasks "today" concept is a **workflow status** named "Today" that the user flips manually.

Consequences for the user:

- A task scheduled in the Planner for today (possibly days in advance, possibly as part of a multi-day bar) does **not** appear in My Tasks as today's work. The morning plan and the morning checklist disagree.
- "Today" as a status cannot express per-person reality: the same task can be planned for me today and for a teammate on Thursday, but a task has exactly one status.
- Keeping status in sync with the calendar would require midnight status flips (cron), which would fight manual status changes, spam the task activity log with machine events, and erode trust in statuses.

The user works in two modes, roughly 50/50: rapid manual triage ("today, today, today" across a list) and ahead-of-time Planner scheduling (including multi-day and split sittings). Both must land in the same "Today" list with zero extra ceremony.

## Solution

**"Today" stops being a status and becomes a derived, per-user daily plan** — computed from `planSegments`, the primitive the Planner already uses. One primitive, two views:

- **My Tasks** gains a derived **Today** group at the top: every task with a plan segment (mine) covering today's date, whether it was dragged onto the Planner last week or added ten seconds ago with the sun button.
- **Adding to Today manually** (sun icon on task rows, in the task detail Plan section, and as a bulk action) simply creates a one-day plan segment for the current user, today. It instantly appears as a bar in the Planner — the plan is always honest.
- **Removing from Today** trims or splits the underlying segment; multi-day bars keep their other days.
- The **"Today" status is retired**: removed from the default seed; "Next up" takes over the triage role. No data migration — the app is pre-launch with demo-only data, so the dev environment is reset (or the status simply deleted in Settings). Statuses describe workflow state only (Next up → In progress → Admin review → …); time lives in the plan.
- The familiar end-of-day gesture is preserved: pushing a task to Admin review (a `review`-type status) moves it into the existing "Completed today" group, exactly as it does now.
- Derived membership is always inspectable: the task detail's existing Plan section shows the segments that put the task in Today, and users can manage their own segments there.

When this ships: the Planner and My Tasks can never disagree about today; there is no sync job, no duplicated state, and no machine-written status changes. As a bonus, plan segments persist as history, enabling future plan-vs-actual reporting.

## User Stories

### Deriving Today

1. As a member, I want every task with one of my plan segments covering today to appear automatically in My Tasks → Today, so that my Planner schedule and my daily checklist are always the same list.
2. As a member, I want a multi-day segment (e.g. Wed–Fri) to put the task in Today on each of those days, so that long sittings don't need re-adding every morning.
3. As a member, I want a task with several of my segments covering today to appear in Today exactly once, so that the list never shows duplicates.
4. As a member, I want tasks planned for me today to appear in my Today even when I am not an assignee of the task, so that the plan — not the assignment — governs my day ("the plan wins").
5. As a member, I want a quiet indicator on Today rows whose task is assigned to someone else (or unassigned) — a small dimmed assignee avatar (dashed empty circle when unassigned) with a tooltip ("Assigned to Anna — planned for you today") — so that I notice the mismatch without the row shouting.
6. As a member, I want a teammate's segment on the same task to have no effect on my Today, so that planning stays personal.
7. As a member, I want "today" computed in the org timezone (same anchor as Workday and the Planner), so that all views agree on the date boundary.
8. As a member, I want tasks I finish (done- or review-type status, updated today) to leave the Today group and appear in "Completed today", so that the day visibly burns down.
9. As a member, I want archived tasks and their segments excluded from Today, so that dead work never resurfaces.

### Adding to Today (manual triage)

10. As a member, I want a sun icon revealed on hover on My Tasks rows (and always visible in a muted state on touch devices, where hover doesn't exist), so that morning triage is one click/tap per task on every device.
11. As a member, I want the same sun icon on `/tasks` page rows, so that I can triage from the org-wide list too.
12. As an admin or member, I want an "Add to Today" bulk action in the `/tasks` selection toolbar, so that I can plan several tasks at once.
13. As a member, I want an "Add to Today" affordance in the task detail's Plan section, so that the drawer/modal offers the same gesture.
14. As a member, I want adding to Today to be idempotent — clicking it on a task already in my Today does nothing (no duplicate segments), so that rapid clicking is safe.
15. As a member, I want a confirmation toast that states what happened in plan terms ("Added to today — visible in your Planner row"), so that I learn the mental model as I use it.
16. As a member, I want adding a task to Today to fail with a clear error if the task is archived, so that plans can't reference dead work (mirrors the Planner's existing rule).
17. As a member creating a task via inline-add inside the Today group, I want it created with **In progress** status, assigned to me, **and** planned for today in one step, so that "I'll also do this today" is a single gesture that reflects reality (typing it into today's plan means I'm on it).

### Removing from Today

18. As a member, I want the sun icon on Today rows shown filled (always visible, not hover-only), so that removal is the mirror image of adding.
19. As a member, I want removing a task whose only coverage is a one-day segment today to delete that segment, so that no orphan plan rows accumulate.
20. As a member, I want removing a task covered by a multi-day segment to keep the other days: a segment spanning past+today+future splits into two; one starting today shifts to start tomorrow; one ending today shrinks to end yesterday — so that "not today" never destroys the rest of my plan.
21. As a member, I want the removal toast to explain what happened to the bar ("The bar split — today was removed, other days stay planned"), so that Planner changes are never mysterious.
22. As a member, I want to delete any of my individual segments from the task detail Plan section, so that fine-grained plan editing doesn't require opening the Planner.

### Status system changes

23. As an admin, I want new orgs seeded without a "Today" status (Inbox → Next up → In progress → Admin review → Client review → Stuck → Done), so that statuses describe workflow only.
24. As the operator (pre-launch, demo data only), I want to retire the existing "Today" status by resetting the dev data or deleting the status in Settings — with no migration code — so that implementation effort goes into the feature, not into moving throwaway data.
25. As a member whose saved My Tasks visibility preference references a deleted status, I want the existing fallback chain (filter invalid IDs → org default → first in-progress status) to keep my view working, so that removing the Today status can never blank anyone's My Tasks.
26. As a member, I want my familiar flow — work the task, then push it to Admin review — to work unchanged, so that retiring the Today status costs me nothing.

### My Tasks layout & transparency

27. As a member, I want the Today group at the top of My Tasks with a count and a quiet "the Planner's plan for today" hint, so that the list leads with the day's intent.
28. As a member, I want tasks currently in Today suppressed from the status groups below, so that no task appears twice on one page.
29. As a member, I want each status group header to show a muted "· N in Today" note when it has suppressed tasks, so that "where did my task go?" is always answered on-screen.
30. As a member, I want an **Earlier** subsection inside the Today group — **expanded by default**, collapsible — listing my planned-but-unfinished tasks from the last 14 days (segments that ended before today, task not completed, no coverage today), so that my morning starts by settling yesterday's leftovers (move or let go) before the day's list.
31. As a member, I want a one-click "Move to today" on Earlier rows that creates a fresh one-day segment (leaving the old segment untouched as history), so that rescheduling is cheap and the record stays honest.
32. As a member, I want leftovers **never** auto-carried to today, so that the app reports my plan instead of policing it.
33. As a member, I want Today rows to show the task's status badge, so that plan membership and workflow state read as two independent facts.
34. As a member, I want to manually reorder tasks within the Today group (persisted per user), so that the checklist reflects my intended order of attack.
35. As a member with an empty Today, I want an empty state that points at both gestures ("add with the sun icon, or schedule in the Planner"), so that the feature teaches itself.
36. As a member, I want the "all done" celebration (confetti / TodayAllDoneState) keyed to the Today group emptying into Completed today, so that finishing the day's plan still feels like something.
37. As a member, I want the sidebar My Tasks badge to show my remaining Today count and **disappear entirely at zero**, so that the number I glance at all day is the size of today's plan — and its absence is the reward.
38. As a member, I want tasks due today (or overdue) to show their existing due-date indicator wherever they are, but **not** be auto-added to Today, so that deadlines (promises to others) and my plan (my intent) stay distinct.

### Task detail (Plan section)

39. As a member, I want the existing Plan section to visually highlight the segment(s) covering today, so that "why is this in my Today?" is answered by looking at the task.
40. As a member, I want to manage (add/remove) **my own** segments from the Plan section even though I'm not an admin, so that self-scheduling doesn't require admin help.
41. As a member, I want other people's segments in the Plan section to stay read-only, so that I can see but not disturb teammates' plans.

### Planner permissions & rendering

42. As a member, I want to create, move, resize, and delete segments **in my own Planner row**, so that the Planner is my self-scheduling surface, not just an admin's board.
43. As a member, I want other users' rows to remain read-only for me, so that only admins manage other people's plans.
44. As an admin, I want to keep full control over every row (unchanged), so that team-level planning still works.
45. As a member attempting to modify someone else's segment (e.g. via a stale client), I want the mutation rejected with a clear error, so that the permission model holds server-side, not just in the UI.
46. As a user, I want completed tasks' bars rendered dimmed (with a check) in the Planner, so that the board reflects reality without deleting history.
47. As a user, I want plan segment changes to write **no** task activity-log events, so that the activity panel stays a workflow/conversation record, not a planning journal (status changes remain logged as today).

### Failure & edge cases

48. As a member, I want add/remove-from-Today to surface mutation errors via the standard error toast (with rollback of any optimistic UI), so that failures are visible and non-destructive.
49. As a member whose segment is deleted or moved off today by an admin while I'm looking at My Tasks, I want the Today group to update live (Convex reactivity), so that the view never goes stale.
50. As a member, I want Today membership to change at the org-timezone midnight without any writes (pure query-time derivation), so that there is nothing to break at midnight.
51. As a user on the day a multi-day segment starts or ends, I want boundary dates treated inclusively (consistent with the Planner's existing `startDate`/`endDate` inclusive convention), so that day one and the last day both count as planned.

## Implementation Decisions

- **Single source of truth**: `planSegments` drives Today membership. No new tag, flag, or status. The manual gesture writes the same primitive the Planner writes.
- **Derivation rule**: task is in my Today iff a segment with `userId = me` satisfies `startDate ≤ today ≤ endDate` (org timezone, inclusive), the task is not archived, and the task is not in "completed today" state (done/review type updated today). Deduped per task.
- **The plan wins over assignment**: Today shows planned tasks regardless of `assigneeIds`. The Planner's existing invariant (segments never touch assignment) is preserved; no auto-assign.
- **Earlier window**: 14 days, a named constant.
- **Remove-from-Today trim/split semantics**: single-day → delete; spans past & future → split into two segments around today; starts today → start moves to tomorrow; ends today → end moves to yesterday. Applied to every covering segment of that user/task.
- **Idempotent wrapper mutations**: `addToToday(taskId)` and `removeFromToday(taskId)` operate on the caller's own segments only; both member-callable. Underlying generic segment mutations (create/update/remove) change from admin-only to **admin-or-self**: a member may pass only their own `userId` (create) or touch only segments where `segment.userId = self` (update/remove), and members may not reassign a segment to another user. Server-enforced.
- **Schema**: new index on `planSegments` by org + user + startDate for the covering-today query (bounded below by today − 60 days as a scan guard). New optional per-segment sort key for manual ordering inside the Today group (fractional midpoints, same approach as `laneOrder`).
- **Today ordering**: default is arrival order — new entrants (sun-added or Planner-scheduled) append to the bottom by segment creation time; the manual sort key overrides and stays stable (no reshuffling on status changes, consistent with the Planner's stable-lane-packing principle).
- **Sun icon visibility**: hover-revealed on desktop; always visible in a muted state on touch devices (the existing hover-action pattern is desktop-only, so this is a deliberate mobile addition).
- **Inline-add in the Today group** creates the task with the org's first **In progress**-type status (by sort order), assigned to the creator, plus a one-day segment for today.
- **Status seed change**: "Today" removed from the default statuses. "Next up" (existing, `in_progress` type) is the triage destination.
- **No data migration**: the app is pre-launch with demo-only data. The "Today" status leaves via seed change + dev data reset (or manual deletion in Settings → Statuses). The existing preference fallback chain already tolerates dangling status IDs, so nothing else is required. Decision recorded so a future reader knows this was deliberate, not forgotten — if real customer data ever exists before this ships, this decision must be revisited.
- **My Tasks query rework**: the list endpoint returns, in order: Today group (with nested Earlier list), visible status groups (Today members suppressed; per-group `inTodayCount` for the header hint), Completed today. Sidebar count endpoint returns the remaining (uncompleted) Today count.
- **No activity logging** for segment mutations (matches current Planner behavior); status changes remain the only logged workflow events.
- **UI surfaces for the sun gesture**: My Tasks rows (hover ghost icon; filled/persistent on Today rows), `/tasks` table rows (hover), `/tasks` bulk toolbar action, task detail Plan section. One shared button component per the domain-UI convention; quiet ghost styling, no pills.
- **Plan section** (task detail): gains today-highlighting on covering chips, member self-service (own segments only), and the Add to Today affordance. Existing admin capabilities unchanged.
- **Planner UI**: members get edit affordances (draw-to-create, drag, resize, delete) on their own row only; other rows read-only. Completed tasks' bars render dimmed with a check.
- **Confetti / empty states**: celebration logic re-keys from "primary status group empty" to "Today group empty with completed > 0". Group-level empty states per the loading → empty → content convention, content-aware skeleton updated for the new group order.
- **Due dates stay separate**: no auto-membership from `dueDate`; existing due indicators unchanged. (A per-user "include due today" toggle is explicitly deferred.)
- **Timezone**: all "today" math uses the org timezone via the existing date helpers; no client-local dates.
- **Old PRD**: `docs/today-tab-prd.md` gets a superseded banner pointing here.

## Module Design

- **Name**: `todayPlan` helpers (pure library)
  - **Responsibility**: all Today/Earlier set math and segment surgery, with no database access: "which of these segments cover date D", "partition these tasks into today/earlier given segments + window", "given covering segments and a date, produce trim/split/delete operations".
  - **Interface**: pure functions taking plain segment/task shapes and a `YYYY-MM-DD` date; returning task-id sets (ordered) and a list of segment operations (`delete` / `patch` / `insert`). Failure modes: none (pure); invalid dates rejected by the existing date assertions at the mutation layer.
  - **Tested**: yes (primary test target).

- **Name**: Today mutations (`addToToday` / `removeFromToday` + permission-widened segment mutations)
  - **Responsibility**: the only write path for personal day-planning; enforces admin-or-self, idempotency, archived-task rejection, and applies `todayPlan` operations transactionally.
  - **Interface**: `addToToday(taskId)`, `removeFromToday(taskId)` — self-scoped, member-callable; generic segment create/update/remove accept member callers for self-owned rows. Failure modes: not-found/cross-org, archived task, permission (acting on another user), invalid range.
  - **Tested**: yes — permission matrix and idempotency (following the existing Convex test patterns).

- **Name**: My Tasks list & count queries (rework of existing)
  - **Responsibility**: assemble the ordered group payload (Today + Earlier + suppressed status groups with `inTodayCount` + Completed today) and the sidebar Today count; owns suppression and enrichment.
  - **Interface**: unchanged call sites, extended return shape (new group keys, `inTodayCount`, Earlier list). Failure modes: none new (auth as today).
  - **Tested**: yes — via the pure grouping helpers (extending the existing helper test suite).

- **Name**: `AddToTodayButton` (shared UI component)
  - **Responsibility**: the sun gesture in all its states (add / in-today / pending), toast copy, error handling with rollback; single visual definition used by every surface.
  - **Interface**: props for task id, current membership, size/variant; fires the wrapper mutations. Failure modes: mutation errors surfaced via standard error toast.
  - **Tested**: no (thin presentational; behavior lives in mutations/helpers).

- **Name**: My Tasks Today group UI (Today group, Earlier subsection, header hints, reorder)
  - **Responsibility**: rendering and interaction of the new list layout, drag-reorder persistence within Today, empty/celebration states.
  - **Interface**: consumes the reworked query payload; reuses existing group/row/inline-add components. Failure modes: standard optimistic-reorder rollback (existing pattern).
  - **Tested**: no (component layer; logic already covered by helpers).

- **Name**: Planner self-service & rendering updates
  - **Responsibility**: row-level edit gating by viewer (own row editable for members), dimmed completed bars; Plan section self-service in the task detail.
  - **Interface**: existing Planner components with an "editable" predicate derived from viewer identity/role. Failure modes: server rejects unauthorized writes regardless of UI state.
  - **Tested**: server side via the permission tests above; UI untested.

## Testing Decisions

- Good tests here exercise **external behavior of pure logic**: date-covering across boundaries (first/last day of a segment, single-day, month/DST-agnostic string math), dedupe, Earlier windowing at exactly 14 days, every trim/split branch, suppression + `inTodayCount` consistency (a task is in exactly one of: Today / Earlier / a status group / Completed today), and the mutation permission matrix (admin vs self vs other).
- Modules with tests: `todayPlan` helpers, Today mutations (permissions + idempotency), reworked My Tasks grouping helpers.
- Prior art: the existing pure-helper test suites for My Tasks grouping, date bucketing, and settlement guards are the style reference — plain-shape inputs, no Convex ctx.

## Out of Scope

- **Data migration for the Today status** — pre-launch, demo-only data; seed change + dev reset (or manual status deletion) covers it. Revisit only if real customer data exists before this ships.
- **"Include due today" view toggle** — deliberate default (due ≠ plan); revisit only if requested.
- **Tabs/lenses layout for My Tasks** (Today · Upcoming · All · Done) — the stacked "day cockpit" stays; the data model already supports a future tab switch as pure UI work.
- **An "Upcoming" group in My Tasks** — the Planner remains the future-facing surface.
- **Auto-carry / auto-reschedule of leftovers** — never; Earlier + one-click move is the whole story.
- **Capacity indicators or overbooking warnings** — standing product decision, unchanged.
- **Per-row keyboard shortcut for Add to Today** — bulk action covers multi-task; a shortcut can come later.
- **Cross-group drag** (dragging a task from a status group into Today or back) — the sun icon is the sole membership gesture in v1; within-Today reorder drag works. Dragging out of Today would conflate plan-removal with status change — exactly the two planes this PRD separates.
- **Subtask planning** — the Planner schedules tasks; unchanged.
- **Plan-vs-actual reporting** — segments persisting as history enables it, but no reporting UI in this PRD.
- **Notifications** about plan changes (e.g. "an admin planned X for you today") — plain reactivity only for now.
- **Renaming the `todayVisibleStatuses` preference field** — internal naming debt, not worth a schema churn now.

## Open Questions

None — all resolved in the UX grill round (2026-07-06):

1. Assignment-mismatch indicator: dimmed assignee avatar + tooltip (see story 5).
2. Planner member self-editing: **in this release as the final slice, explicitly cuttable** to a fast-follow if drag-interaction gating balloons; the server-side admin-or-self permissions ship in the first backend slice regardless, so Today gestures and Plan-section self-service never wait on it.

## Further Notes

- The interactive prototype demonstrates: derived Today via a multi-day bar, sun add/remove with trim/split toasts, Earlier + Move to today, `· N in Today` header hints, status-badge coexistence on Today rows, review-status completion flowing to Completed today, and per-person plans (a teammate's today segment not appearing in mine).
- Design-language constraints carried over from standing feedback: quiet ghost buttons and filled icons, no bordered pills, muted counts as text, hover-revealed row actions, content-aware skeletons, URL-persisted filter state where applicable.
- The Notion-principles review shaped three specifics: suppression must be visible (`· N in Today`), derived membership must be inspectable (Plan section highlighting), and leftovers are shown quietly rather than coached.
- Architecture rationale (for future readers): Today-as-status fails structurally — statuses are global per task while plans are per user per day; syncing them needs midnight crons that fight manual changes and spam the activity log. Deriving from `planSegments` makes the Planner and My Tasks two lenses over one dataset with zero synchronization.
