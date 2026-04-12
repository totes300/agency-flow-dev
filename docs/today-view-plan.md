# My Tasks — Implementation Plan

> **PRD**: `docs/today-tab-prd.md`
> **Test runner**: Vitest (`npm run test` / `npm run test:watch`)
> **Test pattern**: Write tests FIRST → implement → run tests → commit when green
>
> **After every phase**:
> 1. Run `npm run test` — all tests must pass
> 2. Run `npx tsc --noEmit` — zero TypeScript errors
> 3. Verify visually in browser (both admin + member)
> 4. Commit with descriptive message
> 5. Update backlog checklist at bottom of this file

---

## Phase 1 — Schema + Backend Queries

**Goal**: Add schema fields, write the core Convex queries/mutations. No UI yet.

### 1a. Schema changes

**Files to modify:**
- `convex/schema.ts` — add `todayVisibleStatuses` to `users` table

**What to do:**
- Add `todayVisibleStatuses: v.optional(v.array(v.string()))` to `users` table
- No index needed (queried by user ID, already indexed)

### 1b. Write tests FIRST

**Files to create:**
- `convex/lib/__tests__/myTasks.test.ts` — unit tests for helper logic

**Tests to write:**
```
describe("myTasks helpers")
  - filterTasksForMyTasks: returns only tasks assigned to userId
  - filterTasksForMyTasks: excludes archived tasks
  - filterTasksForMyTasks: excludes subtasks (parentTaskId set)
  - groupByStatusType: groups tasks by status type correctly
  - groupByStatusType: "Today" named status goes into its own group
  - groupByStatusType: review-type tasks go into "submitted" group
  - groupByStatusType: done-type tasks excluded entirely
  - groupByStatusType: respects todayVisibleStatuses filter
  - groupByStatusType: default (null) shows only "Today" status + review
  - sortWithinGroup: sorts by manualSortKey first, then dueDate ASC, createdAt DESC
```

### 1c. Implement helpers

**Files to create:**
- `convex/lib/myTaskHelpers.ts` — pure functions for filtering, grouping, sorting

### 1d. Implement Convex queries/mutations

**Files to create/modify:**
- `convex/myTasks.ts` — new file:
  - `listMyTasks` query — tasks for /my-tasks page (grouped, filtered by visible statuses)
  - `myTasksCount` query — uncompleted "Today" status tasks count (sidebar badge)
- `convex/timeEntries.ts` — add `sumMyToday` query (total minutes logged today by current user)
- `convex/users.ts` — add `updateMyTasksSettings` mutation (save `todayVisibleStatuses`)

### 1e. Run tests + commit

```bash
npm run test
npx tsc --noEmit
# Commit: "feat(my-tasks): schema + backend queries for My Tasks view"
```

---

## Phase 2 — Page Shell + Navigation

**Goal**: Route exists, sidebar entry, header with ⚙ dropdown + daily logged time. No task list yet — loading skeleton.

### 2a. Write tests FIRST

**Files to create:**
- `lib/__tests__/myTasksNavigation.test.ts`

**Tests to write:**
```
describe("My Tasks navigation")
  - navigation.ts includes My Tasks entry in Work group
  - My Tasks is above Tasks in sidebar order
  - My Tasks is not admin-only (visible to everyone)
```

### 2b. Implement navigation

**Files to modify:**
- `lib/navigation.ts` — add My Tasks entry (Work group, above Tasks, `CircleUserIcon`)

### 2c. Implement page shell

**Files to create:**
- `app/(dashboard)/my-tasks/page.tsx` — page shell with header
- `app/(dashboard)/my-tasks/loading.tsx` — content-aware skeleton
- `components/my-tasks/my-tasks-header.tsx` — "My tasks" title + ⚙ icon + daily logged time
- `components/my-tasks/view-settings-dropdown.tsx` — ⚙ dropdown with status type checkboxes
- `components/my-tasks/my-tasks-skeleton.tsx` — skeleton matching actual layout

