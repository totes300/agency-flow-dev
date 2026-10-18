# PRD: Tasks & My Tasks Refactor — One View Engine, One Write Path

> **Status:** Approved for implementation · 2026-10-18 · Owner: Adam · Progress: §12
>
> **Scope:** module 1 of the app-wide cleanup. Tasks (`/tasks`), My Tasks (`/my-tasks`),
> the project Tasks tab, task detail (drawer + full page), and the backend behind them.
>
> **Supersedes** `docs/phase-5-tasks-core.md`, `docs/phase-6-tasks-detail.md`,
> `docs/task-row-refactor.md`, `docs/today-tab-prd.md`, the list/row parts of
> `docs/today-planner-prd.md`, and the open My Tasks revamp map in
> `.scratch/my-tasks-revamp/`. Business behaviour from those documents is kept unless this
> PRD says otherwise. Where they conflict, this PRD wins.
>
> **Approved prototype (v4):** <https://claude.ai/artifact/WmdH3Kkf4GR3e1kM67SEyF>
> (source `docs/mockups/tasks-refactor-prototype-v4.html`). The prototype defines structure,
> layout and behaviour. In-row visuals come from the existing design system (§6.4).

---

## 1. Problem statement

Tasks grew over many iterations and now has parallel implementations at every layer. A
codebase review (2026-10-18) found:

| Concern | Today |
|---|---|
| Task list query shapes | 8 (`tasks.list`, `listMyTasks`, `dashboardBoard.myWorkBoard`, `planner.taskPanel`, `listByProject`, `getSubtasks`, `subtaskPreview`, agent mention scan) |
| Task creation paths | 5 (`create`, `createSubtask`, `duplicate`, `createTaskWithSegment`, `createTodayTask`), each with different logging and notifications |
| Enrichment (status/project/client/user joins) | copy-pasted in 3 queries, hand-rolled in 2 more |
| Inline `isAdmin \|\| assigneeIds.includes(userId)` checks | 38 sites, several missing (`activityIndicators`, `deleteImpact`, `planner.taskPanel`, `agentMentions`, `addToToday`) |
| Full-org scans per request | `tasks.list`, `counts`, `listMyTasks`, `myWorkBoard`, `taskPanel` |
| Activity indicators | ~7 queries **per task** for up to 500 tasks |
| "Completed today" | derived from `updatedAt`, so any edit to a done task moves it to today |
| Row components | 3 designs (`task-row`, `my-task-row`, `board-card`) plus `task-card` and the planner card |
| Task detail | 2 parallel implementations (modal + drawer). Duplicated header (177 diff lines) and comment input (290 diff lines) |
| `tasks.ts` | 1,800 lines |
| View state on `/tasks` | `useState`, lost on reload |

Missing product capabilities: priority, labels, start date, task identifiers, saved views,
board layout, display options, a full-page task view, keyboard-first operation.

## 2. Goals and non-goals

**Goals**
1. A Linear-grade, calm interface with an aligned-column table, saved views, list and
   board layouts, display options, and keyboard operation.
2. One view engine. My Tasks, Tasks and the project Tasks tab are presets of the same
   components and the same query layer.
3. One write path and one access policy for tasks. Every invariant is enforced in Convex
   and has a test.
4. Bounded, index-driven reads. No request scans every task in the org.
5. Delete the parallel implementations listed in §10.

**Non-goals (this module)**
- Planner screen redesign. Only the sun/Today semantics touch it.
- Billing/time-entry logic. It is only touched through the `trackedMinutes` hook (§5.5).
- Cycles, milestones, triage, multi-level sub-tasks, SLA.
- Dark mode polish. Tokens must stay theme-safe, but designs are reviewed in light mode.

## 3. Locked decisions

### 3.1 UX (owner-approved through prototype rounds v1–v4)

| # | Decision |
|---|---|
| U1 | App shell: Linear-style grey canvas, inset rounded panel, in-house Linear-style icon set (sidebar, toolbar, status, priority), round icon toolbar buttons, pill view tabs. |
| U2 | Lists are an **aligned-column table** with a sticky header row. Each property has its own fixed track. Linear's right-floating metadata is explicitly rejected. |
| U3 | No redundancy in rows: no task ID in lists (drawer/page only); Client column shows the **client name only** (project shown in detail); the grouped-by property is never repeated. Grouped by status → status shown as an icon before the title. Grouped by project → no Client column. Grouped by assignee → no Assignee column. |
| U4 | Kept from the current app: unread-comments count since last visit (red count on the row, badge in detail, "N new since your last visit" divider); unseen-update dot; start/stop timer from the row with total tracked time (`HH:MM`, live `HH:MM:SS` while running, running timer also in the sidebar). |
| U5 | Tasks page: view tabs. System views **Active / Backlog / All tasks** plus user-created views, **personal or workspace** (workspace = admin). A view stores filters, grouping, ordering, layout, visible properties, sub-task and empty-group toggles. |
| U6 | Display menu as Linear: List/Board, Grouping (Columns on board), Ordering, Show sub-tasks, Show empty groups, property chips, Reset, Set default for everyone (admin, workspace/system views). |
| U7 | Filters: Notion-style "+ Filter", two-step, **faceted** counts (per `feedback_notion_filter_pattern`). Includes a "New comments" facet. |
| U8 | My Tasks tabs: **Today \| Assigned \| Created** (+ user views). Today = manual plan: "Carried over" group (planned on an earlier day, not finished; Keep for today / Remove / Keep all), the Today list in hand-made order (drag), "Add tasks to today" picker (search, Suggested: due soon / started / carried), collapsed "Done today". |
| U9 | Task detail opens as **drawer or full page**, a per-user setting. The **current drawer is kept** and only optimized: ID in the breadcrumb, J/K stepping, Priority/Labels/Start date in the property column, the shared row component for sub-tasks, the unread divider in Activity, and the Email tab hidden until it ships. The full page uses the Linear issue layout (content + right property sidebar) at `/tasks/[identifier]`. |
| U10 | Linear interaction details: status/priority/assignee menus with search, kbd hint, number shortcuts; keyboard C, J/K, Enter, Space (peek), X, S, P, A, L, T (today), Y (timer), F, Esc, ?; floating selection bar (Add to today, Status, Priority, Assignee, Labels, Archive). |
| U11 | Light theme first. In-row visuals use existing components (§6.4). |

### 3.2 Domain (owner decisions, 2026-10-18)

| # | Decision |
|---|---|
| D1 | **Multiple assignees** per task. A `taskAssignees` edge table is the source of truth (§4.2). |
| D2 | Identifier = **project code + per-project number** (`ARLO-21`). Tasks without a project use the **org key + org number** (`KON-7`). Moving a task to another project gives it a new number there. Old identifiers keep resolving (alias table). |
| D3 | Statuses follow the Linear model. **Fixed categories in code**: `backlog`, `unstarted`, `started`, `completed`, `canceled`. **Statuses are fully org-defined** inside a category (name, color, description, order, one default per category). Business logic reads the category only, never a status name. |
| D4 | Data is MVP dummy data: rewrite the schema directly and reseed. No migration code. |
| D5 | Members see only tasks they are assigned to (unchanged). On those tasks a member may change everything **except** project, work category, billable flag and delete. Policy lives in one module (§5.3). |
| D6 | Sub-tasks stay **one level** deep. |
| D7 | Priority: `0 none, 1 urgent, 2 high, 3 medium, 4 low` (Linear ordering). |
| D8 | Labels are org-level, multi-value, non-billing. Work category stays a separate single-value billing property. |
| D9 | Sun / Today plans for the task's **assignees**, never for the presser (carried over from the July map, ticket 03). Members plan only their own day. Admins plan for every assignee. With zero assignees the sun is disabled ("Assign first"). Bulk reports `added N · skipped M (no assignee)`. |

## 4. Data model (target `convex/schema.ts`)

Field lists are normative. Names follow the Convex guideline that every index field
appears in the index name.

