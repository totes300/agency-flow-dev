# Phase 6 — Implementation Plan

> **Finalized**: Mar 18, 2026
> **Design reference**: Paper artboard "Task Detail — Final"
> **Depends on**: Phase 5 (Tasks Core) — complete
> **Ship strategy**: 4 sequential PRs

---

## Decisions Summary

All decisions made via design interview. This overrides/extends `phase-6-tasks-detail.md` where they differ.

| Topic | Decision |
|-------|----------|
| Modal type | Full overlay (ClickUp style) — left content + right activity sidebar |
| URL routing | Query param `?detail=taskId` — shareable, back button closes |
| Subtask navigation | Click subtask → replaces parent modal content (breadcrumb back) |
| Modal dismiss | Escape + backdrop click + X button |
| Sidebar | Always-visible Activity panel (comments + audit trail) |
| Left content | Tabs: Overview / Time / Attachments / Emails |
| Metadata layout | Two-column property grid with icons (ClickUp style), all fields always visible |
| Description editor | Tiptap — full toolbar, auto-save 1s debounce, stored as JSON |
| Comments | Rich text (mini Tiptap) with @mentions |
| Audit trail | Business-critical events only (see list below) |
| Subtask creation | Inline with quick-assign icons: status, category, assignee |
| Subtask reorder | Drag-and-drop with @dnd-kit |
| Subtask inherited fields | Project visible but locked with lock icon |
| Attachments | Full upload via Convex file storage (max 10MB/file, 20/task) |
| Emails tab | Placeholder — tab present, content deferred |
| Timer | In top bar (compact) + metadata Track Time row |
| Time tab | Entry table (Date, User, Duration, Note, Method) + manual entry form with quick buttons |
| Task actions menu | Copy link, Duplicate, Archive, Delete (admin only) |
| Keyboard nav | J/K to cycle tasks in current list |
| Tiptap bundle | Dynamic import via `next/dynamic` (lazy load, ~200KB) |
| Query strategy | Multiple independent Convex queries per section |
| Description storage | `v.any()` on tasks table, debounced mutation |
| Ship strategy | 4 sequential PRs |

---

## Audit Trail — Events to Log

New `activityLog` table: `{taskId, orgId, userId, type, metadata, createdAt}`

| Log (type) | metadata shape |
|------------|---------------|
| `task_created` | `{}` |
| `status_changed` | `{from: statusName, to: statusName, fromId, toId}` |
| `assignee_added` | `{userId, userName}` |
| `assignee_removed` | `{userId, userName}` |
| `category_changed` | `{from, to}` |
| `due_date_changed` | `{from, to}` |
| `project_changed` | `{from, to}` |
| `subtask_created` | `{subtaskId, title}` |
| `subtask_completed` | `{subtaskId, title}` |
| `subtask_deleted` | `{subtaskId, title}` |
| `time_entry_logged` | `{entryId, duration, note}` |
| `time_entry_edited` | `{entryId, oldDuration, newDuration}` |
| `time_entry_deleted` | `{entryId, duration}` |
| `comment_added` | `{commentId}` |
| `email_received` | `{emailId, subject}` (future) |
| `email_sent` | `{emailId, subject}` (future) |

**NOT logged**: estimate changes, billable toggle, title edits, description edits, sort order changes.

---

## Data Model Changes

### New tables

```typescript
// convex/schema.ts additions

activityLog: defineTable({
  taskId: v.id("tasks"),
  orgId: v.string(),
  userId: v.id("users"),
  type: v.string(), // union of event types above
  metadata: v.any(), // JSON per event type
  createdAt: v.number(),
})
  .index("by_task", ["taskId", "createdAt"])
  .index("by_org", ["orgId", "createdAt"]),

comments: defineTable({
  taskId: v.id("tasks"),
  orgId: v.string(),
  userId: v.id("users"),
  content: v.any(), // Tiptap JSON
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_task", ["taskId", "createdAt"]),

attachments: defineTable({
  taskId: v.id("tasks"),
  orgId: v.string(),
  userId: v.id("users"),
  fileId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(), // bytes
  mimeType: v.string(),
  createdAt: v.number(),
})
  .index("by_task", ["taskId", "createdAt"]),
```

### Tasks table additions

```typescript
// Existing tasks table — add:
description: v.optional(v.any()), // Tiptap JSON
```

