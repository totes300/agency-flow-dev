# Task Detail Drawer — Implementation Plan

## 1. Goal

Replace the current fullscreen modal task detail with a **Bonsai-style side drawer** that slides in from the right, keeping the task list visible and interactive on the left. The user can toggle between "modal" and "drawer" views — persisted as a per-user preference.

### Reference: Bonsai layout

```
Normal (no task selected):
┌──────────┬──────────────────────────────────────────────────────────┐
│ Nav      │ Tasks header + filters + tabs                           │
│ (240px)  ├──────────────────────────────────────────────────────────┤
│          │ Task list (full width, all columns)                     │
│          │  hello       Retainer   Pragm.   Adam   High   Mar 19  │
│          │  Create...   Retainer   Pragm.   —      Urgent  —      │
│          │  Case study  Retainer   Pragm.   —      Low     —      │
└──────────┴──────────────────────────────────────────────────────────┘

Drawer open (task selected):
┌──────────┬──────────────────┬───────────────────────┬───────────────┐
│ Nav      │ Task list        │ Main content          │ Properties    │
│ (240px)  │ (unchanged,      │ (scrollable)          │ (collapsible) │
│          │  partially       │                       │               │
│          │  covered by      │ TSK-00003             │ ● To Do  ▾    │
│          │  drawer)         │ hello                 │               │
│          │                  │ 📋 Retainer 👤 Adam   │ Category      │
│          │ hello     Ret..  │                       │  Development  │
│          │ Create..  Ret..  │ Description...        │               │
│          │ Case s..  Ret..  │ Subtasks...           │ Due date      │
│          │                  │ Activity + Comments   │  Mar 28       │
│          │                  │                       │               │
│          │                  │ 💬 typing...          │ Estimate      │
│          │                  │ ┌─ Comment input ──┐  │  10h 0m       │
│          │                  │ │ (sticky bottom)  │  │               │
│          │                  │ └──────────────────┘  │               │
└──────────┴──────────────────┴───────────────────────┴───────────────┘
```

## 2. Key Design Decisions

### 2.1 Drawer is an overlay panel, NOT a flex split
The drawer is a **fixed-position panel** that slides over the right portion of the task list. The task list itself does NOT change — no column compression, no width change, no layout shift.

### 2.2 Drawer width
`55vw` — viewport-relative.

### 2.3 Sidebar collapse is viewport-driven, NOT drawer-driven
- **≥1200px:** Sidebar expanded (240px)
- **<1200px:** Sidebar auto-collapses to icon rail (48px)
- **<768px (md):** No drawer option — always modal

### 2.4 Fewer, purpose-built tabs in drawer mode

| Tab          | Content                                                     |
|--------------|-------------------------------------------------------------|
| **Overview** | Title, description, subtasks, attachment summary, activity + comments, sticky comment input |
| **Time**     | Time entries table, manual entry form, date range filters   |
| **Emails**   | Thread list and composer/reply flow (future)                |

### 2.5 Sticky comment input
Pinned to the bottom of the drawer's main column, outside the scroll area.

The `ActivityFeed` component does NOT include the `CommentInput`. Each consumer places the input:
- **Modal sidebar:** CommentInput inside the sidebar scroll
- **Drawer:** CommentInput as sticky footer, outside scroll area

### 2.6 Activity feed order
Oldest first, newest at bottom. Auto-scroll, "new messages" pill. Unchanged from current behavior.

### 2.7 Properties panel — collapsible
- **≥1440px:** Visible by default
- **<1440px:** Collapsed by default
- Toggle via header button

### 2.8 Selected task highlight
`bg-accent` or left border accent on selected row. `scrollIntoView` on drawer open.

### 2.9 Slide-in animation
~200ms ease-out from right. Task list stays static.

### 2.10 Visual separation
`border-l border-border` + subtle shadow + `bg-background`.

### 2.11 View toggle
`PanelRightClose` (drawer) / `Maximize2` (modal). Persisted to `users.taskDetailView`.

### 2.12 URL param
Single `?detail=taskId` for both views.

## 3. Architecture

### 3.1 Shared controller hook — `useTaskDetail`

```ts
function useTaskDetail(taskIds: string[]) {
  // URL param sync, task query, J/K nav, mark viewed, navigation callbacks
  return { task, detailId, isOpen, handleClose, handleNavigate, navigateToTask, hasNext, hasPrev }
}
```

**Out of hook:** ErrorBoundary, Dialog/drawer shell, layout/styling.

### 3.2 Component tree

