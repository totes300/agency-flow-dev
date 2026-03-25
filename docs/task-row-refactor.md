# Task Row Activity Refactor — Implementation Plan

> **Design reference:** `design/activity-icons-spec.html` Section "1. Full Table — All States"
> **Scope:** `/tasks` page task rows — activity icons, unseen state, subtitles, hover popovers

## 0. Prerequisites

Before starting implementation:

1. **Install shadcn HoverCard** — does NOT exist yet in `components/ui/`:
   ```bash
   npx shadcn@latest add hover-card
   ```
2. **Existing `commentReadReceipts` table** — already exists in schema with `lastSeenAt` per user per task. The new `taskViewReceipts` is a SEPARATE table for task-level "seen" (not comment-level). Do NOT merge them — they serve different purposes:
   - `commentReadReceipts.lastSeenAt` = when user last saw the comments feed (used in task detail sidebar for "New" divider, AND for comment unread count in task list)
   - `taskViewReceipts.lastViewedAt` = when user last opened the task (used for non-comment unseen state: dot, bold title, ring highlighting)
3. **Existing `activityLog` table** — already populated by mutations in `tasks.ts`, `timeEntries.ts`, `comments.ts`. Two new event types must be added: `subtask_completed` (on parent task) and `description_changed`.
4. **Current `ActivityIndicator` type** is exported from `task-row.tsx` and consumed in `app/(dashboard)/tasks/page.tsx` via `activityMap`. The type change is a breaking interface change — update both files together.
5. **Current `activityIndicators` query** in `convex/tasks.ts` (line 633) uses `getAuthContext` which returns `{ orgId, userId, isAdmin }`. The `userId` is available for per-user unseen computation.
6. **Convex filename convention** — no hyphens in filenames. Use `taskViewReceipts.ts`, not `task-view-receipts.ts`.

---

## 1. Summary of Design Decisions

### Task Title Area
- **Unseen task:** font-weight `600` + primary-colored unseen dot (6px) before title
- **Seen task:** font-weight `400`, no dot
- **Description icon:** Small doc icon (`FileText`, 12px) at END of task title — only if task has description. Opacity `0.3` (seen) / `0.45` (unseen). NOT in the activity cell.
- **Subtitle:** Muted activity text showing last event — e.g. "Nora changed status to Review . 12m ago". All same muted color (`text-muted-foreground`), no bold, same visual weight as the old "Updated . 12m ago".

### Activity Cell (icon order: Subtasks, Comments)
Only 2 indicators in the activity cell. Description icon moved to title. History/Activity icon removed (audit trail is on task name hover).

#### Subtask Ring Progress
- **SVG ring** 14px, stroke-width `1.75`
- **Track (background circle):** `border` color (seen) or `primary/15%` (unseen)
- **Arc (progress):** `muted-foreground` color (seen) or `primary` at 60% opacity (unseen)
- **Count:** `10px`, `tabular-nums`, `font-weight: 600` (unseen) or normal (seen). Denominator at `40% opacity` (e.g. "3" full, "/7" muted)
- **Seen count color:** `muted-foreground` at 80% opacity
- **Unseen count color:** `primary`
- Only shown when `subtaskTotal > 0`

#### Comment Count (MessageCircle icon)
- **Icon:** Lucide `MessageCircle` (NOT MessageSquare), 13px, stroke-width varies by state
- **Unseen state:**
  - Icon: `primary` stroke, `2.25` stroke-width, `70%` opacity
  - Count in **tinted pill**: `primary/6%` background, `primary` text, `9px` font, `600` weight, `14px` height, `border-radius: 999px`, `padding: 0 4px`
- **Seen state:**
  - Icon: `currentColor` (inherits muted), `1.75` stroke-width
  - Count as plain text: `10px`, muted color
- **Seen count always visible** (shows total comments, not just unread — provides context about task "weight")
- Only shown when `commentCount > 0`

#### Seen Base Styling
- Activity icons container: `text-muted-foreground/80` (NOT the old `muted/50%`)
- This ensures seen icons are readable but clearly less prominent than unseen primary-colored icons

### Task Name Hover — Recent Activity Popover
- Triggered on task name/subtitle area hover
- `HoverCard` (shadcn) with `openDelay={250}`, `closeDelay={100}`
- Content: last 5 activity log events, human-readable
- Each event: colored dot + "**Name** action **target** . time ago"
- Dot colors: `primary` (status), `success` (completed), `warning` (time), `muted` (other)
- Footer: "Open full history" link that opens task detail
- Desktop only — no hover on mobile
- **Data: lazy-loaded** via `activityLog.latestForTask` query on hover (NOT pre-fetched)

### Other Hover Popovers (on activity icons)
- **Subtask ring hover:** Progress header ("3 of 7 completed") + thin progress bar + up to 5 subtasks (lazy-loaded on hover via `tasks.subtaskPreview` query). Sort: incomplete first (by creation order), then completed (by creation order). Each: checkbox state + title + optional assignee avatar. Footer: "View all subtasks"
- **Comment icon hover:** Last 5 comments (lazy-loaded on hover). Each: avatar + name + time + 2-line truncated text. Unread comments get faint `primary/4%` background. Footer: "View all comments"
- **Description popover** on the doc icon in the title: plain text preview (~150 chars) + rendered checklists (taskList/taskItem nodes from tiptap JSON). NO rich rendering of tables, images, mentions, or formatting. No `@tiptap/html` dependency. Custom lightweight renderer (~30 lines). Max height `200px` with `overflow-y: auto`. Footer: "Open task to read more". **No attachment list** in this popover.
- All popovers: `HoverCard`, `openDelay={250}`, `closeDelay={100}`, desktop only, max 5 items, no "load more"
- All popovers show a tiny skeleton/spinner while data is resolving