---

## Convex Functions

### Queries (independent, parallel loading)

| Query | Returns | Used by |
|-------|---------|---------|
| `tasks.getDetail(taskId)` | Task + joined metadata (status, project, category, assignees) | Modal header + metadata |
| `tasks.getSubtasks(parentTaskId)` | Subtasks sorted by sortOrder, with status/category/assignee joins | Overview tab |
| `timeEntries.byTask(taskId)` | All time entries for task, with user joins, sorted by date desc | Time tab |
| `comments.byTask(taskId)` | Comments sorted by createdAt asc, with user joins | Activity sidebar |
| `activityLog.byTask(taskId)` | Activity events sorted by createdAt asc, with user joins | Activity sidebar |
| `attachments.byTask(taskId)` | Attachments sorted by createdAt desc | Attachments tab |

### Mutations

| Mutation | Does | Writes activity? |
|----------|------|-----------------|
| `tasks.updateDescription(id, content)` | Update Tiptap JSON | No |
| `tasks.updateDetail(id, fields)` | Update metadata fields (status, assignees, category, dueDate, project) | Yes — per field |
| `tasks.createSubtask(parentTaskId, title, statusId?, categoryId?, assigneeIds?)` | Create subtask with inheritance | Yes — `subtask_created` |
| `tasks.reorderSubtasks(parentTaskId, orderedIds)` | Update sortOrder | No |
| `comments.create(taskId, content)` | Create comment (Tiptap JSON) | Yes — `comment_added` |
| `comments.update(id, content)` | Edit own comment | No |
| `comments.remove(id)` | Delete own comment (admin: any) | No |
| `attachments.upload(taskId, fileId, fileName, fileSize, mimeType)` | Store attachment record | No |
| `attachments.remove(id)` | Delete attachment + storage file | No |

### Activity log helper

```typescript
// convex/activityLog.ts
export async function logActivity(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  type: string,
  metadata: Record<string, any>
) {
  const user = await getCurrentUserOrThrow(ctx);
  const task = await ctx.db.get(taskId);
  await ctx.db.insert("activityLog", {
    taskId,
    orgId: task!.orgId,
    userId: user._id,
    type,
    metadata,
    createdAt: Date.now(),
  });
}
```

This helper is called inside existing mutations (e.g. `tasks.update`) when relevant fields change. It compares before/after values and only logs if actually changed.

---

## Component Architecture

```
app/(dashboard)/tasks/page.tsx              ← existing, add detail param handling
components/tasks/
  task-detail-modal.tsx                     ← orchestrator: reads ?detail=, renders overlay
  task-detail-header.tsx                    ← top bar: nav arrows, breadcrumb, timer, actions
  task-detail-metadata.tsx                  ← property grid (ClickUp style, 2-col)
  task-detail-tabs.tsx                      ← tab bar + tab content routing
  task-detail-overview.tsx                  ← description + subtasks
  task-detail-time.tsx                      ← time entries table + manual entry form
  task-detail-attachments.tsx               ← file upload + list
  task-detail-emails.tsx                    ← placeholder
  task-detail-sidebar.tsx                   ← activity feed + comment input
  task-detail-activity-feed.tsx             ← merged comments + audit events timeline
  task-detail-comment-input.tsx             ← mini Tiptap for comments
  tiptap-editor.tsx                         ← full Tiptap editor (dynamic import)
  tiptap-toolbar.tsx                        ← toolbar for the Tiptap editor
  subtask-list.tsx                          ← subtask rows with DnD
  subtask-inline-create.tsx                 ← inline creation row with quick-assign
  subtask-row.tsx                           ← individual subtask row
  time-entry-table.tsx                      ← time entries list for Time tab
  time-entry-form.tsx                       ← manual entry form + quick buttons
  attachment-list.tsx                       ← attachment grid/list
  attachment-upload.tsx                     ← drag-and-drop upload zone
```

### Key patterns