### 2d. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: /my-tasks loads, shows header + skeleton
# Commit: "feat(my-tasks): page shell, navigation, header with view settings"
```

---

## Phase 3 — Task List + Group Headers (read-only)

**Goal**: Display tasks grouped by status type with proper headers. No interactions yet (no checkbox, no timer, no inline create). Click row → existing drawer opens.

### 3a. Write tests FIRST

**Files to create:**
- `components/my-tasks/__tests__/myTasksGroup.test.ts`

**Tests to write:**
```
describe("MyTasksGroup")
  - renders group header with icon, name, count
  - renders correct number of task rows
  - group is collapsible (toggle hides/shows tasks)
  - empty group is not rendered

describe("MyTaskRow")
  - renders 2-line layout: title on line 1, metadata on line 2
  - shows project name, category badge, due date, assignee avatar
  - overdue due date shows ⚠ indicator in red
  - submitted row: strikethrough title, opacity-60, green checkbox disabled
  - clicking row calls onOpenDetail with task ID
```

### 3b. Implement components

**Files to create:**
- `components/my-tasks/my-tasks-list.tsx` — container: maps groups → `MyTasksGroup`
- `components/my-tasks/my-tasks-group.tsx` — group header (icon + name + count + chevron) + task rows + collapse logic
- `components/my-tasks/my-task-row.tsx` — 2-line row (active variant)
- `components/my-tasks/my-task-row-submitted.tsx` — 2-line row (submitted variant: muted, strikethrough)

**Files to modify:**
- `app/(dashboard)/my-tasks/page.tsx` — wire up `listMyTasks` query → pass to list component
- Reuse existing drawer (`TaskDetailDrawer`) — same as `/tasks`

### 3c. Implement hidden tasks footer

- `components/my-tasks/hidden-tasks-footer.tsx` — "X tasks hidden by settings. Show settings"

### 3d. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: /my-tasks shows grouped task list, click opens drawer
# Commit: "feat(my-tasks): task list with status groups, 2-line rows, drawer integration"
```

---

## Phase 4 — Completion Checkbox + Popover

**Goal**: Member checkbox → popover (Done / Send for review). Admin checkbox → instant done. Confetti animation. Toast messages.

### 4a. Write tests FIRST

**Files to create:**
- `components/my-tasks/__tests__/completionCheckbox.test.ts`

**Tests to write:**
```
describe("CompletionCheckbox")
  - member click: shows popover with "Done" and "Send for review" options
  - member selects "Done": calls onDone callback
  - member selects "Send for review": calls onSendForReview callback
  - admin click: calls onDone immediately (no popover)
  - submitted state: checkbox is green, filled, disabled
  - popover closes on Escape
  - popover closes on click outside
```

### 4b. Implement components

**Files to create:**
- `components/my-tasks/completion-checkbox.tsx` — circle checkbox with popover logic
- `components/my-tasks/completion-confetti.css` — CSS keyframe animations for particles
- `components/my-tasks/completion-confetti.tsx` — confetti particle burst component

### 4c. Wire up to task rows

**Files to modify:**
- `components/my-tasks/my-task-row.tsx` — use `CompletionCheckbox`, wire `onDone` / `onSendForReview` to `tasks.update` mutations
- `app/(dashboard)/my-tasks/page.tsx` — add mutation handlers, toast messages

### 4d. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: member popover works, admin instant done, confetti plays, toasts show
# Commit: "feat(my-tasks): completion checkbox with popover, confetti animation"
```

---

## Phase 5 — Inline Task Creation

**Goal**: Notion-style `+ Add task...` per group. Type → Enter → created with smart defaults. Rapid-fire. Optimistic UI.

### 5a. Write tests FIRST

**Files to create:**
- `components/my-tasks/__tests__/inlineAddTask.test.ts`

**Tests to write:**
```
describe("MyTasksInlineAdd")
  - renders "+ Add task..." text initially
  - click transforms into text input
  - Enter with text: calls create mutation with correct defaults
  - Enter with text: input clears and stays focused (rapid-fire)
  - Enter with empty text: does nothing
  - Escape: input closes, reverts to "+ Add task..." text
  - created task gets correct statusId based on group
  - created task gets assigneeIds: [currentUserId]
  - created task gets billable: true
  - optimistic: new task appears immediately with loading pulse