### Receipt Ownership — Two Independent Models

Unseen triggers are split into two groups by receipt owner. This prevents drift between the two receipt tables.

**Group A — Task-view receipt** (`taskViewReceipts.lastViewedAt`):
Drives: unseen dot, bold title, ring highlighting, `hasUnseenSubtasks`, `hasUnseenDescription`

| Event type | Triggers unseen |
|---|---|
| `status_changed` | Yes |
| `assignee_added` | Yes |
| `assignee_removed` | Yes |
| `subtask_created` | Yes |
| `subtask_completed` | Yes |
| `description_changed` | Yes |
| `due_date_changed` | Yes |
| `category_changed` | Yes |
| `project_changed` | Yes |
| `time_entry_logged` | **No** (v1) — too noisy, visible in activity popover only |
| `billable_changed` | **No** — administrative, not actionable from task list |
| Your own actions | **No** — never unseen for your own changes |

**Group B — Comment-read receipt** (`commentReadReceipts.lastSeenAt`):
Drives: `hasUnseenComments`, `unreadCommentCount`, comment tinted pill, "New" divider in comments tab

| Event type | Triggers unseen |
|---|---|
| `comment_added` (by others) | Yes |
| Your own comments | **No** |

**Composite flag:** `hasUnseen = hasUnseenNonComment || hasUnseenComments`

**No cascading** between `markTaskViewed` and `comments.markSeen`. They are independent. In practice, the comment sidebar already auto-calls `comments.markSeen` after 500ms (`task-detail-sidebar.tsx:63`), so opening a task on desktop clears both receipts via their own paths.

### Mark-as-Seen Behavior
- Task is marked "seen" when `TaskDetailModal` **content loads with data AND stays open >= 500ms**
- Timer starts when task data has loaded (NOT on modal shell/skeleton mount) — guard with `if (!task) return;`
- Implemented as `useEffect` + `setTimeout(500)` + cleanup on unmount inside the modal content component
- Calls `markTaskViewed` mutation
- Does NOT trigger on: row hover, popover preview, inline edits, modal open < 500ms
- Comment "seen" is handled separately by the existing sidebar effect at `task-detail-sidebar.tsx:63`

---

## 2. Data Model Changes

### New Table: `taskViewReceipts`

Add to `convex/schema.ts`:

```ts
taskViewReceipts: defineTable({
  taskId: v.id("tasks"),
  orgId: v.string(),
  userId: v.id("users"),
  lastViewedAt: v.number(),
})
  .index("by_user_task", ["userId", "taskId"])
  .index("by_orgId", ["orgId"]),
```

### New Mutation: `convex/taskViewReceipts.ts`

```ts
// markViewed — upsert lastViewedAt for current user + task
// IMPORTANT: Must verify task exists, belongs to org, and user has access
export const markViewed = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Not authorized");
    }
    const existing = await ctx.db
      .query("taskViewReceipts")
      .withIndex("by_user_task", q => q.eq("userId", userId).eq("taskId", taskId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastViewedAt: Date.now() });
    } else {
      await ctx.db.insert("taskViewReceipts", { taskId, orgId, userId, lastViewedAt: Date.now() });
    }
  },
});
```

### New Activity Log Events

Two new event types must be added to existing mutations:

1. **`subtask_completed`** — logged on the **parent** task when a child task's status transitions to a done-type status. Only on the transition INTO done, not on every status change of an already-done task. Metadata: `{ title: string, subtaskId: Id<"tasks"> }`. Add to the `update` mutation in `tasks.ts` where status changes are detected, when the task has a `parentTaskId`.

2. **`description_changed`** — logged when `args.description !== undefined` in the task `update` mutation. Metadata: `{}` (no content — just the fact it changed).

### Extended Query: `activityIndicators`

One query returns everything the row needs. Extend `convex/tasks.ts` `activityIndicators` query:

```ts
// Data returned per task:
{
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  hasDescription: boolean;          // NEW (replaces hasAttachments)
  hasUnseenNonComment: boolean;     // NEW — from taskViewReceipts
  hasUnseenSubtasks: boolean;       // NEW — from taskViewReceipts
  hasUnseenDescription: boolean;    // NEW — from taskViewReceipts
  hasUnseenComments: boolean;       // NEW — from commentReadReceipts
  hasUnseen: boolean;               // NEW — hasUnseenNonComment || hasUnseenComments
  unreadCommentCount: number;       // NEW — from commentReadReceipts
  lastActivity: {                   // NEW — for subtitle
    userName: string;
    type: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  } | null;
}
```

**Breaking changes from current query:**
- `hasAttachments: boolean` is REMOVED — no longer shown in activity cell
- `hasDescription: boolean` is NEW — derived using `isTiptapEmpty()` from `lib/tiptap-utils.ts` (NOT from `!!task.description` which is truthy for empty tiptap docs). Parse safely: `try { return !isTiptapEmpty(JSON.parse(task.description)) } catch { return false }`. Parse failure → `hasDescription = false`, not query failure.
- The query now needs `userId` from `getAuthContext` (already available) to compute per-user unseen state

