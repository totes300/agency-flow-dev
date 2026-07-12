# Agency Flow — TODAY, My Tasks & Planner UX/Product-Logic Review Specification

## Assignment

Act as a senior product designer and staff product engineer specializing in
high-frequency productivity software. Review Agency Flow's complete daily work
planning loop — My Tasks, TODAY, Earlier, shared task lists, task detail and the
Planner — and produce an implementation-ready redesign and logic-correction
plan.

Apply the level of restraint, hierarchy, information density and interaction
clarity expected from a senior designer of a mature product such as Notion,
Linear or Things. Do not copy those products visually. Use their standard of
craft: the primary action is obvious, secondary metadata stays quiet, repeated
work is fast, and the product behaves exactly as the user predicts.

This surface is used throughout every workday. Small friction, visual noise or
planning ambiguity compounds across every employee and project. Treat an
incorrect scheduling target as a product-integrity failure, not merely a UX
imperfection.

This assignment is **review and redesign specification only**. Do not modify
application code, schema, tests, configuration or data. You may create the
required deliverables only under:

```text
docs/fable-to-review/results/today-planner-ux/
```

The output must be detailed enough that a separate implementation agent can
execute it without reopening fundamental product decisions.

## Required repository precautions

Before reviewing:

1. Read the repository-root `AGENTS.md` and `CLAUDE.md` completely.
2. Read `convex/_generated/ai/guidelines.md` before inspecting or reasoning
   about Convex queries and mutations.
3. Read relevant version-matched Next.js documentation under
   `node_modules/next/dist/docs/` before evaluating routing, rendering or
   client/server behavior.
4. Read `docs/today-planner-prd.md` completely, but treat the product-owner
   decisions in this specification as newer and overriding where they conflict.
5. Treat the worktree as shared and potentially dirty.
6. Never run destructive Git commands, reformat unrelated files or overwrite
   existing work.
7. Do not change application behavior during the review.
8. Use synthetic data only for interaction testing.
9. Record commit, branch and `git status --short` in review metadata.
10. Prefer exact code references, screenshots, measured dimensions and
    reproducible interaction traces over subjective claims.

## Primary question

Can an agency owner plan the right work for the right people, and can every
team member open My Tasks and immediately understand what to do today — without
visual clutter, duplicated tasks, hidden scheduling side effects or accidental
planning onto the wrong person?

The answer must cover both:

1. **Product correctness:** which person's plan segment is created by every
   scheduling gesture and why.
2. **Daily usability:** whether TODAY is a calm, fast, trustworthy execution
   surface under realistic task volume.

## User-provided problems to treat as first-class requirements

The review must directly resolve all of these:

1. Status and metadata tags such as Inbox, Next up and In progress are visually
   too large and consume too much vertical and horizontal space.
2. An admin clicking “Add to TODAY” currently adds the task to the admin's own
   plan instead of the assigned person's plan.
3. Planning from the Planner must result in the intended assignee seeing the
   task in their My Tasks -> TODAY list for that date.
4. My Tasks is too dense and shows too many workflow groups for a surface used
   as the daily checklist.
5. TODAY and a collapsible Earlier section should be the default focus.
6. In progress and other status groups must be switchable off and should not
   dominate the default experience.
7. The My Tasks navigation icon and count badge may not be in the right place or
   carry the right visual weight; review and redesign them as part of the whole
   information architecture.
8. The result must stay powerful for admins while remaining calm for members.

## Locked product decisions

These are not open questions. The reviewer must work within them.

### D1. TODAY is a per-person daily plan, not a workflow status

`planSegments` remains the source of truth. A task appears in a person's TODAY
when that person's segment covers the organization-date being viewed.

Do not reintroduce a “Today” task status or maintain a second boolean/tag as
duplicated state.

### D2. Assignment and planning are different but connected

- Assignment answers: **Who owns or is expected to execute this task?**
- Planning answers: **Who is scheduled to work on it on which date?**
- A plan segment must always have an explicit target person.
- Scheduling must not silently rewrite task assignment.
- The default scheduling target should follow assignment in admin planning
  workflows.
- Explicit scheduling to another person remains possible where the UI clearly
  identifies that person.

### D3. Admin “Add to TODAY” targets the assignee, not the acting admin

When an admin invokes “Add to TODAY” from an organization-wide context such as
the shared Tasks list, bulk toolbar, task detail or Planner task inbox, the
system must not silently plan the task for the admin.

Target resolution is:

```text
Exactly one assignee
  -> add the task to that assignee's TODAY

Multiple assignees
  -> show a lightweight target chooser listing the assignees
  -> require or clearly confirm the selected people
  -> never silently select the acting admin merely because they clicked

No assignee
  -> require “Assign and plan” or an explicit planning-person choice
  -> never silently plan it for the acting admin
```

The reviewer must recommend whether multiple-assignee default selection should
be “all assignees” or “none until selected,” based on the lowest risk of
accidental over-scheduling. The UI must always show the chosen outcome before
commit.

### D4. Personal self-scheduling remains intentionally self-scoped

