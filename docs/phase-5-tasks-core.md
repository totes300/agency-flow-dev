# Phase 5 — Tasks Core

> **Goal**: The main task list — table, filtering, grouping, inline editing, bulk operations. The most-used screen in the app.
> **Depends on**: Phase 3 (Projects Core) — needs project/client data
> **Access**: Admin: all tasks. Member: only assigned tasks.

---

## Decisions

| Question | Decision |
|----------|----------|
| Statuses? | Custom `statuses` table (Phase 0) + 5 system types (backlog, in_progress, review, blocked, done) |
| Tabs? | 6: Active, Backlog, Today, Review, Blocked, Done — built on type flags |
| Active tab? | Everything not done/archived: in_progress + review + blocked |
| Columns? | Fixed in v1 (10 columns per screenshot), configurable in v2 |
| Task detail? | Centered modal (Linear/Asana pattern) — implemented in Phase 6 |
| Inline editing? | Status, category, client/project, assignee (click-to-edit) |
| Subtasks? | Lite v1: same entity, lives in parent detail, not in main list. Phase 6. |
| Saved views? | ✅ V1, sidebar below main nav, user-level, graceful fallback on unknown keys |
| Bulk ops? | Max 50: status + assignee + category + project + archive |
| Activity counts? | Computed from queries in v1 (denormalize in v2 if slow) |
| assigneeIds? | Array on task (junction table in v2 if needed) |
| Sort order? | createdAt DESC (newest first) default within groups |
| Search? | Title + project name, case-insensitive. Full-text in v2. |
| Member done? | ❌ Member cannot switch to type:done status |
| No project? | Timer disabled, "Assign a project first" |
| Has time entries? | Project cannot be changed (lock icon) |
| Invoiced task? | Read-only (computed: invoicedInReportId on all billable entries) |
| Fully invoiced badge? | ✅ Computed: status.type=done + no unstamped billable entries. Admin only. |
| Duplication? | Copies basic data, NOT subtasks/comments/attachments/time |

---

## Schema

```typescript
tasks: defineTable({
  orgId: v.string(),
  title: v.string(),
  description: v.optional(v.string()),     // Tiptap JSON — Phase 6
  statusId: v.id("statuses"),              // FK to statuses table
  projectId: v.optional(v.id("projects")),
  assigneeIds: v.array(v.id("users")),     // array, multiple assignees
  workCategoryId: v.optional(v.id("workCategories")),
  estimate: v.optional(v.number()),         // in minutes
  billable: v.boolean(),                    // default: true
  dueDate: v.optional(v.string()),          // YYYY-MM-DD
  parentTaskId: v.optional(v.id("tasks")),  // subtask — Phase 6
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_projectId", ["projectId"])
  .index("by_parentTaskId", ["parentTaskId"])
  .index("by_statusId", ["statusId"])

savedViews: defineTable({
  orgId: v.string(),
  userId: v.id("users"),
  name: v.string(),
  filters: v.string(),                     // JSON blob
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_orgId_userId", ["orgId", "userId"])
```

## Status system

**Custom statuses from the `statuses` table** (seeded in Phase 0):

5 system types: `backlog` · `in_progress` · `review` · `blocked` · `done`

The system **uses type, not name**:
- Member cannot switch to `type: done` status → admin only
- "Fully invoiced" computed = `type: done` + all billable entries stamped
- Tabs filter by type

Seed (8 defaults):
```
inbox (backlog) · today (backlog) · next_up (in_progress) · in_progress (in_progress) ·
admin_review (review) · client_review (review) · stuck (blocked) · done (done)
```

## Tab structure (6 tabs)

| Tab | Shows | Type filter |
|-----|-------|-------------|
| **Active** | All live work | in_progress + review + blocked |
| **Backlog** | The pile | backlog |
| **Today** | Special: tasks in "today" status | backlog (name="Today" specifically) |
| **Review** | Waiting on someone | review |
| **Blocked** | Stuck | blocked |
| **Done** | Complete | done |

Each tab has a **count badge** with the number of tasks.

**Today tab is special**: Tied to the "Today" named status (type: backlog). A highlighted view for daily work.

## Table columns (fixed in v1)

Per the screenshot — 10 columns:

| # | Column | Source | Inline editable? |
|---|--------|--------|-----------------|
| 1 | Checkbox | — | N/A (bulk select) |
| 2 | Task | title + last activity | No (detail modal) |
| 3 | Activity | subtask progress + comment count + attachment count | No (computed) |
| 4 | Status | statusId → statuses.name + color | ✅ Click-to-edit dropdown |
| 5 | Category | workCategoryId → workCategories.name + color | ✅ Click-to-edit dropdown |
| 6 | Client / Project | projectId → project.name + client.name | ✅ Click-to-edit dropdown |
| 7 | Assignee | assigneeIds → user avatars + name | ✅ Click-to-edit multi-select |
| 8 | Due date | dueDate, "Overdue" if past | No (detail modal) |
| 9 | Time | running timer (red) OR play button + logged time | Play = start timer |
| 10 | ⋮ | Menu | N/A |

**Activity column** (computed from queries, not denormalized):
- Subtask progress: "3/5" (done subtasks / total subtasks)
- Comment count: 💬 3
- Attachment count: 📎

**Time column**:
- If timer running on this task → red HH:MM:SS counter + stop button
- If not running → play button (click = start timer) + total logged time
- If task has no project → play button disabled + tooltip "Assign a project first"

**⋮ menu options**: Edit, Duplicate, Archive, Delete (admin only)

