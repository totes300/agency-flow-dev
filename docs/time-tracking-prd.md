# Time Tracking — Product Requirements Document

> **Phase**: 7
> **Status**: Design complete, ready for implementation
> **Depends on**: Phase 5 (Tasks Core) — complete
> **Created**: 2026-03-17
> **Spec reference**: `docs/phase-7-time-tracking.md` (backend mechanics)

---

## Vision

Time tracking is the revenue engine of Agency Flow. Every billable minute that goes untracked is money lost. The experience must feel **effortless** — like committing code, not filling out a timesheet. Users should *want* to log time because the interaction is fast, warm, and rewarding.

**Design philosophy**: "Commit your time" — inspired by git commits. Stop a timer → review the duration → add a note describing what you did → save. Fast, intentional, with a paper trail.

---

## User Context

| Signal | Value | Implication |
|--------|-------|-------------|
| Primary usage pattern | Pop in & out (external tools: Figma, VS Code) | Timer state must be instantly visible on return. Every interaction must be fast. |
| Time tracking habit | 50/50 timer vs manual | Both paths are first-class citizens. Neither should feel secondary. |
| Nudge preference | Moderate (soft indicators, no blockers) | Deferred to "Today" page in later phase. |
| Timer model | Single timer only | Simple mental model. One task at a time. Auto-stop on switch. |
| Visual personality | Warm & encouraging | Rounded elements, subtle animations, friendly colors. Logging feels rewarding. |

---

## Core Concepts

### 1. Combined Time Cell (Task List)

The task row's time column is the primary interaction surface for time tracking. It serves dual purpose:

```
┌──────────────────────────────────────────────────────┐
│ Task Name              Status   Time Cell            │
│──────────────────────────────────────────────────────│
│ Homepage redesign      In Prog  [14:30h         ▶]  │  ← Click cell = manual log popover
│ API integration        Review   [—              ▶]  │  ← Play = start timer
│ Logo design            In Prog  [● 1:23:45      ■]  │  ← Running: live counter + stop
│ Internal meeting       Done     [2:00h          ▶]  │
└──────────────────────────────────────────────────────┘
```

**States**:
- **No time logged**: Shows `—` + play button
- **Time logged, no timer**: Shows total hours (e.g., `14:30h`) + play button
- **Timer running**: Shows live `HH:MM:SS` counter with recording indicator (●) + stop button. Accent/warm color treatment.
- **Hover (no timer)**: Cell becomes clickable — opens manual log popover

**Time display**: Always shows **total logged time** (cumulative across all dates).

### 2. Inline Manual Log Popover

Triggered by clicking the time cell on any task row. A compact popover with combined input (manual entry + timer start in one field).

```
┌────────────────────────────────────┐
│ (AT) Adam Toth  ˅                  │  ← User selector (admin: dropdown, member: fixed)
│────────────────────────────────────│
│ |0h 00m                       [▶] │  ← Combined: type = manual, play = timer
│────────────────────────────────────│
│ 15m  30m  1h  2h  4h  8h          │  ← Quick buttons (fill input, don't submit)
│                                    │
│ ⏱ Today, Mar 18                    │  ← Click to change date
│ ≡ Add a note                       │  ← Optional commit message
│────────────────────────────────────│
│ [⏺ Billable]               [Save] │
│────────────────────────────────────│
│ ˅ Time entries              4:30h  │  ← Collapsible, shows total
│                                    │
│ (AT) Mon, Mar 16             2:00h │
│      Explored color palettes  ● ⋮  │
│ (AT) Tue, Mar 17             1:00h │
│      Final selections         ● ⋮  │
│ (EM) Tue, Mar 17             1:30h │
│      Mood board research      ● ⋮  │
└────────────────────────────────────┘
```

**Input behavior — two states**:
- **Default** (popover opens): placeholder shows "Enter time" in Inter
- **Focused** (user clicks input): placeholder switches to `0h 00m` in JetBrains Mono — ghost template showing the expected format. Blinking cursor appears at the start.
- User types numbers → fills the template (e.g., `2h 30m`)

**Combined input — one field, two modes**:
- Type a duration → manual entry (parsed on save)
- Click play button (▶) → timer starts on this task

**User selector**:
- Admin: dropdown to select any team member — can log time on someone else's behalf
- Member: fixed to current user, not clickable (no chevron)