When a member acts inside their own My Tasks/TODAY context, “Add to TODAY” or
“Move to TODAY” targets that member. This is the explicit personal workflow and
must remain fast and one-click.

An admin deliberately viewing another person's My Tasks must see whose day is
being edited, and actions must target that viewed person rather than the admin.

### D5. Explicit Planner row is an explicit target

Dragging or drawing on a named person's Planner row schedules that person. The
row target is an intentional override and may differ from task assignment.

However:

- the dragged card must show assignee information;
- assignee-compatible rows should be visually easy to find;
- dropping onto a non-assignee row must provide clear feedback;
- the created segment's `userId` must match the visible destination row;
- the task must appear in that row owner's My Tasks/TODAY on the covered date;
- no task assignment change may happen silently.

The reviewer must decide whether a subtle warning, confirmation or post-drop
undo is the least disruptive mismatch treatment. Do not block legitimate
cross-assignee planning without product evidence.

### D6. My Tasks defaults to a calm daily execution view

The default visible hierarchy is:

```text
TODAY
  today's planned tasks

EARLIER
  planned but unfinished tasks from the recent window
  collapsible

Optional workflow groups
  hidden or collapsed by default
  user-configurable

Completed today
  quiet and collapsed when nonessential
```

TODAY must be the obvious primary surface. “In progress,” “Next up,” “Inbox”
and other workflow-status groups must not all compete with it by default.

### D7. Earlier remains honest planning history

Earlier items are not automatically carried into TODAY. Users may explicitly
move them to today or leave them behind. Earlier must be collapsible and its
open/closed state should be stable enough not to create repeated daily friction.

### D8. Information density must be deliberate

Task title and completion/timer actions are primary. Status, project, client,
category, due date, comment count, assignee mismatch and planning state are
secondary and must earn their space.

Do not solve density by making everything tiny or low contrast. Use hierarchy,
progressive disclosure, consistent columns and contextual visibility.

### D9. No decorative motion tax

This is a high-frequency work surface. Reordering, checking, opening, timing
and planning must feel immediate. Use motion only when it explains spatial or
state change, and respect reduced-motion preferences.

## Explicit supersession of the existing PRD

`docs/today-planner-prd.md` currently specifies that shared “Add to TODAY” and
bulk actions are self-scoped and plan for the caller. That rule is superseded
for admin organization-wide planning contexts by D3 and D4 above.

The review must produce an exact PRD amendment identifying every outdated user
story, implementation decision, comment, mutation contract and test assertion.
Do not leave contradictory documentation in the proposed end state.

The following existing principle remains valid:

```text
planSegments drive TODAY membership; planning is per person and per date.
```

The changed principle is:

```text
Old: every Add to TODAY action means “plan for me.”
New: target depends on explicit context; admin shared planning defaults to the
     assignee, personal My Tasks planning targets the viewed/self user, and a
     Planner row explicitly targets that row's person.
```

## Core experience model

The reviewer must map this end-to-end loop:

```text
Admin triages shared work
  -> sees task title + assignee + essential context
  -> chooses Add to TODAY / bulk Add / Planner date
  -> system resolves or asks for target person
  -> creates target-person planSegment
  -> gives specific confirmation: person + date + task count
  -> target person's My Tasks updates reactively
  -> task appears once in TODAY
  -> member works, times and completes/reviews task
  -> task leaves active TODAY as defined
  -> overdue planned work appears quietly in Earlier
```

Every step must be inspectable. A toast saying only “Added to today” is
insufficient in an admin context; it must say whose day changed.

## Architecture and file inventory

This is a starting inventory, not an allowlist. Follow imports and shared
components wherever TODAY membership, scheduling target or row density is
affected.

### Product documentation and domain model

- `docs/today-planner-prd.md`
- `docs/today-tab-prd.md`
- `convex/schema.ts`, especially `tasks`, `users`, `orgMembers` and
  `planSegments`
- `convex/lib/todayPlan.ts`
- `convex/lib/myTaskHelpers.ts`
- `convex/lib/plannerMath.ts`
- `lib/planner.ts`
- `lib/reorder.ts`

### TODAY and My Tasks backend

- `convex/myTasks.ts`
- `convex/planner.ts`
- `convex/tasks.ts`
- `convex/users.ts`
- `convex/orgSettings.ts`
- `convex/timeEntries.ts`
- `convex/timer.ts`
- `convex/lib/auth.ts`
- all Today, Planner and My Tasks tests

At minimum trace:

- `planner.weekGrid`
- `planner.taskPanel`
- `planner.taskSegments`
- `planner.myTodayTaskIds`
- `planner.createSegment`
- `planner.updateSegment`
- `planner.removeSegment`
- `planner.createTaskWithSegment`
- `planner.addToToday`
- `planner.bulkAddToToday`
- `planner.removeFromToday`
- `planner.reorderTodayTask`
- `planner.createTodayTask`
- `myTasks.listMyTasks`
- `myTasks.myTasksCount`
- `users.updateMyTasksSettings`
- `orgSettings.updateDefaultMyTasksStatusIds`

### My Tasks frontend

