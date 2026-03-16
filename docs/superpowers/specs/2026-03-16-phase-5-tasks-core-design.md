# Phase 5 — Tasks Core: Refined Design Spec

> **Date**: 2026-03-16
> **Status**: Approved (brainstorming complete)
> **Depends on**: Phase 3 (Projects Core)
> **Design direction**: Linear-style — clean, minimal surface with powerful list view, grouping, and filtering
> **Supersedes**: Original `docs/phase-5-tasks-core.md` where decisions conflict

---

## Summary of Decisions

| Topic | Decision |
|-------|----------|
| Design direction | Linear-style: clean surface, powerful underneath, list-view only |
| Tabs | 6: Active, Backlog, Today, Review, Blocked, Done |
| Inline editing | All four: status, category, client/project, assignee |
| Grouping style | Indented sections (group name row, tasks indented underneath, collapsible) |
| Inline creation | "+ Add task..." at bottom of every group, auto-inherits group value |
| Filter UX | Stripe-style inline pills, hidden by default, two-step operator selection (is/is not/any of/none of) |
| Filter bar placement | Hidden until Filter button clicked, then revealed below tabs row |
| Search placement | Top-right, next to "+ New task" button |
| Exclusion filter styling | Red-tinted pills to visually distinguish from inclusion filters |
| Saved views | Deferred — URL state with bookmarkable filter combos covers the need |
| Mobile | Essential — card view below 768px with FAB |
| Time column | Included with mock data, wired in Phase 7 |
| Activity column | Included with mock data, wired in Phase 6 |
| Task subtitle | Last activity line ("AT commented · 2m ago") with mock data, wired in Phase 6 |
| Column header icons | Yes — small icon per column header |
| Query architecture | Approach B: split counts + list, counts are global per-tab totals |
| Task creation modal | ClickUp-style: project top, title, Tiptap description, pill bar at bottom |
| Tiptap editor | Basic instance in Phase 5, shared component for Phase 6 detail modal |

---

## 1. Page Layout & Header

```
┌─────────────────────────────────────────────────────────┐
│ Tasks                              [Search] [+ New task] │
├─────────────────────────────────────────────────────────┤
│ Active 12 │ Backlog 8 │ Today 3 │ ...    [Filter] [Group by] │
├─────────────────────────────────────────────────────────┤
│ (filter pill row — hidden until Filter clicked)          │
├─────────────────────────────────────────────────────────┤
│ Table / Card view                                        │
└─────────────────────────────────────────────────────────┘
```

- **Title** "Tasks" top-left
- **Search + New task** top-right
- **6 tabs** left-aligned with count badges from `tasks.counts` query (global totals, unaffected by filters)
- **Filter + Group by** buttons right-aligned on the same row as tabs
- **Filter pill row** slides in below tabs when Filter is clicked
- **URL state** reflects everything. Back button works, URLs are shareable/bookmarkable.

**URL serialization format:**
```
?tab=active&groupBy=project&category=is:cat_123&assignee=isNot:user_456
?tab=backlog&assignee=anyOf:user_1,user_2&workCategory=is:cat_789
?tab=today&search=homepage&dateFrom=2026-01-01&dateTo=2026-03-31
```
Operators in URL: `is`, `isNot`, `anyOf`, `noneOf`. Multi-value operators use comma-separated IDs. `dateFrom`/`dateTo` are standalone params (no operator).

---

## 2. Table Columns (10 columns, desktop)

