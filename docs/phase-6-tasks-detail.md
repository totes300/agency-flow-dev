# Phase 6 — Tasks Detail + Subtasks

> **Goal**: The task detail modal (4 tabs) and the subtask lite system.
> **Depends on**: Phase 5 (Tasks Core)

---

## Decisions

| Question | Decision |
|----------|----------|
| Task detail UI? | Centered modal (Linear/Asana pattern), not drawer, not separate page |
| Rich text editor? | Tiptap, auto-sav, stored as Tiptap JSON |
| Subtasks in v1? | ✅ Lite version: same entity (parentTaskId), lives in parent detail, not in main list |
| Max depth? | 1 level (subtask cannot have subtasks) |
| Subtask inheritance? | projectId must match parent's (not overridable), billable defaults to parent's |
| Subtask in main list? | No — only progress numbers on parent row ("2/3 done") - nor progress bars
| Subtask in billing view? | Nested rows under parent: "↳ Build components · Dev · 04:00" |
| Comments tab? | beatufil tip tab editor and timeline view of comments from pepople |
| Attachments tab? |   |
Email tabs- we will having emails coming into the software under semails tab and i can create a task from an eam or attach e,mail to alredy exsitsing task. Right now just create the placeholder for it i will develop this feature later but i need the tab to be ready. 

---

## Task detail modal

**Centered modal** (Linear/Asana pattern). Opens on: click a task row in the table.

### Modal layout

```
┌──────────────────────────────────────────────────┐
│  ← Back                          [Status ▾] [⋮] │
│                                                  │
│  Task title (editable, click-to-edit)            │
│  Project: Acme / Brand Refresh   Category: Design│
│  Assignees: [Adam] [Emma]        Billable: ✓     │
│  Due date: Mar 22                Estimate: 8:00   │
│                                                  │
│  [Overview] [Time] [Comments] [Attachments]      │
│  ─────────────────────────────────────────────── │
│                                                  │
│  (tab content)                                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Header metadata
All fields editable (click-to-edit):
- **Title**: large text, inline edit
- **Status**: dropdown (custom statuses from statuses table, colored badge)
- **Project**: dropdown (client / project pair display)
- **Category**: dropdown (work categories, color badge)
- **Assignees**: multi-select user dropdown (avatar + name)
- **Billable**: toggle/checkbox
- **Due date**: date picker ("Overdue" in red if past)
- **Estimate**: time input (HH:MM format, stored in minutes)

### Tab 1: Overview

**Description (Rich text)**:
- **Tiptap editor** (rich text, not plain text)
- **Auto-save**: 1 second debounce — user types, saves after 1s of inactivity
- Formatting: bold, italic, bullet list, numbered list, headings, code, links
- Placeholder: "Add a description..."

**Subtasks section** (see details below):
- List of subtasks
- "+ Add subtask" button
- Progress bar: "2/3 done"

**Timer section**:
- If timer running on this task: HH:MM:SS counter + Stop button + Discard button
- If not running: Play button + "Start timer"
- If no project: disabled + "Assign a project to start tracking time"

### Tab 2: Time

Time entries for this task. **Phase 7 (Time Tracking) implements the full logic**, this phase builds the UI.

**Time entry list**:
- Table: Date · User (avatar + name) · Duration · Note · Method (timer/manual icon) · ⋮ menu
- ⋮ menu: Edit, Delete
- Invoiced entry: lock icon, not editable/deletable
- Member: can only edit/delete their own entries

**Manual entry form** (below the list):
- Duration input: parses 30m, 2h, 1h 30m, 1:30, 1.5, 90
- Note input (optional)
- Date picker (default: today)
- Quick buttons: 15m · 30m · 45m · 1h · 2h · 3h · 4h · 6h · 8h
- "Log time" button

### Tab 3: Comments

**Phase 2 (Collaboration) implements** — Phase 6 placeholder:
- "Comments coming soon" message
- Or: simple plain text comments (not rich text, no @mentions)

### Tab 4: Attachments

**Phase 2 (Collaboration) implements** — Phase 6 placeholder:
- "Attachments coming soon" message
- Or: simple file upload (Convex file storage, max 10MB, max 20/task)

### Tab 4: Emails

---

## Subtask  system

### Data model
- Subtask = **task** in the tasks table, with `parentTaskId` set
- **Same entity**: has its own statusId, assigneeIds, workCategoryId, time entries, etc.
- **Max 1 level**: subtask cannot have subtasks (validated in mutation)
- **Inheritance**: projectId must match parent's (not overridable)

### Where they appear

| Context | Appearance |
|---------|-----------|
| **Main task list** | NOT shown independently. Parent row shows progress: "2/3 done" |
| **Parent detail modal (Overview tab)** | List: subtasks in order, editable |
| **Project monthly breakdown (billing view)** | Nested under parent: "↳ Build components · Dev · 04:00" |

### Subtask list in parent detail

```
Subtasks (2/3 done)                    [+ Add subtask]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☑ Design mockups          [Design] [Peti]    done     05:00
☐ Build components        [Dev]    [Anna]    in_prog  04:00
☐ Write copy              [Copy]   [-]       inbox    03:00
```

Each subtask row:
- Checkbox (done toggle — switches to type:done status)
- Title (clickable → opens the subtask's own detail modal)
- Category badge
- Assignee avatar
- Status badge
- timer component
- ⋮ menu: Edit, Archive, Delete

### Subtask creation
- "+ Add subtask" button below the subtask list
- Inline: title input → Enter → created
- Auto-inheritance: projectId = parent's projectId, billable = parent's billable, category=parents category, assignee = parents asignee


### Subtask reordering
- Drag handle or up/down arrows in parent detail
- `sortOrder` field on the tasks table

### Progress bar
- On parent task row (main list): "2/3 done" progress bar
- Computed: `subtasks where type = done` / `total subtasks`
- If no subtasks: not shown

## Queries / Mutations

```
tasks.getDetail       — one task's full details (metadata + subtasks + time entries)
tasks.updateDetail    — description, assignees, category, estimate, billable, dueDate
tasks.createSubtask   — subtask creation (parentTaskId required, max 1 level validation)
tasks.reorderSubtasks — subtask sortOrder update
tasks.getSubtasks     — a parent task's subtasks (sorted by sortOrder)
```

## Acceptance criteria

- [ ] Task detail modal opens on row click
- [ ] Header metadata editable (title, status, project, category, assignees, billable, due, estimate)
- [ ] Overview tab: Tiptap rich text editor, auto-save 1s debounce
- [ ] Time tab: time entry list + manual entry form (Phase 7 implements logic)
- [ ] Comments tab: placeholder (or basic plain text)
- [ ] Attachments tab: placeholder (or basic upload)
- [ ] Subtask creation in parent detail (inline, "+ Add subtask")
- [ ] Subtask list: checkbox, title, category, assignee, status, logged time
- [ ] Subtask detail modal: own modal, "Subtask of: [parent]" header
- [ ] Subtask: projectId inherited from parent (not editable)
- [ ] Subtask: max 1 level (subtask cannot have subtasks)
- [ ] Subtask reordering (drag or up/down arrows)
- [ ] Progress bar on parent row: "2/3 done"
- [ ] Project monthly breakdown: subtasks as nested rows (↳)