- `app/(dashboard)/my-tasks/page.tsx`
- `app/(dashboard)/my-tasks/loading.tsx`
- `components/my-tasks/my-tasks-header.tsx`
- `components/my-tasks/my-tasks-list.tsx`
- `components/my-tasks/my-tasks-group.tsx`
- `components/my-tasks/my-task-row.tsx`
- `components/my-tasks/today-earlier-section.tsx`
- `components/my-tasks/view-settings-dropdown.tsx`
- `components/my-tasks/my-tasks-inline-add.tsx`
- `components/my-tasks/my-tasks-empty-state.tsx`
- `components/my-tasks/my-tasks-skeleton.tsx`
- `components/my-tasks/my-tasks-sortable-row.tsx`
- `components/my-tasks/completion-checkbox.tsx`
- `components/my-tasks/daily-notes-panel.tsx`
- `components/my-tasks/date-navigator.tsx`
- `components/add-to-today-button.tsx`
- task detail modal/drawer consumers

### Shared Tasks surfaces

- `components/tasks/task-row.tsx`
- `components/tasks/sortable-task-row.tsx`
- `components/tasks/bulk-toolbar.tsx`
- `components/tasks/task-property-pickers.tsx`
- `components/tasks/task-detail-metadata.tsx`
- `components/planner/task-plan-section.tsx`
- every `AddToTodayButton` consumer

### Planner frontend

- `app/(dashboard)/planner/page.tsx`
- `components/planner/planner-grid.tsx`
- `components/planner/planner-row.tsx`
- `components/planner/planner-bar.tsx`
- `components/planner/planner-task-panel.tsx`
- `components/planner/planner-task-card.tsx`
- `components/planner/planner-toolbar.tsx`
- `components/planner/planner-panel-filters.tsx`
- `components/planner/planner-quick-add.tsx`
- `components/planner/planner-create-form.tsx`
- `lib/hooks/use-planner-drag.ts`
- `lib/hooks/use-planner-mutations.ts`
- `lib/hooks/use-planner-query-args.ts`

### Navigation and shared visual primitives

- `components/app-sidebar.tsx`
- `lib/navigation.ts`
- `components/sidebar-count-badge.tsx`
- status/category badge and avatar components
- inline timer and activity-indicator components
- spacing, typography, color and border tokens
- responsive layout and task detail providers

## Mandatory current-state discovery

Before recommending changes, produce a complete surface/gesture inventory.

For each gesture record:

| Field | Required content |
|---|---|
| Surface | My Tasks, Tasks, task detail, Planner panel/grid, bulk action |
| Actor | Member, admin, admin viewing another user |
| Task assignment | One, multiple or none |
| Visible label | Exact action copy and affordance |
| Current mutation | Function and arguments |
| Current target | Whose `planSegments.userId` is written |
| Intended target | According to D3–D5 |
| User feedback | Toast, preview, avatar, target name, undo |
| My Tasks result | Which person's TODAY changes |
| Risk | Wrong person, duplicate, hidden effect, ambiguous |
| Verdict | Correct, incorrect, unclear |

Inventory at minimum:

1. Sun action on a shared task row.
2. Sun action on a My Tasks workflow-status row.
3. Move-to-TODAY from Earlier.
4. Remove from TODAY.
5. Task detail “Add to today.”
6. Shared Tasks bulk “Add to TODAY.”
7. Planner task-panel drag onto a person/date.
8. Move an existing Planner segment across people.
9. Copy/split a Planner segment.
10. Draw-to-create on a Planner row.
11. Inline-create inside TODAY.
12. Admin viewing another person's My Tasks.
13. Member self-scheduling from Planner.
14. Scheduling a task already planned for one or more target people.

## Scheduling-target resolution matrix

The reviewer must validate and refine this required model:

| Context | Actor | Assignment | Required target behavior |
|---|---|---|---|
| Own My Tasks | Member/admin | Any | Acting/viewed person |
| Another person's My Tasks | Admin | Any | Viewed person, visibly named |
| Earlier -> Move to TODAY | Member | Any | Current My Tasks owner |
| Shared Tasks row | Admin | One assignee | That assignee |
| Shared Tasks row | Admin | Multiple | Explicit assignee chooser |
| Shared Tasks row | Admin | None | Choose person or assign-and-plan |
| Shared Tasks bulk | Admin | Mixed | Per-task target preview and exception handling |
| Task detail | Admin | One assignee | That assignee, named in action/confirmation |
| Task detail | Admin | Multiple/none | Explicit target chooser |
| Planner panel -> named row | Admin | Any | Destination row owner |
| Existing segment -> named row | Admin | Any | Destination row owner |
| Planner on own row | Member | Any | Member's own row only |
| Inline create in own TODAY | Member/admin | N/A | Create assigned + planned to current My Tasks owner |

The review must specify exact behavior for:

- tasks assigned to two or more people;
- a task whose assignee was removed from the organization;
- unassigned tasks;
- already-planned tasks;
- one assignee already planned but another not planned;
- a task planned to a non-assignee intentionally;
- archived or completed tasks;
- bulk selection containing mixed target cases;
- admin acting while viewing another person's context;
- organization switching during an operation.