| # | Column | Width | Inline editable? | Details |
|---|--------|-------|-------------------|---------|
| 1 | Checkbox | 32px fixed | N/A | Bulk select. Green filled when task is done. |
| 2 | Task | flex | No | Title (bold) + subtitle (last activity, e.g., "AT commented · 2m ago"). Click → detail modal (Phase 6). Strikethrough title for done tasks. |
| 3 | Activity | ~80px | No | Subtask progress (3/5) + comment count + attachment icon. **Mock data in Phase 5, wired in Phase 6.** |
| 4 | Status | ~100px | Yes | Click → dropdown with all statuses for org. Member: done-type statuses disabled. |
| 5 | Category | ~80px | Yes | Click → dropdown of work categories. |
| 6 | Client / Project | ~140px | Yes | Click → grouped dropdown (clients as section headers → projects as selectable items). Toggl-style. Lock icon if task has time entries. |
| 7 | Assignee | ~70px | Yes | Click → multi-select dropdown with avatars. Add/remove. Stacked avatars + "+N" for multiple. |
| 8 | Due date | ~80px | No | Calendar icon + date. Red "Overdue" if past due. Set in detail modal. |
| 9 | Time | ~60px | No | Play/pause button + logged time. **Mock data in Phase 5, wired in Phase 7.** |
| 10 | Menu ⋮ | 28px | N/A | Edit, Duplicate, Archive, Delete (admin only). |

**Column header icons**: Each column header includes a small icon for visual clarity.

**Inline edit behavior:**
- Click cell → dropdown opens in-place
- Escape cancels, click outside or Enter confirms
- Optimistic update → if server fails, revert + error toast
- Convex real-time subscription handles revert naturally

**Sort:** `createdAt DESC` default. No column-header sorting in v1.

---

## 3. Grouping & Inline Creation

### Grouping options (via Group by dropdown)
- Project, Client (admin only), Category, Assignee, Status, None (flat list)

### Group row design
- Colored dot (matches entity color) + group name + chevron (collapse toggle) + task count badge
- Collapsible — click to toggle
- Indented section style: group name as a full-width row, tasks indented underneath
- Collapse state persisted in `localStorage` (keyed by orgId + groupBy dimension)

### Group sort order
- Alphabetical by default
- Exception: Status grouping follows pipeline order (backlog → in_progress → review → blocked → done)

### Empty groups
- Groups with 0 tasks still render with "0 tasks" + "+ Add task..." row
- Users can create tasks into empty groups without switching views

### "+ Add task..." row
- Appears at the bottom of every group
- Click → inline text input for title
- Enter → creates task with defaults + auto-inherits the group value:
  - Grouped by Category: Design → `workCategoryId` = Design
  - Grouped by Project → `projectId` = that project
  - Grouped by Assignee → `assigneeIds` includes that user
  - Grouped by Client → project dropdown pre-filtered to that client's projects
  - Grouped by Status → `statusId` = that status
- **Rapid entry**: after Enter, input stays open for the next task. Escape exits creation mode.
- Member creators auto-assigned to `assigneeIds`
- Default: `statusId` = Inbox (first backlog-type status), `billable: true`

### Per-group pagination
- 50 tasks per group
- Each group has its own "Load more" button (one-off fetch, not a subscription)
- When grouping is off (flat list), pagination is global

---

## 4. Filter System

### Activation
- **Filter button** on the tab row (right-aligned)
- Click → reveals filter pill row below
- Button highlights (active state) when filters are active
- Filter pill row hidden by default

### Filter pill row (Stripe-style)
- Inactive filters shown as `+ Client`, `+ Project`, `+ Assignee`, `+ Category`, `+ Due date`
- Click inactive pill → **two-step dropdown**:
  1. Pick operator: is, is not, any of, none of
  2. Pick value(s) from searchable list
- Active inclusion filters: blue-tinted pills (e.g., "Category is Design ✕")
- Active exclusion filters: red-tinted pills (e.g., "Assignee is not Jake ✕")
- Click ✕ to remove a filter
- "Clear all" link on the right

### Filter operators
| Operator | Meaning | Available on |
|----------|---------|-------------|
| is | Exact match | All fields |
| is not | Exclude match | All fields |
| any of | Match any of multiple values | Assignee, Category, Project |
| none of | Exclude all of multiple values | Assignee, Category, Project |

### Due date filter
The "Due date" pill opens a popover with:
- **Preset options**: Overdue, Today, This week, Next 7 days, This month
- **Custom range**: "From" and "To" date pickers for arbitrary range
- Serialized as `dateFrom` and `dateTo` URL params

