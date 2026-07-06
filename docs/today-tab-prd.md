# My Tasks — Personal Focus View

> ⚠️ **SUPERSEDED (2026-07-06)** by `docs/today-planner-prd.md` — "Today" is no longer a
> status; it is a derived per-user daily plan computed from Planner `planSegments`.
> This document remains for historical context on the original My Tasks design.

> **Goal**: A personal, distraction-free view of all tasks assigned to you. Default: daily focus checklist (only "Today" status tasks). Expandable via ⚙ to a full "My Tasks" view grouped by status.
>
> **Route**: `/my-tasks` — standalone page, own sidebar menu item
> **Depends on**: Phase 5 (Tasks Core), Phase 6 (Task Detail Drawer)

---

## Concept

Every user has a personal task view at `/my-tasks`. **By default it's a daily focus checklist**: only tasks the PM moved to "Today" status. You work through them, check them off, aim for an empty list by end of day. Via the ⚙ settings you can expand it to show other status groups (In Progress, To Do, Done, Backlog, Blocked) — turning it into a full personal task board.

**Two modes, one page:**

| Mode | What you see | When to use |
|------|-------------|-------------|
| **Focus (default)** | Only "Today" status tasks — flat checklist | Daily work: check off your list |
| **Expanded (via ⚙)** | Multiple status groups, each with tasks | Overview: see all your assigned work |

| Aspect | `/tasks` | **`/my-tasks`** |
|--------|----------|-----------------|
| Purpose | Manage all org work | **Personal view: my assigned tasks** |
| Scope | All tasks (filterable) | Only tasks assigned to **me** |
| Default | All tasks, tabbed by status | **Today focus** (only "Today" status) |
| Expanded | — | Full My Tasks (all statuses via ⚙) |
| Complexity | 10-column table, tabs, filters, bulk ops | Clean 2-line rows, status groups |
| Groups | By status/project/client/etc. | By status type (⚙ configurable) |
| Creation | Full inline row | Notion-style: name → Enter |
| Detail | Drawer | Same drawer (reused) |

---

## Decisions

| Question | Decision |
|----------|----------|
| Route | `/my-tasks` — own sidebar item, standalone page |
| Who sees it? | Everyone (admin + member) |
| What tasks? | All tasks assigned to current user. **Default view** shows only "Today" status (focus checklist). **Expanded view** (via ⚙) shows additional status groups. |
| Grouping? | **Default: "Today" only** — flat checklist, no groups. **Expanded**: status-type groups (In Progress, To Do, Done, Backlog, Blocked, Review) — each toggleable via ⚙. |
| Completion? | **Member**: checkbox → mini popover: "Done" or "Send for review". **Admin**: checkbox → instant done (no popover). |
| Submitted section? | ALL review-type tasks assigned to me (no date filter). Stays until PM approves → done → disappears. |
| Drag reorder? | Yes. Drag-and-drop within groups. Uses existing `manualSortKey` (fractional indexing). |
| Inline creation? | Notion-style per group: name → Enter → assigned to me + user's default category + that group's status |
| Filters? | None. Search only. ⚙ to toggle visible status groups. |
| Progress bar? | No. The checklist IS the progress. |
| Daily logged time? | Yes — header right side: `⏱ 4h 35m` |

---

## Industry Comparison & Rationale

Asana, ClickUp, and Monday.com all group their personal view by **time horizon** (Overdue / Today / This Week / Later). We chose a different approach:

**Our model**: Status-driven daily checklist — PM triages to "Today" status, member consumes.

**Why**: In agencies, PMs prepare and assign tasks. The act of moving a task to "Today" status IS the triage. Not every task has a due date. The simplicity of a flat checklist (no time groups, no sub-categories) matches the focus intent.

**What we take from the research**: Overdue `⚠` highlights, real status changes on completion, minimal creation friction, muted submitted section.

---

## Navigation

### Sidebar

```
Work
  ▶ My Tasks     ← NEW
  Tasks
```

- Visible to **everyone** (admin + member)
- Icon: `UserCheckIcon` or `CircleUserIcon` from Lucide
- Badge: count of uncompleted "Today" status tasks assigned to me (focus mode count)

### Route

- Path: `/my-tasks`
- Page: `app/(dashboard)/my-tasks/page.tsx`
- Auto-protected by proxy (dashboard route)

---

## Schema Changes

### 1. `orgMembers` — add `defaultWorkCategoryId`

```typescript
orgMembers: defineTable({
  ...
  defaultWorkCategoryId: v.optional(v.id("workCategories")),  // ← NEW: professional role
})
```

Each org member's default work category (Designer → Design, Developer → Development). Configured in Settings > Team.

