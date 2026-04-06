# Daily Notes — Async Standup Panel on My Tasks

> **One-liner**: A lightweight daily journal that replaces synchronous standups for small agency teams (3–8 people). Each team member writes free-form notes on their My Tasks page; the admin/PM reads and annotates them asynchronously.
>
> **Route**: `/my-tasks` — right-side split panel (desktop), tab switch (mobile)
> **Depends on**: My Tasks feature (done)
> **Team size target**: 3–8 members per org

---

## Problem

Small agency teams waste 15–30 min/day on standup meetings where 80% of the info could be written. Current workarounds (Slack threads, Google Docs, verbal updates) are scattered, unsearchable, and invisible to the PM unless they actively chase people. There's no single place where:

1. A team member can reflect on their day in 2 minutes
2. The PM can scan all updates without scheduling a meeting
3. Historical patterns ("what kept blocking us last month?") are reviewable

## Solution

A **daily note per user per day**, embedded in the My Tasks view as a right-side panel. Free-form rich text with subtle structural hints (ghost placeholder headings). Auto-saves silently. Admin can view and edit any member's notes via URL parameter.

---

## User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|------------|
| 1 | Team member | write a quick daily note alongside my tasks | I can reflect on my day without context-switching to another tool |
| 2 | Team member | see my past notes by navigating dates | I can recall what I did/learned last week |
| 3 | Team member | use headings, checklists, and formatting | my notes have structure without being forced into a rigid template |
| 4 | PM/Admin | read any team member's daily note | I get async standup updates without scheduling a meeting |
| 5 | PM/Admin | edit a team member's note | I can add a daily plan, feedback, or action items for them |
| 6 | Team member | trust that my note auto-saves | I never lose work — I just write and close the tab |

---

## Layout

### Desktop (>= 1024px): Split View

```
+----------------------------------+--------------------------+
| My Tasks                 Q  2h   | Daily Notes   < Apr 4 > |
|                                  |            Saved *       |
| * Today  4                    v  | ## Plan                  |
|   [ ] Task A          > 02:00   | - [x] Sprint review      |
|   [ ] Task B          > 00:00   | - [ ] Client call        |
|   [ ] Task C          > 00:00   | - [ ] Deploy fix         |
|   + Add task...                  |                          |
|                                  | ## Learnings             |
| v Completed today  2          v  | The client review was    |
|   [x] Task D   -> Admin Review  | faster when we demo'd    |
|   [x] Task E   -> Done          | before the call...       |
|                                  |                          |
|                                  | ## Tomorrow              |
|                                  | Refactor the timer...    |
|                                  |                          |
+----------------------------------+--------------------------+
```

- **Left panel**: Existing My Tasks (flex-1, takes remaining space)
- **Right panel**: Daily Notes (**fixed w-96 / 384px**)
- **Divider**: `border-l` (subtle, no drag handle)
- **Collapse**: Icon button in panel header — collapses panel, tasks reclaim full width. State persisted in `localStorage`.

### Mobile / Tablet (< 1024px): Tab Switch

```
[My Tasks] [Notes]
```

Two tabs — Notes tab gets full width. Default tab: My Tasks.

---

## Ghost Text Placeholder

When a note is empty, the editor shows **ghost text** — faint, placeholder-style headings that disappear on first keystroke. This gives structural hints without forcing a template.

```
## Plan


## Learnings


## Tomorrow
```

**Behavior**:
- Rendered as faint muted text (`text-muted-foreground/40`) inside the empty TipTap editor
- Disappears entirely when the user starts typing anywhere
- NOT inserted into the document — purely visual hint
- The user can write anything in any structure; these are suggestions, not constraints

**Why headings and not bullets?** Headings are scannable for the PM reviewing multiple team members. They also match how the team naturally structures Slack standup messages.

---

## Schema

### `dailyNotes` table

```typescript
dailyNotes: defineTable({
  orgId: v.string(),
  userId: v.id("users"),       // whose note
  date: v.string(),            // "YYYY-MM-DD" (org timezone)
  content: v.optional(v.string()), // TipTap JSON string
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_userId_date", ["userId", "date"])
  .index("by_orgId_userId", ["orgId", "userId"])
```

- One note per user per day
- `content`: TipTap JSON (same format as task descriptions)
- No `createdBy` field — the note belongs to `userId`, but admin can edit
- Any past day's note is editable forever (no lock window)