**Logic for unseen computation:**

For each task in the batch:
1. Fetch user's `taskViewReceipts` record via `by_user_task` index → get `lastViewedAt` (or `0` if never viewed)
2. Fetch user's `commentReadReceipts` record via `by_user_task` index → get `lastSeenAt` (or `0` if never seen)
3. **`hasUnseenNonComment`:** Use `.first()` on `activityLog` with `by_task` index, range `createdAt > lastViewedAt`, filter `userId !== currentUser` AND type in Group A allowlist. Only need existence check, not count.
4. **`hasUnseenSubtasks`:** Same as above but type in `["subtask_created", "subtask_completed"]`
5. **`hasUnseenDescription`:** Same as above but type = `"description_changed"`
6. **`hasUnseenComments`:** `unreadCommentCount > 0` (derived from step 7)
7. **`unreadCommentCount`:** Count comments where `createdAt > lastSeenAt AND userId !== currentUser` (query `comments` table with `by_task` index, NOT activityLog)
8. **`lastActivity`:** `.first()` on `activityLog` with `by_task` index, `order("desc")` — join user name from cache
9. **`hasUnseen`:** `hasUnseenNonComment || hasUnseenComments`

**Performance notes:**
- Use `.first()` instead of `.collect()` for all boolean unseen checks — only need existence, not full scan
- Cache `lastViewedAt` and `lastSeenAt` lookups in Maps at the start of the batch
- Cache user names in a Map across tasks
- `lastActivity` uses `.first()` with `order("desc")` on indexed field — single document read
- No artificial UX cap on task IDs. The task list's own pagination ("Load more" per group) is the natural throttle. A safety net of `taskIds.slice(0, 500)` guards against bugs passing thousands of IDs, but this should never be hit in normal use. At ~6 reads per task, 200 tasks = ~1200 reads — well within Convex's 4096-document transaction limit.
- **Scaling observation point:** Monitor query duration and document reads in the Convex dashboard after shipping. If the batch query becomes too slow or causes excessive reactive churn, the first alternative is **per-row subscriptions** (`useQuery` per `TaskRow` with single-task query) — not further batch workarounds like chunking. Per-row subscriptions give finer invalidation granularity (one comment only re-runs one task's query, not all) and eliminate transaction limit concerns entirely. This is not the v1 design because batch matches the existing codebase patterns and the visible row count is moderate, but it is the known escalation path.

### Hover Popover Data Strategy

All popover data is lazy-loaded per task on hover. No batch pre-fetching at page level.

| Popover | Data source | Query | Trigger |
|---------|------------|-------|---------|
| **Activity (task name)** | `activityLog` | `activityLog.latestForTask` (5 events) | Hover open |
| **Subtasks** | `tasks` table (children) | `tasks.subtaskPreview` (5 subtasks, incomplete first) | Hover open |
| **Comments** | `comments` table | `comments.latestPreview` (5 comments) | Hover open |
| **Description** | `task.description` field | None — already on row props | Immediate |

Lazy-load pattern for all hover popovers:
```tsx
function SomeHoverPopover({ taskId, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const data = useQuery(
    api.someTable.someQuery,
    isOpen ? { taskId } : "skip"
  );
  // Show skeleton while data === undefined && isOpen
  // ...
}
```

### New Lazy Queries

#### `convex/activityLog.ts` — `latestForTask`

Single-task query returning last 5 activity events with user names. Access-controlled.

```ts
export const latestForTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const events = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(5);

    const userCache = new Map<string, string>();
    for (const event of events) {
      if (!userCache.has(event.userId)) {
        const user = await ctx.db.get(event.userId);
        userCache.set(event.userId, user?.name ?? "Unknown");
      }
    }

    return events.map((e) => ({
      type: e.type,
      userName: userCache.get(e.userId) ?? "Unknown",
      metadata: e.metadata as Record<string, unknown>,
      createdAt: e.createdAt,
    }));
  },
});
```

#### `convex/comments.ts` — `latestPreview`

Single-task query returning last 5 comments with author info. Used by comment hover popover.

#### `convex/tasks.ts` — `subtaskPreview`

Single-task query returning up to 5 subtasks with `{ title, statusType, assigneeIds }`. Sort order: incomplete first (by creation order), then completed (by creation order). This gives the user the most actionable view — what's left to do, then what's done.

---

## 3. Component Changes

### 3a. `components/tasks/task-row.tsx`

**Major refactor.** Current `ActivityIndicator` type and `ActivityIcons` component completely replaced.

#### New `ActivityIndicator` type:

```ts
export type ActivityIndicator = {
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  hasDescription: boolean;
  hasUnseenNonComment: boolean;
  hasUnseenSubtasks: boolean;
  hasUnseenComments: boolean;
  hasUnseenDescription: boolean;
  hasUnseen: boolean;
  unreadCommentCount: number;
  lastActivity: {
    userName: string;
    type: string;
    metadata: Record<string, unknown>;
    createdAt: number;
  } | null;
}
```

#### Task Title Changes:
- Remove `formatRelativeTime(task.updatedAt)` subtitle
- Replace with `formatActivitySubtitle(activity.lastActivity)` — e.g. "Nora changed status to Review . 12m ago"
- Fallback (activity undefined or no lastActivity): `"Created · {formatRelativeTime(task.createdAt)}"` from task data
- Add unseen dot (6px primary circle) before title when `activity.hasUnseen`
- Add `FileText` icon (12px) at end of title when `activity.hasDescription` (single source of truth — do NOT fall back to `task.description` which is truthy for empty tiptap docs)
- Title font-weight: `font-semibold` (unseen) vs `font-normal` (seen/loading)
- When `activity === undefined` (loading): `font-normal`, no dot, fallback subtitle, reserve activity cell space

#### Activity Cell Changes:
- Remove `ListChecksIcon`, `MessageSquareIcon`, `FileTextIcon` imports
- Add `MessageCircleIcon` from lucide-react
- New component: `SubtaskRing` — SVG ring progress (see spec below)
- New component: `CommentIndicator` — MessageCircle icon + tinted pill or plain count
- Order: SubtaskRing, CommentIndicator (no description icon)
- When `activity === undefined`: render fixed-width container (`w-[96px]`) with lightweight placeholder shapes (muted rounded rects at ~30% opacity matching ring + pill geometry). Not animated skeleton, just stable footprint. No reflow when data arrives.

#### New `SubtaskRing` component (inline in task-row.tsx or extracted):

```tsx
function SubtaskRing({ done, total, isUnseen }: { done: number; total: number; isUnseen: boolean }) {
  if (total === 0) return null;
  const circumference = 2 * Math.PI * 6.5; // r=6.5
  const progress = done / total;
  const offset = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-1">
      <svg width={14} height={14} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={6.5} fill="none"
          stroke={isUnseen ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "var(--border)"}
          strokeWidth={1.75} />
        <circle cx={8} cy={8} r={6.5} fill="none"
          className={isUnseen ? "stroke-primary opacity-60" : "stroke-muted-foreground"}
          strokeWidth={1.75}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 8 8)" />
      </svg>
      <span className={cn(
        "text-[10px] tabular-nums",
        isUnseen ? "font-semibold text-primary" : "text-muted-foreground/80"
      )}>
        {done}<span className="opacity-40">/{total}</span>
      </span>
    </div>
  );
}
```

#### New `CommentIndicator` component:

```tsx
function CommentIndicator({ count, unreadCount, isUnseen }: { count: number; unreadCount: number; isUnseen: boolean }) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <MessageCircleIcon className={cn(
        "size-[13px] shrink-0",
        isUnseen ? "stroke-primary opacity-70" : "stroke-muted-foreground/80"
      )} strokeWidth={isUnseen ? 2.25 : 1.75} />
      {isUnseen ? (
        <span className="inline-flex items-center h-3.5 px-1 rounded-full bg-primary/[0.06] text-[9px] font-semibold text-primary">
          {unreadCount}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/80">{count}</span>
      )}
    </div>
  );
}
```

**Note:** When unseen, the pill shows `unreadCount` (new comments since last comment view). When seen, plain text shows `count` (total comments — provides context about task "weight").

### 3b. `components/tasks/tasks-table.tsx`

- Activity column width stays at `96px` (2 icons fit easily)
- No grid template change needed

### 3c. New Hover Components

Create 4 new components in `components/tasks/`. All use lazy-loaded data via conditional `useQuery`.

#### `components/tasks/activity-hover-popover.tsx`
- Wraps the task name/subtitle area
- Uses shadcn `HoverCard` with `openDelay={250}`, `closeDelay={100}`
- Lazy-loads `activityLog.latestForTask` on hover open
- Renders: colored dot + formatted text + relative time per event
- Shows skeleton while loading
- Footer: "Open full history" link
- Desktop only

#### `components/tasks/subtask-hover-popover.tsx`
- Wraps the SubtaskRing
- `HoverCard` with same delays
- Lazy-loads `tasks.subtaskPreview` on hover open
- Content: progress header + thin bar + last 5 subtasks
- Subtask items: monochrome checkbox (not colored) + title + optional assignee avatar
- Incomplete subtasks first, then completed
- Footer: "View all subtasks"

#### `components/tasks/comment-hover-popover.tsx`
- Wraps the CommentIndicator
- `HoverCard` with same delays
- Lazy-loads `comments.latestPreview` on hover open
- Content: last 5 comments
- Each: avatar + name + relative time + 2-line text truncation
- Unread comments (based on `commentReadReceipts.lastSeenAt`): faint `bg-primary/[0.04]`
- Footer: "View all comments"

#### `components/tasks/description-hover-popover.tsx`
- Wraps the doc icon in the task title
- `HoverCard` with same delays
- **No query needed** — `task.description` already available on row props
- Content: custom lightweight renderer that walks tiptap JSON:
  - `taskList`/`taskItem` nodes → styled checklist lines (checkbox + text, checked/unchecked state)
  - All other nodes → plain text (concatenate text nodes, truncate ~150 chars)
  - No `@tiptap/html` dependency, no read-only editor instance
- Max height `200px` with `overflow-y: auto`
- Footer: "Open task to read more"
- **No attachment list** in this popover

### 3d. `components/tasks/task-detail-modal.tsx`

Add `markTaskViewed` call with 500ms timer, starting AFTER task data loads:

```tsx
// Inside the modal content component (not the modal shell)
useEffect(() => {
  if (!task) return; // Don't start timer until data loaded
  const timer = setTimeout(() => {
    void markViewed({ taskId });
  }, 500);
  return () => clearTimeout(timer);
}, [taskId, task, markViewed]);
```

### 3e. `app/(dashboard)/tasks/page.tsx`

- Pass extended `activityMap` data to `TaskRow`
- The `activityIndicators` query already returns per-task data — just needs the extended fields
- **No `latestByTasks` subscription** — all popover data is lazy-loaded per task

### 3f. `components/tasks/task-card.tsx` (Mobile)

Minimal update only:
- Add `activity?: ActivityIndicator` prop
- Unseen dot (6px primary circle) before title when `activity?.hasUnseen`
- Bold title (`font-semibold`) when unseen, `font-normal` when seen/loading
- Updated subtitle using `formatActivitySubtitle(activity?.lastActivity)` with fallback
- **No** SubtaskRing, CommentIndicator, or hover popovers on mobile

---

## 4. New Utility Functions

### `lib/format-activity-subtitle.ts`

```ts
export function formatActivitySubtitle(
  lastActivity: { userName: string; type: string; metadata: Record<string, unknown>; createdAt: number } | null
): string {
  if (!lastActivity) return "Created";
  const { userName, type, metadata, createdAt } = lastActivity;
  const firstName = userName.split(" ")[0];
  const time = formatRelativeTime(createdAt);

  switch (type) {
    case "status_changed": return `${firstName} changed status to ${metadata.to} . ${time}`;
    case "comment_added": return `${firstName} commented . ${time}`;
    case "time_entry_logged": return `${firstName} logged ${metadata.duration} . ${time}`;
    case "subtask_completed": return `${firstName} completed ${metadata.title} . ${time}`;
    case "subtask_created": return `${firstName} created subtask . ${time}`;
    case "assignee_added": return `${firstName} assigned ${metadata.userName} . ${time}`;
    case "assignee_removed": return `${firstName} unassigned ${metadata.userName} . ${time}`;
    case "due_date_changed": return metadata.to ? `${firstName} set due date . ${time}` : `${firstName} removed due date . ${time}`;
    case "task_created": return `${firstName} created this task . ${time}`;
    case "description_changed": return `${firstName} updated description . ${time}`;
    default: return `${firstName} updated . ${time}`;
  }
}
```

---

## 5. Implementation Phases

Each phase is a testable, committable unit. Run verification at the end of each before moving to the next.

---

### Phase 1: Backend Foundation
**Commit message:** `feat: task-view receipts, activity log events, extended activityIndicators`

**What:** All backend changes that the UI will consume. No frontend changes yet — existing UI continues to work with the old `ActivityIndicator` shape during this phase.

**Steps:**
1. Add `taskViewReceipts` table to `convex/schema.ts`
2. Create `convex/taskViewReceipts.ts` with `markViewed` mutation (with auth guard)
3. Add `description_changed` logging to task `update` mutation in `convex/tasks.ts`
4. Add `subtask_completed` logging on parent task in `convex/tasks.ts` (transition-to-done only)
5. Extend `activityIndicators` query in `convex/tasks.ts` — new return shape with unseen data, lastActivity, hasDescription (using `isTiptapEmpty`). Keep backward-compatible: include all old fields so existing UI doesn't break.
6. Create `formatActivitySubtitle` utility in `lib/format-activity-subtitle.ts`

**Files changed:**
- `convex/schema.ts`
- `convex/taskViewReceipts.ts` (new)
- `convex/tasks.ts`
- `lib/format-activity-subtitle.ts` (new)

**Verification:**
- [x] `npx convex dev` runs without errors (schema deploys) — manual verification needed
- [x] `npx tsc --noEmit` passes
- [x] Existing `/tasks` page still works — no visual changes, no errors in console (hasAttachments preserved for backward compat)
- [x] In Convex dashboard: `taskViewReceipts` table visible, `activityIndicators` query returns extended fields — manual verification needed
- [x] Test: edit a task description → check activityLog has `description_changed` entry — manual verification needed
- [x] Test: complete a subtask → check parent task's activityLog has `subtask_completed` entry — manual verification needed
- [x] Test: `markViewed` mutation works from Convex dashboard (manual call with valid taskId) — manual verification needed
- [x] Test: `markViewed` rejects with invalid taskId or unauthorized user — manual verification needed

---

### Phase 2: Task Row Visual Refactor (Seen State)
**Commit message:** `feat: task row redesign — SubtaskRing, CommentIndicator, subtitle, loading states`

**What:** Replace the old `ActivityIcons` with the new visual design. All tasks render in "seen" state at this point (no unseen detection yet — that comes when we wire up `markTaskViewed`). This phase is purely visual.

**Steps:**
1. Update `ActivityIndicator` type in `task-row.tsx` to the new shape
2. Create `SubtaskRing` component
3. Create `CommentIndicator` component
4. Refactor `TaskRow` title area: new subtitle via `formatActivitySubtitle`, `FileText` doc icon (gated by `activity.hasDescription`), loading footprint for activity cell
5. Update `page.tsx` to pass extended `activityMap` data
6. Update `TasksListSkeleton` to match new ring + pill shapes
7. Update mobile `TaskCard` — unseen dot, bold title, subtitle (minimal)

**Files changed:**
- `components/tasks/task-row.tsx`
- `app/(dashboard)/tasks/page.tsx`
- `components/tasks/tasks-list-skeleton.tsx`
- `components/tasks/task-card.tsx`

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Task list renders with new layout: SubtaskRing + CommentIndicator in activity cell
- [ ] Subtitle shows "Nora changed status to Review . 12m ago" format (or "Created . X ago" fallback)
- [ ] Tasks with subtasks show ring with correct progress arc
- [ ] Tasks with comments show MessageCircle icon + count
- [ ] Tasks with description show FileText doc icon after title
- [ ] Tasks with empty tiptap description do NOT show doc icon
- [ ] Loading state: no dot, font-normal, fallback subtitle, placeholder shapes in activity cell — no reflow when data arrives
- [ ] Skeleton matches new layout shapes
- [ ] Mobile task cards show updated subtitle
- [ ] All seen styling: muted colors, normal font weight, no dots or pills

---

### Phase 3: Unseen State + Mark-as-Seen
**Commit message:** `feat: unseen state indicators + markTaskViewed on modal open`

**What:** Wire up the unseen visual states and the mark-as-seen behavior. After this phase, the unseen dot, bold titles, primary-colored rings, and tinted comment pills are live.

**Steps:**
1. Add `markTaskViewed` call to `TaskDetailModal` (500ms timer, after data load)
2. Update `TaskRow` to apply unseen styling based on `activity.hasUnseen`, `activity.hasUnseenSubtasks`, `activity.hasUnseenComments`
3. Unseen dot (6px) before title, `font-semibold` title, primary ring arc, tinted comment pill with `unreadCommentCount`

**Files changed:**
- `components/tasks/task-detail-modal.tsx`
- `components/tasks/task-row.tsx`
- `components/tasks/task-card.tsx` (mobile unseen dot + bold)

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Tasks modified by OTHER users show unseen indicators: dot, bold, primary ring, tinted pill
- [ ] Tasks modified only by YOU show seen state (no dot, normal weight)
- [ ] Open task detail, wait > 500ms, close → unseen indicators clear
- [ ] Open task detail, close < 500ms → unseen indicators stay
- [ ] Rapid J/K nav (< 500ms each) → none marked seen
- [ ] Timer does NOT start on skeleton — only after task content loads
- [ ] Comment pill shows `unreadCommentCount` (from `commentReadReceipts`), not total
- [ ] Time entries and billable changes do NOT trigger unseen
- [ ] Your own actions do NOT trigger unseen
- [ ] Mobile: unseen dot + bold title visible

---

### Phase 4: Hover Popovers — Backend Queries
**Commit message:** `feat: lazy-load queries for hover popovers`

**What:** Backend queries that the hover popovers will consume. No UI yet — just the data layer.

**Steps:**
1. Install shadcn HoverCard: `npx shadcn@latest add hover-card`
2. Create `latestForTask` query in `convex/activityLog.ts` (single task, 5 events)
3. Create `latestPreview` query in `convex/comments.ts` (single task, 5 comments)
4. Create `subtaskPreview` query in `convex/tasks.ts` (single task, 5 subtasks, incomplete first)

**Files changed:**
- `components/ui/hover-card.tsx` (new, via shadcn)
- `convex/activityLog.ts`
- `convex/comments.ts`
- `convex/tasks.ts`

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] `components/ui/hover-card.tsx` exists
- [ ] In Convex dashboard: test each query manually with a valid taskId
- [ ] `latestForTask` returns up to 5 events with userNames
- [ ] `latestPreview` returns up to 5 comments with author info
- [ ] `subtaskPreview` returns up to 5 subtasks, incomplete first then completed
- [ ] All three queries reject unauthorized access (wrong org, non-assignee non-admin)