### 4.1 `statuses`
```
orgId, name, description?, color, category: "backlog"|"unstarted"|"started"|"completed"|"canceled",
position (fractional key, order within category), isDefault (one per category), archivedAt?, createdAt, updatedAt
index by_orgId_category_position (orgId, category, position)
```
- The icon is derived. Backlog = dashed ring. Unstarted = empty ring. Started = ring plus a pie
  filled by position inside the category. Completed = filled check. Canceled = filled ×.
- Default seed per org: Backlog·**Inbox** (default), Unstarted·**Next up** (default),
  Started·**In progress** (default), Started·**Admin review**, Started·**Client review**,
  Started·**Stuck**, Completed·**Done** (default), Canceled·**Canceled** (default).
- The category of a status is immutable once tasks use it. To change it, move tasks to a
  status in another category. This removes the current type-change cascade.
- Every category always keeps at least one non-archived status.

### 4.2 `tasks` and edges
```
tasks:
  orgId, title, description? (TipTap JSON string), hasDescription,
  identifier ("ARLO-21"), numberScope: { kind: "project", projectId } | { kind: "org" }, number,
  statusId, statusCategory (denormalized from statuses), priority (0–4),
  projectId?, clientId? (denormalized from project), workCategoryId?, billable,
  startDate?, dueDate? (YYYY-MM-DD), estimateMinutes?,
  parentTaskId?, sortKey (fractional; one global manual order, Linear-style),
  assigneeIds (READ CACHE of taskAssignees, written only by the write module),
  labelIds (READ CACHE of taskLabels),
  -- derived, maintained by the write module (§5.5) --
  trackedMinutes, commentCount, lastCommentAt?, subtaskCount, subtaskDoneCount,
  lastActivityAt, lastActivity?: { kind, actorId, at },
  completedAt? (set iff statusCategory ∈ {completed, canceled}),
  archivedAt?, createdAt, createdBy, updatedAt

  index by_orgId_statusCategory_sortKey
  index by_orgId_projectId_statusCategory
  index by_orgId_parentTaskId
  index by_orgId_identifier
  index by_orgId_completedAt
  index by_orgId_createdBy
  search index search_title (filterFields: orgId, statusCategory)

taskAssignees: orgId, taskId, userId, assignedAt, assignedBy
  index by_orgId_userId_taskId · index by_taskId_userId
taskLabels: orgId, taskId, labelId
  index by_orgId_labelId · index by_taskId_labelId
labels: orgId, name, color, archivedAt?, position
  index by_orgId_position
taskIdentifierAliases: orgId, identifier, taskId
  index by_orgId_identifier · index by_taskId   (by_taskId: delete cascade, slice 1)
```
Counters for identifiers live on `projects.nextTaskNumber` and
`orgSettings.taskKey` + `orgSettings.nextTaskNumber`. They are incremented in the same
mutation that creates or moves the task.

### 4.3 Per-user state
```
taskUserState: orgId, userId, taskId, lastViewedAt, unreadComments, hasUnseenChanges, subscribed, muted
  index by_orgId_userId_unreadComments (orgId, userId, unreadComments)
  index by_taskId_userId
```
This replaces `taskViewReceipts`, `commentReadReceipts`-as-list-signal and `taskMutes`. It
is **fan-out on write**: a comment increments `unreadComments` for subscribers except the
author, and opening the task resets it. A list row then reads one row per visible task
instead of running 7 queries per task. Comment-level read receipts stay where the activity
feed needs them.

**Subscription defaults (slice 2):** the subscribers of a task are its current assignees,
its creator, everyone who commented on it, and anyone whose row already says `subscribed`
(an assignee who is removed later stays subscribed). `muted` users stay subscribed but get
no fan-out; `notifications.muteTask` / `unmuteTask` mirror into `muted` until slice 7 drops
`taskMutes`. Rows are lazy: created on the first fan-out to a subscriber, when someone
comments, mutes, or opens the task. An admin who opens a task they do not participate in
gets a row with `subscribed: false` that only tracks `lastViewedAt`. Fan-out: a comment
increments `unreadComments` for subscribers except the author; a comment delete recounts
(comments by others newer than `lastViewedAt`); an activity event in
`userState.UNSEEN_CHANGE_TYPES` (status, assignees, sub-task created/completed, due/start
date, priority, labels, work category, project) sets `hasUnseenChanges` for subscribers
except the actor; opening the task (`tasks/userState.markViewed`, also called by the old
`taskViewReceipts.markViewed`) resets both and stamps `lastViewedAt`.

### 4.4 Views and preferences
```
taskViews: orgId, ownerId? (absent = workspace view), surface: "tasks"|"myTasks"|"project",
  name, position, spec, createdBy, createdAt, updatedAt
  index by_orgId_surface_position · index by_orgId_ownerId_surface
viewDefaults: orgId, surface, systemViewKey, spec    // "Set default for everyone" on system views
  index by_orgId_surface_systemViewKey
users.taskDetailMode: "drawer" | "page"              // replaces taskDetailView (modal|drawer)
```
`spec` is a validated object: `filters[{property, operator, values}]`, `layout`, `groupBy`,
`orderBy`, `visibleProperties[]`, `showSubtasks`, `showEmptyGroups`. System views
(Active/Backlog/All, Today/Assigned/Created) are code constants. Unsaved, transient
changes live in the URL. A view shows the "modified" dot when the URL differs from its
spec.

**Slice 4 details:** a `viewDefaults` row stores a system view's *display* settings only;
the system view's filters stay the code constant (they define Active/Backlog/…). Filter
values may be `me` (the caller) or `none` (`NONE_FILTER_VALUE`: the property is unset — No
assignee / No label / No project). A view's filters split into the **scope** (a system
view's own filters; a saved view's `statusCategory` filters) and the editable **chips**
(a saved view's other filters, or the URL's `filter` params). Saving stores scope + chips.
The title search (`?q=`) is transient: never saved, never "modified".

### 4.5 Unchanged
`planSegments` (Today plan, `todaySortKey`), `comments` and attachments, `timeEntries`,
`activityLog` (made typed: `type` becomes a `v.union` of literals, `metadata` a
discriminated union).

### 4.6 Removed
`tasks.statusType`, `tasks.manualSortKey` (renamed to `sortKey`), `tasks.sortOrder`
(sub-tasks use `sortKey`), `tasks.estimate` (already minutes; renamed to `estimateMinutes`),
`orgSettings.defaultStatusId` (dead), `orgSettings.completionDefault*StatusId` (D5 makes
them unnecessary), `orgSettings.defaultMyTasksStatusIds`, `users.todayVisibleStatuses`,
`users.taskDetailView`, `migrations/retireTodayStatus.ts`.

## 5. Backend architecture

### 5.1 Module layout
```
convex/tasks/
  model.ts        pure domain: categories, icons-by-position, identifier format, transition rules (no ctx)
  access.ts       loadTaskForRead / loadTaskForWrite / canEditField — the ONLY authz entry points
  write.ts        the ONLY writer of tasks, taskAssignees, taskLabels, derived fields, aliases
  derived.ts      counter maintenance helpers called from write.ts and the comment/time hooks
  read.ts         bounded loaders + DTO shaping (TaskRowDTO, TaskDetailDTO)
  queries.ts      public queries: listView, getByIdentifier, getDetail, subtasks, pickerCandidates
  mutations.ts    thin public mutations → write.ts (create, update, setStatus, setAssignees, setLabels,
                  move, reorder, archive, restore, remove, duplicate, bulk)
  today.ts        sun/Today: addToToday, removeFromToday, keepCarried, reorderToday, listToday
  views.ts        saved views CRUD + viewDefaults
convex/statuses.ts, convex/labels.ts   org settings CRUD (admin), category-safe
convex/workspaceRefs.ts                one query: statuses, labels, projects+clients, members, categories
```
Agent tools, the Planner, notifications and seeds call `write.ts`/`read.ts` internals.
They never touch tables directly.