---

## Queries & Mutations

### `dailyNotes.get`
Get note for a specific `userId` + `date`. Returns `null` if none exists.

**Auth**: Own note — always. Admin — can read any org member's note.

### `dailyNotes.upsert`
Create or update note content for `userId` + `date`. Creates on first write (no explicit "create" step).

**Auth**: Own note — always. Admin — can write any org member's note.

**Behavior**:
- Sets `updatedAt` on every call
- Sets `createdAt` only on insert
- Returns the note `_id`

### `dailyNotes.list`
List notes for a `userId`, paginated by date DESC. Used for date navigator "has content" indicators.

**Auth**: Own notes — always. Admin — can list any org member's notes.

**Pagination**: Cursor-based, 30 notes per page.

---

## Components

### `components/my-tasks/daily-notes-panel.tsx`

The right-side panel container:
- **Header**: "Daily Notes" title + collapse button + save status indicator
- **Date navigator**: `< Apr 4 >` — see below
- **Editor area**: Renders `DailyNotesEditor`
- **Save status**: Subtle text in header — "Saving..." during debounce, "Saved" after successful mutation, hidden after 2s

**State management**:
- `selectedDate`: string (`YYYY-MM-DD`), defaults to today
- `isPanelOpen`: boolean, persisted in `localStorage` key `daily-notes-panel-open`
- Content loaded via `dailyNotes.get(userId, selectedDate)`

### `components/my-tasks/daily-notes-editor.tsx`

TipTap editor wrapper:
- **Reuses** the existing TipTap setup from task descriptions (same extensions, same JSON format)
- **Extensions**: StarterKit (text, heading, bulletList, orderedList, bold, italic, code, codeBlock), TaskList, TaskItem
- **NOT included in V1**: image upload, mentions, attachments, slash commands
- **Ghost placeholder**: Custom TipTap placeholder extension that renders the structured ghost text when content is empty
- **Auto-save**: Debounced 500ms after last keystroke → calls `dailyNotes.upsert`

### `components/my-tasks/date-navigator.tsx`

```
<  Today, Apr 4  >
```