### Search scope
- **v1**: Title-only search via Convex search index (`searchIndex("search_title")`). Fast, index-driven.
- Project name search is **not** included in v1 (would require join + post-filter). Noted for v2.

### Filter logic
- All active filters combine with AND logic
- Filters combine with tab selection (tab is the primary filter, pills are additional)
- Member users don't see Client filter (they only see assigned tasks)
- Search combines with filters (AND)

### Client / Project filter dropdown
- Projects grouped under client section headers (same Toggl-style pattern as inline editing)

---

## 5. Task Creation Modal

Triggered by "**+ New task**" button (header) or **FAB** (mobile).

### Layout (ClickUp-inspired)
```
┌──────────────────────────────────────────────────┐
│                                            ✕     │
│  [Project ▾]                                     │
│                                                  │
│  Task Name                                       │  ← large, focused input
│                                                  │
│  + Write a description...                        │  ← Tiptap editor (basic in v1)
│                                                  │
│                                                  │
│  (spacious editor area)                          │
│                                                  │
│                                                  │
│  [Status] [Assignee] [Due date] [Category] [···] │  ← pill bar
│                                                  │
│  ─────────────────────────────────────────────── │
│                          [Create Task  ▾]        │  ← split button
└──────────────────────────────────────────────────┘
```

### Fields
| Field | Type | Default |
|-------|------|---------|
| Project | Grouped dropdown (clients → projects) | None |
| Title | Text input (required) | — |
| Description | Tiptap editor (basic: bold, italic, lists, code) | Empty |
| Status | Pill → dropdown | Inbox (first backlog-type) |
| Assignee | Pill → multi-select with avatars | Member: auto-includes self. Admin: empty |
| Due date | Pill → date picker | None |
| Category | Pill → dropdown | None |
| ··· overflow | Billable toggle, Estimate (Phase 6) | Billable: on |

### Behavior
- Focus lands on Title on open
- Enter or "Create" button submits
- Split button dropdown: "Create & add another" — creates and clears form for rapid entry
- Modal closes on Escape or backdrop click
- Tiptap editor: shared `components/tiptap-editor.tsx` component, reused in Phase 6 detail modal

---

## 6. Bulk Operations

### Selection
- Checkbox per row, max 50 selected
- "Select all" checkbox in column header — selects all visible tasks across groups, capped at 50
- If exceeds 50: "50 of 120 selected (maximum)"

### Floating toolbar (bottom of screen, Linear-style)
- "X selected" count + "Deselect all" link
- **Status** dropdown → change status (done-type disabled for members)
- **Add assignee** dropdown → adds to assigneeIds
- **Remove assignee** dropdown → removes from assigneeIds
- **Category** dropdown → replaces
- **Project** dropdown → replaces (only if none of selected tasks have time entries)
- **Archive** button — visually separated (right-aligned with divider, distinct styling)

### Pre-flight check
- Before executing, UI checks which tasks would be skipped (e.g., tasks with time entries when changing project)
- If any skipped → confirmation dialog: "3 tasks have time entries and will be skipped. Continue with the other 47?"

### Execution
- Single atomic Convex mutation
- Returns: `{ updated: number, skipped: Array<{ taskId, title, reason }> }`
- All succeeded → toast "48 tasks updated"
- Some skipped → toast with summary

### Undo
- Bulk archive uses `useUndoAction` pattern: "12 tasks archived — Undo" (5s sonner toast)
- One click restores all

### Keyboard
- Escape deselects all

---

## 7. Mobile Experience (< 768px)

### Card view
```
┌─────────────────────────────────┐
│ ☐  Update hero section copy     │
│     In Progress  ·  Design      │
│     Acme Corp · Website         │
│     🔵 AT        Mar 20         │
└─────────────────────────────────┘
```

- Tap card → detail modal (Phase 6 stub — simple read view for now)
- Long-press → enters bulk selection mode, tapping toggles cards
- Floating toolbar becomes bottom sheet in selection mode
- Swipe down or "Done" exits selection mode