## Product and data invariants

Give each invariant an explicit verdict: **Proven**, **Violated**, **Unclear**
or **Not applicable**. Cite code and interaction evidence.

### P1. Single planning primitive

TODAY membership is derived only from `planSegments`. UI redesign must not
create parallel Today state.

### P2. Correct target identity

Every plan mutation writes the intended person's `userId`, independent of the
acting user's ID unless self-scheduling is explicit.

### P3. Visible target before commit

In admin contexts, the user can determine whose TODAY will change before the
operation commits.

### P4. Honest confirmation

Success feedback states person, date and result. Example:

```text
Added “Prepare kickoff deck” to Anna's Today.
```

Bulk confirmation reports exact outcomes and exceptions, not just a total.

### P5. Idempotency is per task/person/date

Adding the same task for the same person and date twice creates no duplicate.
The same task may legitimately be planned for different people or dates.

### P6. Explicit row wins

A Planner drop into Anna's row writes Anna's segment, even if assignment names
someone else. The mismatch remains visible and reversible.

### P7. Assignment does not change silently

Creating, moving, resizing, splitting or removing a segment does not modify
`task.assigneeIds` unless the user explicitly chooses a combined assign-and-
plan action.

### P8. TODAY/My Tasks consistency

Immediately after a segment is created for a date/person, that person's My
Tasks for that organization-date shows the task exactly once.

### P9. Planner/My Tasks consistency

Every TODAY row can be explained by at least one covering segment, and every
eligible covering segment is represented in the correct person's TODAY.

### P10. Correct organization date

All planning and TODAY membership uses the organization timezone, not browser
local time, including date navigation and midnight rollover.

### P11. Earlier integrity

Earlier contains recent planned-but-unfinished items according to a documented
window. Moving to TODAY creates a new explicit current segment without erasing
historical plan evidence.

### P12. Removal scope

Removing from TODAY changes only the current/viewed target person's covering
segments and preserves other people's segments and non-today portions.

### P13. Permissions

Members can alter only their own plan. Admins may plan for organization
members. UI behavior and server authorization agree.

### P14. Stable ordering

Manual TODAY order is per person, survives reactive updates and does not get
corrupted when multiple covering segments exist.

### P15. Completion behavior

Completing or submitting a task moves it out of active TODAY according to one
clear rule and does not destroy its planning history.

### P16. No hidden duplicate presentation

A task in TODAY is not repeated as a full row in default status groups. Any
optional cross-reference is quiet and explanatory.

## Mandatory My Tasks information-architecture review

The reviewer must compare the current hierarchy with the locked target:

```text
Current impression from the supplied screenshot:
  My Tasks title + settings + time
  Today
  Earlier
  In progress and potentially other status groups
  Daily Notes column
  persistent navigation counts

Target default:
  clear daily header
  Today as the dominant checklist
  compact collapsible Earlier
  optional/collapsed workflow groups
  Completed today quietly accessible
  Daily Notes integrated without stealing focus
```

Answer:

1. Should the page label be `My Tasks`, `Today`, or a two-level combination?
2. Should the current date be more prominent than the generic page title?
3. Which status groups are hidden, collapsed or configurable by default?
4. Should the settings control use a gear, a labeled View control or a command
   menu?
5. Where should total tracked time appear so it is understandable but quiet?
6. Should Daily Notes remain a fixed 480px column, become resizable/collapsible,
   or use another pattern?
7. How should an admin switch to another person's day without confusing self-
   scheduling semantics?
8. How should TODAY, Earlier and Completed respond to empty states?
9. Which open/collapsed states should persist per user?
10. What is the narrow/mobile hierarchy?

Provide one recommended model, not a menu of unresolved alternatives.

## Mandatory row-density and visual-hierarchy review

Measure the rendered interface at representative desktop and laptop widths.
For every row, tag and group header capture:

- total row height;
- title line height and weight;
- primary/secondary column widths;
- tag height, padding, radius and gap;
- metadata wrap/truncation behavior;
- timer, comment and avatar hit areas;
- separator contrast;
- number of simultaneous colors/shapes;
- hover-only controls and keyboard/touch equivalents.

The redesign must follow these principles:

### V1. Title dominates

The task title should be the first readable object in a row. Metadata must not
have equal visual weight.

### V2. Status is not a large decorative tag

Inbox, Next up and In progress should use the smallest honest representation:
for example a colored dot plus quiet text, or a compact micro-badge where a
boundary is needed. Avoid oversized pill geometry and repeated tinted blocks.

### V3. One quiet metadata line

Prefer a single predictable secondary line or aligned metadata region. Define
priority and overflow rules rather than displaying every field equally.

Recommended priority for validation, not blind implementation:

```text
Due/overdue risk
  > assignee/planning mismatch
  > project/client context
  > workflow status
  > category
  > low-frequency metadata
```

### V4. Progressive disclosure

Rare actions may appear on row hover/focus or in a compact menu, but essential
touch and keyboard actions must remain discoverable.

### V5. Stable alignment

Checkbox, title, activity, timer and overflow controls should occupy stable
columns so scanning does not zigzag.

### V6. Density without fragility