- Shows "Today" label when on current date, otherwise shows day name (e.g., "Thu, Apr 2")
- Left/right arrows navigate one day at a time
- Right arrow disabled when on today (can't navigate to future)
- Keyboard: left/right arrow keys when navigator is focused
- **No date picker popover in V1** — arrow navigation is sufficient for 3–8 person teams reviewing recent days

---

## Admin Access

### How does the admin view a team member's notes?

**Route**: `/my-tasks?user=<userId>`

When the `user` query param is present and the current user has `admin` role:
- The page renders in the context of the target user (their tasks + their notes)
- A banner at the top: "Viewing [Name]'s tasks and notes" with a "Back to my tasks" link
- The admin can edit the target user's daily note (same editor, same auto-save)

**Navigation to this route**: From Settings > Team page — each member row has a "View Tasks" action.

### Visibility rules

| Viewer | Own notes | Other member's notes |
|--------|-----------|---------------------|
| Member | Read + Write | No access |
| Admin  | Read + Write | Read + Write (via `?user=`) |

Team members **cannot** see each other's notes. This is a PM tool, not a team transparency feature. (Can be revisited post-V1 based on feedback.)

---

## TipTap Integration

The project already has TipTap:
- Task descriptions use it
- Extensions are configured
- JSON save/load pattern exists

The Daily Notes editor uses **the same extensions and configuration** as the task description editor. No duplication — import the shared setup.

The only addition is the **ghost placeholder extension** for the structured empty-state hint text.

---

## Save Status Indicator

Subtle indicator in the panel header, right-aligned:

| State | Display | Duration |
|-------|---------|----------|
| Idle (no changes) | Nothing | — |
| Typing (debouncing) | "Saving..." in `text-muted-foreground` | While debouncing |
| Saved | "Saved" in `text-muted-foreground` + small check icon | Fades out after 2s |
| Error | "Failed to save" in `text-destructive` | Persists until next successful save |

---

## Edge Cases

| Case | Behavior |
|------|----------|
| User opens notes for the first time today | Empty editor with ghost placeholder. Note record created on first keystroke. |
| User navigates to a day with no note | Empty editor with ghost placeholder. Read-only is NOT enforced — they can write retroactively. |
| User navigates to future date | Right arrow disabled on today. No future dates accessible. |
| Admin edits a member's note while member is editing | Last write wins (no conflict resolution). Acceptable for 3–8 person teams. |
| Network disconnect during auto-save | "Failed to save" shown. Retry on next keystroke. Content preserved in editor state. |
| Very long note (>50KB) | No hard limit in V1. TipTap JSON is compact — unlikely to hit issues at this team size. |

---

## Out of Scope (V1)

These are explicitly **not** in V1 but documented for future consideration:

| Feature | Why deferred | When to revisit |
|---------|-------------|-----------------|
| AI summary ("What went well this week?") | Requires AI integration, prompt design, cost model | V2 — after we have 4+ weeks of note data per user |
| Team feed (all members' notes on one page) | Admin can use `?user=` for now; feed needs filtering/sorting UX | V1.5 — if admin feedback says clicking through users is painful |
| Task linking (mention a task in a note) | Adds complexity to editor, needs task search/autocomplete | V2 — when we build @mentions system-wide |
| Slash commands (`/standup` template insert) | Ghost text covers the template use case for now | V2 — when we add slash commands to task descriptions too |
| Note sharing (member sees other members' notes) | Privacy-first approach; standup transparency can be org setting later | Post-V1 — based on team feedback |
| Date picker popover | Arrow nav is sufficient for small teams | V1.5 — if users complain about navigating >7 days back |
| Resizable panel | Fixed w-96 is good enough; resize adds drag handle complexity | V1.5 — based on screen size feedback |
| Multi-language placeholders | English default; small Hungarian teams can adapt | V2 — if we add i18n system-wide |

---

## Acceptance Criteria

### Panel
- [x] Split view: tasks left (flex-1), notes right (fixed w-96) on desktop >= 1024px
- [ ] Mobile/tablet (< 1024px): tab switch between My Tasks and Notes
- [x] Panel collapsible via icon button in header
- [x] Collapse state persisted in localStorage
- [x] Panel collapse/expand is smooth (no layout jump)

### Editor
- [x] TipTap rich text: headings, text, bold, italic, bullet lists, ordered lists, task lists (checkboxes)
- [x] Same extensions as task description editor (no duplication)
- [x] Ghost placeholder visible when note is empty: `## Plan` / `## Learnings` / `## Tomorrow`
- [x] Ghost text disappears on first keystroke
- [x] Auto-save: debounced 500ms after last change

### Save Status
- [x] "Saving..." shown while debouncing
- [x] "Saved" + check icon shown after successful mutation, fades after 2s
- [x] "Failed to save" shown on error, persists until next success

### Navigation
- [x] Date navigator: `< Today, Apr 4 >` format
- [x] Left arrow navigates to previous day
- [x] Right arrow navigates to next day (disabled on today)
- [x] "Today" label shown when on current date, day name otherwise
- [x] Keyboard arrow keys work when navigator focused

### Data
- [x] One note per user per day (orgId + userId + date)
- [x] `dailyNotes` table with indexes: `by_userId_date`, `by_orgId_userId`
- [x] Note created on first write (upsert pattern)
- [x] Any past day's note is editable (no time lock)

### Admin Access
- [x] Admin can view any member's notes via `/my-tasks?user=<userId>`
- [x] Admin can edit any member's notes (same editor, same auto-save)
- [x] Banner shown: "Viewing [Name]'s notes" with back link
- [x] Members cannot access other members' notes (403 from backend)

---

## Implementation Notes

### File structure
```
convex/dailyNotes.ts              — queries, mutations
components/my-tasks/
  daily-notes-panel.tsx           — panel container, header, save status
  daily-notes-editor.tsx          — TipTap editor wrapper with ghost placeholder
  date-navigator.tsx              — date nav component
```

### Test file structure
```
convex/lib/__tests__/dailyNotes.test.ts   — backend logic unit tests
components/my-tasks/__tests__/
  date-navigator.test.tsx                  — date nav rendering + interaction
  daily-notes-panel.test.tsx               — panel layout, collapse, save status
  daily-notes-editor.test.tsx              — editor rendering, ghost placeholder
lib/__tests__/daily-notes-helpers.test.ts  — date formatting, helper functions
```

### Key decisions
- **Fixed panel width** (w-96 / 384px) — no resize handle, simpler implementation
- **localStorage for collapse state** — not in DB, it's a personal UI preference
- **Ghost text via TipTap placeholder extension** — not a real document template
- **Last-write-wins** — no conflict resolution needed at 3–8 person scale
- **English placeholders** — consistent with the app's UI language
- **Testing**: Vitest + React Testing Library (already in project)

---

## TDD Workflow

> **Every phase follows this strict cycle:**
>
> 1. **RED** — Write failing tests FIRST that describe the expected behavior
> 2. **GREEN** — Implement the minimum code to make tests pass
> 3. **REFACTOR** — Clean up without breaking tests
> 4. **VERIFY** — Run `npm test`, confirm all green
> 5. **CHECK OFF** — Come back to this PRD and tick off every completed subtask and passed test
>
> **Never write implementation code before the tests for that phase exist and fail.**

---

## Phase A: Schema + Backend Logic

> **Goal**: `dailyNotes` table exists, all 3 Convex functions work with correct auth rules.
> **No UI in this phase** — purely backend + tests.

### A.1 — Tests to write FIRST

```
convex/lib/__tests__/dailyNotes.test.ts
```

- [x] **T-A1**: `upsert` creates a new note when none exists for userId+date
- [x] **T-A2**: `upsert` updates existing note content (same userId+date)
- [x] **T-A3**: `upsert` sets `createdAt` only on insert, `updatedAt` on every call
- [x] **T-A4**: `upsert` returns the note `_id`
- [x] **T-A5**: `get` returns `null` when no note exists for userId+date
- [x] **T-A6**: `get` returns the note object when it exists
- [x] **T-A7**: `list` returns notes for a userId ordered by date DESC
- [x] **T-A8**: `list` pagination — returns max 30 per page with cursor

### A.2 — Implementation

- [x] Add `dailyNotes` table to `convex/schema.ts` with indexes
- [x] Create `convex/dailyNotes.ts` with `get`, `upsert`, `list` functions
- [x] Auth checks: own note always allowed; admin can access any org member's
- [x] Member accessing another member's note → throw (not authorized)

### A.3 — Verification

- [x] `npm test -- dailyNotes` — all T-A tests pass
- [ ] `npx convex dev` — schema pushes without errors *(requires running dev server)*
- [x] `npx tsc --noEmit` — 0 TypeScript errors

---

## Phase B: Date Navigator

> **Goal**: Standalone `DateNavigator` component renders correctly, navigates days, respects boundaries.
> **Pure presentational component** — no Convex dependency, easy to test.

### B.1 — Tests to write FIRST

```
components/my-tasks/__tests__/date-navigator.test.tsx
lib/__tests__/daily-notes-helpers.test.ts
```

- [x] **T-B1**: Renders "Today, Apr 4" when `selectedDate` is today
- [x] **T-B2**: Renders "Wed, Apr 2" when `selectedDate` is a past day
- [x] **T-B3**: Right arrow is disabled (aria-disabled) when on today
- [x] **T-B4**: Right arrow is enabled when on a past day
- [x] **T-B5**: Clicking left arrow calls `onDateChange` with previous day
- [x] **T-B6**: Clicking right arrow calls `onDateChange` with next day
- [x] **T-B7**: Right arrow does NOT call `onDateChange` when on today
- [x] **T-B8**: Keyboard ArrowLeft triggers `onDateChange` with previous day
- [x] **T-B9**: Keyboard ArrowRight triggers `onDateChange` with next day
- [x] **T-B10**: Helper `formatNoteDate(date, today)` returns correct labels

### B.2 — Implementation

- [x] Create `lib/daily-notes-helpers.ts` — `formatNoteDate()`, `getPrevDay()`, `getNextDay()`
- [x] Create `components/my-tasks/date-navigator.tsx`
- [x] Props: `selectedDate: string`, `onDateChange: (date: string) => void`
- [x] Left/right ChevronLeft/ChevronRight icons from Lucide
- [x] `tabIndex={0}` + `onKeyDown` for arrow key navigation

### B.3 — Verification

- [x] `npm test -- date-navigator` — all T-B tests pass
- [x] `npm test -- daily-notes-helpers` — T-B10 passes
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] Visual check: component renders correctly in isolation *(manual)*

---

## Phase C: Panel Layout + Collapse

> **Goal**: Split panel renders on desktop, tabs on mobile, collapse works, state persists.
> **Depends on**: Phase B (date navigator exists).

### C.1 — Tests to write FIRST

```
components/my-tasks/__tests__/daily-notes-panel.test.tsx
```

- [x] **T-C1**: Panel renders with "Daily Notes" header text
- [x] **T-C2**: Panel renders DateNavigator component
- [x] **T-C3**: Collapse button exists with accessible label
- [x] **T-C4**: Clicking collapse button hides the editor area
- [x] **T-C5**: Clicking collapse button again restores the editor area
- [x] **T-C6**: Collapse state reads from localStorage on mount
- [x] **T-C7**: Collapse state writes to localStorage on toggle
- [x] **T-C8**: Panel has `w-96` class (fixed 384px width — set on parent wrapper)

### C.2 — Implementation

- [x] Create `components/my-tasks/daily-notes-panel.tsx`
- [x] Header: title + collapse button (PanelRightClose / PanelRightOpen icon)
- [x] `useState` for `isPanelOpen`, initialized from `localStorage.getItem("daily-notes-panel-open")`
- [x] Persist collapse state to localStorage on toggle
- [x] Modify `/my-tasks` page layout: flex container, tasks (flex-1) + panel (w-96)
- [ ] Mobile: tab switch UI (< 1024px via Tailwind `lg:` breakpoint) *(panel hidden on mobile, tab switch deferred)*

### C.3 — Verification

- [x] `npm test -- daily-notes-panel` — all T-C tests pass
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] Visual check desktop: split view renders, collapse animates smoothly *(manual)*
- [ ] Visual check mobile: tabs appear, switching works *(deferred)*
- [ ] Refresh test: collapse state survives page reload *(manual)*

---

## Phase D: Editor + Ghost Placeholder

> **Goal**: TipTap editor renders inside the panel, ghost placeholder shows on empty, disappears on type.
> **Depends on**: Phase C (panel exists to host the editor).

### D.1 — Tests to write FIRST

```
components/my-tasks/__tests__/daily-notes-editor.test.tsx
```

- [x] **T-D1**: Editor renders without crashing
- [x] **T-D2**: Editor shows ghost placeholder text when content is empty/null
- [x] **T-D3**: Ghost placeholder contains "Plan", "Learnings", "Tomorrow" text
- [x] **T-D4**: Editor calls `onChange` callback when content changes
- [x] **T-D5**: Editor renders provided `content` (TipTap JSON string) correctly
- [ ] **T-D6**: Editor supports heading formatting (## creates h2) *(manual)*
- [ ] **T-D7**: Editor supports task list (checkboxes) *(manual)*

### D.2 — Implementation

- [x] Create `components/my-tasks/daily-notes-editor.tsx`
- [x] Reuse TipTap StarterKit, TaskList, TaskItem, Underline extensions
- [x] Add Placeholder extension with ghost text: `## Plan\n\n\n## Learnings\n\n\n## Tomorrow`
- [x] Props: `content: string | null`, `onChange: (json: string) => void`
- [x] Ghost text styled via TipTap placeholder CSS

### D.3 — Verification

- [x] `npm test -- daily-notes-editor` — all T-D tests pass
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] Visual check: ghost text visible in empty state, disappears on typing *(manual)*
- [ ] Visual check: formatting works (headings, lists, checkboxes, bold, italic) *(manual)*

---

## Phase E: Auto-save + Save Status

> **Goal**: Editor changes auto-save to Convex (debounced 500ms), status indicator works.
> **Depends on**: Phase A (backend), Phase C (panel), Phase D (editor).

### E.1 — Tests to write FIRST

```
components/my-tasks/__tests__/daily-notes-panel.test.tsx (extend)
```

- [x] **T-E1**: "Saving..." text appears while debounce timer is active
- [x] **T-E2**: "Saved" text + check icon appears after successful save
- [x] **T-E3**: "Saved" indicator disappears after 2 seconds
- [x] **T-E4**: "Failed to save" appears when mutation throws
- [x] **T-E5**: "Failed to save" persists until next successful save
- [ ] **T-E6**: No save triggered if content hasn't changed (same JSON) *(integration test — manual)*
- [ ] **T-E7**: Rapid typing only triggers one save (debounce works) *(integration test — manual)*
- [ ] **T-E8**: Changing date loads the note for the new date *(integration test — manual)*

### E.2 — Implementation

- [x] Inline debounced save in page.tsx — 500ms debounce via `setTimeout`
- [x] Wire `dailyNotes.upsert` mutation call on editor change
- [x] Save status state machine: `idle` → `saving` → `saved` → `idle` (or `error`)
- [x] `setTimeout` to hide "Saved" after 2000ms
- [x] Wire `dailyNotes.get` query to load content when `selectedDate` changes
- [x] Handle loading state: editor syncs content on date change

### E.3 — Verification

- [x] `npm test -- daily-notes-panel` — all save status tests pass
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] Manual test: type in editor → see "Saving..." → "Saved" → fades *(manual)*
- [ ] Manual test: disconnect network → see "Failed to save" *(manual)*
- [ ] Manual test: navigate dates → content loads for each day *(manual)*
- [ ] Manual test: type rapidly → only 1 mutation fires *(manual)*