```
tasks/page.tsx
  ├── useTaskDetail(taskIds)
  │
  ├── if preference === "modal":
  │     TaskDetailModal (uses useTaskDetail)
  │       ├── ErrorBoundary → TaskDetailHeader → Title + Metadata(grid) + Tabs
  │       └── TaskDetailSidebar → ActivityFeed + CommentInput (inside scroll)
  │
  └── if preference === "drawer":
        TaskDetailDrawer (uses useTaskDetail)
          ├── ErrorBoundary → TaskDetailDrawerHeader
          └── flex row:
                ├── TaskDetailDrawerContent
                │     ├── Tabs: [Overview] [Time] [Emails]
                │     ├── Scroll: Title + Description + Subtasks + Attachments + ActivityFeed
                │     └── Sticky: TypingIndicator + CommentInput
                └── TaskDetailMetadata(layout="stack", collapsible)
```

### 3.3 ActivityFeed — extracted shared component

Owns: queries, feed merging, Comments/All toggle, auto-scroll, "new messages" pill, day dividers, ChatMessage + ActivityBatch rendering, typing indicator.

Does NOT own: CommentInput, outer container.

## 4. Data Model Changes

```ts
// convex/schema.ts — users table
taskDetailView: v.optional(v.union(v.literal("modal"), v.literal("drawer"))),
```

```ts
// convex/users.ts
export const updateTaskDetailView = mutation({ ... })
```

---

## 5. Committable Phases

Each phase produces a **working, committable state**. The app never breaks between phases. Each has explicit verification steps.

---

### Phase 1: Schema + mutation

**Goal:** Add the data model for view preference. Zero UI changes.

**Files:**
- `convex/schema.ts` — add `taskDetailView` field to users table
- `convex/users.ts` — add `updateTaskDetailView` mutation

**Verification:**
- [ ] `npx convex dev` runs without errors
- [ ] `npx tsc --noEmit` passes
- [ ] Open the app — everything works unchanged
- [ ] (Optional) Test mutation via Convex dashboard: set a user's `taskDetailView` to `"drawer"`, confirm it saves

**Commit message:** `feat: add taskDetailView preference to users schema`

---

### Phase 2: Extract `useTaskDetail` hook

**Goal:** Extract all controller logic from `TaskDetailModal` into a shared hook. Modal uses the hook. Behavior identical.

**Files:**
- `components/tasks/use-task-detail.ts` — **NEW** shared hook
- `components/tasks/task-detail-modal.tsx` — refactored to consume hook

**What moves into the hook:**
- `useSearchParams` / `useRouter` / `usePathname` for URL sync
- `parseDetailParam`, `buildDetailUrl`, `getAdjacentTaskId` usage
- `useQuery(api.tasks.getDetail, ...)` — task data query
- `useConvexAuth()` — auth check for query
- `handleClose`, `handleNavigate`, `navigateToTask` callbacks
- `hasNext` / `hasPrev` memoization
- J/K keyboard listener (`useEffect` with keydown)
- Mark viewed (`useMutation(api.taskViewReceipts.markViewed)` + 500ms debounce)

**What stays in `TaskDetailModal`:**
- `<Dialog>` / `<DialogFullscreenContent>` shell
- `<ErrorBoundary>` wrapper
- Layout JSX (header + body + sidebar)
- `if (!isOpen) return null` gate

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Open a task → modal opens with correct data
- [ ] Close modal → URL clears
- [ ] J/K navigation works (next/prev task)
- [ ] Open task, wait 1s → verify "mark viewed" fires (unseen dot disappears on task row)
- [ ] Navigate to `?detail=<taskId>` directly → modal opens correctly
- [ ] Escape key closes modal
- [ ] Click outside closes modal

**Commit message:** `refactor: extract useTaskDetail hook from TaskDetailModal`

---

### Phase 3: Extract `ActivityFeed` component

**Goal:** Extract the activity feed rendering from `TaskDetailSidebar` into a shared component. Sidebar delegates to it. Behavior identical.

**Files:**
- `components/tasks/activity-feed.tsx` — **NEW** shared component
- `components/tasks/task-detail-sidebar.tsx` — refactored to use `ActivityFeed`

**What moves into `ActivityFeed`:**
- All queries: activities, comments, reactions, attachments, read receipts, typing indicators
- `mergeActivityFeed()` call + memoization
- Comments vs All view toggle state + rendering logic
- `groupFeedForCommentsView()` / flat timeline rendering
- Day dividers (`computeDayDividers`, `getDayLabel`)
- Message grouping (`computeMessageGrouping`)
- `ChatMessage` + `ActivityBatch` rendering
- "New" unseen divider logic
- Auto-scroll behavior (scroll ref management, `isScrolledUpRef`)
- "New messages" floating pill
- Typing indicator
- Reply context state (`replyContext`, `setReplyContext`)