Compact rows must retain usable hit targets, focus visibility, readable
contrast and support for long Hungarian/English labels and user-generated task
titles.

### V7. Color earns meaning

Use color for status, urgency, active timing and meaningful state. Do not let
project/category/status/assignee all compete as saturated tags.

### V8. Whitespace supports the task list

The supplied desktop screenshot leaves a large unused central/right area while
the task rows are constrained. Evaluate whether the current `max-w-3xl`, page
padding and fixed Daily Notes width produce the right balance at 1280, 1440 and
wide screens.

## Required visual before/after table

For every material UI issue, use this format:

| Before | After | Why |
|---|---|---|
| Large tinted status pill consumes metadata line | Compact status dot + text, or smaller badge with measured height | Restores title hierarchy and reduces vertical noise |

Include exact component reference, current measurement and target measurement
where practical. Do not write “make it cleaner” without specifying what
changes and why.

## Navigation badge and icon review

The reviewer must not assume the current My Tasks sidebar badge is correct.
Evaluate:

- what the number currently counts;
- whether users interpret it as overdue, assigned, unread or today's remaining
  plan;
- whether the same red badge language is also used for notifications/invoices;
- whether a neutral count, progress indicator, no badge or another location is
  more honest;
- whether the icon communicates personal daily work;
- whether the sidebar duplicates a clearer in-page Today count;
- zero-state behavior;
- update timing when tasks complete, move to Earlier or are replanned;
- accessibility label and screen-reader meaning.

Make one recommendation and define its exact count semantics. The badge must
not create anxiety through notification styling if it represents planned work
rather than an alert.

## Planner experience review

Review the Planner as the admin's team-scheduling workspace, not only as a
calendar grid.

### Required questions

1. Can the admin immediately locate the assignee's row before a drop?
2. Does a task card show current assignee(s) before dragging?
3. Does the drag preview show person and date, not only bar geometry?
4. Is the drop target visually unambiguous at high row density?
5. What happens when the task is unassigned or has multiple assignees?
6. Is there a one-click “plan for assignee today” shortcut in addition to drag?
7. Does an intentional non-assignee drop communicate the mismatch?
8. Does the target member's My Tasks update immediately?
9. Can the admin undo a mistaken drop or cross-row move?
10. Is keyboard-accessible scheduling possible or at least specified?
11. Are completed, archived and already-planned tasks represented honestly?
12. Does mobile/tablet provide a usable non-drag alternative?

### Required Planner target feedback

During admin drag, display or specify a preview equivalent to:

```text
Anna Kovács · Today, Jul 12
Prepare kickoff deck
```

After commit, feedback must state the same target and offer undo where safe.

## Interaction and motion review

Because this view is used tens or hundreds of times daily:

- checking, opening, timing and keyboard navigation should be immediate;
- collapse/expand may use a short, interruptible transition only if it improves
  orientation;
- drag must follow the pointer without lag and give a stable target preview;
- avoid celebratory or decorative motion on routine actions;
- completion celebration must not block continued work;
- respect `prefers-reduced-motion`;
- focus must move predictably after add, complete, remove, reorder and undo;
- optimistic UI must roll back visibly on mutation failure.

Document every animation over 200ms and justify it. Do not animate keyboard-
initiated list navigation.

## Accessibility and input-method review

Test and specify:

1. Complete keyboard traversal of header, groups and task rows.
2. Opening task detail with Enter/Space without triggering nested actions.
3. Completion, timing, Add/Remove TODAY and overflow actions by keyboard.
4. Visible focus indicators in normal and dimmed Earlier rows.
5. Screen-reader names for icon-only controls.
6. Collapsible group `aria-expanded` and relationship to content.
7. Status conveyed by text, not color alone.
8. Touch behavior where hover actions do not exist.
9. Minimum practical hit areas even in compact density.
10. Drag-and-drop alternative for keyboard and mobile users.
11. Contrast of low-opacity metadata and Earlier rows.
12. Zoom at 200% and long-content reflow.

The current use of very low opacity must be tested rather than assumed
accessible.

## Responsive scenarios

Review at minimum:

- 1280 x 720 laptop;
- 1440 x 900 desktop;
- wide desktop similar to the supplied screenshot;
- 1024px tablet landscape;
- 390px mobile;
- 200% browser zoom.

For each, capture the hierarchy, visible task count above the fold, Daily Notes
behavior, truncation, action discoverability and scroll model.

The redesign must avoid making a wide desktop feel empty while also avoiding a
cramped laptop layout.

## Mandatory functional scenarios

Use at least these identities:

```text
admin_A
member_Anna
member_Bela
```

And these tasks:

```text
T1 assigned only to Anna
T2 assigned only to Bela
T3 assigned to Anna and Bela
T4 unassigned
T5 assigned to Anna, already planned for Anna today
T6 assigned to Anna, planned for Bela today
T7 archived
T8 completed/reviewed today
T9 with a multi-day Anna segment spanning today
T10 with an Earlier Anna segment
```

Exercise:

### Admin shared-task actions