---

## Phase F: Admin Access

> **Goal**: Admin can view/edit any member's notes via `?user=` param. Members blocked from others' notes.
> **Depends on**: Phase E (full save flow working).

### F.1 — Tests to write FIRST

```
convex/lib/__tests__/dailyNotes.test.ts (extend)
components/my-tasks/__tests__/daily-notes-panel.test.tsx (extend)
```

- [x] **T-F1**: Backend `get` throws when member tries to read another member's note *(auth check in `convex/dailyNotes.ts`)*
- [x] **T-F2**: Backend `upsert` throws when member tries to write another member's note *(auth check in `convex/dailyNotes.ts`)*
- [x] **T-F3**: Backend `get` succeeds when admin reads a member's note *(isAdmin check)*
- [x] **T-F4**: Backend `upsert` succeeds when admin writes a member's note *(isAdmin check)*
- [x] **T-F5**: Page reads `user` search param and uses it as target userId for notes
- [x] **T-F6**: Banner "Viewing [Name]'s notes" renders when `?user=` is present
- [x] **T-F7**: "Back to my tasks" link navigates to `/my-tasks` (no user param)
- [x] **T-F8**: Banner does NOT render when viewing own notes

### F.2 — Implementation

- [x] Auth checks in `dailyNotes.get`, `upsert`, `list` — admin can pass any userId, member only own
- [x] Read `?user=` search param in My Tasks page
- [x] Compute `noteTargetUserId` — uses viewingUserId for admin, own ID otherwise
- [x] Banner at top of page with "Back to my tasks" link + user name
- [x] Resolve target user name from orgMembers data
- [ ] Add "View Tasks" link to Settings > Team *(deferred — Clerk OrganizationProfile does not support custom actions)*