**What stays in `TaskDetailSidebar`:**
- The outer container (`w-[480px]`, `hidden md:flex`, border, etc.)
- "Activity" title header
- `<ActivityFeed>` usage
- `<TaskDetailCommentInput>` placement (inside scroll)

**`ActivityFeed` props interface:**
```ts
interface ActivityFeedProps {
  taskId: Id<"tasks">
  isAdmin?: boolean
  scrollRef: React.RefObject<HTMLDivElement>  // parent provides scroll container
  onReplyContextChange?: (ctx: ReplyContext | null) => void
  replyContext: ReplyContext | null
}
```

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Open task modal → Activity sidebar loads correctly
- [ ] Toggle "Comments" / "All" → feed switches correctly
- [ ] Post a comment → appears in feed, auto-scrolls to bottom
- [ ] Reply to a comment → reply context banner appears
- [ ] Scroll up → "New messages" pill appears when new content arrives
- [ ] Click pill → scrolls to bottom
- [ ] Day dividers show correctly ("Today", "Yesterday", "Mar 24")
- [ ] "New" red divider shows at correct position
- [ ] Emoji reactions work
- [ ] Typing indicator shows when another user types
- [ ] Read receipts ("Seen by") display correctly
- [ ] Comment attachments display correctly

**Commit message:** `refactor: extract ActivityFeed from TaskDetailSidebar`

---

### Phase 4: Metadata layout prop + exports

**Goal:** Make `TaskDetailMetadata` support both grid and stack layouts. Export `InlineEstimateCell`. Add Created by/on fields for stack layout.

**Files:**
- `components/tasks/task-detail-metadata.tsx` — add `layout` prop, export estimate cell, add extra fields

**Changes:**
- Add `layout?: "grid" | "stack"` prop (default `"grid"`, no breaking change)
- When `layout="grid"`: render as current 2-column grid (unchanged)
- When `layout="stack"`: render as single-column vertical list, include extra fields:
  - Created by (user avatar + name)
  - Created on (date)
- Export `InlineEstimateCell` (currently module-private)
- Export `MetadataRow` for potential reuse

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Open task modal → metadata renders in grid layout (unchanged)
- [ ] (Temporary test) Swap to `layout="stack"` in modal → renders vertically with Created by/on
- [ ] Revert to `layout="grid"` — confirm no visual diff from before

**Commit message:** `feat: add layout prop to TaskDetailMetadata for drawer support`

---

### Phase 5: Drawer shell + header

**Goal:** Create the drawer container and header. Renders when `?detail=` is set, but NOT yet wired into the page (standalone test only).

**Files:**
- `components/tasks/task-detail-drawer.tsx` — **NEW** fixed-position shell
- `components/tasks/task-detail-drawer-header.tsx` — **NEW** compact header

**`TaskDetailDrawer` structure:**
```tsx
// Fixed-position overlay panel
<div className="fixed top-0 right-0 bottom-0 w-[55vw] z-40
  border-l border-border bg-background shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)]
  flex flex-col">
  <ErrorBoundary>
    <TaskDetailDrawerHeader ... />
    <div className="flex flex-1 overflow-hidden">
      {/* DrawerContent + Properties will go here in Phase 6 */}
      {/* For now: just show task title as proof of life */}
      {task && <div className="p-6">{task.title}</div>}
    </div>
  </ErrorBoundary>
</div>
```

**`TaskDetailDrawerHeader`:**
- Left: prev/next nav arrows, breadcrumb (client / project)
- Right: properties toggle, view toggle (drawer→modal), kebab menu, close (X)
- Height: compact (~44px), matching modal header

**Props:** Same as `TaskDetailHeader` — receives task data + callbacks from `useTaskDetail`.

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] (Temporary) Import `TaskDetailDrawer` in `tasks/page.tsx` alongside modal, render it always
- [ ] See the fixed panel appear on the right with task title
- [ ] Header renders with nav arrows, close button
- [ ] Close button calls `handleClose`
- [ ] Revert the temporary import — drawer is not user-facing yet

**Commit message:** `feat: create TaskDetailDrawer shell and header`

---

### Phase 6: Drawer content

**Goal:** Build the full drawer content with Overview tab, ActivityFeed, and sticky comment input. This is the most complex phase.

**Files:**
- `components/tasks/task-detail-drawer-content.tsx` — **NEW** main content area