- **Modal**: Uses Radix Dialog (`DialogContent`) with custom full-overlay sizing
- **URL sync**: `useSearchParams` reads `?detail=taskId`, `router.push` updates it
- **Keyboard nav**: `useEffect` on `keydown` for J/K (requires knowing task list order — pass via context or prop)
- **Metadata fields**: Each field is click-to-edit, reusing existing inline cell popover patterns (Command dropdown, date picker, etc.)
- **Tiptap**: `next/dynamic(() => import('./tiptap-editor'), { ssr: false, loading: () => <EditorSkeleton /> })`
- **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable` for subtask reordering
- **Activity feed**: Merge `comments` + `activityLog` queries client-side, sort by `createdAt`, render different components per type

---

## Modal Layout (matches Paper mockup)

```
┌──────────────────────────────────────────────────────────────┐
│ < >  Acme Corp / Brand Refresh   [▶ 9:00] Created Mar 18 ⋮ ✕│  ← top bar
├──────────────────────────────────────────┬───────────────────┤
│                                          │ Activity          │
│  Design homepage hero section            │ ─────────────     │
│                                          │ audit events...   │
│  ◎ Status    [● In Progress]  👤 Assign  │ comment cards...  │
│  📁 Project  Brand Refresh    🏷 Category│                   │
│  📅 Due date Mar 22           ⏱ Estimate │                   │
│  💰 Billable [✓]              🕐 Tracked │                   │
│                                          │                   │
│  [Overview] [Time] [Attachments] [Emails]│                   │
│  ─────────────────────────────────────── │                   │
│                                          │                   │
│  (tab content — scrollable)              │ [Write comment...]│
│                                          │ [Comment ▾] B I @ │
├──────────────────────────────────────────┴───────────────────┤
└──────────────────────────────────────────────────────────────┘
```

### Overview tab content order:
1. Description (Tiptap editor with toolbar)
2. Subtasks (header with progress + list with DnD + inline create)

### Time tab content:
1. Timer start/stop widget (if project assigned)
2. Time entry table (Date, User, Duration, Note, Method, ⋮ menu)
3. Manual entry form (duration input + note + date picker + quick buttons + "Log time")

---

## PR Breakdown

### PR1: Modal Foundation
**Scope**: Shell, header, metadata, tabs, URL routing, keyboard nav

**Files**:
- `components/tasks/task-detail-modal.tsx` — overlay shell, URL sync, escape/backdrop
- `components/tasks/task-detail-header.tsx` — nav arrows, breadcrumb, timer button, actions menu
- `components/tasks/task-detail-metadata.tsx` — property grid (reuses existing inline cell patterns)
- `components/tasks/task-detail-tabs.tsx` — tab bar
- `components/tasks/task-detail-emails.tsx` — placeholder
- Update `app/(dashboard)/tasks/page.tsx` — read `?detail=` param, render modal
- Update `components/tasks/task-row.tsx` — click handler sets `?detail=taskId`

**Convex**:
- `tasks.getDetail` query (or extend existing)

**New deps**: none

**Acceptance**:
- [ ] Click task row → modal opens, URL updates to `?detail=taskId`
- [ ] Back button / Escape / backdrop click closes modal
- [ ] All metadata fields editable (click-to-edit popovers)
- [ ] J/K keyboard nav cycles tasks
- [ ] Timer button in top bar starts/stops timer
- [ ] ⋮ menu: Copy link, Duplicate, Archive, Delete
- [ ] Tabs render (content placeholder for now)

---

### PR2: Content + Subtasks
**Scope**: Tiptap editor, subtask enhancements, DnD reorder

**Files**:
- `components/tasks/tiptap-editor.tsx` — full editor (dynamic import)
- `components/tasks/tiptap-toolbar.tsx` — formatting toolbar
- `components/tasks/task-detail-overview.tsx` — description + subtasks
- `components/tasks/subtask-list.tsx` — DnD sortable list
- `components/tasks/subtask-row.tsx` — individual row
- `components/tasks/subtask-inline-create.tsx` — inline create with quick-assign

**Convex**:
- `tasks.updateDescription` mutation
- `tasks.createSubtask` mutation (with inheritance logic)
- `tasks.getSubtasks` query
- `tasks.reorderSubtasks` mutation
- Validation: max 1 level depth, projectId must match parent

**New deps**: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-mention`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**Acceptance**:
- [ ] Tiptap editor with full toolbar (B, I, lists, headings, code, link, image, @mention, task list)
- [ ] Auto-save description (1s debounce)
- [ ] Subtask list with DnD reorder (drag handles)
- [ ] Inline subtask creation with status/category/assignee quick-assign
- [ ] Subtask click → replaces modal content, back arrow returns to parent
- [ ] Subtask detail: project field visible but locked
- [ ] Progress bar on subtask header: "2/3 done"
- [ ] Max 1 level validation (subtask cannot have subtasks)