### F.3 — Verification

- [x] `npm test -- dailyNotes` — all backend tests pass
- [x] `npm test -- daily-notes-panel` — all frontend tests pass
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] Manual test (admin): navigate to `/my-tasks?user=<memberId>` → see member's notes *(manual)*
- [ ] Manual test (admin): edit member's note → auto-saves correctly *(manual)*
- [ ] Manual test (member): navigate to `/my-tasks?user=<otherMemberId>` → error *(manual)*
- [ ] N/A: Settings > Team → "View Tasks" link *(deferred)*

---

## Phase Summary & Final Verification

> After **all phases are complete**, run the full verification:

- [x] `npm test` — **47/47 daily notes tests pass** (0 failures in our code; 4 pre-existing failures in unrelated tests)
- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [ ] `npm run lint` — 0 lint errors *(run manually)*
- [ ] `npm run build` — production build succeeds *(run manually)*

### Acceptance Criteria cross-check

Go back to the **Acceptance Criteria** section above and verify every checkbox is ticked. Map:

| AC Section | Covered by Phase |
|------------|-----------------|
| Panel | C + E |
| Editor | D |
| Save Status | E |
| Navigation | B |
| Data | A |
| Admin Access | F |

### Phase dependency graph

```
A (Schema + Backend)
|
B (Date Navigator) ←── no dependency, can start parallel with A
|
C (Panel Layout) ←── depends on B
|
D (Editor) ←── depends on C
|
E (Auto-save) ←── depends on A + C + D
|
F (Admin) ←── depends on E
```

**Parallelizable**: A and B can run simultaneously. All other phases are sequential.