```

### 5b. Implement component

**Files to create:**
- `components/my-tasks/my-tasks-inline-add.tsx` — Notion-style inline add per group

### 5c. Wire up

**Files to modify:**
- `components/my-tasks/my-tasks-group.tsx` — render `MyTasksInlineAdd` at bottom of each group
- `app/(dashboard)/my-tasks/page.tsx` — pass create mutation + optimistic handlers

### 5d. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: add tasks inline, rapid-fire, optimistic shows immediately
# Commit: "feat(my-tasks): Notion-style inline task creation with smart defaults"
```

---

## Phase 6 — Drag Reorder

**Goal**: Drag-and-drop within groups using existing `manualSortKey` + `@dnd-kit/react`.

### 6a. Write tests FIRST

**Files to create:**
- `components/my-tasks/__tests__/dragReorder.test.ts`

**Tests to write:**
```
describe("MyTasks drag reorder")
  - drag handle visible on row hover
  - reorder calls reorderTask mutation with correct beforeKey/afterKey
  - optimistic order updates immediately
  - cannot drag between different groups
  - submitted group rows are not draggable
```

### 6b. Implement

**Files to modify:**
- `components/my-tasks/my-task-row.tsx` — add drag handle (reuse `SortableTaskRow` pattern from `/tasks`)
- `components/my-tasks/my-tasks-group.tsx` — wrap rows in `DragDropProvider`
- `app/(dashboard)/my-tasks/page.tsx` — wire `reorderTask` mutation + optimistic state

### 6c. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: drag tasks within a group, order persists
# Commit: "feat(my-tasks): drag-and-drop reorder within status groups"
```

---

## Phase 7 — Timer + Search + Empty State

**Goal**: Timer integration per row, search bar, empty state. Polish pass.

### 7a. Write tests FIRST

**Files to create:**
- `components/my-tasks/__tests__/myTasksPage.test.ts`

**Tests to write:**
```
describe("MyTasks timer")
  - timer button shows play icon when not running
  - timer button disabled when task has no project
  - timer button shows tooltip "Assign a project first" when no project

describe("MyTasks search")
  - search input filters tasks by title
  - search combines with status group visibility
  - clearing search restores full list

describe("MyTasks empty state")
  - shows empty state when no tasks in Today group
  - empty state shows "+ Add task..." link
  - empty state shows "X tasks hidden by settings" when hidden tasks exist
```

### 7b. Implement

**Files to modify:**
- `components/my-tasks/my-task-row.tsx` — integrate `InlineTimeCell` (reuse from `/tasks`)
- `components/my-tasks/my-tasks-header.tsx` — add search input
- `app/(dashboard)/my-tasks/page.tsx` — search state, filter logic

**Files to create:**
- `components/my-tasks/my-tasks-empty-state.tsx` — empty state component

### 7c. Run tests + verify + commit

```bash
npm run test
npx tsc --noEmit
# Visual check: timer works, search filters, empty state renders
# Commit: "feat(my-tasks): timer integration, search, empty state"
```

---

## Phase 8 — Mobile + Final Polish

**Goal**: Mobile layout, FAB button, loading skeleton accuracy, visual polish.

### 8a. Write tests FIRST

**Tests to add to existing files:**
```
describe("MyTasks mobile")
  - FAB button visible on mobile viewport
  - FAB button hidden on desktop
  - drawer opens as full-screen modal on mobile