1. Add T1 to TODAY -> Anna, never admin_A.
2. Add T2 to TODAY -> Bela.
3. Add T3 -> explicit multi-person behavior.
4. Add T4 -> explicit person or assign-and-plan flow.
5. Add T5 -> honest already-planned result.
6. Add T6 -> clarify whether adding Anna creates a second legitimate plan.
7. Add T7 -> rejected.
8. Bulk add T1–T7 -> preview, per-task results and no silent admin targets.

### Personal My Tasks actions

9. Anna adds a visible workflow task -> Anna.
10. Anna moves T10 from Earlier -> Anna, old segment retained.
11. Anna removes T9 from TODAY -> correct trim/split, other users untouched.
12. Admin viewing Anna's My Tasks adds a task -> Anna with visible context.

### Planner actions

13. Admin drags T1 onto Anna today -> Anna sees it in TODAY.
14. Admin drags T1 onto Bela today -> explicit mismatch feedback; Bela sees it.
15. Admin drags T3 onto each assignee -> independent idempotent segments.
16. Admin drags T4 -> destination row is explicit target, assignment unchanged.
17. Member drags onto own row -> allowed.
18. Member attempts another row -> UI prevents and server rejects.
19. Admin moves a segment across rows -> source and target My Tasks update.
20. Admin moves today's segment to tomorrow -> disappears from TODAY and is
    present on the correct Planner date.

### Time/date and reactive behavior

21. Org and browser timezones differ near midnight.
22. Date navigator views yesterday/tomorrow.
23. Two browser sessions observe the same person's plan.
24. Concurrent double click/drop remains idempotent.
25. Mutation failure rolls back preview and gives actionable feedback.
26. Organization switch cannot apply an operation to the prior org.

## Required My Tasks content scenarios

Evaluate realistic states, not only a small demo:

1. Empty TODAY, no completed tasks.
2. Empty TODAY after finishing all work.
3. Three TODAY tasks, no Earlier.
4. Ten TODAY tasks with long titles and mixed metadata.
5. Five TODAY plus fifteen Earlier tasks.
6. Multiple optional workflow groups containing 50+ tasks.
7. Active timer on a TODAY row.
8. Overdue due dates and unread comments.
9. Assignment mismatch.
10. Missing project/category/status metadata.
11. Loading, partial loading and mutation pending.
12. Backend error/offline/reconnect.

Measure how many primary rows remain visible above the fold before and after the
proposed redesign.

## Required design artifacts

The reviewer must deliver a coherent target, not disconnected comments.

### Target screen hierarchy

Specify exact ordering and default state for:

- page/date header;
- TODAY header and summary;
- TODAY rows;
- inline add;
- Earlier;
- Completed today;
- optional workflow groups;
- Daily Notes;
- view/person controls.

### Component anatomy

Provide annotated anatomy for:

1. TODAY task row.
2. Earlier task row.
3. Optional workflow-group row.
4. Group header.
5. Add-to-TODAY action for self.
6. Add-to-TODAY action for an admin and assignee.
7. Multi-assignee target chooser.
8. Planner task card and drag preview.
9. My Tasks navigation item/badge.

For each identify primary, secondary, contextual and hidden-until-needed
elements.

### Interaction states

Show normal, hover, focus, selected, dragging, pending, success, error,
completed, dimmed and disabled states where applicable.

### Design tokens and measurements

Recommend concrete row heights, spacing, typography, tag treatment, radii,
border contrast and responsive breakpoints using existing design tokens where
possible. Explain any new token required.

Do not prescribe arbitrary pixel values without testing them in context.

## Performance review

TODAY and Planner must remain responsive at agency scale. Inspect:

- query breadth for My Tasks and Earlier windows;
- repeated task enrichment and time/activity queries;
- Planner row/segment rendering volume;
- drag pointer updates and rerender boundaries;
- optimistic updates;
- per-row subscriptions or N+1 reads;
- large optional workflow groups hidden/collapsed by default;
- task-detail payloads;
- memoization and unstable callbacks;
- list virtualization threshold;
- organization-midnight reactivity;
- presence of layout/paint-heavy row animations.

Use representative loads:

```text
25 members
500 active tasks
100 plan segments in visible Planner range
20 TODAY tasks for one person
50 Earlier/status-group tasks
```

Do not recommend virtualization unless measurement shows it is needed; it can
damage keyboard and variable-height behavior.

## Existing tests and required regression coverage

Inspect at minimum:

- `convex/__tests__/todayGestures.test.ts`
- `convex/lib/__tests__/todayPlan.test.ts`
- `convex/lib/__tests__/myTasks.test.ts`
- Planner pure helper and component tests
- My Tasks component tests
- navigation badge tests

Identify every test that encodes the superseded “plan for caller” behavior.

The implementation test plan must include:

1. Pure target-resolution tests.
2. Backend authorization tests for admin-target and member-self behavior.
3. Multi-assignee/unassigned/idempotency tests.
4. Integration tests from gesture to `planSegments.userId`.
5. Query reconciliation proving the target person's TODAY membership.
6. Bulk mixed-result tests.
7. Existing segment trim/split preservation tests.
8. Org-timezone boundary tests.
9. UI tests for visible target/copy and chooser behavior.
10. Planner drag/drop E2E tests across rows.
11. Keyboard and touch alternatives.
12. Sidebar badge semantic tests.
13. Visual regression screenshots at required viewports.

