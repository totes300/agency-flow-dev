# Notion-style Notification Inbox (@mentions) — Implementation Plan

> **Audience:** an implementation agent with no prior context. Everything needed to execute
> is in this document plus the referenced files. Read `convex/_generated/ai/guidelines.md`
> and `CLAUDE.md` before starting — their rules are binding (0 TS errors, every mutation
> call `.catch(toastError)`, thin pages, shared components, backlog entry mandatory,
> **never `git stash`**).

## 1. Context & goal

The app (Next.js 16 App Router + Convex 1.33 + Clerk + shadcn/ui + Tailwind v4) has **no
notification system**. Mentions exist only as Tiptap JSON nodes
(`{ type: "mention", attrs: { id: <users._id>, label: <name> } }`) inside comment/description
content — never extracted server-side. Nobody is told about assignments or new comments.

Build a **Notion-style Inbox** living in the left sidebar:

- "Inbox" button at the top of the sidebar (directly under `<TeamSwitcher />`) with an
  unread-count badge.
- Clicking opens a **~400px overlay panel** (Popover) next to the sidebar — not a route.
- Notifications grouped by week: **"This week"**, **"Last week"**, then older buckets
  ("Apr 13–19, 2026" style).
- Unread = blue dot. Reading removes the dot; **read items stay in the inbox until
  archived** (Notion behavior). Badge counts unread only.
- Row click: opens the task detail drawer AND **deep-links to the specific comment** —
  scroll + `comment-highlight` flash. The anchor/scroll/flash mechanism already exists
  in `components/tasks/comment-card.tsx` (`id={comment-<id>}`, scrollIntoView, reflow
  restart); pass the comment id alongside the detail URL param.
- **Auto-read:** opening a task via ANY path (not just from the inbox) marks all of that
  task's unread notifications read for the viewer — the badge never lies.
- Hover actions per row: **mark as read/unread**, **archive**, **snooze** (presets:
  Later today +3h / Tomorrow 9 AM / Next week Mon 9 AM, org timezone), **mute task**
  (in the overflow menu).
- Panel header: mark-all-as-read (CheckCheck icon) + **unread-only filter toggle**
  (ListFilter icon, client-side filter) + archived-view toggle (Archive icon).
- No toasts on live arrival — the badge updating via Convex reactivity is the only
  signal (Notion behavior; toasts breed notification blindness).
- Real-time via Convex reactivity. **In-app only** for v1 (schema stays email-extensible).

### Notification triggers (v1)

1. `mention_comment` — user is @mentioned in a comment.
2. `mention_description` — user is @mentioned in a task description.
3. `assigned` — user is assigned to a task (any path, incl. default/auto-assign, bulk).
4. `comment` — a new comment lands on a task where the user is a **participant**:
   an assignee OR someone who previously commented on that task (Notion participants
   model — commenting subscribes you to the conversation).
5. `comment_reply` — someone replies (`parentCommentId`) to a comment the user authored.
   Row sentence: *"X replied to your comment in <Task>"*.

**Never notify the actor about their own action.** Priority per recipient per comment:
**mention > reply > plain comment** — exactly ONE row per (recipient, comment).

**Task-level mute (v1):** a user can mute a task; muted users receive NO `comment` /
`comment_reply` notifications for it. `mention_comment`, `mention_description`, and
`assigned` always break through the mute (Notion behavior).

### Mention + access rule (user-approved, Notion pattern)

@mention **never** grants task access by itself. Comments/task detail are visible only to
assignees + org admins today (guard: `if (!isAdmin && !task.assigneeIds.includes(userId))`).

- In the mention suggestion list, members WITHOUT access to the current task remain
  selectable but show a muted hint: **"Nincs hozzáférése ehhez a taskhoz."**
- On comment submit, if any mentioned user lacks access, show a confirm dialog:
  *"Anna jelenleg nem látja ezt a taskot. Ahhoz, hogy értesítést kapjon és elolvashassa a
  kommentet, hozzáférést kell adnod neki."* Buttons: **"Hozzáadás assignee-ként és
  említés"** (adds them as assignees, then posts the comment) / **"Mégse"** (back to
  editing). Multiple affected users → list all names in one dialog.
- Server-side fan-out independently filters recipients without task access
  (defense in depth — a crafted mention id must not leak notifications).
- Known accepted v1 side effect: the "add as assignee & mention" flow produces BOTH an
  `assigned` and a `mention_comment` notification. Acceptable; note merge as backlog item.

## 2. Codebase facts (verified — trust these)

### Backend

- `convex/schema.ts`: every business table carries `orgId: v.string()`, `createdAt`,
  `updatedAt` (epoch ms, `Date.now()`). Index naming: `by_orgId`, `by_orgId_<field>`,
  `by_user_task`, … Enums via `v.union(v.literal(...))`. **Convex filenames must not
  contain hyphens.**
- Auth preamble everywhere: `const { orgId, userId, isAdmin } = await getAuthContext(ctx)`
  from `convex/lib/auth.ts`; every doc access asserts `doc.orgId === orgId`; errors are
  `new ConvexError("<human string>")`.