**Quick buttons**: Fill the duration input field (don't auto-submit). User confirms with Save.

**Icon-labeled rows**:
- Clock icon + date: defaults to today, click opens date picker
- Lines icon + "Add a note": optional, click to focus

**Billable toggle**: pre-filled from task's `billable` default. Only visible if task is billable.

**Time entries section** (collapsible):
- Toggle header with chevron + total time on right
- Each entry: user avatar + date + note + billable dot (green) + duration + ⋮ menu
- ⋮ menu: Edit, Delete
- Entries from all users shown (admin sees all, member sees own)
- Invoiced entries: no ⋮ menu, lock icon instead

**Submit**: Save button or Enter key. Rounding applied per org setting (1/5/6/15 min, ceil).

### 3. "Commit Time" Popover (Timer Stop Flow)

When a timer is stopped (< 8 hours), a review popover appears — the "commit" moment:

```
┌────────────────────────────────┐
│ Commit time                    │
│                                │
│ Homepage redesign              │  ← Task name (read-only context)
│ Acme Corp / Brand Refresh      │  ← Client / Project
│                                │
│ Duration  [1:30           ]    │  ← Pre-filled with rounded time, editable
│ Note      [What did you do?]   │  ← Optional commit message
│                                │
│ ☑ Billable                     │  ← Only if task is billable
│                                │
│ [Discard]              [Save]  │
└────────────────────────────────┘
```

**Behavior**:
- Duration pre-filled with the rounded elapsed time, fully editable
- User can adjust (e.g., timer ran 1:32 → rounded to 1:30 → user changes to 1:15)
- Note field with placeholder "What did you do?"
- Billable toggle (only if task.billable === true)
- **Save** (Enter) → entry created → success toast
- **Discard** → no entry, timer cleared
- No date field (defaults to today in org timezone)

### 4. Stale Timer Recovery (> 8 hours)

If a timer has been running for more than 8 hours when the user returns:

```
┌──────────────────────────────────────────┐
│ ⚠ Forgotten timer?                       │
│                                          │
│ A timer has been running for 14h 23m     │
│ on "Homepage redesign"                   │
│                                          │
│ This is likely a forgotten timer.        │
│                                          │
│ I actually worked  [___________]         │  ← Duration input
│ Note               [___________]         │
│                                          │
│ [Discard timer]        [Save time entry] │
└──────────────────────────────────────────┘
```

**Behavior**:
- Triggered automatically on app load if `timerStartedAt` > 8 hours ago
- Modal dialog (blocking — must be resolved before using the app)
- Duration field is **empty** (not pre-filled with 14h — that's almost certainly wrong)
- User enters the real time they worked
- Discard = timer cleared, no entry
- Save = entry created with user-entered duration

**Key difference from normal stop**: Duration is NOT pre-filled. Forces the user to consciously enter the correct amount.

### 5. Floating Timer Widget

Fixed position, bottom-right. Expanded card style with today's breakdown.

```
┌──────────────────────────────────────┐
│  ● Recording                         │
│  Homepage redesign                   │
│  Acme Corp / Brand Refresh           │
│                                      │
│        01:23:45                       │  ← Large, warm-colored live counter
│                                      │
│  [Discard]                    [Stop] │
│──────────────────────────────────────│
│  Today  ─────────────────── 6:30h    │
│                                      │
│  API integration             2:00h   │
│  Logo design                 1:30h   │
│  Homepage redesign           1:00h   │
│  Content writing             2:00h   │
│──────────────────────────────────────│
│  ● recording + 4 entries             │
└──────────────────────────────────────┘
```

**Behavior**:
- **Only visible when a timer is running**
- Top section: running timer with task name, client/project, live HH:MM:SS
- Bottom section: today's logged entries (view-only, click → navigate to task)
- Today total displayed prominently
- Stop → triggers "Commit time" popover
- Discard → clears timer, no entry
- Task name is clickable → navigates to task detail
- Subtle entrance animation (slide up from bottom)
- Mobile: narrower, positioned bottom-left, collapsible

### 6. Timer in Task Detail Modal

The task detail modal (Phase 6) will have a Time tab with:
- Start/stop timer button
- Manual entry form (full version with date picker)
- List of all time entries for this task
- Entry editing (duration, note, date) via inline edit or ⋮ menu
- Invoiced entries: read-only with lock icon

This is the **full-featured** time management view. The task list popover and floating widget are quick-access shortcuts.

---

## Billable / Non-Billable

### Architecture

**Two-level system**: Task sets the default, entry can override.

| Level | Field | Default | Behavior |
|-------|-------|---------|----------|
| Task | `billable: boolean` | `true` | Admin/creator sets at task creation. Changeable anytime. |
| Time Entry | `isBillable: boolean` | Inherited from `task.billable` | Override per entry. Only shown in UI if task is billable. |

**Schema addition** (on `timeEntries` table):
```typescript
isBillable: v.boolean(),  // defaults from task.billable at creation
```

### UI Rules

- **Task is billable** → time entry defaults to billable. Toggle shown in commit popover and manual log popover so user can mark specific entries as non-billable (e.g., internal meeting about a client project).
- **Task is non-billable** → time entry always non-billable. Toggle hidden (no override).
- Reports and invoicing aggregate only entries where `isBillable === true`.

---

## Server-Side Timer (Backend)

### Timer State
Lives on the `users` table (survives browser close):
```typescript
timerTaskId: v.optional(v.id("tasks"))
timerStartedAt: v.optional(v.number())  // ms timestamp
```

### Starting a Timer
**Conditions** (all required):
1. Task has a `projectId` (blocks: "Assign a project first")
2. Task is not archived
3. Member: only on assigned tasks (`assigneeIds` contains userId)

**Auto-stop**: If a timer is already running on a different task:
1. Previous timer evaluated:
   - If < 30 seconds → discarded silently
   - If < 8 hours → "Commit time" popover for previous task
   - If ≥ 8 hours → "Stale timer recovery" dialog for previous task
2. After previous is resolved → new timer starts
3. Toast: "Timer switched from [previous task]"

### Stopping a Timer

1. Elapsed = `Date.now() - timerStartedAt`
2. **If < 30 seconds**: Toast "Timer was under 30 seconds" + "Save as 1 min" action button. Timer cleared.
3. **If < 8 hours**: "Commit time" popover (pre-filled duration, editable, note field)
4. **If ≥ 8 hours**: "Stale timer recovery" dialog (empty duration, user must enter real time)

### Rounding
- Org setting: 1 / 5 / 6 / 15 minutes
- Always ceil (round up)
- `Math.ceil(rawMinutes / roundingMinutes) * roundingMinutes`
- Applied to both timer and manual entries

### Rate Snapshot
On entry creation, the applicable rate is stored:

| Project type | Fields stored | Source |
|-------------|--------------|--------|
| T&M flat | `appliedRate` | `project.hourlyRate` |
| T&M per-category | `appliedRate` | `project.tmCategoryRates[task.workCategoryId]` |
| Fixed | `appliedCostRate` + `appliedBillRate` | `projectCategoryEstimates[task.workCategoryId]` |
| Retainer | `appliedCostRate` + `appliedBillRate` | Phase 4 retainer rates |

**Blocks** (no entry created):
- T&M per-category + no task category → "Set a category on this task first"
- Category not in project rate list → "Set a rate for [category] on the project first"

---

## Time Entry Schema

```typescript
timeEntries: defineTable({
  orgId: v.string(),
  taskId: v.id("tasks"),
  userId: v.id("users"),
  date: v.string(),                         // YYYY-MM-DD (org timezone)
  durationMinutes: v.number(),              // integer > 0, rounded
  note: v.optional(v.string()),
  isBillable: v.boolean(),                  // defaults from task.billable
  method: v.union(v.literal("timer"), v.literal("manual")),
  invoicedInReportId: v.optional(v.id("reports")),
  appliedRate: v.optional(v.number()),
  appliedCostRate: v.optional(v.number()),
  appliedBillRate: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_taskId", ["taskId"])
  .index("by_userId_date", ["userId", "date"])
```

---

## Time Entry CRUD

### Create (Manual)
- **Where**: Inline popover (task row) or Task detail modal
- **Fields**: duration (parsed), note (optional), isBillable (default from task), date (default: today)
- **Validation**: duration > 0 after rounding, task has projectId, task not archived, rate exists
- **Rate snapshot**: applied at creation time

### Edit
- **Where**: Task detail modal > Time tab > entry row > ⋮ menu > Edit
- **Editable**: duration, note, date, isBillable
- **Rate snapshot**: does NOT update on edit (stays from creation time)
- **Invoiced entry**: read-only, not editable (lock icon + "This entry is invoiced")
- **Permissions**: Member = own entries only. Admin = any.

### Delete
- Confirmation: "Delete this time entry? This cannot be undone."
- Invoiced → not deletable
- Member → own entries only
- Admin → any

---

## Queries & Mutations

```
// Timer
timer.start(taskId)       — start timer (auto-stop if another running)
timer.stop()              — stop timer → open commit flow (client handles UI)
timer.discard()           — discard timer (no entry)
timer.getState()          — reactive: user's current timer (taskId, startedAt, task details)

// Time entries
timeEntries.create        — manual entry (parse + round + rate snapshot + billable)
timeEntries.update        — edit (admin: any, member: own, invoiced: no)
timeEntries.remove        — delete (admin: any, member: own, invoiced: no)
timeEntries.listByTask    — all entries for a task (date desc)
timeEntries.listToday     — current user's entries for today (for widget)
timeEntries.sumByTask     — total minutes for a task (for time cell display)

// Aggregations (for other modules)
timeEntries.sumByProject     — project totals
timeEntries.sumByCategory    — per-category breakdown
timeEntries.getUninvoiced    — uninvoiced entries for a project
```

---

## Duration Parser

```typescript
// Client-side: lib/duration.ts
export function parseDuration(input: string): number | null {
  // "30m" → 30
  // "2h" → 120
  // "1h 30m" or "1h30m" → 90
  // "1:30" → 90
  // "1.5" → 90 (hours)
  // "90" → 90 (minutes)
  // Returns minutes or null if not parseable
}

export function formatDuration(minutes: number): string {
  // 90 → "1h 30m"
  // 30 → "30m"
  // 120 → "2h"
  // 0 → "0m"
}
```

---

## Timer States (Pause/Resume)

The timer supports 3 states: **running**, **paused**, **stopped** (committed/discarded).

### Server state (users table)
```typescript
timerTaskId: v.optional(v.id("tasks"))
timerStartedAt: v.optional(v.number())       // last resume timestamp
timerAccumulatedMs: v.optional(v.number())    // accumulated time from previous segments
timerStatus: v.optional(v.union(v.literal("running"), v.literal("paused")))
```

### Pause behavior
- **Pause**: saves `accumulated += (now - startedAt)`, clears `startedAt`, sets status `"paused"`
- **Resume**: sets `startedAt = now`, sets status `"running"` (accumulated preserved)
- **Display**: `accumulated + (now - startedAt)` when running, just `accumulated` when paused
- **Commit**: uses total accumulated time for the entry

### Floating Widget — 3 states (morphs in-place)

**Running** → timer in red (`#DC2626`), ‖ Pause pill, Commit time + Discard buttons, collapsible Today
**Paused** → timer in grey (`#D6D3D1`), ▶ Resume pill, Commit time + Discard buttons, collapsible Today
**Committing** → timer grey, icon-row duration (editable with cursor) + icon-row note, Billable toggle, Save + Discard stacked buttons. Today section hidden.

Widget **morphs in-place** between states — no popover-on-popover. "Commit time" → widget content transitions to the commit form. "Save" → widget disappears + toast.

---

## Visual Design Direction

### Color & State
- **Running timer**: red `#DC2626` — alive, counting
- **Paused timer**: grey `#D6D3D1` — frozen, inactive
- **Stopped/Committing timer**: grey `#D6D3D1` — same as paused, no extra indicators
- No dots, no accent bars, no "stopped" labels — timer color is the only state indicator
- Success state (entry saved): toast notification

### Typography
- Timer display: JetBrains Mono 400, 26px (widget), red/grey based on state
- Duration values: JetBrains Mono for all time numbers across the app
- UI text: Inter for everything else

### Button Pattern (consistent across ALL screens)
- **Primary action**: full-width, black (`#1C1917`) background, white text
- **Secondary action**: full-width, outlined (`1px #E8E5E3` border), grey text
- **Stacked**: primary on top, secondary below, 6px gap
- **Billable toggle**: icon-row style above the buttons, not inside the button area
- This pattern is identical on: Popover, Widget Running, Widget Paused, Widget Committing, Stale Timer

### Animations
- Widget entrance: slide-up from bottom (300ms ease-out)
- Widget morph: smooth content transition between states
- Entry saved: brief toast
- Timer start: smooth transition from play → pause icon

### Mobile Considerations
- Floating widget: bottom-left, narrower, collapsible to just the timer counter
- Time cell: tap to open popover (no hover state)
- Commit form: full-width sheet from bottom

---

## Implementation Order

1. **Schema**: Add `isBillable` to timeEntries, add `timerAccumulatedMs` + `timerStatus` to users, deploy
2. **Backend**: Timer mutations (start, stop, pause, resume, discard, getState)
3. **Backend**: Time entry CRUD (create, update, remove, list queries)
4. **Backend**: Duration parser + rounding utility
5. **UI**: Combined time cell in task row (display + play/stop)
6. **UI**: Inline log popover (combined input + user selector + time entries)
7. **UI**: Floating timer widget (running state + Today breakdown)
8. **UI**: Widget pause/resume state
9. **UI**: Widget committing state (morph from running/paused)
10. **UI**: Stale timer recovery dialog (8h+ check on app load)
11. **Wire**: Rate snapshot logic in entry creation
12. **Wire**: Billable inheritance (task → entry)
13. **Polish**: Animations, mobile responsive, edge cases

---

## Deferred to v2

- Quick-switch / recent timers history
- Weekly timesheet view (/my-time Harvest-style grid)
- "Who's working now" dashboard
- Idle detection
- Nudges / reminders (build into "Today" page)
- Time entry tags/labels
- Global shortcut (Cmd+T) for logging from anywhere
- Browser tab title with running timer

---

## Acceptance Criteria

- [ ] Timer starts from task row play button or inline log popover
- [ ] Running timer shows live HH:MM:SS in red in floating widget
- [ ] Pause: timer freezes (grey), accumulated time preserved
- [ ] Resume: timer continues from accumulated time
- [ ] Commit time: widget morphs to commit form (duration + note + billable)
- [ ] Duration editable in commit form (pre-filled with rounded time, cursor visible)
- [ ] Save: entry created, widget disappears, toast shown
- [ ] Discard: timer cleared, no entry, widget disappears
- [ ] Auto-stop: starting new timer → commit flow for previous task
- [ ] Under 30s: toast + "Save as 1 min" action
- [ ] Stale timer (≥ 8h): blocking recovery dialog, empty duration, user must enter
- [ ] Manual log: inline popover from task row time cell click
- [ ] Combined input: type = manual entry, play button = start timer
- [ ] Input states: default "Enter time", focused "0h 00m" ghost with cursor
- [ ] User selector: admin can log for others, member fixed
- [ ] Quick buttons (15m/30m/1h/2h/4h/8h) fill duration field
- [ ] Time entries section: collapsible, shows task's entries with ⋮ menu (edit/delete)
- [ ] Duration parser handles: 1h30m, 1:30, 1.5, 90
- [ ] Rounding: org setting (1/5/6/15m), always ceil
- [ ] Date: defaults to today in org timezone
- [ ] Rate snapshot: correct rate stored on entry
- [ ] No rate: blocks entry with helpful error
- [ ] Billable: inherits from task, override per entry, toggle as icon-row
- [ ] Billable toggle: visible only if task is billable
- [ ] Today section: collapsible in widget, shows daily entries + total
- [ ] Invoiced entries: read-only, lock icon, not editable/deletable
- [ ] Member: only manages own entries, timer only on assigned tasks
- [ ] Admin: manages all entries, can log for others
- [ ] Server-side timer: survives browser close (pause state too)
- [ ] Concurrent tabs: Convex reactive sync
- [ ] All buttons: full-width stacked pattern (primary top, secondary below)

---

## Paper Design References

**Source of truth**: `Phase 7 — Final Screens v2` artboard in "Agency flow dev" Paper file, Page 1.

| # | Screen | What it shows |
|---|--------|---------------|
| 1 | **Inline Log Popover** | User selector + combined input (cursor + `0h 00m` ghost) + quick buttons + icon-rows (date, note) + billable + Save + collapsible time entries with ⋮ menu |
| 2 | **Widget: Running** | Red timer 26px JetBrains Mono + task context + ‖ Pause pill + Commit time (primary) + Discard (secondary) + collapsible Today with entries |
| 3 | **Widget: Paused** | Grey timer + task context + ▶ Resume pill + Commit time + Discard + collapsible Today |
| 4 | **Widget: Committing** | Grey timer + task context + icon-row editable duration (cursor) + icon-row note + billable icon-row + Save + Discard |
| 5 | **Stale Timer (8h+)** | Red warning bar + task context + icon-row empty duration (cursor + `0h 00m` ghost) + icon-row note + Save + Discard |

### Exploration artboards (for context, not final)
- `Time Cell — States` — task row time column states
- `Log Popover — Final` — iteration history of the inline popover
- `Floating Widget — Redesign` — widget iteration history
- `Widget — Running vs Paused` — state comparison explorations
- `Timer Typography — Options` — font comparison (JetBrains Mono chosen)
- `Log Popover — 3 Variations` — ClickUp/Notion/Linear style explorations