**Structure:**
```tsx
<div className="flex flex-1 flex-col overflow-hidden">
  {/* Tab bar */}
  <Tabs defaultValue="overview">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="time">Time</TabsTrigger>
      <TabsTrigger value="emails">Emails</TabsTrigger>
    </TabsList>

    <TabsContent value="overview" className="flex flex-1 flex-col overflow-hidden">
      {/* Scrollable area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <TaskDetailTitle ... />
        {/* Project badge + assignee inline row */}
        <TiptapEditor variant="document" ... />
        <SubtaskList ... />
        {/* Compact attachments section */}
        <ActivityFeed taskId={...} scrollRef={scrollRef} ... />
      </div>

      {/* Sticky footer — outside scroll */}
      <div className="shrink-0 border-t border-border">
        <TypingIndicator ... />
        <TaskDetailCommentInput ... />
      </div>
    </TabsContent>

    <TabsContent value="time">
      <TaskDetailTime ... />
    </TabsContent>

    <TabsContent value="emails">
      <div className="p-6 text-muted-foreground">Coming soon</div>
    </TabsContent>
  </Tabs>
</div>
```

**Key challenges:**
- Scroll management: ActivityFeed needs `scrollRef` to manage auto-scroll, but it shares the scroll container with description/subtasks above it
- Reply context: `replyContext` state lives here, passed to both `ActivityFeed` and `CommentInput`
- Tab switching: scroll position resets when switching tabs

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] (Temporary) Render drawer in page with full content
- [ ] Description editor loads and is editable
- [ ] Subtasks render and can be toggled
- [ ] Activity feed shows with Comments/All toggle
- [ ] Post a comment → appears in feed
- [ ] Comment input is sticky at bottom — scroll the content, input stays
- [ ] Reply to a comment → banner appears above input, reply posts correctly
- [ ] Auto-scroll works when new comment arrives
- [ ] "New messages" pill works when scrolled up
- [ ] Switch to Time tab → time entries render
- [ ] Switch back to Overview → scroll position resets, activity at bottom
- [ ] Typing indicator shows above comment input

**Commit message:** `feat: create TaskDetailDrawerContent with Overview, Time, Emails tabs`

---

### Phase 7: Integration — conditional rendering + view toggle

**Goal:** Wire everything together. Users can switch between modal and drawer.

**Files:**
- `app/(dashboard)/tasks/page.tsx` — conditional render based on preference
- `components/tasks/task-detail-header.tsx` — add view toggle button
- `components/tasks/task-detail-drawer-header.tsx` — wire view toggle button
- `components/tasks/task-detail-drawer.tsx` — wire `TaskDetailMetadata(layout="stack")` + collapsible properties

**`tasks/page.tsx` changes:**
```tsx
const currentUser = useQuery(api.users.current, ...)
const viewPref = currentUser?.taskDetailView ?? "modal"

// Only mount ONE — prevents double Convex subscriptions
{viewPref === "modal" ? (
  <TaskDetailModal taskIds={allVisibleTaskIds} isAdmin={isAdmin} />
) : (
  <TaskDetailDrawer taskIds={allVisibleTaskIds} isAdmin={isAdmin} />
)}
```

**View toggle wiring:**
- Both headers show toggle button (PanelRightClose ↔ Maximize2)
- Click calls `updateTaskDetailView` mutation
- Convex reactivity updates `currentUser.taskDetailView` → page re-renders with other container
- Current `?detail=` param preserved — task stays open, just container swaps

**Properties panel wiring:**
- `TaskDetailDrawer` renders `TaskDetailMetadata(layout="stack")` in a collapsible right column
- Toggle button in drawer header shows/hides it
- Default: visible ≥1440px, collapsed <1440px (via `useMediaQuery` or `window.matchMedia`)

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Open app → default is modal (existing behavior unchanged)
- [ ] Click view toggle in modal header → drawer appears, modal disappears
- [ ] Task data is the same in drawer as it was in modal
- [ ] Click view toggle in drawer header → modal appears, drawer disappears
- [ ] Preference persists: reload page → same view
- [ ] J/K navigation works in drawer
- [ ] Escape closes drawer
- [ ] Properties panel visible on wide screen, collapsible on narrow
- [ ] Properties toggle button works
- [ ] Properties show all metadata fields + Created by/on

**Commit message:** `feat: integrate drawer with view toggle and preference persistence`

---

### Phase 8: Polish — highlight, scroll, animation, responsive

**Goal:** Final polish pass. Selected row highlight, slide-in animation, responsive breakpoints.