- `comments` table (schema.ts:495): `{ taskId, orgId, userId (author), content (Tiptap
  JSON object), parentCommentId?, resolvedAt?, ... }`, index `by_task`.
  `comments.create` at `convex/comments.ts:86-143` — validates access, inserts, calls
  `logActivity(type: "comment_added")`. A local `extractContentPreview` /
  `extractPlainText` exists near `comments.ts:494` — reuse for preview text.
- `tasks.assigneeIds: v.array(v.id("users"))` (schema.ts:122). Assignment changes:
  - `tasks.update` (tasks.ts:1064) — diffs old/new assignees at :1173-1195 logging
    `assignee_added`/`assignee_removed`; auto-assign default assignee path at ~:1131/:1190.
  - `tasks.create` (:980), `tasks.createSubtask` (:222).
  - `tasks.bulkUpdate` (:1352) — per-task loop capped at 50; `addAssignee`/`removeAssignee`
    ops (~:1419) plus two auto-assign branches on category/project change (~:1450, :1471).
  - Task description is a **JSON string** (`v.optional(v.string())`, `JSON.parse`d at
    tasks.ts:835). Description edits flow through **two** mutations: `tasks.update` AND
    `tasks.updateDescription` (:1215) — both need fan-out hooks.
- `convex/activityLog.ts` — `logActivity(ctx, {taskId, orgId, userId(actor), type,
  metadata})` helper (:12-30); the pattern to copy for a `createNotifications` helper.
- Mention suggestion source: `convex/orgMembers.ts` `listOrgMembers` returns
  `{ _id: users._id, name }` — extend with role/isAdmin for the access hint.
- **No pagination anywhere yet**; guidelines require bounded reads (`take(n)`, never
  unbounded `.collect()`, never count via `.collect().length`).
- Unread precedent: `commentReadReceipts` lastSeenAt watermark;
  `convex/lib/taskActivityIndicators.ts` `computeTaskIndicatorState`.
- Scheduler: `ctx.scheduler.runAfter` used in 8 places; `runAt` unused but idiomatic for
  snooze wake. **Convex queries are reactive to DATA, not time** — a snoozed item
  reappearing live requires a scheduled mutation touching the row.
- Tests: vitest. Pure logic → `convex/lib/*.ts` unit-tested in `convex/lib/__tests__/`
  (preferred). Integration → `convex-test` in `convex/__tests__/` with file-level pragma
  `// @vitest-environment edge-runtime` and the `import.meta.glob("../**/*.ts")` module
  map (copy the structure of `convex/__tests__/invoiceTransitions.test.ts`).

### Frontend

- Sidebar: `components/app-sidebar.tsx` — `SidebarHeader` currently holds only
  `<TeamSwitcher />`; the Inbox button goes right under it. Sidebar is
  `collapsible="icon"` → use `SidebarMenuButton` with `tooltip`.
- Badge precedent: `MyTasksBadge` / `InvoicesNavSignals` in `components/nav-main.tsx` —
  `useQuery(api…, isAuthenticated ? {} : "skip")` via `useConvexAuth()`, render
  `<SidebarMenuBadge>`, return `null` when zero.
- `components/ui/` has popover, sheet, dropdown-menu, tooltip, badge, avatar, tabs,
  skeleton, separator, sonner. **No scroll-area — do not add it**; use native
  `overflow-y-auto` (pattern: `components/tasks/activity-feed.tsx`).
- Hover row actions pattern: `components/invoices/invoice-row-actions.tsx` —
  `opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`
  wrapper, inline buttons + overflow `DropdownMenu`, `toastError` from
  `@/lib/toast-helpers`.
- Shared building blocks: `components/user-avatar.tsx` (`UserAvatar name imageUrl size`),
  `components/empty-state.tsx`, `components/confirm-dialog.tsx`,
  `lib/format.ts` `formatRelativeTime(timestamp)` (:208),
  `lib/date-buckets.ts` (`mondayOfWeek`, `bucketKey(ymd,"week")`, `bucketLabel`,
  `todayInTimezone`), `lib/hooks/use-org-timezone.ts`, `lib/hooks/use-is-admin.ts`.
- Task navigation: the `/tasks` page opens the detail drawer via a URL param —
  `lib/task-detail.ts` `buildDetailUrl(searchParams, taskId)` / `parseDetailParam`;
  hook `components/tasks/use-task-detail.ts`. Notification click →
  `router.push` to `/tasks` with the detail param.
- Mention editor stack: `components/tasks/use-mention-suggestion.tsx` (Tiptap
  `@tiptap/extension-mention`, items from `listOrgMembers`),
  `components/tasks/suggestion-dropdown.tsx`, composers
  `components/tasks/task-detail-comment-input.tsx` and
  `components/tasks/inline-comment-input.tsx`.
- Mobile: `useIsMobile` hook exists; sidebar renders as a Sheet on mobile.

## 3. Data model

Add to `convex/schema.ts`:

```ts
notifications: defineTable({
  orgId: v.string(),
  recipientId: v.id("users"),
  actorId: v.id("users"),
  type: v.union(
    v.literal("mention_comment"),
    v.literal("mention_description"),
    v.literal("assigned"),
    v.literal("comment"),
    v.literal("comment_reply"),
  ),
  taskId: v.id("tasks"),
  commentId: v.optional(v.id("comments")),
  previewText: v.string(), // plain-text snapshot at fan-out time (survives edits/deletes)
  inboxState: v.union(
    v.literal("unread"),
    v.literal("read"),
    v.literal("archived"),
    v.literal("snoozed"),
  ),
  readAt: v.optional(v.number()),
  archivedAt: v.optional(v.number()),
  snoozedUntil: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_recipient_org_state", ["recipientId", "orgId", "inboxState", "createdAt"])
  .index("by_task", ["taskId"])   // cascade cleanup on task delete
  .index("by_orgId", ["orgId"]),

taskMutes: defineTable({
  orgId: v.string(),
  taskId: v.id("tasks"),
  userId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_user_task", ["userId", "taskId"])  // fan-out mute check + toggle lookup
  .index("by_task", ["taskId"])                 // cascade cleanup on task delete
  .index("by_orgId", ["orgId"]),
```

**Why a 4-value `inboxState` machine** (not optional-timestamp derivation, not watermark):
Convex indexes can't express "where readAt is undefined" ordering. With the state in the
index, every hot query is a clean bounded read:

- Unread badge: `.withIndex("by_recipient_org_state", q => q.eq("recipientId", userId).eq("orgId", orgId).eq("inboxState", "unread")).take(100)` → `.length` (display "99+" when capped).
- Inbox list: `"unread"` take(100) + `"read"` take(100), merged desc by `createdAt`.
- Archived list: one read on `"archived"`.
- Snoozed rows invisible by state — no time-window filtering.

`readAt`/`archivedAt`/`snoozedUntil` are audit/display metadata; `inboxState` is the
query source of truth. `orgId` is inside the index because users can belong to multiple
Clerk orgs. Email later = add optional `emailedAt`/`channels`, no reshape.

## 4. Fan-out architecture

### `convex/lib/notificationEvents.ts` (pure, unit-tested)

```ts
export function extractMentionIds(content: unknown): string[]
// recursively walk Tiptap JSON; collect attrs.id where node.type === "mention"; dedupe.

export function diffMentionIds(oldContent: unknown, newContent: unknown): string[]
// mention ids present in new but not old (only newly ADDED mentions notify).

export function computeCommentRecipients(args: {
  actorId: string; assigneeIds: string[]; mentionIds: string[];
  participantIds: string[];   // authors of prior comments on the task (deduped)
  parentAuthorId?: string;    // author of the comment being replied to, if a reply
}): Array<{ userId: string; type: "mention_comment" | "comment_reply" | "comment" }>
// exclude actor; priority per recipient: mention_comment > comment_reply
// (parentAuthorId) > comment (assigneeIds ∪ participantIds). Exactly one row per
// recipient per comment.

export function truncatePreview(text: string, max?: number): string  // default 140

export function safeParseDoc(json: string | undefined | null): unknown
// try/catch JSON.parse → null on legacy plain-string/invalid descriptions.
```

### `convex/notifications.ts` — `createNotifications` helper

Plain exported async helper (NOT a mutation), same shape as `logActivity`:

```ts
export async function createNotifications(
  ctx: MutationCtx,
  args: {
    orgId: string;
    actorId: Id<"users">;
    taskId: Id<"tasks">;
    events: Array<{
      recipientId: string; // unvalidated — may come from client-controlled Tiptap JSON
      type: "mention_comment" | "mention_description" | "assigned" | "comment"
        | "comment_reply";
      commentId?: Id<"comments">;
      previewText: string;
    }>;
  },
): Promise<void>
```

Per event, in order — **any failure skips the event silently** (a bad mention must never
fail the comment/task mutation):

1. `ctx.db.normalizeId("users", recipientId)` → skip if null; `ctx.db.get` → skip if
   missing or `deletedAt` set; skip if `recipientId === actorId`.