### Navigation
- Tabs are horizontally scrollable
- Filter/Group by buttons remain right of tabs, dropdowns are full-width bottom sheets
- **FAB** bottom-right → opens task creation modal

### Grouped view
- Same indented section pattern with cards instead of rows
- "+ Add task..." row at bottom of each group

---

## 8. Empty States

| Tab | Message |
|-----|---------|
| Active | "No active tasks — create one to get started" + New task button |
| Backlog | "Backlog is empty" |
| Today | "Nothing planned for today" |
| Review | "Nothing waiting for review" |
| Blocked | "Nothing blocked — nice!" |
| Done | "No completed tasks yet" |

### Edge cases
- **No projects exist** → project dropdown shows "Create a project first"
- **Member with 0 tasks** → "No tasks assigned to you yet"
- **Filter returns 0 results** → "No tasks match your filters" + "Clear all filters" button
- **Empty groups** → still render with "0 tasks" + "+ Add task..." row
- **Task archived while selected** → real-time subscription removes from selection
- **Concurrent inline edit** → last write wins, Convex handles conflicts

---

## 9. Schema & Query Architecture

### Schema: `tasks` table
```typescript
tasks: defineTable({
  orgId: v.string(),
  title: v.string(),
  description: v.optional(v.string()),     // Tiptap JSON
  statusId: v.id("statuses"),
  statusType: v.union(                       // denormalized from statuses.type
    v.literal("backlog"),
    v.literal("in_progress"),
    v.literal("review"),
    v.literal("blocked"),
    v.literal("done"),
  ),
  projectId: v.optional(v.id("projects")),
  assigneeIds: v.array(v.id("users")),
  workCategoryId: v.optional(v.id("workCategories")),
  estimate: v.optional(v.number()),         // minutes
  billable: v.boolean(),
  dueDate: v.optional(v.string()),          // YYYY-MM-DD
  parentTaskId: v.optional(v.id("tasks")),  // Phase 6 subtasks
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_statusType", ["orgId", "statusType"])
  .index("by_projectId", ["projectId"])
  .index("by_parentTaskId", ["parentTaskId"])
  .index("by_statusId", ["statusId"])
  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["orgId"]
  })
```

### Schema: `statuses` table addition
```typescript
systemRole: v.optional(v.union(v.literal("today")))
```
- Today tab queries `systemRole: "today"`, not the status name
- Admin can rename the status freely without breaking the tab
- Seed data sets `systemRole: "today"` on the "Today" status

**Migration steps:**
1. Add `systemRole` field to statuses table in `convex/schema.ts`
2. Update the seed function in `convex/statuses.ts` to set `systemRole: "today"` on the "Today" status
3. Write a one-time migration mutation to backfill existing orgs: find each org's status named "Today" (type: backlog) and set `systemRole: "today"`

### Query architecture: Approach B (split counts + list)

**`tasks.counts`** — single real-time subscription
- Uses `by_orgId_statusType` index for efficient per-type counting
- Returns: `{ active: number, backlog: number, today: number, review: number, blocked: number, done: number }`
- `active` = in_progress + review + blocked counts
- `today` count follows a **separate code path**: look up the status with `systemRole: "today"` first, then count tasks with that specific `statusId` via the `by_statusId` index. Does NOT use `by_orgId_statusType` for this count.
- `backlog` count includes ALL backlog-type tasks (including "today" tasks). The overlap between Backlog and Today tabs is **intentional** — Today is a highlighted subset of Backlog.
- Global totals, unaffected by active filters
- Respects permission: admin sees all, member sees only assigned (in-memory filter on `assigneeIds` for members)