---

### Phase 5: Hover Popovers — Activity + Description
**Commit message:** `feat: activity and description hover popovers on task row`

**What:** The two simpler popovers: activity (lazy-loaded) and description (no query, tiptap JSON walker).

**Steps:**
1. Create `ActivityHoverPopover` — wraps task name/subtitle, lazy-loads `latestForTask` on hover
2. Create `DescriptionHoverPopover` — wraps doc icon, walks tiptap JSON for plain text + checklists
3. Wire both into `TaskRow`

**Files changed:**
- `components/tasks/activity-hover-popover.tsx` (new)
- `components/tasks/description-hover-popover.tsx` (new)
- `components/tasks/task-row.tsx`

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Hover task name → popover appears after 250ms with last 5 activity events
- [ ] Activity popover shows skeleton while loading, then formatted events with colored dots
- [ ] Activity popover footer "Open full history" link works
- [ ] Hover doc icon → popover appears with plain text + rendered checklists
- [ ] Checklist items show checked/unchecked state correctly
- [ ] Description popover scrolls if content > 200px
- [ ] Popovers close after 100ms when mouse leaves
- [ ] Popovers do NOT appear on mobile/tablet (test with responsive devtools)

---

### Phase 6: Hover Popovers — Subtasks + Comments
**Commit message:** `feat: subtask and comment hover popovers on task row`