```

### 8b. Implement

**Files to modify:**
- `app/(dashboard)/my-tasks/page.tsx` — mobile FAB button, responsive breakpoints
- `components/my-tasks/my-tasks-skeleton.tsx` — finalize skeleton to match actual layout (2-line rows, group headers)
- All components — verify mobile rendering, touch targets

### 8c. Final test run + commit

```bash
npm run test
npx tsc --noEmit
npm run lint
# Visual check: mobile layout, FAB, skeleton, all interactions
# Commit: "feat(my-tasks): mobile layout, FAB, loading skeleton, polish"
```

---

## Phase Summary

| Phase | What | Key deliverable | Approx scope |
|-------|------|-----------------|--------------|
| **1** | Schema + Backend | Convex queries, helpers, tests | Backend only |
| **2** | Page Shell + Nav | Route, sidebar, header, ⚙ dropdown | UI shell |
| **3** | Task List (read-only) | Groups, rows, drawer integration | Core display |
| **4** | Completion | Checkbox popover, confetti, status change | Key interaction |
| **5** | Inline Creation | Notion-style add, smart defaults, optimistic | Creation flow |
| **6** | Drag Reorder | DnD within groups, manualSortKey | Reorder |
| **7** | Timer + Search + Empty | Timer, search, empty state | Features |
| **8** | Mobile + Polish | FAB, skeleton, responsive | Final pass |

Each phase is independently committable and testable. No phase depends on a later phase.

---

## Backlog Checklist

### Phase 1 — Schema + Backend
- [x] `users.todayVisibleStatuses` field added
- [x] `convex/lib/myTaskHelpers.ts` helpers written
- [x] `convex/lib/__tests__/myTasks.test.ts` — all tests pass
- [x] `convex/myTasks.ts` — `listMyTasks`, `myTasksCount` queries
- [x] `convex/timeEntries.ts` — `sumMyToday` query
- [x] `convex/users.ts` — `updateMyTasksSettings` mutation
- [x] `npm run test` green, `npx tsc --noEmit` clean

### Phase 2 — Page Shell + Navigation
- [x] `lib/navigation.ts` — My Tasks entry added
- [x] `/my-tasks` route loads
- [x] Header: title + ⚙ + daily time
- [x] ⚙ dropdown: toggles, saves to Convex, dot indicator
- [x] Loading skeleton matches layout
- [x] Tests pass, TS clean

### Phase 3 — Task List + Groups
- [x] Groups render with header (icon + name + count)
- [x] 2-line task rows (title dominant, muted metadata)
- [x] Submitted rows: muted, strikethrough, green checkbox
- [x] Collapsible groups
- [x] Empty groups hidden
- [x] Click row → drawer opens
- [x] "X hidden by settings" footer
- [x] Tests pass, TS clean

### Phase 4 — Completion Checkbox
- [x] Member: popover with Done / Send for review
- [x] Admin: instant done
- [x] Confetti animation (CSS-only)
- [x] Status mutation fires correctly
- [x] Row animates to Submitted (member review) or fades out (done)
- [x] Toast messages
- [x] Tests pass, TS clean

### Phase 5 — Inline Creation
- [x] `+ Add task...` per group
- [x] Notion-style: name → Enter → created
- [x] Smart defaults (self-assigned, group status, billable)
- [x] Rapid-fire (input stays focused)
- [x] Optimistic UI (Convex real-time)
- [x] Tests pass, TS clean

### Phase 6 — Drag Reorder
- [x] Drag handle on hover
- [x] Reorder within group (manualSortKey)
- [x] Cannot drag between groups
- [x] Submitted rows not draggable
- [x] Optimistic reorder
- [x] Tests pass, TS clean

### Phase 7 — Timer + Search + Empty
- [x] Timer per row (reuse InlineTimeCell)
- [x] Disabled without project
- [x] Search bar filters titles
- [x] Empty state with "Add task" + hidden count
- [x] Tests pass, TS clean

### Phase 8 — Mobile + Polish
- [x] Mobile FAB button
- [x] Drawer → full-screen modal on mobile
- [x] Skeleton matches actual layout (2-line rows, group headers, inline add)
- [x] `npm run test` green
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint` — pre-existing errors only
- [x] Visual check: admin + member, desktop + mobile