### 5.2 Invariants

| ID | Invariant | Owner | Test |
|---|---|---|---|
| T1 | Every task read and write goes through `access.ts`. A member can read or write a task iff a `taskAssignees(userId)` edge exists on the task **or on its parent** (sub-tasks of an assigned parent are accessible, §11.5). Org comes from the Clerk JWT only. | access.ts | access matrix test over every public function |
| T2 | `tasks`, `taskAssignees`, `taskLabels`, `taskIdentifierAliases` and every derived task field are written only by `tasks/write.ts`. | write.ts | lint rule / grep test: no `db.insert/patch("tasks"…)` outside write.ts |
| T3 | `task.statusCategory === statuses[task.statusId].category`. Code branches on category only. | write.ts | property test across transitions |
| T4 | `completedAt` is set iff the category is `completed` or `canceled`. It is stamped on entering the category and cleared on leaving it. | write.ts | transition test |
| T5 | `identifier` is unique per org. It changes only on project move or code rename, and the old value goes to aliases. | write.ts | create/move/rename test |
| T6 | `assigneeIds` and `labelIds` caches equal the edge tables, and derived counters equal recomputation. | derived.ts | `recompute()` consistency test after randomized op sequences |
| T7 | No query reads an unbounded task set. Every loader uses an index range and an explicit cap, and returns `truncated: true` when the cap is hit. | read.ts | test with cap+1 rows |
| T8 | Sub-tasks are one level deep and inherit the parent's project/client. A parent's archive or restore cascades. | write.ts | tests |

### 5.3 Access policy (D5)

| Action | Admin | Member (assigned) |
|---|---|---|
| Read task, comments, activity | ✓ | ✓ |
| Title, description, status (any category), priority, dates, estimate, labels, sub-tasks | ✓ | ✓ |
| Add assignees | ✓ | ✓ (cannot remove the last assignee or themselves if they are the last) |
| Remove other assignees | ✓ | ✗ |
| Project, work category, billable | ✓ | ✗ |
| Archive | ✓ | ✓ |
| Delete | ✓ | ✗ |
| Plan Today | for every assignee | own day only |
| Create task | ✓ | ✓ (auto-assigned to self) |
| Workspace views, statuses, labels settings | ✓ | ✗ (personal views ✓) |