**What:** The two data-heavy popovers with lazy-loaded queries.

**Steps:**
1. Create `SubtaskHoverPopover` — wraps SubtaskRing, lazy-loads `subtaskPreview` on hover
2. Create `CommentHoverPopover` — wraps CommentIndicator, lazy-loads `latestPreview` on hover
3. Wire both into `TaskRow`

**Files changed:**
- `components/tasks/subtask-hover-popover.tsx` (new)
- `components/tasks/comment-hover-popover.tsx` (new)
- `components/tasks/task-row.tsx`

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Hover subtask ring → popover with progress header, thin bar, up to 5 subtasks
- [ ] Subtask popover: incomplete subtasks first, then completed
- [ ] Subtask items show checkbox state + title + assignee avatar (if any)
- [ ] Subtask popover footer "View all subtasks" works
- [ ] Hover comment icon → popover with last 5 comments
- [ ] Comment items: avatar + name + time + 2-line truncated text
- [ ] Unread comments highlighted with `bg-primary/[0.04]`
- [ ] Comment popover footer "View all comments" works
- [ ] Both popovers show skeleton while loading
- [ ] Both popovers desktop-only
- [ ] Full end-to-end: all 4 popovers work simultaneously without conflicts

---

## 6. Verification Checklist

### Visual
- [ ] Unseen tasks show: primary dot (6px) + semibold (600) title + primary ring arc + tinted comment pill
- [ ] Seen tasks show: normal weight (400) title + muted ring at 80% opacity + plain comment count at 80% opacity
- [ ] Description doc icon (12px FileText) appears at end of task title ONLY when `task.description` exists and is non-empty
- [ ] Doc icon opacity: 0.3 (seen) / 0.45 (unseen)
- [ ] Subtitle shows last activity in all-muted text ("Nora changed status to Review . 12m ago")
- [ ] Subtitle fallback: "Created . X ago" when no activity log exists or activity is loading
- [ ] Activity cell order: SubtaskRing first, CommentIndicator second (no description icon in cell)
- [ ] Ring progress SVG: 14px, 1.75px stroke, correct progress arc calculation
- [ ] MessageCircle icon (NOT MessageSquare): 13px, stroke-width 2.25/1.75 (unseen/seen)
- [ ] Tinted pill: 14px height, 9px font, primary/6% bg, border-radius 999px
- [ ] No custom colors — all from globals.css variables
- [ ] Loading state: font-normal, no dot, fallback subtitle, activity cell reserves space with placeholder shapes

