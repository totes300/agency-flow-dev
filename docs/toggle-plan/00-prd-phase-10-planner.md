# PRD: Phase 10 — Planner (visual resource planning)

> **Design reference:** `docs/mockups/planner-mockup.html` — a fully interactive, self-contained HTML mockup finalized with the product owner over six design iterations. Open it in a browser and exercise every interaction before implementing. Where this document and the mockup disagree on visual/interaction detail, the mockup wins; where the mockup simplifies data (fake IDs, hardcoded people), this document wins.

## Problem Statement

The agency currently plans "who works on what, on which day" in a third-party tool (Toggl Plan). Agency Flow already records what *happened* (Workday grid, time entries) but has no surface for what *should happen*. The plan therefore lives outside the system: it cannot reference real tasks, drag-planning does not update anything in Agency Flow, and the team constantly re-enters the same work items in two tools.

A full Gantt chart is explicitly not wanted — no dependencies, no milestones, no critical path. The need is a simplified visual scheduler: people as rows, days as columns, tasks as horizontal bars that can be dragged, stretched, split, and created in place.

## Solution

A new fullscreen `/planner` view: a people × days timeline in the Toggl Plan mold, built as the sibling of the existing Workday grid (same layout skeleton, same visual language — Workday = actuals, Planner = plan).

When complete:

- Every org member sees the whole team's plan for a week or two weeks at a glance; admins shape it by direct manipulation (drag to move, drag edges to resize, drag between rows to reassign, ⌥-drag to split).
- Plan bars are **references to real tasks**, colored by the task's work category. A task can be scheduled in multiple separate sittings (segments) across days, weeks, and people, while its timer, comments, links, and time entries keep accumulating on the single task.
- A right-hand Tasks panel lists the real backlog (newest first, searchable, filterable) and tasks are scheduled by dragging them onto the grid.
- New tasks can be created without leaving the Planner: by drawing a range on empty cells, or via a quick-add composer.
- Clicking any bar opens the **existing** task detail drawer, extended with a "Plan" section listing all of that task's sittings.

## User Stories

### Viewing

1. As an org member, I want to open `/planner` and see every teammate as a row and days as columns, so that I understand the team's plan at a glance.
2. As an org member, I want to switch between a 1-week and 2-week zoom, so that I can plan at the granularity I need.
3. As an org member, I want to navigate weeks (prev / next / Today) with the visible range reflected in the URL, so that the back button works and I can share a link to a specific week.
4. As an org member, I want today's column highlighted and weekends visually muted, so that I can orient instantly.
5. As an org member, I want bars colored by the task's work category (gray when the task has no category) with the task title on the first line and the project name on the second, so that bars are identifiable without clicking.
6. As an org member, I want overlapping bars in one person's row to stack into separate lanes (the row grows), so that nothing is ever hidden behind another bar.
7. As an org member, I want a bar that extends beyond the visible range to render clipped with a squared-off edge, so that I can tell it continues.
8. As an org member, I want each person's row header to show planned days vs. working days in the visible range (weekend cells excluded from both counts) with an amber state when overbooked, so that overload is visible before it happens.
9. As an org member, I want to filter visible rows to selected people (URL-persisted), so that I can focus on part of the team.
10. As an org member, I want bars of a task whose status is done to remain on the timeline, dimmed and marked with a check, so that the plan history stays honest.
11. As an org member, I want a task split into multiple segments to show a part badge (`1/2`, `2/2`, …) on each bar, and hovering or selecting one segment to highlight its siblings, so that a task's full footprint is readable even when scattered.
12. As an org member on a narrow screen, I want the grid to scroll horizontally inside its own container with the people column sticky, so that the layout never breaks.
13. As an org member, I want a content-aware loading skeleton that mirrors the grid layout while data loads, per app convention.
14. As an org member with an org that has no members or no plan yet, I want a dedicated empty state that tells me what the Planner is and (if I am admin) how to schedule the first task.

### Editing the plan (admin only)