### 2. `users` — add `todayVisibleStatuses`

```typescript
users: defineTable({
  ...
  todayVisibleStatuses: v.optional(v.array(v.string())),  // ← NEW
  // Status type names to show on /my-tasks.
  // Default (when null): show only the "Today" named status (not a type — a specific status).
})
```

**Default behavior** (when `null`): show only tasks in the "Today" status (focus checklist).

**When customized via ⚙**: array of status type strings the user wants to see, e.g. `["in_progress", "backlog", "done"]`. The "Today" status tasks always show as the first group. Additional types add separate groups below — this turns the page into a full "My Tasks" view like the mockup (In Progress + To Do + Done + etc.).

### 3. `tasks` — no schema change

---

## Page Layout

### Default view — Focus mode (no ⚙ customization)

```
My tasks                                       ⏱ 4h 35m

☀ Today  4                                            ▴
  ○ Build landing page              Dev    ⏱ 1:20
  ○ Review wireframes               Design ⏱ 0:45
  ○ Write blog post                 Copy
  ○ Fix header bug                  Dev    ⏱ 0:30
  + Add task...

✓ Submitted  3                                        ▾
  ✓ Design icon set                 Design ⏱ 2:00
  ✓ Write copy for CTA             Copy   ⏱ 0:45
  ✓ Setup analytics                Dev    ⏱ 1:15
```

**Every group always has a status header** — consistent with expanded mode. "☀ Today 4" uses the status icon + name + count, same pattern as "● In Progress 2" etc.

At the bottom: `X tasks hidden by settings. Show settings` — indicating there are more tasks in other statuses.

### Expanded view (statuses toggled on via ⚙)

```
My tasks                                 [⚙]  ⏱ 4h 35m

☀ Today  3                                     (always visible)
  ○ Build landing page              Dev    ⏱ 1:20
  ○ Write blog post                 Copy
  ○ Fix header bug                  Dev    ⏱ 0:30
  + Add task...

● In Progress  2                                (toggled on)
  ○ Review wireframes               Design ⏱ 0:45
  ○ Ongoing design task             Design ⏱ 3:00
  + Add task...

○ To Do  4                                     (toggled on)
  ○ Demo task name 001              Dev
  ○ Demo task name 004
  ○ deko task name 006
  ○ Demo task name 007
  + Add task...

✅ Done  3                                      (toggled on)
  ✓ demo task name 00               Dev
  ✓ demo task name 003              Design
  ✓ Demo task name 005
  + Add task...

2 tasks hidden by settings.  Show settings
```

This matches the mockup: full "My Tasks" grouped by status. Each group has `+ Add task...`. Inline-created tasks get that group's status.

---

## Header

```
My tasks                                 [⚙]  ⏱ 4h 35m
```

| Element | Position | Details |
|---------|----------|---------|
| "My tasks" | Left | Page title, `text-2xl font-semibold` |
| ⚙ icon | Right | View settings dropdown |
| ⏱ time | Right | Total time logged by current user today, real-time via Convex |

### View Settings Dropdown (⚙)

```
┌────────────────────────┐
│  Show groups:          │
│  ☐ In Progress         │
│  ☐ To Do (Backlog)     │
│  ☐ Blocked             │
│  ☐ Done                │
│  ☑ Submitted (Review)  │
└────────────────────────┘
```

- Checkboxes for each status TYPE (not individual statuses)
- "Today" tasks are ALWAYS shown (first group, not toggleable)
- "Submitted" (review type) is ON by default (shows the done/review section)
- All other types are OFF by default → focus mode
- When toggled on → that status type appears as a separate group with its own `+ Add task...`
- Changes saved to `users.todayVisibleStatuses` (Convex, syncs across devices)
- Subtle dot indicator on ⚙ when non-default settings active
- Footer: `X tasks hidden by settings. Show settings` — clickable, opens the ⚙ dropdown

---

## Row Design

### Active task row (2-line)

```
┌──────────────────────────────────────────────────────────────────┐
│  ○  Build landing page                                  ⏱ 1:20  │
│     ⌘ Luxe Linens Meta Ads · Design · Oct 24           👤  [⋮] │
└──────────────────────────────────────────────────────────────────┘
```

**Line 1 (primary):**
- Completion checkbox (circle, not square — distinct from /tasks selection checkbox)
- Task title — `text-sm font-medium text-foreground`, dominant, truncate
- Logged time + timer button — right-aligned

**Line 2 (secondary, muted):**
- Project name (with icon)
- Category badge (dot + name)
- Due date (red `⚠` if overdue)
- Assignee avatar(s) — right-aligned
- ⋮ menu — right-aligned