### 5.4 Read layer
- `listView({surface, viewKey | spec, projectId?, closedLimit?, today?})` returns
  `{ rows: TaskRowDTO[], truncated, hasMoreClosed, perUser, spec }`. `surface` also accepts
  `"planner"` (the Planner panel preset, §10). The spec's filters are the view's scope and are
  applied server-side (`newComments` after the per-user join); transient URL filters and facets
  run client-side over `rows`. From slice 4 the client sends only the scope (§4.4: system view
  by key, else `statusCategory` filters + `showSubtasks`); a saved view's other filters run
  client-side as chips so their facets stay complete. Server and client share one pure matcher
  (`convex/tasks/filters.ts`). `perUser` is sparse: rows absent from it have the defaults.
  `today` (YYYY-MM-DD, client clock) keeps the query cacheable; it falls back to the org
  timezone. The loader picks the most selective index.
  Member or "assigned to me" → `taskAssignees.by_orgId_userId_taskId`. Project →
  `by_orgId_projectId_statusCategory`. Category-scoped views → `by_orgId_statusCategory_sortKey`.
  Completed and canceled are capped by `by_orgId_completedAt` desc (default 200, "Load
  more" paginates by raising `closedLimit`, max 2,000; `hasMoreClosed` says more exist).
  A member always reads their own edges (their visibility is the edge set) plus, when the
  view shows sub-tasks, the sub-tasks of their assigned parents (§11.5).
- Caps: 1,000 open rows per view. The UI shows "Showing first 1,000. Refine with
  filters" when `truncated`. Closed rows are paginated, not truncated. Archived tasks are
  never listed by `listView`.
- Grouping, sorting, faceting and column rendering run **client-side** over the returned
  rows. This makes facets instant and keeps the server contract small.
- `TaskRowDTO` is flat and id-based. Names, colors and avatars come from the single
  `workspaceRefs` query (cached once per page), not from per-query joins.
- The per-user part (`unreadComments`, `hasUnseenChanges`, `inMyToday`) is read from
  `taskUserState` and `planSegments` by index for the caller only.
- Counts: tab counts come from the loaded rows. The sidebar My Tasks badge reads today's
  `planSegments` for the user (small range). `@convex-dev/aggregate` is introduced only if
  an org-wide count is ever needed beyond a loaded view.

### 5.5 Derived data hooks
- **Comments:** `comments` create/delete call `derived.onComment` (commentCount, lastCommentAt,
  lastActivity, fan-out to `taskUserState`).
- **Sub-tasks:** sub-task create/status/archive → `derived.onSubtaskChange(parent)`.
  `subtaskCount` counts non-archived sub-tasks; `subtaskDoneCount` counts the non-archived
  ones in a **closed** category (completed + canceled) — a canceled sub-task is finished
  work (slice 1 decision, same as the seed and the old UI's legacy `done`).
- **Time entries:** the time-entry write path calls `derived.onTimeEntryChange(taskId, delta)`.
  This is the only touchpoint with billing code. It is coordinated with
  `docs/prd-billing-refactor.md` and changes no billing behaviour.
- **Activity:** every write appends typed `activityLog` rows and updates `lastActivity`.

### 5.6 Today (sun) semantics
- A plan is `planSegments(userId, taskId, date)`. Today for the user = segments on today's date.
- **Carried over** = the user's segments on earlier dates whose task is not completed or
  canceled and that have no segment today. Window: 14 days.
  - Keep → create today's segment.
  - Remove → delete the stale segment.
  - Keep all → batch create.
- **Done today** = the user's tasks with `completedAt` today (fixes the `updatedAt` bug).
- `addToToday(taskId)`: targets = the presser if they are a member. If the presser is an
  admin, targets = all assignees. Idempotent per (user, task, date). With zero assignees
  it rejects with a typed error.
- Unchanged: Planner board CRUD with explicit `userId` and `assertCanManagePlanFor`.

## 6. Frontend architecture

### 6.1 Routes
`/tasks` (view tabs; `?view=` + URL filter state) · `/tasks/[identifier]` (full page,
resolves aliases) · `/my-tasks` (`?tab=today|assigned|created|<viewId>`) · project page
gains a **Tasks** tab (preset `surface: "project"`) · drawer via `?task=<identifier>` on
any of these routes.

### 6.2 Components
```
components/task-view/
  task-view.tsx            container: preset + view spec → listView → table|board
  use-view-state.ts        URL ⇄ saved spec ⇄ defaults; "modified" detection
  columns.tsx              column registry: key, track width, header, sortable, render(cell), editable
  task-table.tsx           sticky header + group headers + rows (CSS grid from registry)
  task-row.tsx             THE row (used by lists, Today, sub-tasks, pickers)
  group-header.tsx · task-board.tsx · board-card.tsx
  view-tabs.tsx · display-menu.tsx · filter-menu.tsx (built on ui/filters + facets)
  selection-bar.tsx · use-task-keyboard.ts · property-menus.tsx (status/priority/assignee/labels)
components/task-detail/
  task-detail.tsx          shared body (title, tabs, description, sub-tasks, activity, comment input)
  task-detail-drawer.tsx   current drawer shell + U9 deltas
  task-detail-page.tsx     full-page shell (Linear layout)
  task-properties.tsx      single property panel (stacked for drawer, sidebar for page)
components/my-tasks/       today-list.tsx, carried-over.tsx, today-picker.tsx (Today only; Assigned/Created are task-view presets)
components/icons/          status-icon.tsx (category+position), priority-icon.tsx, nav icon set
```

### 6.3 Column registry (default widths from prototype v4)

| Key | Track | Header | Notes |
|---|---|---|---|
| priority | 22px | – | icon button, P menu |
| id | 60px | ID | off by default |
| statusIcon | 18px | – | used instead of `status` when grouped by status |
| title | minmax(250px,1fr) | Task | unseen dot, sub-task ring, sun, comment count right-aligned |
| status | 120px | Status | icon + name |
| category | 112px | Category | `ColoredPillBadge` with dot |
| labels | 160px | Labels | off by default |
| client | 140px | Client | client name only |
| assignee | 96px | Assignee | `UserAvatar` stack + first name |
| due | 76px | Due date | overdue = destructive token |
| estimate | 60px | Estimate | off by default |
| time | 76px | Time | existing time cell (play/stop, HH:MM) |
| created | 64px | Created | off by default |
| activity | 200px | Last activity | off by default |

The table min-width = sum of track minimums. The panel scrolls horizontally only below that.

### 6.4 Design-system rules
In-row cells reuse `ColoredPillBadge` (5px radius, tone-based), `UserAvatar` (photos),
the existing time cell, the `globals.css` tokens (`primary`, `muted`, `border`,
`destructive`), and shadcn `Button`/`DropdownMenu`/`Popover`/`Command`. The prototype's
rounded pills, monogram avatars, hexagon client icon and indigo accents are **not**
carried over. New shared pieces (icons, view tabs, display menu, table grid) are built on
the same tokens. Standing feedback applies: no bordered pill toolbar buttons except the
view tabs, counts as muted text, quiet ghost controls.

## 7. Agent tools
`findTasks`, `getTaskDetail` and `countTasksByStatus` call `tasks/read.ts` with the
caller's access. `proposeCreateTasks` and `proposeArchiveTask` call `tasks/write.ts`. Tools
accept identifiers (`ARLO-21`). `agentMentions` task search uses the search index plus
access filtering instead of a full scan.

## 8. Testing
`convex-test` suites per slice. Required:
- the access matrix (T1, every public function × admin/member-assigned/member-unassigned/other-org)
- the write invariants T2–T6, T8
- read caps (T7)
- Today semantics (carried, keep/remove, assignee targeting, idempotency, done-today via `completedAt`)
- identifier create/move/alias
- `listView` index selection per surface

UI: unit tests for `use-view-state` (URL ⇄ spec) and the column registry visibility rules
(U3). Each slice runs `npx tsc --noEmit`, `npm run lint`, `npm test`. `npm run build` runs
at slice ends that touch routes.

## 9. Slices
Each slice is shippable and leaves the app working. Slices 0–2 are backend-first. The
old UI keeps working on adapters until slice 3 replaces it.

| # | Slice | Done when |
|---|---|---|
| 0 | **Foundations.** New schema (§4) + `tasks/model.ts` + `access.ts` + seed rewrite (statuses by category, identifiers, priorities, labels, assignee edges). | Reseed works; access matrix tests green; tsc clean |
| 1 | **Write path.** `tasks/write.ts` + `derived.ts`; all 5 create paths, `update`, `bulkUpdate`, archive/restore/remove/duplicate rewired; typed activity; comment/sub-task/time hooks. | T2–T6, T8 tests green; old UI still works |
| 2 | **Read path.** `workspaceRefs`, `listView`, `getByIdentifier`, `getDetail`, `taskUserState`. Old list queries become thin adapters, then are deleted when slices 3–5 land. | T7 + index-selection tests; no full-org scans remain in tasks code |
| 3 | **Table UI kit on /tasks.** Icons, column registry, task-table/row/group header, property menus, selection bar, keyboard, system views Active/Backlog/All, URL state. | `/tasks` on the new engine; old `tasks-table`/`task-row` deleted |
| 4 | **Views + board + shell.** `taskViews` CRUD, view tabs, display menu, filter menu with facets, search, board layout, set-default-for-everyone; the U1 app shell (grey canvas, inset panel, nav icon set wired into the sidebar) per §11.6. | Personal + workspace views persist; board works; shell live |
| 4b | **Row editing restored (§11.7).** Inline edit of category, client/project and due date in the row; drag reorder (global `sortKey`, write path `reorder`); inline "add task" row at the end of a group. | Old-row capabilities back on the new table |
| 5 | **My Tasks.** Today (carried, picker, manual order, done today), Assigned/Created presets, sun semantics (§5.6) everywhere, sidebar badge. | Old `my-tasks/*`, `myTasks.ts`, prototype folder deleted |
| 6 | **Detail.** Shared `task-detail` body, drawer with U9 deltas, `/tasks/[identifier]` full page, per-user drawer/page setting, J/K. | Modal path and duplicate header/comment input deleted |
| 7 | **Project tab, settings, cleanup.** Project Tasks tab preset, Linear-style statuses and labels settings, agent tools on the new layer, §10 deletions, docs updated. | §10 list empty; all checks green |

## 10. Deletion list (must be empty at the end of slice 7)
- **Backend:**
  - `tasks.ts`: split, then remove `list`, `counts`, `activityIndicators`, `subtaskPreview`, `listByProject`.
  - `myTasks.ts`.
  - `planner.taskPanel`: replaced by `listView` with surface `planner`.
  - `lib/myTaskHelpers.ts`, `lib/taskActivityIndicators.ts`, the `lib/task_helpers.ts` enricher, `migrations/retireTodayStatus.ts`.
- **Frontend:**
  - `components/tasks/`: `tasks-table`, `task-row`, `task-card`, `tasks-tabs`, `tasks-header`, `task-detail-modal`, `task-detail-header`, `task-detail-comment-input`, `comment-card` (dead).
  - `components/my-tasks/`: `prototype/*`, `my-task-row`, `my-tasks-list`, `date-navigator` (test-only).
  - The 6 copies of the reference-data block.
- **Owner decides, not auto-deleted:** `convex/dashboardBoard.ts` and
  `components/dashboard/my-work-board/` are uncommitted work in progress. Recommendation: rebuild
  the dashboard board as a `task-view` preset with `layout: "board"` once slice 4 lands.

## 11. Resolved questions (owner, 2026-10-18)
1. Project code rename rewrites every identifier in the project, and the old ones go to `taskIdentifierAliases` (Linear team-key behaviour).
2. Default visible columns follow prototype v4 (§6.3). My Tasks hides Assignee.
3. "Done today" = `completed` category only. Canceled does not count.
4. Admin planning someone's day creates no inbox notification, only the Today row.
5. Sub-task access: a member assigned to a parent task can read and edit (per §5.3) all of its sub-tasks, even ones they are not assigned to. Assignment to a sub-task alone also grants access. `access.ts` is updated in slice 1.
6. The U1 app shell (grey canvas, inset rounded panel, Linear-style nav icons in the sidebar) ships in slice 4 (owner, 2026-10-18, after slice 3 review).
7. Slice 3 dropped some old-row capabilities. Restored in slice 4b: inline edit of category, client/project and due date; drag reorder; inline add-task row. NOT restored: the mobile card list (the table scrolls horizontally on mobile).


## 12. Execution and resume protocol

**Branch:** `tasks-refactor`, cut from `billing-refactor` at `4a70e71`. It depends on the
billing time-entry write path. Never commit the owner's unrelated working-tree changes
(`components/dashboard/`, `convex/dashboardBoard.ts`, `.agents/skills/*`, `skills-lock.json`).

**Widen, then narrow.** D4 allows a direct schema rewrite, but the app must compile and run
after every slice. Slices 0–6 therefore **add** the new tables and fields next to the old
ones. Old code keeps working through adapters. Slice 7 deletes the old fields, tables and
code (§4.6, §10) once nothing reads them. Reseed whenever a slice changes seed shape.

**How a slice runs.** One slice per session, in its own worktree off the latest
`tasks-refactor` tip:
1. Read this PRD, `CLAUDE.md`/`AGENTS.md` and `convex/_generated/ai/guidelines.md`, plus
   memory `feedback-tasks-refactor-direction` for UI slices.
2. Implement only that slice's row in §9. Do not re-decide §3 or §11.
3. Run `npx tsc --noEmit`, `npm run lint` and `npm test`. Run `npm run build` when routes change.
4. Commit on the slice branch and update the status table below (status, commit, notes,
   deviations). Any deviation from a MUST is written into this PRD first.
5. The orchestrating session reviews the diff, merges into `tasks-refactor`, and starts the next slice.

**Resuming from a new chat:** "Continue the tasks refactor per `docs/prd-tasks-refactor.md`
§12." The status table is the single source of truth for progress.

### Slice status

| # | Slice | Status | Commit | Notes |
|---|---|---|---|---|
| 0 | Foundations | done — merged 2026-10-18 | `31c588b` | **Review (orchestrator):** ff-merged; tsc clean, new files lint-clean (repo lint baseline unchanged 62 errors/45 warnings), 1442/1446 tests (4 pre-existing failures in `format-activity-timestamp` + `taskActivityIndicators`). Dev deployment reseeded 2026-10-18 (63 tasks reshaped; rerun is a no-op). Owner decided sub-task access via parent (§11.5) — slice 1 updates `access.ts` + matrix tests. Schema widened (§4: statuses category/position/isDefault/description, tasks new fields + indexes, taskAssignees, taskLabels, labels, taskIdentifierAliases, taskUserState, taskViews, viewDefaults, users.taskDetailMode, projects.nextTaskNumber, orgSettings.taskKey/nextTaskNumber); `tasks/model.ts`, `tasks/access.ts`; reseed `convex/devSeedTasks.ts` (`npx convex run devSeedTasks:seed '{}'`); tests `convex/__tests__/tasks{Model,Access,Seed}.test.ts`. **Deviations:** (1) widen = every new `tasks`/`statuses`/counter field is `v.optional` (old writers don't set them) — slice 7 narrows; (2) no general seed existed (`seedInvoicingScenarios` was deleted in billing slice 5) and time entries/closes reference tasks, so the seed reshapes the org **in place** (idempotent) instead of wipe + reseed; (3) `projects.code` is the identifier key — legacy `PRJ-042` codes are not valid keys (hyphen), the seed recodes them (`ARLO`, `PRAG`, `ARLO2`); (4) index names `by_orgId_userId_unreadComments` and new `viewDefaults.by_orgId_surface_systemViewKey` (§4.3/§4.4 updated); (5) `tasks.estimate` was already minutes (§4.6 text fixed). **Slice 1 must know:** `generateNextProjectCode` still emits `PRJ-NNN` for new projects (invalid key → no identifier); old create/assign/remove paths write no edges/identifiers and don't cascade edges on delete (re-running the seed backfills/sweeps); `projects.remove` keeps tasks (seed moves them to org scope); seed counts `subtaskDoneCount` as closed (completed + canceled) — confirm in `derived.ts`; T1 read literally means a member cannot open an unassigned sub-task of an assigned parent (old `getSubtasks` shows all) — orchestrator to confirm before slice 2; `devSeedArloJune` looks up `PRJ-002` and breaks after recoding; `api.d.ts` hand-edited (no codegen run) — regenerate after merge; guidelines target Convex ^1.41, installed 1.34.1 (single-arg `db.get/patch` kept). |
| 1 | Write path | done — merged 2026-10-18 | `b080b7c` + `0a8dd80` | **Review (orchestrator):** ff-merged; re-ran tsc (clean), lint (baseline 62/45), `npm test` 1496/1500 (same 4 pre-existing). Checked every time-entry write path (create/update/move/remove/timer) calls `onTimeEntryChange`; only other entry deleter is the task-delete cascade. Schema pushed (typed `activityLog` accepted) and dev reseeded (9 tasks backfilled; rerun no-op). Deviations (3)–(8) accepted as consistent with D5/§5.3/T5/T8. `convex/tasks/write.ts` (only writer of tasks/taskAssignees/taskLabels/taskIdentifierAliases; createTask/updateTask/archive/restore/remove/duplicate/reorder + edge sync, identifier allocation/move/rename, seed+maintenance primitives) and `convex/tasks/derived.ts` (onComment, onSubtaskChange, onTimeEntryChange, touchLastActivity, recomputeTaskCounters). Rewired: `tasks.create/createSubtask/duplicate/update/updateDescription/bulkUpdate/archive/restore/remove/reorderTask/reorderSubtasks`, `planner.createTaskWithSegment/createTodayTask`, comment create/remove + time-entry create/update/remove + timer entry hooks, `statuses.update` cascade, `migrations/retireTodayStatus`, both seeds (`devSeedTasks`, `devSeedArloJune`) through write.ts internals. `activityLog` typed (table-level discriminated union in `tasks/model.ts`; superset of historical shapes). Project codes: generator emits valid keys (client prefix / derived name, else `PRJ`, `PRJ2`…), user codes uppercased + validated, unique vs projects AND org task key; code rename rewrites identifiers + aliases (§11.1). Tests: `tasksWriteBoundary.test.ts` (T2, TypeScript-checker scan — resolves the table of every `db.insert/patch/replace/delete` from the id type, so 1.34's id-only calls are covered; unresolved writes also fail), `tasksWrite.test.ts` (45: create paths, T3/T4 randomized transitions, T5 move/rename/alias/uniqueness, T6 randomized 60-op sequence vs `recomputeTaskCounters`, T8 cascade/delete, access matrix for every rewired mutation × admin/assigned/unassigned/other-org, incl. sub-tasks reached via the parent). **§11.5 implemented:** `access.ts` grants a member a sub-task when they have an edge on it OR on its parent (`TaskAccess.viaParent`); via-parent access follows the member field policy (no project/category/billable, no delete, may add assignees but not remove others); assignment to a sub-task alone grants that sub-task, not the parent or siblings; an other-org edge on the parent grants nothing (loader tests in `tasksAccess.test.ts`, mutation matrix in `tasksWrite.test.ts`). `devSeedArloJune` looks up project code `ARLO` (name-disambiguated). **Deviations:** (1) derived.ts writes through `write.ts#patchDerivedFields` (T2 kept literal; write.ts ↔ derived.ts import cycle, functions only); (2) added index `taskIdentifierAliases.by_taskId` (§4.2 updated); (3) D5/§5.3 now enforced on the old mutations: members can no longer change project/work category/billable or remove other assignees (old UI shows the error), members are auto-assigned on every create incl. Planner draw-to-create, the old bulk "only admins can mark done" rule is dropped (D5: any category); (4) `createTodayTask` uses the default **started** status ("In progress"; falls back to unstarted) instead of the first legacy `in_progress` by sortOrder ("Next up"); (5) restore cascades only to sub-tasks archived in the same cascade (same `archivedAt`), not ones archived earlier on their own; (6) duplicating a sub-task makes a sibling sub-task (was: top-level); duplicate notifies assignees like create; (7) a sub-task's project cannot be changed; moving a parent moves its sub-tasks (each renumbered + aliased); (8) identifier allocation skips numbers whose identifier is an alias (reused code), a rename drops aliases its new identifiers shadow — a live identifier never equals an alias; (9) `lastActivity.kind` is the activity type (`comment_added`, not `comment`; seed aligned); (10) statuses: create/seed/onboarding stamp `category`; a legacy type change that would change the category is rejected while tasks use the status (§4.1), otherwise `statusType` follows via write.ts; (11) `taskUserState` fan-out is left for slice 2 (hook point: `derived.onComment`); (12) `projects.remove` still leaves tasks with a dangling projectId (unchanged; seed sweeps). **Slice 2 must know:** read paths/comments still check the `assigneeIds` cache — switch them to `access.ts`; read paths must use `access.ts` so §11.5 (via-parent sub-task access) applies to `getSubtasks`/`getDetail` too; global end-of-order sort key reads `by_orgId_manualSortKey` + per-category `by_orgId_statusCategory_sortKey` — add `by_orgId_sortKey` when slice 7 drops `manualSortKey`; pushing the typed `activityLog` schema fails if the dev deployment holds a row shape not in the union — clear/reseed activity if so; tasks created by old code before the reseed have no identifier/edges until `devSeedTasks:seed` runs; `api.d.ts` hand-edited for `tasks/write` + `tasks/derived` (no codegen run). Checks: tsc clean; lint 62 errors/45 warnings = baseline, none in touched files; `npm test` 1496 passed / 4 failed (the 4 pre-existing). `npm run build` not run (no route changes; it runs `convex codegen`). |
| 2 | Read path | done — merged 2026-10-18 | `dc06b62` | **Review (orchestrator):** ff-merged; re-ran tsc (clean), lint (baseline 62/45), `npm test` 1516/1520 (same 4 pre-existing). Test-fixture edits only add `taskAssignees` edges + `statusCategory`; member Planner panel narrowing accepted (T1/D5, was a §1 missing check); `hasAttachments` has no UI reader. Schema pushed, dev reseeded (67 `taskUserState` rows backfilled; rerun no-op). **Built:** `convex/workspaceRefs.ts` (`get`: statuses with derived icon, labels, projects + clients, members, work categories, org task key — display fields only, no rates/fees/billing details; archived rows flagged). `convex/tasks/read.ts` (bounded loaders, each one index range with `take(cap + 1)` → `truncated`: `loadByCategories`, `loadRecentlyClosed` (`by_orgId_completedAt` desc), `loadProjectTasks`, `loadAssignedTo` (`taskAssignees.by_orgId_userId_taskId`), `loadCreatedBy`, `loadSubtasksOf`, `loadViaParentSubtasks`; pure `planListLoad` index selection + `matchesFilter(s)` for every spec filter property; `TaskRowDTO`/`TaskDetailDTO` (detail adds description, parent, per-field `permissions` from access.ts, per-user state); `loadPerUser` = one range read of the caller's `taskUserState` + one of their plan segments). `convex/tasks/queries.ts`: `listView`, `getByIdentifier` (case-insensitive, aliases, `resolvedFromAlias`), `getDetail`, `subtasks`, `pickerCandidates` — all through `access.ts`. `convex/tasks/userState.ts`: subscription rule (§4.3), fan-out from `derived.onComment` and from every `logActivity` (`derived.onActivity`), `markViewed` mutation, mute mirror, `recomputeUserStates` (seed backfill, parity-tested against the hooks). System views (Active/Backlog/All, Assigned/Created, project, planner) are code constants in `tasks/model.ts` `SYSTEM_VIEWS`. **Adapters (shapes kept):** `tasks.list` (tabs → categories of the legacy type; admin category index, member edges; search capped), `counts`, `getDetail`, `getSubtasks`, `subtaskPreview`, `listByProject`, `activityIndicators` (derived counters + `taskUserState`, 1 activity read per row instead of ~7), `deleteImpact`, `getWorkCategoryId`, `myTasks.listMyTasks` (my edges + my segments' tasks, no org scan), `planner.taskPanel` (= `loadView` planner preset). Access switched from the `assigneeIds` cache to `access.ts` in `comments.*`, `commentAttachments`, `commentReactions`, `attachments`, `activityLog`, `typingIndicators`, `taskViewReceipts.markViewed` (also resets `taskUserState`), `notifications` (recipient check via `userCanReadTask`, `muteTask`), `timer.start`/`previewRateForTask`. New access helpers `userCanReadTask`, `filterReadableTasks`. Task delete cascades `taskUserState`. No full-org task scan remains in tasks code (only the dev `planner.seedDemo`, capped at 200). **Schema:** unchanged. **Seed shape:** `devSeedTasks` gains step 5b (backfill `taskUserState` from `taskViewReceipts`/`commentReadReceipts`/`taskMutes`; idempotent; result adds `userStatesInserted`/`userStatesUpdated`) — **reseed after merge**. `api.d.ts` hand-edited for `tasks/queries`, `tasks/read`, `tasks/userState`, `workspaceRefs`. **Tests:** `tasksRead.test.ts` (19): T7 every loader at cap/cap+1 and `listView` at 1,001 rows; index selection (pure plan per surface + views stay complete while another range is over the cap; closed paging); access matrix admin/assigned/via-parent/unassigned/other-org for `listView`, `getDetail`, `getByIdentifier`, `subtasks`, `pickerCandidates`, `markViewed`, `workspaceRefs` and the switched old queries; alias resolution; `taskUserState` fan-out/mute/delete-recount/reset + recompute parity + reseed backfill idempotency; adapter shape parity. Legacy fixtures in `notifications`/`planner`/`entryCategory` tests now insert edges + `statusCategory` (the shape the write path produces); planner gains a member-scope test. Checks: tsc clean; lint 62/45 = baseline, none in touched files; `npm test` 1516 passed / 4 failed (the same pre-existing 4; `taskActivityIndicators` still fails — it tests the pure `computeTaskIndicatorState`, which the adapter no longer calls). `npm run build` not run (no route changes). **Deviations:** (1) `listView` contract widened in §5.4: extra `hasMoreClosed` + resolved `spec` in the result, `closedLimit` (pagination by raising the limit, not a cursor) and `today` args, `"planner"` surface; spec filters are server-side scope, facets client-side; (2) behaviour changes from T1 on old queries: members' Planner panel lists only tasks they can read (was every org task); members get sub-tasks of assigned parents in `getSubtasks`/`getDetail`/comments/activity/attachments/timer/`listByProject`; `deleteImpact`/`activityIndicators`/`commentReactions`/`typingIndicators` gained the missing access checks; (3) `tasks.counts` and `tasks.list` are bounded (≤1,000 rows per category; a count can read 1,000); (4) `activityIndicators.hasAttachments` is always `false` (no reader); `hasUnseenSubtasks`/`unseenActivityCount` are derived from the state row + the last 20 events; (5) `getByIdentifier`/`getDetail`/`subtasks` return null (not throw) for missing/foreign/unreadable tasks; (6) `recomputeUserStates` cannot see mute history (after an unmute it counts the muted period). **Slice 3 must know:** use `api.tasks.queries.listView` + `api.workspaceRefs.get`; rows are id-based, resolve names client-side; `perUser` is sparse; pass `today`; `listView` excludes archived tasks (no archived view exists); grouping/sorting/facets are client-side, transient filters too (send only the saved spec's filters, or send the URL spec if it should narrow server-side); call `api.tasks.userState.markViewed` when a task opens (the old `taskViewReceipts.markViewed` already does); `SYSTEM_VIEWS` holds the default display settings per system view; `viewDefaults` is not read yet (slice 4). Scaling caveats: archived rows still occupy the category/project index ranges and count toward the cap; a member's edge read (2,000) includes closed tasks — both fine at MVP volume, revisit with an archived-aware or category-aware index if needed. Old `isVisibleTopLevelTask` removed (dead cache-based check). `agentMentions` still scans the org (agent tools, slice 7). |
| 3 | Table UI kit on /tasks | done — merged 2026-10-18 | `bff07a7` | **Review (orchestrator):** ff-merged; re-ran tsc (clean), lint 42/42 (below the 62/45 baseline, deleted files), `npm test` 1551/1555 (same 4 pre-existing); no Convex changes, no push needed. Browser-checked /tasks on the dev deployment (1440px, light, signed in): views, grouping, rows render, no console errors. Owner decisions on the review: U1 shell → slice 4 (§11.6); restore inline edit, drag reorder, inline add → new slice 4b (§11.7); mobile card list dropped. **Built:** `components/icons/` — `status-icon.tsx` (category + position pie from `workspaceRefs` `status.icon`, status palette colours, check/cross cut out with `--background`), `priority-icon.tsx` (D7 shapes in foreground tints), `nav-icons.tsx` (the prototype v4 Linear-style nav/toolbar set as `currentColor` SVG components). `components/task-view/` — `task-view.tsx` (container: `useViewState` → `api.tasks.queries.listView` (`viewKey` when unmodified, else `spec`; `closedLimit`; client `today`) + `api.workspaceRefs.get` → `row-model.ts` (resolve ids, client-side `sortRows`/`groupRows`) → table), `view-state.ts` + `use-view-state.ts` (`?view=` + display overrides `group`/`order`/`props`/`sub`/`empty`, only diffs vs the system spec are written, "modified" = non-empty diff; view switch pushes, display changes replace), `column-rules.ts` (registry metadata, §6.3 tracks, U3 `visibleColumnKeys`, grid template + min width) + `columns.tsx` (cell renderers), `task-table.tsx` (one CSS grid template shared by sticky header, sticky group headers and rows; sortable headers set the `order` override, clicking the active one resets), `task-row.tsx`, `group-header.tsx` (chevron, icon, name, muted count, "+" prefilled for status/project/assignee groups), `property-menus.tsx` (one Popover + Command anchored virtually to the opener: search, kbd hint, numbers pick with an empty search; status/priority close, assignee/labels toggle and stay open; bulk = applies to the selection), `selection-bar.tsx` (count, clear, Status/Priority/Assignee/Labels, Archive), `use-task-keyboard.ts` (C, J/K/↓/↑, Enter/Space open, X, S/P/A/L (on the selection when the focused row is selected), Y, Esc, ?), `shortcuts-dialog.tsx`, `view-tabs.tsx` (pill tabs, modified dot), `use-task-actions.ts`, `task-view-skeleton.tsx`. `/tasks` = `<Suspense><TaskView surface="tasks"/></Suspense>`; rows open the existing drawer/modal via `?detail=` (user pref, as before). In-row visuals reuse `CategoryBadge`, `ColoredPillBadge` (labels, colour dot), `UserAvatar` (photos), `InlineTimeCell`, `CommentPill` (red unread count since last visit, else muted total) + `InlineSubtaskRing`, unseen-update dot (`perUser.hasUnseenChanges`, `bg-primary`), shadcn `Button`/`Popover`/`Command`/`Checkbox`/`Dialog` + added shadcn `kbd` and `empty` (registry files imported a bogus `cn` package — fixed to `@/lib/utils`, no dependency added). **Deleted:** `components/tasks/{tasks-table,task-row,sortable-task-row,task-group,task-card,inline-add-task,inline-created-task-row,tasks-tabs,tasks-header,tasks-filter-bar,tasks-empty-state,bulk-toolbar,tasks-list-skeleton,task-preview-popover,subtask-hover-popover}.tsx`, `lib/hooks/use-task-filters.ts`, `lib/hooks/use-inline-draft-tasks.ts`, `lib/format-activity-subtitle.ts` (all only used by the old `/tasks`). `ActivityIndicator` type moved to `components/tasks/activity-indicators.tsx` (4 My Tasks imports repointed). `TaskFormModal` gained an optional `defaults` prop (group "+"). `api.d.ts` regenerated by `npm run build` (import order only). **Tests:** `components/task-view/__tests__/` — `use-view-state.test.ts` (URL ⇄ spec, invalid params, round trip, modified), `columns.test.ts` (U3 rules, registry order, defaults, grid/min width), `row-model.test.ts` (resolve, priority order, status/assignee grouping, empty-group scope). Checks: tsc clean; lint 42 errors / 42 warnings (baseline 62/45 — deleted files carried some; none in new files; `my-tasks-list.tsx` keeps its 6 pre-existing `react-hooks/refs` errors, only its import line changed); `npm test` 1551 passed / 4 failed (the same pre-existing 4); `npm run build` green (`/tasks` static). Browser-checked on the dev deployment (signed in): Active/Backlog/All tabs + URL, status menu click + number pick, J/K, S→3, X, selection bar + bulk priority menu, Esc, header sort → `?order=dueDate` + modified dot/Reset, group collapse, C → create modal, Enter → existing drawer. **Deviations / not carried over (by scope):** (1) no app-shell change (U1 grey canvas/sidebar icons are outside the §9 row): the view is an inset rounded panel inside the current layout; the nav icon set is built but not wired into the sidebar. (2) Category cell uses `CategoryBadge` — the category-coloured version of the `ColoredPillBadge` styling (5px pill + dot); `ColoredPillBadge` itself is tone-only (5 tones) and cannot show org category colours. (3) Editable in-row: priority, status, assignee, labels (menus) and the timer; category, client and due date are read-only in the row (edit in the drawer) — the old row edited them inline with dashed "Add" chips. (4) The old toolbar is gone until slice 4: search, filter bar, group-by dropdown, archived tab (listView never lists archived; archive has the undo toast, restore stays in the detail), inline add rows, drag reorder, mobile card list (the table scrolls horizontally), row "…" menu (duplicate/delete live in the drawer, archive in the selection bar). (5) Sun / "Add to today" (row + selection bar) and keys T, F are left for slices 5 and 4; Space = Enter until slice 6 adds the drawer/page mode. (6) Assignee menu toggles members (D1 multi-assignee) instead of Linear single-select; "No assignee" clears. (7) Bulk priority/labels/assignees run one `tasks.update` per task (bulkUpdate has no such actions); status and archive use `bulkUpdate` in chunks of 50; partial results toast "N updated · M skipped". (8) Drawer param stays `?detail=<taskId>` (§6.1 `?task=<identifier>` is slice 6). **Slice 4 must know:** add `filter` (and `layout`) params to `view-state.ts` (`OVERRIDE_PARAMS`, `parseOverrides`, `diffOverrides`, `writeViewParams` — tests in `__tests__/use-view-state.test.ts`); transient filters/facets must run client-side over `rows` (`convex/tasks/read.ts#matchesFilter` imports server code — do not import it into the client). Move the modified dot from the tab to the Display button (prototype) and drop the interim Reset button. `ViewTabs` takes `{key,name}` options — add saved views + scope icons there. `PropertyMenu` is one popover with a virtual anchor (`{kind, taskIds, anchor}`) — reuse it for board cards. `CELL_RENDERERS` are per column; a board card can reuse them. Group collapse is in-memory per `view|groupBy|groupKey`. Keyboard overlay detection keys off Radix `data-state="open"` — the old drawer is always mounted with `role="dialog" aria-modal` (do not select on `aria-modal`), and list keys are disabled while `?detail=` is set. The legacy reference-data block (4 old queries) stays in `task-view.tsx` only for the drawer/modal/`TaskFormModal` (slices 6/7). Panel height is `calc(100svh-7rem)` (dashboard header + padding). |
| 4 | Views + board + shell | done — merged 2026-10-18 | `61c2976` + `e624a10` + `bff0067` + `ba87f99` | **Review (orchestrator):** ff-merged; re-ran tsc (clean), lint 42/42 (baseline), `npm test` 1579/1583 (same 4 pre-existing); no schema change; functions pushed to dev. Live-verified on dev (1440px, light, admin): board layout + shell render, no console errors; created a personal view from a modified board (tab + sidebar Saved Views entry, persists across reload), then deleted it via the tab menu. **Open item (owner):** U4 says the running timer also shows in the sidebar, but no sidebar timer exists (only the floating widget) — not built by any slice yet. **Built (backend):** `convex/tasks/views.ts` — `list({surface})` (workspace views then the caller's personal views, by position; effective system-view specs with `viewDefaults` applied; `customizedDefaults`; `canManageWorkspace`), `create` (personal for everyone, workspace admin-only; end of scope; ≤50 per scope), `update` (rename / re-save spec), `remove`, `reorder({viewId, afterId})` (inside its scope only), `setDefault` / `resetDefault` (admin, system views; display settings only), `resolveSystemViewSpec` (used by `listView`'s `viewKey` path, so system views read `viewDefaults`). Org/role from `getAuthContext`; every id read checks org + owner (another user's personal view is "not found", also for admins). `tasks/model.ts`: `normalizeViewSpec` (filter operator/value rules, ≤20 filters, ≤100 values, dedupe props, drop `statusIcon`), `normalizeViewName` (1–60), `systemDefaultSpec`, `NONE_FILTER_VALUE`, caps. `convex/tasks/filters.ts`: the pure filter matcher moved out of `read.ts` (re-exported there) and shared with the client; adds `none` matching; `planListLoad` ignores a pinned `none`. **Built (UI, `components/task-view/`):** `view-state.ts` rewritten for saved views — `ViewOption` (system/workspace/personal), `resolveView`, scope vs chips split, `filter` (repeatable, `prop.op.v1,v2`; `filter=` = explicit none) and `layout` params, `q` search param, `paramsForView`, `listViewQueryFor` (system view by key; else scope + `showSubtasks` with display fields pinned so display/chip changes never re-subscribe); `use-view-state.ts` (`useViewState` loads `views.list` via `useQueries` so a failure degrades to system views; `useViewActions`: save, save as new, rename, delete, move, set/reset default for everyone); `view-tabs.tsx` (system → workspace (globe) → personal (lock) pills; click the active tab for its menu: Rename, Duplicate as new view, Restore original default (admin, customized system view), Delete; drag to reorder inside the group; "New view" icon button); `view-dialog.tsx` (create/rename, Personal/Workspace segmented); `display-menu.tsx` (U6: List/Board, Grouping/Columns, Ordering, Show sub-tasks, Show empty groups/columns, property toggles, Reset · Save as new view · Save (editable saved view) · Set default for everyone (admin, system + workspace views); round button carries the modified dot — interim Reset button and tab dot removed); `filter-model.ts` (chips, search, facets over the rows passing the OTHER chips, incl. New comments; toggle/remove/labels) + `filter-menu.tsx` (round F button → two-step Command menu with faceted counts; quiet `bg-muted` chips that reopen their value list, ×, "+ Filter", Clear); `search-box.tsx` (`/`, title + identifier, debounced into `?q=`); `board-model.ts` (`boardMoveFor`, `canDragOnBoard`) + `task-board.tsx` + `board-card.tsx` (columns by grouping, cards reuse `CELL_RENDERERS`, no ID, never the column's property; drag between columns → `setStatus` / `setPriority` / `tasks.update` assignees·labels·project·workCategory; pointer + keyboard sensors); `segmented.tsx` (shared segmented ToggleGroup). Keyboard: F filter, / search. `useTaskActions.patchTask`; `GroupIcon` exported. **U1 shell (§11.6):** `AppSidebar variant="inset"` (grey canvas = `--sidebar` token, accent/border retuned), `SidebarInset` ring + `overflow-clip` (rounded without breaking window-sticky headers), header `h-12`, layout drops its padding for `[data-full-bleed]` pages (the task view fills the panel), open inbox = its own inset panel; nav icon set wired via `lib/navigation.ts` (+ new `DashboardNavIcon`, `WorkdayNavIcon`, `SettingsNavIcon`, `ChevronLeftNavIcon`), Inbox icon; sidebar "Saved Views" placeholder replaced by `nav-saved-views.tsx` (the caller's task views as links; hidden when none). **Tests:** `convex/__tests__/tasksViews.test.ts` (12: access matrix admin/member/member2/other-org × personal/workspace incl. update/remove/reorder refusals, unauthenticated; list order + per-surface; reorder; per-scope cap; spec validation on create/update; normalisation; defaults set/update/reset read by `views.list` and `listView` incl. other-org isolation and `showSubtasks` reaching the loader; shared matcher `me`/`none`/dates/new comments); `components/task-view/__tests__/use-view-state.test.ts` rewritten (22: views, filter params, draft ⇄ URL, modified, listView args) + `filter-model.test.ts` (search, chips, facets, board moves, member drag policy). **Checks:** tsc clean; lint 42 errors / 42 warnings = baseline, none in touched files; `npm test` 1579 passed / 4 failed (the same pre-existing 4); `npm run build` green. **Browser (port 3014, signed in, dev deployment = slice 0–3 backend):** shell on /tasks, /projects, /planner, /my-tasks, /billing + open inbox; filter menu (F) → Status facet counts → chip + `?filter=` + modified dot; Clear; Display menu → Board (`?layout=board`); board by status and by assignee; board drop via keyboard drag changed a task's status (reverted via the status menu); search `/` → `?q=`; tab select + active-tab menu; New view dialog. Not verifiable live (views module not deployed — `tasks/views:create` "Could not find public function", which also shows `convex codegen` did not push): saving/renaming/deleting/reordering views, set/reset default, sidebar saved views — covered by convex-test. Pointer drag on the board could not be driven by the pane's synthetic events (drag start verified; drop verified with the keyboard sensor). Screenshots: notes folder `slice-4-*.jpg`. **Schema:** unchanged. **Deploy:** push functions after merge (new `tasks/views.ts`, `tasks/filters.ts`); no reseed. `api.d.ts` regenerated by `convex codegen`. **Deviations:** (1) §4.4/§5.4 refined (written above): system-view defaults store display settings only; scope vs chips split — a saved view's non-category filters run client-side; `none` filter value; search transient. (2) Filter menu offers Status, Priority, Assignee, Labels, Project, Client, Category, Created by, New comments; no date filters in the menu (saved date filters render as read-only chips). (3) Board: "No grouping" shows status columns; status columns always shown (drop targets); Client boards are read-only (derived), Project/Category boards draggable for admins only (D5); multi-value columns (assignee/label) swap the source value for the target, the "No …" column clears it; no collapse/selection on the board. (4) View tab menu opens by clicking the active tab (no context menu component in the kit); reorder by drag only. (5) Admin affordances use the Clerk role (`useIsAdmin`), the server enforces. (6) There was no running-timer indicator in the sidebar in this checkout (only the floating timer widget, unchanged) — nothing to keep or move. (7) Sidebar "Saved Views — No saved views yet" placeholder removed; the group appears once a view exists. (8) Header is `h-12` on every dashboard page (was 16 → 12 when collapsed). (9) Board card redesigned after owner feedback (2026-10-18, references: Linear + Notion board cards): a vertical stack with one job per row and generous padding (14px) — row 1 client name (muted) + assignee photos right (Linear's ID/avatar row; no task ID, U3); row 2 status icon + title (14px medium, up to 3 lines); row 3 property chips, one value each, quiet `bg-secondary` fill, no border (priority icon chip only when set — opens the priority menu; category = the tinted `CategoryBadge`; labels ≤2 + "+N"; due (destructive when overdue); estimate; sub-task ring); row 4 activity — tracked time (timer cell) left, comments right (red when unread) — only when there is some. Starting a timer on a card without tracked time: Y or the detail. Columns 19rem. `AssigneeAvatars` and `formatDue` are shared from `columns.tsx`. **Slice 4b must know:** cells are shared by the row and the board card (`CELL_RENDERERS`) — inline editors for category/client/due will appear on cards too unless gated (cards keep labels hidden when empty); list drag reorder should only be offered with `orderBy: "manual"` and no grouping by a non-status property, and neighbour keys come from the visible (chip/search-filtered) rows — decide whether reorder is disabled while chips/search are active; dnd-kit here is `@dnd-kit/react` with a 5px pointer distance (a click still opens) + `KeyboardSensor` on the board — the list keyboard hook ignores events the sensor `preventDefault`s; the board's `DragDropProvider` is separate from any list provider; inline add should reuse `createInGroup` (status/project/assignee prefill) and the board column "+"; URL params owned by the view state: `view`, `layout`, `group`, `order`, `props`, `sub`, `empty`, `filter` (repeatable), `q`; `listViewQueryFor` keeps the subscription stable across display changes — do not add display fields to the server args. |
| 4b | Row editing restored | not started | | |
| 5 | My Tasks | not started | | |
| 6 | Detail | not started | | |
| 7 | Project tab, settings, cleanup | not started | | |