15. As an admin, I want to drag a bar horizontally and have it snap day-by-day (a single solid preview bar — never a detached outline), so that what I see during the drag is exactly what I get on release.
16. As an admin, I want to drag a bar's left or right edge and have the bar itself snap to day boundaries live (minimum one day), with the day-count label updating during the drag.
17. As an admin, I want to drag a bar vertically onto another person's row to reassign that segment.
18. As an admin, I want neighbouring bars to reflow into lanes *live during the drag* (animated), so that I never have to "drop onto" another bar to see where things will land.
19. As an admin, I want to hold ⌥ (Alt) while dragging a bar to drop a **new segment of the same task** at the target (the original stays), so that I can plan a continuation of interrupted work — Toggl Plan's split gesture.
20. As an admin, I want to select a bar (click) and press Delete/Backspace to unschedule that segment, so that cleanup is fast.
21. As an admin, I want every plan mutation to apply optimistically and roll back with an error toast if the server rejects it, so that dragging feels instant but never lies.
22. As a non-admin member, I must see the same board read-only: no drag affordances, no resize handles, no draw-to-create, no panel dragging — and the server must reject any plan mutation I somehow issue.

### Tasks panel

23. As an admin, I want a right-hand Tasks panel (toggleable via a toolbar button showing the unscheduled count) listing real tasks as cards — **title on top, client name below, category as a colored dot; no estimate text** — so that picking is fast and uncluttered.
24. As an admin, I want the list ordered newest-created first, so that tasks I just captured are on top, ready to place.
25. As an admin, I want a search box matching title, project, and client, so that I can find anything in a backlog of hundreds.
26. As an admin, I want an **Unscheduled** tab (default: tasks with zero segments, excluding done and archived tasks) and an **All** tab (every active task; already-scheduled ones dimmed with a "planned" check), so that the default view is my to-plan inbox but every task stays reachable for adding another sitting.
27. As an admin, I want filter chips inside the panel — Project (multi), Client (multi), Category (multi), Due (overdue / next 7 days / no due date) — that narrow **only the panel list, never the timeline**, so that the board always shows the whole team's real plan while I pick from a subset. Filters persist in the URL.
28. As an admin, I want to drag a task card onto a row/day to create a segment there; the default span is derived from the task's remaining estimate (see Implementation Decisions), defaulting to 1 day when no estimate is set.
29. As an admin, I want dragging the same task from the panel again to add another sitting of the same task (never a duplicate task).
30. As an admin, I want the card to visually follow my cursor while over the panel and morph into the snapped bar preview once over the grid; dropping outside the grid animates the card back and changes nothing.
31. As an org member (non-admin), I want to see the panel read-only (cards not draggable), so that I can still browse the backlog.

### Creating tasks in place (admin only)

32. As an admin, I want to press and drag across empty cells in a person's row to draw a new bar (snapped, day-count shown), and on release get a small popover asking for title + project; Enter creates the task **and** its segment in one atomic operation, Escape cancels and removes the preview.
33. As an admin, I want the "+ New task" toolbar button to open a quick-add composer at the top of the panel (title + project); Enter creates an unscheduled task (which appears at the top of the list), keeps the composer open for rapid capture, and Escape closes it.
34. As an admin, I want tasks created from the Planner to use the same defaults as inline-add on `/tasks` (default status, no category, creator handling, fractional sort key), so that Planner-created tasks are indistinguishable from any other task.
35. As an admin, if creating a task fails, I want the preview/composer state preserved and an error toast shown, so that I don't lose the typed title.

### Task detail

36. As an org member, I want clicking a bar (or a panel card) to open the **existing** task detail drawer — same component, same `?detail=<taskId>` URL mechanism as `/tasks` — so that there is exactly one task surface in the app.
37. As an org member, I want the drawer's properties column to gain a "Plan" section listing every sitting of the task (date range, person, duration, part n/m), so that the plan is visible from the task side too.
38. As an admin, I want a per-segment unschedule (×) action in the drawer's Plan section.
39. As an org member, I want Escape to close the drawer, and the drawer URL param to make a task-focused view shareable from the Planner.

### Data integrity

40. As an admin, when a task is archived, I want its segments hidden from the timeline (not deleted) and restored when the task is unarchived, so that archive stays reversible.
41. As an admin, when a task is hard-deleted, I want its segments deleted with it, so that no orphan bars remain.
42. As any user, I must never see another org's segments, tasks, or people — every query and mutation filters by `orgId`, no exceptions.
43. As an admin, if I try to resize a segment such that `endDate < startDate`, the mutation must reject; the UI must make this impossible (minimum one day).

## Implementation Decisions

### Schema

New table **`planSegments`** (camelCase per convention; Convex filenames must not contain hyphens):

- `orgId` — string, tenant scope (mandatory on every index/query)
- `taskId` — id of `tasks`
- `userId` — id of `users` (one segment = one person's bar; the task's own `assigneeIds` array is *not* used for row placement)
- `startDate` — string `YYYY-MM-DD`, inclusive (same convention as `timeEntries.date`)
- `endDate` — string `YYYY-MM-DD`, inclusive; invariant `endDate >= startDate`
- `createdAt`, `updatedAt` — epoch ms; `createdBy` — id of `users`