2. Verify org membership (via `orgMembers` lookup for `(orgId, userId)`).
3. Verify **task access**: recipient is in `task.assigneeIds` OR is an org admin
   (role from `orgMembers`). Skip otherwise (defense in depth for the access rule).
   Note: this also keeps the participants model consistent — a prior commenter who has
   since been removed from assignees (and isn't admin) silently drops out.
4. **Mute check** (only for `comment` and `comment_reply`): skip if a `taskMutes` row
   exists for `(recipientId, taskId)` via `by_user_task`. `mention_*` and `assigned`
   ignore mutes.
5. **Dedupe** (only for `assigned` and `mention_description`): read the recipient's
   `"unread"` index slice `take(100)`; skip if an unread row with the same
   `(type, taskId)` exists. (Absorbs remove→re-add assignment cycles and description
   autosave churn.) `comment`/`comment_reply`/`mention_comment` are never deduped
   server-side — each comment is a distinct event; the client groups them visually.
6. Insert with `inboxState: "unread"`, `createdAt/updatedAt = Date.now()`.

### Hook points (all call sites already have `orgId`, actor `userId`, and the task)

| Call site | Trigger | Events |
|---|---|---|
| `comments.create` (comments.ts:86) | after insert + `logActivity` | `extractMentionIds(args.content)` → `computeCommentRecipients` with `task.assigneeIds`, `participantIds` (prior commenter userIds via `by_task`, bounded `take(200)`, deduped), `parentAuthorId` (author of `args.parentCommentId` when set); preview from existing `extractContentPreview`; pass `commentId` |
| `tasks.create` (:980) | after insert | `assigned` for each assignee ≠ actor (incl. default-assignee); `mention_description` from `extractMentionIds(safeParseDoc(description))`; preview = task title (assigned) / description plain text (mention) |
| `tasks.update` (:1064) | reuse existing old/new assignee diff (:1173) + auto-assign path (:1190) | `assigned` for added ids ≠ actor; when `args.description !== undefined`: `diffMentionIds(safeParseDoc(task.description), safeParseDoc(next))` → `mention_description` |
| `tasks.updateDescription` (:1215) | after the `nextDescription === task.description` early-return | same mention diff |
| `tasks.createSubtask` (:222) | after insert | `assigned` per assignee ≠ actor |
| `tasks.bulkUpdate` (:1352) | inside per-task loop: `addAssignee` op + both auto-assign branches, only when actually added | one `assigned` per task (≤50 cap already exists; dedupe absorbs repeats) |

Also extend `cascadeDeleteTaskData` in `tasks.ts` to delete notification rows via the
`by_task` index when a task is deleted.

Out of scope v1 (record in backlog, all user-reviewed decisions): mentions added by
comment **edits**; merging the `assigned`+`mention_comment` pair from the access-grant
flow; float-to-top on snooze resurface; email digest; **inline reply from the inbox
panel** (Notion-style mini composer under comment rows — deep-link + drawer composer
covers v1); **due-date reminders** ("due tomorrow", org-tz 9 AM — reuse the snooze
scheduler infra); **status-change notifications** (e.g. task done → notify creator);
**per-user notification preferences** (Settings section, per-type toggles); **@task /
@project mentions** in the editor (Notion @page-style linking — separate feature, the
Tiptap mention infra is reusable); **full keyboard scheme** in the panel (↑↓/Enter/E/U
roving focus — v1 ships Esc + focus-ring reachability only); **custom snooze date
picker**; **hover task-preview card** on notification rows.

## 5. Convex API (`convex/notifications.ts`)

All functions: arg validators + `getAuthContext(ctx)` preamble. All mutations assert per
row: `row.recipientId === userId && row.orgId === orgId`, else `ConvexError`. Array args
capped at 50.

```ts
// queries
export const listInbox = query({ args: {}, ... })
// "unread" take(100) + "read" take(100) via by_recipient_org_state, merge desc by createdAt.
// Enrich per row: taskTitle (drop row if task deleted), actorName/actorImageUrl
// (cache ctx.db.get(actorId) per unique actor; "Former member" fallback).
// Returns: { _id, type, inboxState, createdAt, previewText, taskId, commentId?,
//            taskTitle, actorId, actorName, actorImageUrl? }[]

export const listArchived = query({ args: {}, ... })   // "archived" take(100), same enrichment
export const unreadCount  = query({ args: {}, ... })   // "unread" take(100) → { count, isCapped }

// mutations
export const markRead    = mutation({ args: { ids: v.array(v.id("notifications")) } })
//   → patch { inboxState: "read", readAt: now, updatedAt: now }
export const markUnread  = mutation({ args: { ids: v.array(v.id("notifications")) } })
//   → patch { inboxState: "unread", readAt: undefined, updatedAt: now }
export const archive     = mutation({ args: { ids: v.array(v.id("notifications")) } })
//   → patch { inboxState: "archived", archivedAt: now, updatedAt: now }
export const markAllRead = mutation({ args: {} })
//   → loop "unread" slice take(200), patch each to read
export const markTaskRead = mutation({ args: { taskId: v.id("tasks") } })
//   → viewer's "unread" slice take(100), patch rows matching taskId to read.
//     Called on task-detail-drawer open (ANY navigation path) — honest badge:
//     organically reading a task clears its inbox dots. Assert task.orgId === orgId.
export const muteTask    = mutation({ args: { taskId: v.id("tasks") } })
//   → upsert taskMutes row for (userId, taskId); assert task access + org.
export const unmuteTask  = mutation({ args: { taskId: v.id("tasks") } })
//   → delete the taskMutes row if present.
export const isTaskMuted = query({ args: { taskId: v.id("tasks") } })
//   → boolean via by_user_task (drives the mute/unmute menu item label).
export const snooze      = mutation({ args: { id: v.id("notifications"), until: v.number() } })
//   → patch { inboxState: "snoozed", snoozedUntil: until, updatedAt: now };
//     ctx.scheduler.runAt(until, internal.notifications.wake,
//                         { notificationId: id, expectedUntil: until })
export const wake        = internalMutation({
  args: { notificationId: v.id("notifications"), expectedUntil: v.number() } })
//   → load row; NO-OP if missing, inboxState !== "snoozed", or
//     snoozedUntil !== expectedUntil (guard token). Else patch
//     { inboxState: "unread", snoozedUntil: undefined, readAt: undefined, updatedAt: now }.
```

**Snooze mechanics:** the guard token (`expectedUntil`) makes cancellation free — archiving,
reading, or re-snoozing changes state/`snoozedUntil`, so the stale scheduled `wake` fires
and no-ops. No `scheduler.cancel`, no stored scheduled-function ids. The wake mutation
touching the row is what makes it reappear live in an open panel (Convex reactivity).

**Snooze presets** computed client-side in `lib/inbox-snooze.ts` (pure, tested) with the
org timezone from `useOrgTimezone()`:
- "Later today" → `now + 3h`.
- "Tomorrow, 9 AM" / "Next week, Mon 9 AM" → resolve target YYYY-MM-DD via
  `todayInTimezone` + day arithmetic from `lib/date-buckets.ts`, then convert wall-clock
  9:00 in that tz to an epoch using the guess-and-correct Intl technique (guess UTC epoch,
  format back in tz, adjust by diff). **Unit-test a DST-transition date** (Europe/Budapest).

### `convex/orgMembers.ts`

Extend `listOrgMembers` to also return `role` (or `isAdmin: boolean`) so the client can
compute mention-access hints: `hasAccess = isAdmin || assigneeIds.includes(id)`.

## 6. Client grouping (`lib/inbox.ts`, pure + tested)

Server stays one-row-per-event; grouping is presentation (rows ≤200, already in memory).

```ts
export function typeClass(type): "comment" | "assigned" | "mention_description"
// comment + comment_reply + mention_comment collapse into "comment"

export function groupInbox(rows, timezone: string, now: number): WeekSection[]
```

- Week key: `bucketKey(todayInTimezone(timezone, new Date(row.createdAt)), "week")`.
- Section label: current Monday → `"This week"`; previous Monday → `"Last week"`;
  else `bucketLabel(key, "week", timezone)`.
- Within a section, group by `(taskId, typeClass)`. Group carries: unique actors in
  recency order (stacked avatars max 3 + "+N"), latest `previewText` + `createdAt`,
  `unread = members.some(m => m.inboxState === "unread")`, `memberIds` (group actions
  apply the mutation to all member ids). Sentence: `"Maddie, Frances commented in
  <TaskTitle>"` / `"Anna assigned you to <TaskTitle>"` / `"Anna mentioned you in
  <TaskTitle>"` / when the group's latest row is `comment_reply`: `"Anna replied to
  your comment in <TaskTitle>"`.
- **Unread-only filter**: header toggle, pure client-side — filter groups to
  `unread === true` before rendering (rows are already in memory; zero backend work).
  Ephemeral UI state (useState), not URL — the popover itself isn't a route.

## 7. UI component tree

```
components/app-sidebar.tsx — in SidebarHeader, BELOW <TeamSwitcher />:
└── components/inbox/inbox-button.tsx
    // "use client". Popover root. SidebarMenuItem > SidebarMenuButton(tooltip="Inbox",
    // lucide InboxIcon, label "Inbox") as PopoverTrigger. Unread badge: SidebarMenuBadge
    // via useQuery(api.notifications.unreadCount, isAuthenticated ? {} : "skip"),
    // hidden when 0, "99+" when isCapped (copy MyTasksBadge pattern).
    // Mobile (useIsMobile): render panel content in <Sheet side="left"> instead.
    └── components/inbox/inbox-panel.tsx
        // <PopoverContent side="right" align="start" sideOffset={12} collisionPadding={16}
        //  className="w-[400px] h-[min(calc(100vh-2rem),44rem)] p-0 flex flex-col overflow-hidden">
        // View state: "inbox" | "archived" (local useState — ephemeral UI state).
        // Three-phase: loading (content-aware skeleton: avatar circle + two text lines,
        // mirroring row layout) → empty → content. List region: native overflow-y-auto.
        ├── header: "Inbox" title + CheckCheck icon-button (markAllRead, disabled at 0
        │   unread) + ListFilter icon toggle (unread-only, client-side) + Archive icon
        │   toggle. All mutations .catch(toastError).
        ├── components/inbox/inbox-empty-state.tsx
        │   // wraps components/empty-state.tsx — "You're all caught up"
        └── week sections from lib/inbox.ts groupInbox
            └── components/inbox/notification-row.tsx
                // group row: stacked UserAvatars, bold sentence with task title,
                // muted previewText (1–2 line clamp), formatRelativeTime, blue dot
                // (size-2 rounded-full bg-blue-500) when group unread.
                // Row is a `group` for hover reveal. Click: markRead(memberIds) then
                // router.push to /tasks with the detail param (lib/task-detail.ts
                // buildDetailUrl semantics) PLUS the group's latest commentId as an
                // extra `comment` search param when present; close popover. The drawer
                // reads the param on open, scrolls to `comment-<id>` and replays the
                // existing `comment-highlight` flash (mechanism in comment-card.tsx),
                // then strips the param. Drawer open also fires markTaskRead(taskId)
                // — this single hook covers BOTH inbox clicks and organic task opens.
                ├── components/inbox/notification-row-actions.tsx
                │   // opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                │   // (invoice-row-actions pattern). Inline: read/unread toggle, archive.
                │   // Snooze via dropdown; overflow DropdownMenu adds "Mute task" /
                │   // "Unmute task" (isTaskMuted + muteTask/unmuteTask, BellOff icon).
                │   // Archived view shows "unarchive" (markUnread →
                │   // back to inbox) instead. All .catch(toastError).
                └── components/inbox/snooze-menu.tsx
                    // DropdownMenu with the 3 presets from lib/inbox-snooze.ts +
                    // useOrgTimezone (gate on isReady). Calls snooze({id, until}) per member.
```

## 8. Mention-access UX (Notion pattern)

1. `components/tasks/use-mention-suggestion.tsx`: accept optional task context
   (`assigneeIds`); suggestion items gain `hasAccess` computed from extended
   `listOrgMembers` (role) + assigneeIds.
2. `components/tasks/suggestion-dropdown.tsx`: render muted "Nincs hozzáférése ehhez a
   taskhoz" hint next to no-access members (still selectable).
3. Comment composers (`task-detail-comment-input.tsx`, `inline-comment-input.tsx`):
   before submit, extract mention ids from the editor JSON client-side
   (reuse/extract a walker consistent with `lib/tiptap-utils.ts`); if any mentioned user
   lacks access → open `ConfirmDialog`:
   - Text: "<Names> jelenleg nem látja ezt a taskot. Ahhoz, hogy értesítést kapjon és
     elolvashassa a kommentet, hozzáférést kell adnod neki."
   - Confirm "Hozzáadás assignee-ként és említés" → add them to `assigneeIds` (existing
     `tasks.update` mutation), then post the comment. Cancel → back to editing, nothing sent.

## 9. Implementation slices (each ends with a verification gate)

1. **Schema + pure logic.** `notifications` + `taskMutes` tables; `convex/lib/notificationEvents.ts` +
   `convex/lib/__tests__/notificationEvents.test.ts`; `lib/inbox.ts` + `lib/inbox-snooze.ts`
   + tests (in `lib/` test convention next to existing `lib/*.test.ts`).
   ✓ `npx tsc --noEmit` clean, `npx vitest run` green, `npx convex dev` accepts schema.
2. **Fan-out.** `createNotifications` + hooks into `comments.create`,
   `tasks.create/update/updateDescription/createSubtask/bulkUpdate`;
   `cascadeDeleteTaskData` extension.
   ✓ `convex/__tests__/notifications.test.ts` (edge-runtime pragma): mention+comment
   fan-out, actor exclusion, mention-beats-reply-beats-comment priority, participants
   (prior commenters notified), reply → `comment_reply` to parent author, mute filter
   (comment skipped, mention breaks through), assignee diff, dedupe, access filter.
3. **Queries/mutations.** Full API incl. snooze/wake guard token, `markTaskRead`,
   `muteTask`/`unmuteTask`/`isTaskMuted`.
   ✓ integration tests: state transitions, foreign-row mutation throws, snooze →
   scheduled wake → unread, stale wake no-ops after archive, markTaskRead only
   touches the given task's rows.
4. **Sidebar entry + panel shell.** `inbox-button`, badge, `inbox-panel` with header
   actions, skeleton, empty state; wire into `app-sidebar.tsx`.
   ✓ badge live-updates across two browser sessions; Esc/outside-click close; collapsed
   sidebar anchoring works; mobile Sheet fallback.
5. **Rows + grouping + actions.** Week sections, group rows, hover actions (incl.
   mute/unmute), snooze menu, unread-only filter, archived view, navigation to the task
   drawer with comment deep-link (scroll + highlight) and drawer-open `markTaskRead`.
   ✓ two-user manual walkthrough of all five triggers; comment click lands scrolled on
   the right comment with flash; organic task open clears that task's dots; muted task
   stays silent for comments but mention still arrives; snooze with a 1-minute test
   value resurfaces live; mark-all-read; unread filter; group actions.
6. **Mention-access UX.** `listOrgMembers` role; suggestion hint; pre-submit
   ConfirmDialog + add-as-assignee flow.
   ✓ manual test mentioning a no-access member; cancel path leaves editor intact.
7. **Polish + close-out.** Edge cases below; content-aware skeleton final pass;
   `docs/backlog.md` entry (mandatory — include deferred TODOs: comment-edit mentions,
   resurface ordering, email digest, assigned+mention merge, mention-grants-visibility);
   final `npx tsc --noEmit` + `npx vitest run` + `npm run lint`.

## 10. Edge cases (explicit handling)

- **Deleted task** → cascade deletes rows (`by_task`); enrichment also defensively drops
  rows whose task lookup fails.
- **Deleted comment** → notification stays (previewText snapshot; navigation targets the
  task; dangling `commentId` harmless).
- **Self-mention / own action** → actor always excluded (incl. `tasks.create`
  self-auto-assign).
- **Non-member or malformed mention id** → `normalizeId` + membership check → silent skip;
  comment still posts.
- **Mentioned user without access** → filtered at fan-out; UI flow (section 8) is the
  sanctioned path to grant access.
- **Remove→re-add assignment, autosave description churn** → unread dedupe on
  `(recipient, type, taskId)`.
- **Muted task** → `comment`/`comment_reply` skipped at fan-out; `mention_*` and
  `assigned` break through; unmute resumes silently (no backfill of missed events).
- **Deep-link to a since-deleted comment** → the drawer's scroll effect finds no
  `comment-<id>` element → no-op, drawer stays at default scroll. No error.
- **Reply whose parent author lacks task access** → fan-out access filter drops the
  `comment_reply`; the recipient set falls back to plain participants/assignees.
- **Bulk addAssignee storm** → 50-task cap exists; dedupe absorbs repeats; client groups.
- **User removed from org** → `getAuthContext` throws (inbox inaccessible); stale rows
  inert (recipient+org-scoped index). Departed **actor** → "Former member" fallback.
- **Legacy non-JSON description** → `safeParseDoc` → no mentions, no crash.
- **Snooze races** (archive/read/re-snooze before wake fires) → guard token no-op.
- **>99 unread** → badge "99+" via `isCapped`.
- **Multi-org user** → `orgId` inside the recipient index keeps lists/counts org-correct.

## 11. Test plan

- **Unit** (`convex/lib/__tests__/`, `lib/`): mention extraction (nested nodes, malformed,
  dedupe), mention diff, recipient matrix (actor/assignee/mention/participant/parent-author
  overlaps — mention > reply > comment priority), preview
  truncation, `groupInbox` (week boundaries with injected `now`, this/last-week labels,
  group unread aggregation, actor stacking), snooze presets (fixed `now`,
  `Europe/Budapest`, incl. a DST-transition date).
- **Integration** (`convex/__tests__/notifications.test.ts`, convex-test, edge-runtime):
  fan-out per trigger, access filtering, state machine, ownership rejection, snooze →
  wake → unread, stale-wake no-op.
- **Manual**: two Clerk users; all five triggers; real-time badge/panel; mark-all-read;
  unread-only filter; archived toggle; snooze resurface; mute/unmute; comment deep-link
  scroll+flash; organic task open clears dots; task-drawer navigation from `/tasks` and
  from another page; mention-access dialog both paths.
- **Gates**: `npx tsc --noEmit` = 0 errors; full `npx vitest run`; `npm run lint`;
  `docs/backlog.md` entry present.

## 12. File inventory

**Modify:** `convex/schema.ts`, `convex/comments.ts`, `convex/tasks.ts`,
`convex/orgMembers.ts`, `components/app-sidebar.tsx`,
`components/tasks/use-mention-suggestion.tsx`, `components/tasks/suggestion-dropdown.tsx`,
`components/tasks/task-detail-comment-input.tsx`,
`components/tasks/inline-comment-input.tsx`, `lib/task-detail.ts` (comment param
alongside the detail param), the task detail drawer (`components/tasks/
task-detail-drawer.tsx` / `-content.tsx`: markTaskRead on open + comment-param
scroll effect), `docs/backlog.md`.

**Create:** `convex/notifications.ts`, `convex/lib/notificationEvents.ts`,
`convex/lib/__tests__/notificationEvents.test.ts`, `convex/__tests__/notifications.test.ts`,
`lib/inbox.ts` (+ test), `lib/inbox-snooze.ts` (+ test),
`components/inbox/inbox-button.tsx`, `components/inbox/inbox-panel.tsx`,
`components/inbox/inbox-empty-state.tsx`, `components/inbox/notification-row.tsx`,
`components/inbox/notification-row-actions.tsx`, `components/inbox/snooze-menu.tsx`.

**Reuse (do not reinvent):** `getAuthContext` (`convex/lib/auth.ts`), `logActivity`
pattern (`convex/activityLog.ts`), `UserAvatar`, `EmptyState`, `ConfirmDialog`,
`formatRelativeTime` (`lib/format.ts`), `lib/date-buckets.ts`, `lib/task-detail.ts`,
`useOrgTimezone`, `useIsMobile`, invoice-row-actions hover pattern, MyTasksBadge badge
pattern, `extractContentPreview` (`convex/comments.ts`), `lib/tiptap-utils.ts`.

## 13. Senior architect review (2026-07-04) — corrections + final execution plan

Every line reference and pattern claim in section 2 was re-verified against the codebase
and holds. The following **corrections and design deltas supersede the corresponding
details above**, and the tracer-bullet chunk plan below **supersedes section 9's
layer-by-layer slicing**.

### Review deltas (binding)

1. **`markTaskRead` integrates via `taskViewReceipts.markViewed`, not a new drawer hook.**
   `components/tasks/use-task-detail.ts:78-86` already fires
   `api.taskViewReceipts.markViewed` 500ms after ANY task-detail open (every navigation
   path funnels through this hook). Extend the `markViewed` mutation
   (`convex/taskViewReceipts.ts:9`) to also call a shared helper
   `markTaskNotificationsRead(ctx, { userId, orgId, taskId })` exported from
   `convex/notifications.ts`. No new client wiring; every current and future task-open
   surface clears notifications automatically. The standalone public `markTaskRead`
   mutation from section 5 is **dropped** (inbox row clicks call `markRead(ids)` directly;
   the helper covers organic opens).
2. **`listOrgMembers` already returns `role`** (`convex/orgMembers.ts:9` returns
   `{ _id, name, email, imageUrl, role }`). Section 5's "extend listOrgMembers" is
   already done. But the mention editor consumes members via
   `useTaskReferenceData()` (`components/tasks/task-reference-data.tsx`), not directly —
   the mention-access work (section 8) threads `role` through that provider.
3. **Org-membership + role lookup in `createNotifications`:** `orgMembers` has NO
   `(orgId, userId)` index. After `ctx.db.get(recipientId)` (step 1), use
   `by_orgId_clerkUserId` with `(orgId, user.externalId)` → `.unique()`. One indexed
   point-read that yields BOTH the membership check (step 2) and the `role` needed for
   the admin branch of the task-access check (step 3).
4. **`snooze` takes `ids: v.array(v.id("notifications"))` + one `until`** (≤50, like every
   other mutation) and schedules one `wake` per row. Group rows snooze all `memberIds` in
   one round-trip; single-id form was an API inconsistency.
5. **`markUnread` must also clear `archivedAt`** (it doubles as "unarchive" from the
   archived view): patch `{ inboxState: "unread", readAt: undefined,
   archivedAt: undefined, updatedAt: now }`.
6. **Additional edge case:** recipient loses task access while holding unread
   notifications for it → badge counts them, task won't open (`tasks.getDetail` throws).
   v1 handling: inbox row actions (read/archive) work regardless of task access — the row
   is dismissible; row click surfaces the existing error toast. Document in backlog.
7. **`comments.create` already loads + access-validates the task** (comments.ts:95-99) —
   fan-out reuses `task` in scope; no extra read.
8. **Dedupe scan cost** (step 5, `take(100)` per `assigned`/`mention_description` event;
   worst case 50×100 row reads in `bulkUpdate`) is bounded and acceptable at MVP scale.
   Noted for backlog; no design change.

### Final execution plan — tracer-bullet chunks (supersedes section 9 ordering)

Content of section 9's slices is unchanged unless a delta above says otherwise; only the
grouping/order differs so that chunk 1 crosses every layer end-to-end.

1. **Tracer: one mention, end-to-end.** `notifications` table (full schema, section 3);
   `convex/lib/notificationEvents.ts` with `extractMentionIds` + `truncatePreview` (+ unit
   tests); `createNotifications` with the full validation ladder (normalizeId, self-skip,
   membership via delta 3, task-access) but wired ONLY into `comments.create` for
   `mention_comment`; API: `unreadCount`, `listInbox` (flat, enriched), `markRead`;
   UI: `inbox-button` + badge in `app-sidebar.tsx`, minimal `inbox-panel` (flat list,
   loading/empty/content phases), row click → `markRead` + navigate to task drawer (no
   comment deep-link yet).
   ✓ Gate: two sessions — mention → live badge → panel row → click opens task → dot
   clears; `npx tsc --noEmit` clean; `npx vitest run` green; **user feedback checkpoint
   before widening.**
2. **All five triggers + fan-out hardening.** `taskMutes` table; `diffMentionIds`,
   `safeParseDoc`, `computeCommentRecipients` (+ recipient-matrix unit tests); mute check
   in `createNotifications`; unread dedupe for `assigned`/`mention_description`; hooks:
   `tasks.create/update/updateDescription/createSubtask/bulkUpdate` + reply/participants
   in `comments.create`; `cascadeDeleteTaskData` extension (notifications + taskMutes).
   ✓ Gate: section 9 slice-2 integration suite (`convex/__tests__/notifications.test.ts`).
3. **State machine + honest badge.** `markUnread` (delta 5), `archive`, `markAllRead`,
   `markTaskNotificationsRead` helper wired into `taskViewReceipts.markViewed` (delta 1);
   `muteTask`/`unmuteTask`/`isTaskMuted`; `snooze` (array form, delta 4) + `wake` guard
   token; `lib/inbox-snooze.ts` presets (+ DST unit test).
   ✓ Gate: section 9 slice-3 integration tests; manual: organic task open clears dots;
   1-minute snooze resurfaces live in an open panel.
4. **Panel UX: grouping, actions, deep-link.** `lib/inbox.ts` `groupInbox` (+ tests);
   week sections, group rows, hover actions, snooze menu, unread-only filter, archived
   view, mark-all-read header; comment deep-link (`lib/task-detail.ts` comment param +
   drawer scroll/`comment-highlight` replay); mobile Sheet; content-aware skeleton;
   `inbox-empty-state`.
   ✓ Gate: section 9 slice-5 two-user walkthrough, all five triggers.
5. **Mention-access UX.** Thread `role`/task `assigneeIds` through
   `useTaskReferenceData` → `use-mention-suggestion` → `suggestion-dropdown` hint;
   pre-submit mention extraction + `ConfirmDialog` add-as-assignee flow in both composers.
   ✓ Gate: manual no-access mention, both dialog paths; cancel leaves editor intact.
6. **Edge cases + close-out.** Section 10 sweep + delta 6; final skeleton pass;
   `docs/backlog.md` entry (deferred TODOs incl. deltas 6 + 8 and section 4's
   out-of-scope list); `npx tsc --noEmit` + `npx vitest run` + `npm run lint`.