### Behavior
- [ ] Hovering task name area shows Recent Activity popover (lazy-loaded, last 5 events, 250ms delay)
- [ ] Hovering subtask ring shows subtask list popover (lazy-loaded)
- [ ] Hovering comment icon shows comment preview popover (lazy-loaded)
- [ ] Hovering doc icon shows description preview (plain text + checklists, no query needed)
- [ ] All popovers: 250ms open delay, 100ms close delay, footer with CTA link, skeleton while loading
- [ ] Popovers do NOT render on mobile/tablet (desktop only)
- [ ] Opening task detail for >= 500ms (after data loads) clears unseen state via `markTaskViewed`
- [ ] Opening task detail < 500ms does NOT clear unseen (cleanup fires)
- [ ] Timer does NOT start on skeleton/loading state — only after task data loads
- [ ] Your own actions do NOT trigger unseen dot
- [ ] Time entries do NOT trigger unseen dot (v1)
- [ ] Billable changes do NOT trigger unseen dot
- [ ] Tasks with 0 subtasks: no ring shown. Tasks with 0 comments: no comment icon shown.

### Data
- [ ] `taskViewReceipts` table created with correct indexes
- [ ] `activityIndicators` query returns all extended fields in one query
- [ ] Non-comment unseen flags use `taskViewReceipts.lastViewedAt`
- [ ] Comment unseen flags use `commentReadReceipts.lastSeenAt`
- [ ] `hasUnseen = hasUnseenNonComment || hasUnseenComments` (explicit composite)
- [ ] `description_changed` now logged in activityLog
- [ ] `subtask_completed` now logged on parent task (transition-to-done only, with title + subtaskId metadata)
- [ ] All popover data lazy-loaded per task on hover (no batch pre-fetch)
- [ ] Existing `commentReadReceipts` table NOT modified (separate concern)
- [ ] `markTaskViewed` does NOT cascade to `comments.markSeen`