**`tasks.list`** — single real-time subscription, returns grouped result
```typescript
// Parameters
{
  tab: "active" | "backlog" | "today" | "review" | "blocked" | "done",
  filters: {
    clientId?: { op: "is" | "isNot", value: Id },
    projectId?: { op: "is" | "isNot", value: Id },
    assigneeIds?: { op: "is" | "isNot" | "anyOf" | "noneOf", value: Id[] },
    workCategoryId?: { op: "is" | "isNot", value: Id },
    dateFrom?: string,
    dateTo?: string,
  },
  groupBy?: "project" | "client" | "category" | "assignee" | "status" | null,
  search?: string,
  limit: number,  // 50 default
}

// Returns
{
  groups: Array<{
    key: string,
    label: string,
    color?: string,
    count: number,
    tasks: Array<TaskWithJoins>,  // first 50
    hasMore: boolean,
    cursor?: string,
  }>,
  totalCount: number,
}
```

**`tasks.listMore`** — for "Load more" within a group
```typescript
// Parameters
{ groupKey: string, cursor: string, limit: number }
// Returns
{ tasks: Array<TaskWithJoins>, hasMore: boolean, cursor?: string }
```
Implementation: defined as a Convex query, but invoked on the client via `fetchQuery` (not `useQuery`) to avoid creating a real-time subscription. This is a one-off fetch — the parent `tasks.list` subscription already covers reactivity for the initial 50 tasks.

### Mutations

| Mutation | Description |
|----------|-------------|
| `tasks.create` | Inline or modal creation. Resolves `statusType` from `statusId`. Member auto-assigned. |
| `tasks.update` | Single field inline edit. If `statusId` changes, also updates `statusType`. |
| `tasks.archive` | Soft delete. Cascades to subtasks. Stops active timers (Phase 7). Uses undo pattern. |
| `tasks.restore` | Unset `archivedAt`. Checks permissions at restore time — if a member was unassigned during the undo window, the restore fails with an error toast. |
| `tasks.remove` | Hard delete, admin only. If has time entries → suggest archive instead. |
| `tasks.duplicate` | Copies: title, description, project, assignees, category, estimate, billable. Does NOT copy: subtasks, comments, attachments, time entries. |
| `tasks.bulkUpdate` | Atomic, max 50. Returns `{ updated, skipped[] }`. Pre-flight check for locked tasks. |

### `statusType` sync rule
Every mutation that changes `statusId` also writes `statusType`:
```typescript
async function resolveStatusType(ctx: MutationCtx, statusId: Id<"statuses">) {
  const status = await ctx.db.get(statusId);
  if (!status) throw new Error("Status not found");
  return status.type;
}
```

### Performance notes
- **Archived task filtering**: All list queries filter out archived tasks (`archivedAt !== undefined`) in memory after the index scan. The `by_orgId_statusType` index does not include `archivedAt`. At current scale this is fine — archived tasks are a small percentage. If archived tasks grow large, consider a compound index with `archivedAt` as a leading field or a separate archive table.
- **`createdAt DESC` sort within groups**: Sorting happens in memory after the index scan. For 50 tasks per group this is negligible. No compound index needed in v1.
- **Tiptap JSON storage**: Description stored as `v.optional(v.string())` containing Tiptap JSON. No server-side validation of JSON structure in v1 — the Tiptap editor on the client is the source of truth.

### Scaling notes (documented for future implementation)
- **`assigneeIds` array → junction table**: At ~2,000 tasks/org, migrate to `taskAssignees` table with `by_orgId_userId` index for efficient member permission filtering.
- **`tasks.counts` → denormalized counts document**: At ~10,000 tasks/org, maintain a `taskCounts` record per org updated by mutations instead of counting on every query.

---

## 10. Permission Model

| Action | Admin | Member |
|--------|-------|--------|
| See all tasks | ✅ | ❌ (only assigned) |
| Create tasks | ✅ | ✅ (auto-assigned to self) |
| Inline edit all fields | ✅ | ✅ (on assigned tasks) |
| Set status to done-type | ✅ | ❌ |
| Bulk operations | ✅ | ✅ (on assigned tasks, no done status) |
| Delete tasks | ✅ | ❌ |
| See Client filter | ✅ | ❌ |
| Group by Client | ✅ | ❌ |
| Archive / Restore | ✅ | ✅ (on assigned tasks) |

---

## 11. Deferred Items & Agent Notes