## Required hypotheses to prove or disprove

These are leads, not established findings.

### H1. The current behavior is intentional but no longer correct

`planner.addToToday` and `bulkAddToToday` appear explicitly self-scoped. This
matches the existing PRD but conflicts with the new admin planning requirement.
Inventory every dependent surface before changing the contract.

### H2. One shared mutation cannot express all target contexts safely

The existing `{ taskId }` API may be insufficient for admin assignee-targeted
planning. Determine the smallest explicit API shape that prevents clients from
accidentally or maliciously choosing unauthorized users.

### H3. Planner grid targeting is technically correct but insufficiently clear

Panel drops appear to derive `userId` from the destination row. The underlying
logic may already be correct while task cards, drag previews and confirmations
fail to communicate the target or assignment mismatch.

### H4. Planner draw-to-create creates unassigned tasks

`createTaskWithSegment` appears to create an empty `assigneeIds` list even when
the task is placed on a named person's row. Determine whether this is correct
for the new mental model or whether the UI needs an explicit assign-and-plan
choice.

### H5. Status groups overwhelm the daily purpose

My Tasks currently renders Today, Earlier and every selected workflow group.
Even with visibility settings, defaults and group expansion may produce a
backlog browser instead of a daily execution list.

### H6. Status badges dominate row hierarchy

Today/Earlier rows render status as a dedicated badge before project/category
metadata. Its geometry, color and repetition may consume more attention than
the task title and actual urgency.

### H7. Navigation counts use alert styling for workload

The sidebar badge may use the same visual language as unread Inbox or invoice
alerts although My Tasks count represents remaining planned work. This can
miscommunicate urgency.

### H8. Wide-screen layout wastes useful space

The task list appears constrained while Daily Notes has a fixed-width column
and substantial whitespace remains. Determine whether max-width and split-view
decisions serve scanning at realistic screen sizes.

### H9. Low-opacity secondary content is too faint

Earlier rows and metadata use reduced opacity. Test contrast and legibility,
especially when the whole row opacity also affects nested controls.

### H10. Date and total-time header semantics are unclear

The screenshot shows a generic My Tasks title and a small time total while the
date is more prominent in Daily Notes. Determine whether the page's primary
temporal context is inverted.

### H11. Optional groups need better defaults, not only another settings menu

The gear allows status visibility changes, but users should not need to
configure the product before the core daily view becomes calm.

### H12. Admin viewed-person context can be mistaken for self context

The page supports admin viewing another user's notes/tasks. Prove that all
planning gestures, header copy and mutation targets remain bound to the viewed
person.

## Severity model

### Critical

- Cross-organization planning or authorization bypass.
- A plan write targets an arbitrary unauthorized user.

### High

- Admin Add to TODAY silently plans for the wrong person.
- Planner action and target person's My Tasks disagree.
- Bulk scheduling silently creates incorrect personal plans.
- Date/timezone error puts work on the wrong day.
- Removing or moving TODAY corrupts another person's or another date's plan.

### Medium

- Default My Tasks hierarchy obscures TODAY under status-group noise.
- Repeated large tags materially reduce scanability and visible task count.
- Multiple/unassigned target handling is ambiguous.
- Navigation badge communicates the wrong meaning.
- Planner target/mismatch is technically correct but visually hidden.
- Keyboard/touch user cannot perform a core planning action.

### Low

- Minor visual inconsistency, spacing or motion issue with no workflow impact.
- Copy/polish issue that does not hide state or target.

## Finding format

Every finding must include:

```text
ID: TODAY-001
Title:
Severity:
Confidence:
Affected surface(s):
Actor and task state:
Current behavior:
Expected behavior:
Business/user impact:
Exact code path:
Visual/interaction evidence:
Minimal reproduction:
Recommended design or logic direction:
Before/After row:
Regression-test specification:
Dependencies or migration concern:
```

Distinguish clearly among:

- confirmed logic defect;
- superseded product decision;
- usability issue;
- visual hierarchy issue;
- accessibility issue;
- performance risk;
- future enhancement.

## Required deliverables

Create all files under:

```text
docs/fable-to-review/results/today-planner-ux/
```

### 1. `EXECUTIVE-SUMMARY.md`

Answer:

- Can an admin reliably plan work to the intended person today?
- Does Planner scheduling reliably populate that person's My Tasks?
- Is My Tasks currently suitable as an all-day execution surface?
- What are the top five logic/UX blockers?
- What is the single recommended target experience?
- What must be corrected before real team rollout?

Provide verdicts:

```text
Scheduling target correctness: GO / CONDITIONAL GO / NO-GO
Planner -> My Tasks consistency: GO / CONDITIONAL GO / NO-GO
Daily My Tasks usability: GO / CONDITIONAL GO / NO-GO
Accessibility/input coverage: GO / CONDITIONAL GO / NO-GO
```

### 2. `CURRENT-STATE-MAP.md`