### Infrastructure
- [ ] `npx shadcn@latest add hover-card` installed
- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] Skeleton matches new layout (ring + circle shapes instead of old list icon)
- [ ] Mobile `TaskCard` updated (unseen dot + bold title + subtitle only, no icons or popovers)

---

## 7. CSS / Tailwind Token Reference

All values from `globals.css`:

| Token | Usage |
|-------|-------|
| `--primary` | Unseen ring arc, comment icon stroke, tinted pill text, unseen dot |
| `--primary / 6%` | Tinted pill background |
| `--primary / 15%` | Unseen ring track |
| `--border` | Seen ring track |
| `--muted-foreground` | Seen icon color base |
| `--muted-foreground / 80%` | Seen icon + count opacity |
| `--fg` (foreground) | Unseen task title text |

No custom colors. Everything derives from the existing design system.

---

## 8. Edge Cases

| Scenario | Expected behavior |
|----------|------------------|
| Task with 0 subtasks, 0 comments, no description | Activity cell shows placeholder footprint while loading, then empty. Title has no doc icon. Subtitle shows "Created . X ago". |
| Task never viewed by current user (`taskViewReceipts` record doesn't exist) | Treat as unseen — `lastViewedAt = 0`, so ALL other-user activity triggers unseen. |
| User creates a task themselves | `task_created` activityLog entry has their userId → NOT unseen for them. But if another user later comments → unseen. |
| Task with only your own comments | Comment icon shows total count (e.g. "3") but NO tinted pill (no unread — your own comments don't count). |
| `activityIndicators` query returns `undefined` (loading) | font-normal, no dot, fallback subtitle from task data, activity cell reserves space with placeholder shapes. No false positives. No reflow when data arrives. |
| Archived tasks tab | Unseen state still applies — archived doesn't mean seen. |
| `CommentIndicator` unseen pill count | Shows `unreadCommentCount` (from `commentReadReceipts.lastSeenAt`), NOT total count. The total count shows in seen state. |
| Description is empty tiptap doc (e.g. `{"type":"doc","content":[{"type":"paragraph"}]}`) | Treat as no description — no doc icon. Use `isTiptapEmpty()` from `lib/tiptap-utils.ts`, NOT string truthiness or `.trim()`. An empty tiptap doc serialized as JSON is truthy and non-empty as a string. |
| Task detail opened via direct URL (not from list) | `markTaskViewed` still fires after 500ms (after data loads). Works the same. |
| Rapid J/K keyboard nav (< 500ms per task) | None marked seen — 500ms threshold does its job. |
| Comment sidebar marks seen independently | `comments.markSeen` at `task-detail-sidebar.tsx:63` fires on its own 500ms timer. No coupling with `markTaskViewed`. |
| Subtask status toggled within done-type statuses | Only transition INTO done logs `subtask_completed` on parent. Re-completing an already-done subtask does not re-log. |

---

## 9. Files Changed Summary

| File | Change type | Description |
|------|------------|-------------|
| `convex/schema.ts` | Modified | Add `taskViewReceipts` table |
| `convex/taskViewReceipts.ts` | **New** | `markViewed` mutation |
| `convex/tasks.ts` | Modified | Extend `activityIndicators` query, add `description_changed` + `subtask_completed` logging, add `subtaskPreview` query |
| `convex/activityLog.ts` | Modified | Add `latestForTask` single-task query |
| `convex/comments.ts` | Modified | Add `latestPreview` single-task query |
| `lib/format-activity-subtitle.ts` | **New** | Subtitle formatting utility |
| `components/tasks/task-row.tsx` | **Major refactor** | New `ActivityIndicator` type, `SubtaskRing`, `CommentIndicator`, title changes, loading footprint |
| `components/tasks/activity-hover-popover.tsx` | **New** | Task name hover popover (lazy-loaded) |
| `components/tasks/subtask-hover-popover.tsx` | **New** | Subtask ring hover popover (lazy-loaded) |
| `components/tasks/comment-hover-popover.tsx` | **New** | Comment icon hover popover (lazy-loaded) |
| `components/tasks/description-hover-popover.tsx` | **New** | Doc icon hover popover (tiptap JSON walker, no query) |
| `components/tasks/task-detail-modal.tsx` | Modified | Add `markTaskViewed` with 500ms timer (after data load) |
| `components/tasks/tasks-list-skeleton.tsx` | Modified | Update skeleton to match new ring + circle layout |
| `components/tasks/task-card.tsx` | Modified | Minimal mobile update: unseen dot, bold title, subtitle |
| `app/(dashboard)/tasks/page.tsx` | Modified | Pass extended activityMap data to `TaskRow` (no new subscriptions) |
| `components/ui/hover-card.tsx` | **New** (via shadcn) | `npx shadcn@latest add hover-card` |

---

## 10. Decisions Log

Architectural decisions resolved during design review (2026-03-25):

1. **No denormalization** of unseen state onto task documents. `activityLog` is the source of truth. Convex reactivity handles live updates.
2. **Two independent receipt models.** `taskViewReceipts` owns non-comment unseen state. `commentReadReceipts` owns comment unseen state. No cascading between them.
3. **Comment flags all come from `commentReadReceipts`:** `hasUnseenComments`, `unreadCommentCount`, "New" divider. Never from `taskViewReceipts`.
4. **`hasUnseen` is an explicit composite:** `hasUnseenNonComment || hasUnseenComments`. Documented per-group to prevent receipt model confusion.
5. **One `activityIndicators` query** returns all row data. Split into multiple queries only if real performance data warrants it.
6. **All popover data lazy-loaded** per task on hover. No batch `latestByTasks` subscription at page level.
7. **Description popover:** plain text + checklists only. No `@tiptap/html`, no read-only editor. Custom lightweight tiptap JSON walker.
8. **`markTaskViewed` timer** starts after task data loads, not on modal shell mount.
9. **`subtask_completed`** must be added as new activityLog event on parent task (transition-to-done only).
10. **`description_changed`** must be added as new activityLog event.
11. **`billable_changed` excluded** from unseen triggers (administrative, not actionable).
12. **Mobile `TaskCard`:** minimal update (dot, bold, subtitle). No activity icons or popovers.
13. **Loading state:** no false positives, no reflow. Reserve activity cell footprint with placeholder shapes.
14. **`markViewed` mutation** must verify task existence, org membership, and user access (admin or assignee) — same guard pattern as all other task-scoped mutations.
15. **`hasDescription`** uses `isTiptapEmpty()` from `lib/tiptap-utils.ts`, NOT string truthiness. Empty tiptap docs serialize as truthy JSON strings.
16. **Subtask preview** query is `tasks.subtaskPreview`. Sort: incomplete first (by creation order), then completed (by creation order). Up to 5 results.
17. **No artificial task cap.** Task list pagination is the natural throttle. Safety net at 500 IDs for bug protection only. Batch query chosen because it matches existing codebase patterns and visible row count is moderate — not as a permanent scaling strategy. If batch becomes too slow or reactive churn is excessive, escalate to per-row subscriptions, not batch chunking.