**Design tokens:**
- `py-2 px-3`
- Line 2: `text-[11px] text-muted-foreground/60`
- Hover: `bg-muted/30`, cursor pointer
- Click → opens task detail drawer

### Submitted task row

- Checkbox: filled green, disabled
- Title: strikethrough, `opacity-60`
- Logged time visible (shows effort spent)
- Timer: hidden
- Clickable → drawer opens (can see comments, details)

---

## Completion Behavior

### Checkbox = completion toggle

No bulk selection on this page. The checkbox is purely for marking tasks done or sending for review.

### Member clicks checkbox → mini popover:

```
┌───────────────────────┐
│ ✓ Done                │
│ → Send for review     │
└───────────────────────┘
```

- **"Done"**: `tasks.update({ statusId: firstDoneStatus })` → confetti → row fades out → toast "Task completed ✓"
- **"Send for review"**: `tasks.update({ statusId: firstReviewStatus })` → confetti → row slides to Submitted → toast "Sent for review ✓"

The popover appears right next to the checkbox (popover/dropdown, not modal). One extra click, zero ambiguity. The member decides: "Can I close this myself, or should someone check?"

### Admin clicks checkbox → instant done (no popover):

1. Mutation: `tasks.update({ statusId: firstDoneStatus })`
2. Confetti micro-animation
3. Row fades out
4. Toast: "Task completed ✓"

Admin doesn't need the popover — they ARE the reviewer. If they want to send to Client Review, they use the drawer status dropdown.

### Confetti animation

Triggers on both "Done" and "Send for review". CSS-only particles (positioned `<span>`s + keyframe animations). No external libs.

### `<CompletionCheckbox>` component

Reusable. Props: `isAdmin`, `onDone`, `onSendForReview`.

---

## Submitted Section

The "Submitted" section shows **ALL** tasks that:
- Are assigned to current user
- Have `review`-type status (Admin Review, Client Review, etc.)

**No date filter.** Tasks stay here until the PM approves (moves to `done`) — then they disappear. This solves the midnight problem: yesterday's review tasks don't vanish overnight.

**Visual treatment:**
- Section header: `✓ Submitted  4` (collapsible, default open)
- Rows: muted (`opacity-60`), green checkbox (disabled), strikethrough title
- Logged time still visible
- Clickable → drawer opens (see comments, check review status)

**When PM approves** (moves to `done`): task leaves this section. Clean.
**When PM sends back** (moves to `in_progress`): task reappears in the appropriate group. Real-time via Convex.

---

## Inline Task Creation (Notion-style)

### Per-group `+ Add task...`

Each visible group (Today, In Progress, Blocked, etc.) has its own `+ Add task...` at the bottom.

### Flow

1. Click `+ Add task...` → bare text input appears
2. Type title → **Enter** → task created with defaults for that group
3. Input clears, stays focused → rapid-fire creation
4. **Escape** → cancel

### Smart defaults

| Field | Value |
|-------|-------|
| `assigneeIds` | `[currentUserId]` |
| `workCategoryId` | Current user's `defaultWorkCategoryId` |
| `statusId` | The group's status (Today group → "Today" status, In Progress group → first in_progress status, etc.) |
| `billable` | `true` |
| `projectId` | `undefined` (set later in drawer) |

### Optimistic UI

Task appears immediately with loading pulse. Settle on server confirm. Error → inline retry.

---

## Drag Reorder

Tasks within each group can be reordered via drag-and-drop. This uses the existing `manualSortKey` field (fractional indexing, already implemented in `/tasks`).

- Drag handle visible on hover (left side of row, before checkbox)
- Reorder within a group only (can't drag between groups — that's a status change)
- Personal sort order: `manualSortKey` is per-task, not per-user, so reordering here also affects `/tasks` sort. This is intentional — single source of truth.
- Default sort (no manual reorder yet): `dueDate ASC`, then `createdAt DESC`
- Once any task is manually reordered, the group switches to manual sort mode

---

## Timer Integration

Same as `/tasks` `InlineTimeCell`:
- No project → disabled, tooltip "Assign a project first"
- Has project → play button + logged time
- Running → red counter + stop
- Running elsewhere → play (switches timer)

---

## Auto-Category on Assign & Member Default Category

> **Separate feature** — see `docs/auto-category-on-assign-prd.md` (to be written).
>
> Includes: `defaultWorkCategoryId` on `orgMembers`, Settings > Team UI changes, auto-category logic in `tasks.create` / `tasks.update` / `tasks.bulkUpdate`.
>
> My Tasks inline create will use `defaultWorkCategoryId` if available (for smart defaults). If the feature isn't implemented yet, inline create simply doesn't auto-set a category.