Indexes: `by_orgId_taskId` (drawer Plan section, cascade on delete/archive checks) and `by_orgId_startDate` (range reads; overlap query = `startDate <= rangeEnd` via index range, then in-memory `endDate >= rangeStart` filter — acceptable at MVP scale, revisit if segment counts grow).

Rationale for a separate table instead of planned-date fields on `tasks`: `assigneeIds` is an array while a bar belongs to exactly one person; one task must support many segments (splitting); unscheduling must never mutate the task. MVP/dummy-data stage: add the table directly, no migration machinery.

Weekends: segments span weekends **continuously** (a Thursday-start 4-day segment ends Sunday). No auto-split around weekends. Capacity math excludes weekend cells from both planned and available counts.

`tasks.dueDate` remains a pure deadline (drives the Due filter and drawer display). `tasks.estimate` is not displayed in the Planner UI but seeds default segment length.

### Backend API (new Convex module, `planner`)

- **`weekGrid` query** — args `{ startDate, endDate, userIds? }` (inclusive `YYYY-MM-DD`), mirroring the Workday `weekGrid` contract. Returns rows for **all** org members (resolved via `orgMembers`, skipping deleted users, sorted by name) with each row's segments joined to light task data (title, project name, category color key, statusType, part index/count). **Deliberate difference from Workday:** non-admin members are *not* scoped to their own row — the Planner is a shared board; everyone sees all rows. Excludes segments of archived tasks.
- **`taskPanel` query** — returns all active (non-archived) tasks with light fields for the panel: title, project name, client name, category color key, statusType, estimate, planned day count, segment count, createdAt. Search/filter/sort run client-side (hundreds of tasks is fine; server-side narrowing is a later optimization).
- **Mutations** (all admin-gated with the existing `requireAdmin` helper; all validate org ownership of every referenced id; all validate the date invariant):
  - `createSegment { taskId, userId, startDate, endDate }`
  - `updateSegment { id, userId?, startDate?, endDate? }` (move, resize, reassign)
  - `removeSegment { id }`
  - `createTaskWithSegment { title, projectId, userId, startDate, endDate }` — atomic draw-to-create; internally reuses the task-creation defaults (default status, fractional sort key) and then inserts the segment.