### Sort order
- **Default**: createdAt DESC (newest first) within groups
- Column header click: ASC/DESC toggle (v1: default only, v2: multi-sort)

## Filtering + grouping

### Filter panel (collapsible)
- **Client** dropdown (admin only — member doesn't see)
- **Project** dropdown
- **Assignee** dropdown (multi-select)
- **Category** dropdown
- **Date range** (from — to)
- Combinable (AND logic)
- **"Clear all"** button

### Grouping (Group by dropdown)
- Client (admin only)
- Project
- Assignee
- Status
- Category
- None (flat list)

Each group header: group name + task count. Collapsible.

### Search
- Title + project name, case-insensitive
- Search combines with filters (AND)

### Pagination
- 50 tasks/page
- "Load more" button at bottom
- Count in header: "All Tasks 67"

## Permission filtering

**Admin**: All tasks in the org.
**Member**: Only tasks where `assigneeIds` contains the member's userId. This filters at the query level, not the UI.

Filters also respect this: member doesn't see client/project filters, and tasks are automatically filtered to their own.

## Saved views

- Save a filter combination with a name
- **User-level** (each user saves their own, not org-level)
- **In sidebar below main nav** (global section, not nested under Tasks)
- CRUD: create ("Save current filters as..."), rename, delete
- Click in sidebar → loads the filters

**Filters JSON format** (in `savedViews.filters`):
```json
{
  "clientId": "client_123",
  "projectId": "project_456",
  "assigneeIds": ["user_1", "user_2"],
  "workCategoryId": "cat_789",
  "dateFrom": "2026-01-01",
  "dateTo": "2026-03-31",
  "tab": "active",
  "groupBy": "category"
}
```
**Graceful fallback**: If a field is unknown (new filter in v2) → ignore it, don't break.

## Task creation

### Inline creation (in the table)
- At the bottom of each group: "+ Add task..." row → click → title input (text field)
- Enter → creates: `{ title, statusId: inbox status, billable: true, assigneeIds: [], sortOrder: last+1 }`
- If grouped (e.g., by category: Design) → auto-inherits the group

### Mobile FAB button
- Floating action button, bottom-right on mobile
- Click → task create modal (title + optionally other fields)

### "+ New task" button (header)
- Same as FAB — modal form

### Auto-assign suggestion
If the task has a project and a category:
1. Check the project's `defaultAssignees` for this category
2. If found → "Assign to [name]?" suggestion (not auto-assign)
3. If not found → no suggestion

## Bulk operations

- **Max 50 selection** via checkboxes
- After selection, a toolbar appears:
  - **Status** dropdown → changes status of selected tasks
    - `type: done` → admin only!
  - **Assignee** dropdown → adds (doesn't replace)
  - **Category** dropdown → replaces
  - **Project** dropdown → replaces (only if no time entries on the tasks!)
  - **Archive** button → cascade archive (subtasks too)
- "X selected" count in toolbar
- "Deselect all" button

## Special rules

| Rule | How it's enforced |
|------|-------------------|
| No project → timer disabled | Time column: play button disabled + tooltip |
| Has time entries → project not changeable | Project dropdown: lock icon + tooltip "Has time entries" |
| Invoiced → read-only | Entire row grayed + lock badge (computed: `invoicedInReportId` check) |
| ✓ Fully invoiced badge | Admin only, computed: status.type = done + no unstamped billable entries |
| Member → no "done" | Status dropdown: done-type statuses disabled |
| Archive cascades to subtasks | In mutation: tasks with parentTaskId filtered also archived |
| Timers stop on archive | In mutation: users table timerTaskId check |

## Queries / Mutations

```
tasks.list           — filtered, paginated list (orgId, tab, filters, groupBy, search, limit, cursor)
                      Admin: all. Member: assigneeIds contains userId.
                      Returns: task + status + category + project + client + assignees + activity counts
tasks.get            — one task by ID (detailed — Phase 6)
tasks.create         — inline or modal creation
tasks.update         — inline editing (status, category, project, assignees)
tasks.archive        — soft delete (cascades to subtasks, stops timers)
tasks.restore        — unset archivedAt
tasks.remove         — hard delete, admin only (if has time → suggest archive)
tasks.duplicate      — copies: title, description, project, assignees, category, estimate, billable
                      Does NOT copy: subtasks, comments, attachments, time entries
tasks.bulkUpdate     — max 50 tasks, status/assignee/category/project/archive

savedViews.list      — user's saved views
savedViews.create    — save with name + filters JSON
savedViews.update    — rename
savedViews.remove    — delete
```

## Acceptance criteria

- [ ] Admin sees all tasks, member sees only assigned
- [ ] 6 tabs work with count badges (filtered by type)
- [ ] Table: 10 columns per screenshot
- [ ] Inline editing: status, category, client/project, assignee
- [ ] Filter panel: client, project, assignee, category, date range
- [ ] Grouping: client, project, assignee, status, category
- [ ] Search: title + project name
- [ ] Pagination: 50/page, load more
- [ ] Inline task creation ("+ Add task..." row)
- [ ] "+ New task" button and mobile FAB
- [ ] Bulk ops: status + assignee + category + project + archive (max 50)
- [ ] Member cannot mark done (type:done disabled)
- [ ] No project: timer disabled
- [ ] Has time entries: project not changeable
- [ ] Saved views: CRUD, loads from sidebar
- [ ] Duplicate: basic data yes, subtasks/comments/time no
- [ ] Archive: cascades to subtasks + timers stop