### Mock data columns (implement structure now, wire later)
- **Activity column** (subtask progress, comments, attachments) → **Phase 6**: wire to real subtask/comment/attachment queries
- **Task subtitle** (last activity line) → **Phase 6**: wire to real activity feed
- **Time column** (play/pause, logged time) → **Phase 7**: wire to real timer and time entry system

### Deferred features
- **Saved views** → later iteration (URL state + bookmarks cover the need)
- **Column-header sorting** → v2
- **Drag-and-drop reordering** → v2 (add `sortOrder` field then)
- **Arrow-key row navigation** → v2
- **Rich Tiptap features** (mentions, slash commands, blocks) → Phase 6

---

## 12. Acceptance Criteria

### Core
- [ ] Admin sees all tasks, member sees only assigned
- [ ] 6 tabs with count badges (global totals via `tasks.counts`)
- [ ] Today tab uses `systemRole` flag, not status name
- [ ] 10 columns per spec (Activity + Time with mock data)
- [ ] Task subtitle shows last activity (mock data)
- [ ] Column headers have icons
- [ ] Done tasks: green checkbox + strikethrough title

### Inline editing
- [ ] Status, category, client/project, assignee — click-to-edit
- [ ] Client/project dropdown: grouped by client, select project (Toggl-style)
- [ ] Member cannot set done-type status
- [ ] Lock icon on project if task has time entries
- [ ] Optimistic update with revert on failure

### Grouping
- [ ] Group by: project, client, category, assignee, status, none
- [ ] Indented sections with colored dot, name, chevron, count
- [ ] Collapsible groups, state persisted in localStorage
- [ ] Empty groups still render with "+ Add task..."
- [ ] Groups sorted alphabetically (status: pipeline order)
- [ ] Per-group pagination (50/group, "Load more")
- [ ] Collapsed groups don't subscribe to task data

### Inline creation
- [ ] "+ Add task..." at bottom of every group
- [ ] Auto-inherits group value
- [ ] Client group: pre-filters project dropdown to client's projects
- [ ] Rapid entry mode (input stays open after Enter)
- [ ] Member auto-assigned

### Filters
- [ ] Filter pill row hidden by default, revealed on click
- [ ] Stripe-style pills with two-step operator (is/is not/any of/none of)
- [ ] Exclusion filters: red-tinted pills
- [ ] "Clear all" link
- [ ] Full URL state: tab, filters, groupBy, search

### Task creation modal
- [ ] ClickUp-style layout: project top, title, Tiptap editor, pill bar, split "Create" button
- [ ] "Create & add another" option
- [ ] Tiptap editor (basic formatting in v1, shared component)

### Bulk operations
- [ ] Max 50 selection, "Select all" caps at 50
- [ ] Floating bottom toolbar (Linear-style)
- [ ] Add assignee + Remove assignee (separate actions)
- [ ] Archive visually separated from other actions
- [ ] Pre-flight check + confirmation for skipped tasks
- [ ] Atomic mutation with result summary
- [ ] Bulk archive uses undo pattern (5s toast)

### Mobile (< 768px)
- [ ] Card view replacing table
- [ ] Long-press for bulk selection, bottom sheet toolbar
- [ ] FAB for task creation
- [ ] Horizontally scrollable tabs
- [ ] Filter/Group by as bottom sheets

### Empty states
- [ ] Per-tab unique messages
- [ ] Member-specific empty state
- [ ] Filter-no-results with "Clear all" button

### Performance
- [ ] `statusType` denormalized on tasks (union type, not plain string), compound index used
- [ ] Convex search index on title (v1 search is title-only)
- [ ] Single subscription for grouped list
- [ ] One-off fetch for "Load more" via `fetchQuery`
- [ ] Tab counts unaffected by active filters
- [ ] Today count uses separate code path (systemRole lookup → statusId count)
- [ ] Backlog tab includes Today tasks (intentional overlap)

### Migration
- [ ] `systemRole` field added to statuses schema
- [ ] Seed function updated to set `systemRole: "today"`
- [ ] Backfill migration for existing orgs' "Today" status