- **Cascade:** task hard-delete removes its segments (extend the existing task delete path); archive requires no data change (grid queries exclude archived tasks' segments).

### Frontend

- New route `/planner`, protected, visible to **all** org members in the shared navigation config; write affordances gated by the existing admin hook. Page file is a thin orchestrator (<200 lines) composing feature components.
- **Grid layout** copies the Workday skeleton: `200px + repeat(days, 1fr)` CSS grid, sticky people rail, today column tint via `color-mix` with `--primary`, weekend shading, horizontal scroll container. Two-line bars (~46px tall), category tint formula identical to Workday boxes / `CategoryBadge` (~13–15% background, ~52–72% text via `color-mix`), reusing `CategoryDot`, `UserAvatar`, and `getCategoryColor` (gray for no category).
- **Drag engine: custom pointer events, not dnd-kit.** The mockup's behavior is the spec: (a) everything snaps to whole days — segments are date-granular, half days do not exist, and the UI must never suggest them; (b) during move, a single solid snapped preview bar moves (original hidden; with ⌥ the original stays and the preview represents the copy); (c) during resize, the bar itself snaps live; (d) affected rows re-pack lanes live with a short top/height transition; (e) drop commits via optimistic mutation, cancel restores. A 4px movement threshold distinguishes click (open drawer) from drag. `dnd-timeline` (headless, dnd-kit-based) is an approved fallback if the custom engine stalls — decide with fresh Context7 docs at implementation time. Packaged Gantt widgets (Bryntum, Syncfusion, react-calendar-timeline) are rejected.
- **URL state** follows the existing hand-rolled `useSearchParams` helper convention (the nuqs adapter is mounted but unused in this codebase — do not introduce a second pattern): week anchor, zoom (7/14 days), member filter, panel filters (project/client/category/due), and `?detail=` for the drawer. Ephemeral state (panel search text, open dropdowns, selection, composer open) stays in component state; search may use the existing URL-debounce helper if trivially applicable.
- **Task detail:** mount the existing drawer component on the Planner page with `taskIds` ordered by first visible segment (row order, then start date) so prev/next navigation works. Extend the existing metadata component with a "Plan" section (stacked-layout variant) listing segments with per-segment unschedule for admins.
- **Every mutation call** wrapped per convention: optimistic apply, `.catch` → error toast + rollback. TypeScript must stay at 0 errors (`npx tsc --noEmit`).

### Default segment length when scheduling from the panel

`tasks.estimate` — verify its unit in the schema/UI (believed to be minutes, edited via the time cell). Rule: if estimate is set, default span in days = `ceil(estimate / 480)` minus days already planned across existing segments, clamped to minimum 1; if unset, 1 day. This is a UX default only — the user resizes after dropping.

### Delivery slices (each lands independently, each gets backlog.md entries)

1. **Read-only grid** — schema, `weekGrid`, `/planner` route, grid components, lane packing + date math in a pure lib module, skeleton, empty state, week nav/zoom/member filter in URL. Seeded manually with a few segments (including one split task) for verification.
2. **Drag engine** — move / resize / reassign / ⌥-split with live lane reflow and optimistic mutations; click-to-open drawer wiring; selection + Delete.
3. **Tasks panel + creation** — `taskPanel` query, panel UI (cards, search, tabs, filters), drag-to-schedule, quick-add composer, draw-to-create with popover, drawer "Plan" section.
4. **Polish** — capacity heat refinement, done-task styling audit, due-date markers on bars (optional), performance pass with React DevTools Profiler (measure before optimizing), mobile/narrow-viewport audit.

## Module Design

- **Name:** `planner` (Convex backend module)
  - **Responsibility:** all plan reads and writes — the only code that touches `planSegments`.
  - **Interface:** `weekGrid(startDate, endDate, userIds?) → rows with joined segment/task data`; `taskPanel() → task cards data`; `createSegment / updateSegment / removeSegment / createTaskWithSegment` mutations. Failure modes: auth errors (not signed in / not admin for writes), validation errors (cross-org id, `endDate < startDate`, missing task/user). All errors are `ConvexError` with actionable messages.
  - **Tested:** yes.

- **Name:** planner date & lane math (pure lib module)
  - **Responsibility:** everything computable without React or Convex: lane packing (greedy first-fit by start date), date-string range math (overlap, clamp to visible range, inclusive span in days, workday counting), capacity calculation, part-badge ordering.
  - **Interface:** pure functions over plain data (`{start, end}` date strings / day indexes); no side effects, no Date-object timezone traps (string math, following the existing date-bucket helpers).
  - **Tested:** yes — this is the highest-value unit-test target.

- **Name:** planner drag engine (client hook)
  - **Responsibility:** the entire pointer state machine — modes (move / resize-left / resize-right / panel-drag / draw-create), day snapping, copy toggling, live reflow computation, threshold handling, commit/cancel. Exposes declarative state; components only render it. Deep module: all drag complexity lives here.
  - **Interface:** input = grid geometry + current segments + permissions; output = preview state (proposed segment, affected-row lane layouts, mode flags) + commit callbacks that call the mutations.
  - **Tested:** the pure reducer core (given pointer positions → proposed placement) yes; DOM wiring no (verified manually / via the mockup parity checklist).

- **Name:** planner URL state (client hook)
  - **Responsibility:** week anchor, zoom, member filter, panel filters ↔ search params, following the Workday query-args hook pattern.
  - **Interface:** typed getters + setters using router replace; drops params at defaults.
  - **Tested:** no (thin; convention-driven).

- **Name:** planner UI components (grid, row, bar, task panel, filter chips, quick-create popover, composer, skeleton, empty state)
  - **Responsibility:** rendering only; every domain visual (bar, part badge) is a shared component from first use per convention.
  - **Interface:** props in, callbacks out; no direct Convex calls except top-level queries in the page orchestrator.
  - **Tested:** no (visual; covered by mockup parity + manual verification).

- **Name:** task detail "Plan" section (extension of the existing metadata component)
  - **Responsibility:** listing a task's segments inside the existing drawer + admin unschedule per segment.
  - **Interface:** consumes the task id; reads via a small query (or data threaded from `weekGrid`/task detail); calls `removeSegment`.
  - **Tested:** covered by backend tests for the query/mutation; UI no.

## Testing Decisions

- Good tests here assert **external behaviour**: what `weekGrid` returns for a given org/date range/permission level, what mutations accept and reject, and what the pure math produces — never internal implementation details or DOM specifics.
- Backend: follow the existing Convex test suite pattern (`convex/__tests__/` — see the invoice transitions test as prior art). Must-cover cases: org scoping (a second org's data never leaks), member vs. admin write rejection, all-rows visibility for members (the deliberate Workday difference), date invariant rejection, archived-task exclusion, cascade on task delete, `createTaskWithSegment` atomicity and task defaults.
- Lib: unit tests for lane packing (overlap chains, ties, single-lane), range overlap/clamping at visible-range edges, workday counting across week boundaries, part-badge ordering, default-span rule.
- Drag engine: unit-test the pure placement reducer (pointer day + grab offset + mode → proposal). No browser-automation tests in scope.
- Manual verification checklist = the mockup: every interaction listed in its "Interaction spec" table must behave identically in the real build (this is the definition of done for slices 2–3).

## Out of Scope

- Gantt features: dependencies between tasks, milestones, critical path, baselines.
- Sub-day scheduling (hours), per-day planned-hours amounts, and any half-day UI.
- Auto-splitting segments around weekends (segments span weekends continuously).
- Plan-vs-actual overlay (combining Workday actuals with Planner bars in one grid) — natural future phase, not this one.
- Notifications ("you were scheduled on X"), calendar sync (Google Calendar/iCal), and any export.
- Recurring/repeating segments.
- Changing task assignees from the Planner (segments have their own `userId`; `assigneeIds` is untouched).
- Server-side search/pagination for the task panel (client-side over all active tasks is fine at current scale).
- Mobile-specific planning UX beyond "doesn't break" (horizontal scroll + read-only usability).
- The Kanban-with-day-columns alternative — evaluated and rejected during design (cards can't span days; hides per-person capacity).

## Open Questions

1. **`tasks.estimate` unit** — believed to be minutes (edited via the time-cell UI). Owner: implementing agent. Resolution: verify in schema/UI on slice 3; if minutes, apply the `ceil(estimate / 480)` default-span rule; if it turns out to be days, use it directly.
2. **Row set for very large orgs** — all members always render as rows; fine at current team size. Owner: product. Resolution: revisit alongside the known task-counts scalability item if org size grows; the member filter already mitigates.

## Further Notes

- **Design provenance:** the mockup went through six review rounds with the product owner; key rulings to preserve: single snapped visual during drag (no detached outline + separate fill — this was explicitly rejected); bars must sit exactly within day columns (a `box-sizing` regression caused overhang once — Tailwind preflight prevents this class of bug in the real build); estimate text removed from panel cards; filters are panel-scoped, not board-scoped; the drawer is the existing task drawer, never a bespoke one.
- **Multi-tenancy is non-negotiable:** every new query/mutation filters by `orgId` even where another index already narrows the read (project rule).
- **Convex guidelines:** read the generated Convex AI guidelines file before writing backend code (project rule); Convex filenames cannot contain hyphens.
- **Library docs:** if dnd-kit/`dnd-timeline` is considered in slice 2, fetch current docs via Context7 first (project rule). The recommended path is the custom pointer engine + the already-installed `motion` package for reflow/settle animation.
- **Backlog:** on completion of each slice, write task-level checkboxes, verification notes, and deferred TODOs into `docs/backlog.md` under `## Phase 10: Planner` (project rule).
- **Codebase touchpoints** (paths current as of writing; verify before relying on them):
  - Grid skeleton & visual language: `components/workday/*`, `lib/workday.ts`, `convex/workday.ts` (`weekGrid` contract to mirror)
  - Drawer mechanism: `components/tasks/task-detail-drawer.tsx`, `components/tasks/use-task-detail.ts`, `lib/task-detail.ts` (`?detail=` param helpers), metadata extension point `components/tasks/task-detail-metadata.tsx`
  - URL-state pattern to copy: `lib/hooks/use-workday-query-args.ts`, `lib/hooks/use-week-picker.ts`; debounced search helper `lib/hooks/use-url-debounced-param.ts`
  - Task creation defaults: `convex/tasks.ts` (`create`, `getDefaultStatusId`), inline-add prior art `components/tasks/inline-add-task.tsx`
  - Auth: `convex/lib/auth.ts` (`requireAdmin`), client `lib/hooks/use-is-admin.ts`, route visibility `lib/route-access.ts`, nav `lib/navigation.ts`
  - Date-string math prior art: `lib/date-buckets.ts`
  - Category colors: `convex/lib/constants.ts` (`getCategoryColor`), shared visuals `components/category-dot.tsx`, `components/user-avatar.tsx`
  - Backend test prior art: `convex/__tests__/invoiceTransitions.test.ts`