---

## Queries / Mutations

### New queries

```
tasks.listMyTasks     — Tasks for /my-tasks page:
                        - "Today" named status tasks assigned to me (always)
                        - If todayVisibleStatuses set: also tasks in those status types assigned to me
                        - Submitted: ALL review-type tasks assigned to me (no date filter)
                        Sorted: manualSortKey (if set), then dueDate ASC, then createdAt DESC.
                        Grouped by status type.
                        Returns TaskWithJoins shape.

tasks.myTasksCount    — Count of uncompleted "Today" status tasks assigned to me (sidebar badge)

timeEntries.sumMyToday — Total minutes logged by current user today
```

### New mutations

```
users.updateMyTasksSettings — Save todayVisibleStatuses array
```

### Modified (by Auto-Category feature, separately)

```
tasks.create          — (See auto-category-on-assign PRD)
tasks.update          — (See auto-category-on-assign PRD)
orgMembers.update     — (See auto-category-on-assign PRD)
```

---

## Mobile

- Same layout (already compact)
- Drawer → full-screen modal
- FAB button for modal creation

---

## Empty State

```
┌─────────────────────────────────────────┐
│                                         │
│     ☀️  All clear for today              │
│                                         │
│     No tasks scheduled. Ask your PM     │
│     to queue work, or add one yourself. │
│                                         │
│     [+ Add task...]                     │
│                                         │
│     4 tasks hidden by settings.         │
│     Show settings                       │
│                                         │
└─────────────────────────────────────────┘
```

The "hidden by settings" footer reminds users they may have tasks in other status groups.

---

## Acceptance Criteria

### Page & Navigation
- [ ] `/my-tasks` route exists as standalone page
- [ ] "My Tasks" in sidebar (Work group, above Tasks) with uncompleted count badge
- [ ] Accessible to admin + member

### Default View (Focus mode)
- [ ] Shows ONLY "Today" named status tasks assigned to current user (flat checklist)
- [ ] Submitted section at bottom (review/done tasks updated today, collapsible)
- [ ] Done-type tasks (PM approved) disappear entirely
- [ ] Footer: "X tasks hidden by settings. Show settings"

### Expanded View (via ⚙)
- [ ] Each enabled status type → separate group with header + count + `+ Add task...`
- [ ] "Today" group always first, always visible
- [ ] Matches mockup: In Progress + To Do + Done groups etc.

### Header
- [ ] "My tasks" title left, ⚙ icon + `⏱ Xh Xm` right
- [ ] Daily logged time real-time via Convex

### View Settings (⚙)
- [ ] Toggle status types: In Progress, To Do, Blocked, Done, Submitted
- [ ] "Today" always shown (not toggleable)
- [ ] "Submitted" on by default, all others off
- [ ] Saved per-user in `users.todayVisibleStatuses`
- [ ] Dot indicator on ⚙ when non-default

### Row Design
- [ ] 2-line: title dominant (line 1) + muted metadata (line 2)
- [ ] Completion checkbox (circle, not square)
- [ ] Click row → task detail drawer

### Completion
- [ ] Member: checkbox → mini popover with "Done" and "Send for review"
- [ ] Admin: checkbox → instant done (no popover)
- [ ] "Done" = first done-type status, "Send for review" = first review-type status
- [ ] CSS-only confetti animation on both actions
- [ ] Toast: "Task completed ✓" / "Sent for review ✓"

### Submitted Section
- [ ] Shows ALL review-type tasks assigned to me (no date filter)
- [ ] Tasks stay until PM approves (done) → then disappear
- [ ] Muted, strikethrough, green checkbox disabled
- [ ] Clickable → drawer
- [ ] Collapsible

### Drag Reorder
- [ ] Drag-and-drop within groups (uses existing `manualSortKey`)
- [ ] Drag handle on hover
- [ ] Default sort: dueDate ASC, createdAt DESC
- [ ] Cannot drag between groups (that's a status change)

### Inline Creation
- [ ] `+ Add task...` per group, Notion-style
- [ ] Enter = create (self-assigned, group's status, billable)
- [ ] Category from `defaultWorkCategoryId` if auto-category feature is available
- [ ] Rapid-fire: stays focused after Enter
- [ ] Optimistic UI

### Timer
- [ ] Play/stop per task, disabled without project

### Auto-Category (separate PRD)
- [ ] Ref: `docs/auto-category-on-assign-prd.md`
- [ ] My Tasks inline create uses it for defaults if available

### Search
- [ ] Search bar filters titles within view