---

### PR3: Activity + Comments
**Scope**: activityLog table, activity sidebar, rich text comments

**Files**:
- `components/tasks/task-detail-sidebar.tsx` — sidebar shell
- `components/tasks/task-detail-activity-feed.tsx` — merged timeline
- `components/tasks/task-detail-comment-input.tsx` — mini Tiptap
- `convex/activityLog.ts` — queries + logActivity helper
- `convex/comments.ts` — CRUD queries/mutations
- Update existing mutations to call `logActivity()`:
  - `convex/tasks.ts` — status, assignee, category, dueDate, project changes + subtask events
  - `convex/timeEntries.ts` — log/edit/delete events

**Schema changes**:
- Add `activityLog` table
- Add `comments` table

**Acceptance**:
- [ ] Activity sidebar always visible on right
- [ ] Audit events: task created, status change (with badge), assignee add/remove, subtask created/completed/deleted, time logged/edited/deleted, category/due/project changed
- [ ] Comments: rich text with @mentions, avatar + name + timestamp
- [ ] Comment input: mini Tiptap with B/I/@/toolbar + "Comment" button
- [ ] Merged timeline: comments + audit events sorted by createdAt
- [ ] Edit/delete own comments (admin: delete any)

---

### PR4: Attachments + Time Tab + Polish
**Scope**: File uploads, time entries table, email placeholder, polish

**Files**:
- `components/tasks/task-detail-attachments.tsx` — upload zone + file list
- `components/tasks/attachment-upload.tsx` — drag-and-drop
- `components/tasks/attachment-list.tsx` — file grid with thumbnails
- `components/tasks/task-detail-time.tsx` — time tab orchestrator
- `components/tasks/time-entry-table.tsx` — entry list
- `components/tasks/time-entry-form.tsx` — manual entry + quick buttons
- `convex/attachments.ts` — upload/delete mutations + query

**Schema changes**:
- Add `attachments` table

**Acceptance**:
- [ ] Time tab: entry table (Date, User, Duration, Note, Method, ⋮)
- [ ] Manual time entry form with quick buttons (15m, 30m, 1h, 2h, 4h, 8h)
- [ ] Duration parser (30m, 2h, 1h 30m, 1:30, 1.5, 90)
- [ ] Invoiced entries: lock icon, not editable
- [ ] Members: can only edit/delete own entries
- [ ] Attachments: drag-and-drop + click upload
- [ ] Image thumbnails, file icons for non-images
- [ ] Max 10MB/file, 20 files/task validation
- [ ] Emails tab: "Email integration coming soon" placeholder
- [ ] Loading skeletons for all sections (content-aware)
- [ ] Mobile responsive considerations
- [ ] `npx tsc --noEmit` passes with 0 errors

---

## Dependencies to Install

```bash
# PR2
npm install @tiptap/react @tiptap/starter-kit @tiptap/pm @tiptap/extension-placeholder @tiptap/extension-link @tiptap/extension-image @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-mention @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# No new deps for PR1, PR3, PR4
```

---

## Performance Considerations

- **Tiptap**: Dynamic import, only loads when modal opens (~200KB)
- **Independent queries**: Adding a comment doesn't re-fetch time entries
- **Activity feed merge**: Client-side merge of comments + activityLog (both small arrays)
- **Subtask DnD**: Optimistic reorder on client, mutation fires in background
- **Description auto-save**: 1s debounce prevents mutation spam
- **Attachment thumbnails**: Convex `getUrl()` for storage files, lazy load images
- **Keyboard nav**: Requires knowing task list order — pass ordered IDs via context from task list

---

## Backlog / Deferred

- [ ] Subtask: drag between parent tasks (Phase ?)
- [ ] Comments: edit history (Phase ?)
- [ ] Comments: reactions/emoji (Phase ?)
- [ ] Emails tab: full implementation (dedicated phase)
- [ ] Activity: filter by event type
- [ ] Activity: pagination (currently loads all — fine for <500 events)
- [ ] Description: collaborative editing (Tiptap Collab — requires Hocuspocus server)
- [ ] Attachments: preview modal for images/PDFs
- [ ] Attachments: version history
- [ ] Time tab: export to CSV