**Files:**
- `components/tasks/task-row.tsx` — selected highlight
- `components/tasks/task-detail-drawer.tsx` — animation + responsive
- `app/(dashboard)/tasks/page.tsx` — responsive fallback

**Changes:**

**Selected task highlight (`task-row.tsx`):**
- Accept `isDetailOpen?: boolean` prop
- When true: `bg-accent/50` background + `border-l-2 border-primary` left accent
- Pass from `tasks/page.tsx`: `isDetailOpen={detailId === task._id}`

**Scroll into view:**
- When `detailId` changes in drawer mode, find the row element and call `scrollIntoView({ block: "nearest", behavior: "smooth" })`
- Use `data-task-id` attribute on rows for lookup

**Slide-in animation (`task-detail-drawer.tsx`):**
```tsx
<div className={cn(
  "fixed top-0 right-0 bottom-0 w-[55vw] z-40 ...",
  "transition-transform duration-200 ease-out",
  isOpen ? "translate-x-0" : "translate-x-full",
)}>
```

**Responsive fallback (`tasks/page.tsx`):**
```tsx
const isMobile = useMediaQuery("(max-width: 767px)")  // or check via Tailwind
const effectiveView = isMobile ? "modal" : viewPref
```
- Hide view toggle button on mobile (`hidden md:flex`)

**Verification:**
- [ ] `npx tsc --noEmit` passes
- [ ] Open task in drawer → selected row highlighted in task list
- [ ] Switch to different task (J/K or click) → highlight moves, row scrolls into view
- [ ] Close drawer → highlight removed
- [ ] Drawer slides in smoothly from right (~200ms)
- [ ] Drawer slides out when closing
- [ ] Resize window below 768px → auto-switches to modal
- [ ] Resize back above 768px → returns to drawer
- [ ] View toggle button hidden on mobile
- [ ] Properties panel auto-collapses below 1440px
- [ ] Full end-to-end: open drawer, comment, navigate J/K, toggle to modal, toggle back to drawer — everything works

**Commit message:** `feat: polish drawer with animation, highlight, and responsive fallback`

---

## 6. File Summary

### New files (5)

| File | Phase | Purpose |
|------|-------|---------|
| `components/tasks/use-task-detail.ts` | 2 | Shared controller hook |
| `components/tasks/activity-feed.tsx` | 3 | Shared activity feed |
| `components/tasks/task-detail-drawer.tsx` | 5 | Drawer shell |
| `components/tasks/task-detail-drawer-header.tsx` | 5 | Drawer header |
| `components/tasks/task-detail-drawer-content.tsx` | 6 | Drawer main content |

### Modified files (~10)

| File | Phase | Change |
|------|-------|--------|
| `convex/schema.ts` | 1 | Add `taskDetailView` field |
| `convex/users.ts` | 1 | Add `updateTaskDetailView` mutation |
| `components/tasks/task-detail-modal.tsx` | 2 | Use `useTaskDetail` hook |
| `components/tasks/task-detail-sidebar.tsx` | 3 | Use `ActivityFeed` |
| `components/tasks/task-detail-metadata.tsx` | 4 | Add `layout` prop, export cells, add Created fields |
| `components/tasks/task-detail-drawer.tsx` | 7 | Wire properties panel |
| `components/tasks/task-detail-drawer-header.tsx` | 7 | Wire view toggle |
| `components/tasks/task-detail-header.tsx` | 7 | Add view toggle button |
| `app/(dashboard)/tasks/page.tsx` | 7 | Conditional modal/drawer rendering |
| `components/tasks/task-row.tsx` | 8 | Selected task highlight |

## 7. Responsive Behavior

| Viewport width | Sidebar        | Task detail       | Properties panel   |
|----------------|----------------|-------------------|--------------------|
| ≥1440px        | Expanded       | Drawer (55vw)     | Visible by default |
| 1200–1440px    | Expanded       | Drawer (55vw)     | Collapsed default  |
| 768–1200px     | Icon rail      | Drawer (55vw)     | Collapsed default  |
| <768px         | Hidden         | Modal (fullscreen) | N/A (in modal)    |

## 8. Edge Cases

- **Deep link:** `?detail=taskId` works for both views.
- **Task list click:** Updates drawer content — no close/reopen.
- **Click outside drawer:** Does NOT close. Close via X, Escape, or same task click.
- **Only one container mounted:** Prevents double subscriptions.
- **Window resize:** Auto-switches modal ↔ drawer at breakpoint.
- **Scroll position:** Task switch resets scroll. Activity auto-scrolls to bottom.