Complete gesture inventory, code paths and rendered-surface map. Include the
current vs intended target person for every Add/Move/Drag/Bulk action.

### 3. `PRODUCT-LOGIC-AMENDMENT.md`

An exact amendment to `docs/today-planner-prd.md` covering the new contextual
target-resolution model. Identify outdated stories, contracts, comments and
tests. Include the final multi-assignee and unassigned decisions.

### 4. `TARGET-EXPERIENCE.md`

The implementation-ready target information architecture, user flows,
component anatomy, copy, state behavior and responsive model. Make one clear
recommendation.

### 5. `UI-UX-AUDIT.md`

Evidence-based visual and interaction findings, including the mandatory
Before/After/Why table, measurements and screenshot references.

### 6. `WIREFRAMES.md`

Annotated low-fidelity wireframes for:

- default My Tasks desktop;
- laptop and mobile My Tasks;
- Earlier collapsed/expanded;
- workflow groups enabled;
- admin viewing another person's day;
- admin Add to TODAY with one assignee;
- multi-assignee/unassigned target selection;
- Planner card, drag preview and mismatch result.

Use Mermaid, ASCII layout or embedded local images. Prioritize hierarchy and
behavior over decorative mockup styling.

### 7. `SCHEDULING-TARGET-MATRIX.md`

The complete actor/context/assignment/target/permission/idempotency matrix with
all mandatory scenarios and explicit resulting `planSegments` rows.

### 8. `ACCESSIBILITY-RESPONSIVE-REVIEW.md`

Keyboard, screen-reader, touch, contrast, reduced-motion, zoom and required
viewport results. Include concrete remediation requirements.

### 9. `PERFORMANCE-REVIEW.md`

Query/render/drag measurements or evidence, realistic dataset assumptions and
only justified optimizations.

### 10. `FINDINGS.md`

All findings in the required format ordered by severity, then daily frequency.

### 11. `IMPLEMENTATION-PLAN.md`

Break implementation into independently verifiable slices:

```text
P0 — correct contextual scheduling targets and tests
P1 — simplify default My Tasks hierarchy and row density
P2 — Planner target feedback, navigation semantics and responsive polish
P3 — accessibility, performance and final visual-regression hardening
```

For each slice list files, backend contract changes, migrations if any,
component changes, tests, acceptance criteria and rollback concerns.

### 12. `TEST-PLAN.md`

Exact unit, integration, component, E2E and visual-regression cases. Include
identity setup, input, expected target person/date, database assertion and UI
assertion.

### 13. `REVIEW-METADATA.md`

Record repository state, versions, commands, routes inspected, viewport sizes,
test data, test results, skipped checks and environment limitations.

## Acceptance criteria for the target redesign

The proposed target is acceptable only if:

1. Admin Add to TODAY on a singly assigned task names and targets the assignee.
2. Multiple and zero-assignee tasks cannot silently land on the acting admin.
3. Personal My Tasks add/move actions remain one-click and self/viewed-person
   scoped.
4. Planner row drops write the visible row owner and immediately reconcile with
   that person's TODAY.
5. Assignment is never silently changed by planning.
6. TODAY is visually and structurally dominant by default.
7. Earlier is collapsible and does not auto-carry work.
8. In progress and other workflow groups can be disabled and do not dominate
   the default view.
9. Task titles remain primary and repeated status tags are materially quieter.
10. The navigation badge/icon has one documented, honest semantic.
11. The page remains usable on laptop, wide desktop, tablet and mobile.
12. Every core action has keyboard/touch support or a documented accessible
    alternative.
13. Mutation pending/error/undo behavior is explicit.
14. Existing valid plan history and split/trim behavior are preserved.
15. Backend tests prove target identity rather than only checking that a
    segment was added.

## Completion criteria

The review is complete only when:

- every TODAY/Planner scheduling gesture is inventoried;
- current and intended target person are proven for every gesture;
- the existing PRD contradiction is explicitly amended;
- single/multiple/no-assignee behavior is decided;
- My Tasks default hierarchy is specified at component level;
- status-group visibility and persistence are specified;
- row/tag dimensions and hierarchy are measured;
- navigation badge meaning is resolved;
- Planner drag target and mismatch feedback are designed;
- required content and responsive states are reviewed;
- accessibility/input coverage is tested;
- performance is assessed with realistic volume;
- all product invariants have verdicts;
- every High finding has deterministic reproduction and regression tests;
- wireframes and an ordered implementation plan are delivered;
- no application code, schema, tests or production data were modified.

## Review quality bar

An acceptable review does not say:

- “Make the tags smaller.”
- “Use more whitespace.”
- “The page feels cluttered.”
- “Add to TODAY should use the assignee” without tracing every context.
- “Planner already works” without proving the resulting My Tasks membership.
- “Hide In progress” without defining defaults, persistence and discovery.
- “Copy Notion.”

An acceptable review defines exactly who is scheduled by each gesture, proves
the Planner/My Tasks data relationship, specifies a calm default daily
hierarchy, measures the density changes, designs every important state and
hands an implementation agent a testable plan with no unresolved core product
logic.
