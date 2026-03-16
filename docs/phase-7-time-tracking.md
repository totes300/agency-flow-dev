# Phase 7 — Time Tracking

> **Goal**: Server-side timer + manual entry + floating widget + time entry CRUD + rate snapshot.
> **Depends on**: Phase 5 (Tasks Core) — we log time on tasks
> **This is the billing foundation — if there's no tracked time, there's nothing to invoice.**

---

## Decisions

| Question | Decision |
|----------|----------|
| Timer type? | Server-side (users table: timerTaskId + timerStartedAt). Survives browser close. |
| Rounding? | Org setting: 1m / 5m / 6m / 15m. Always ceil (round up). 7m @ 15m = 15m. |
| Midnight crossing? | Entry date = stop date in org timezone (not UTC, not start date) |
| < 30 seconds? | Doesn't auto-save. Toast: "Save as 1m" action button. |
| Auto-stop? | Starting on another task → previous stops + entry created + toast |
| Max timer? | 16 hours (960 minutes) — cap |
| Rate snapshot? | ✅ Rate stored on entry at creation (appliedRate, appliedCostRate, appliedBillRate) |
| Rate fallback? | None — if no rate, blocks entry ("Set a rate first") |
| Time entry location? | Task detail modal > Time tab |
| Invoiced entry? | Read-only, not editable, not deletable (invoicedInReportId set) |
| Member permissions? | Timer only on assigned tasks, only manage own entries |
| Time edit audit? | Activity log in v1 ("AT changed 2:00 → 8:00"), admin approval in v2 |
| Concurrent tabs? | Server-side auto-stop handles it, Convex reactive query syncs |
| Recent timers? | ❌ V2 |
| Weekly timesheet? | ❌ V2 (/my-time Harvest-style grid) |
| Who's working now? | ❌ V2 |
| Idle detection? | ❌ V2 |

---

## Schema

```typescript
timeEntries: defineTable({
  orgId: v.string(),
  taskId: v.id("tasks"),
  userId: v.id("users"),
  date: v.string(),                         // YYYY-MM-DD (org timezone!)
  durationMinutes: v.number(),              // integer > 0, rounded
  note: v.optional(v.string()),
  method: v.union(v.literal("timer"), v.literal("manual")),
  invoicedInReportId: v.optional(v.id("reports")),  // billing stamp (Phase 2)
  appliedRate: v.optional(v.number()),       // T&M rate snapshot
  appliedCostRate: v.optional(v.number()),   // Fixed/Retainer cost rate snapshot
  appliedBillRate: v.optional(v.number()),   // Fixed/Retainer bill rate snapshot
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_taskId", ["taskId"])
  .index("by_userId_date", ["userId", "date"])
```

**Timer state on the `users` table** (defined in Phase 0):
```typescript
timerTaskId: v.optional(v.id("tasks"))
timerStartedAt: v.optional(v.number())    // ms timestamp
```

---

## Server-side timer

### Why server-side?
Timer state lives on the server (Convex `users` table), not in the browser. The client computes running time from `Date.now() - timerStartedAt`. **Survives browser close** — always accurate.

### Starting a timer

**Conditions** (all required):
1. Task has a `projectId` (otherwise blocks: "Assign a project first")
2. Task is not invoiced (no unstamped billable entries check — this doesn't block the timer, but fully invoiced tasks shouldn't be worked on)
3. Member: only on assigned tasks (assigneeIds contains userId)
4. Task is not archived

**Auto-stop**: If a timer is already running on a **different** task → it automatically stops:
1. Time entry created for the previous task
2. Toast: "Timer stopped on [previous task name] — [duration] logged"
3. New timer starts

**Mutation**: `timer.start(taskId)` → sets `users.timerTaskId` + `users.timerStartedAt = Date.now()`

### Stopping a timer

1. Elapsed time = `Date.now() - timerStartedAt` (milliseconds)
2. **Rounding**: `Math.ceil(elapsedMs / 60000 / roundingMinutes) * roundingMinutes`
   - Uses the org's `roundingMinutes` setting (1, 5, 6, or 15 minutes)
   - Always **ceil** (round up) — 7m @ 15m rounding = 15m
3. **Max 16 hours** (960 minutes) — cap if exceeded
4. **Date**: The stop date in the **org timezone** (not UTC!)
   - Midnight crossing: if you start at 11:50 PM and stop at 12:30 AM → the new day
5. **Method**: "timer"
6. **Rate snapshot**: applied to the entry (see Rate snapshot section)
7. Timer state cleared: `users.timerTaskId = undefined`, `users.timerStartedAt = undefined`

**Mutation**: `timer.stop()` → creates timeEntry + clears timer state

### Under 30 seconds special case
If elapsed time < 30 seconds:
- **Does NOT auto-save**
- Toast: "Timer was under 30 seconds" + **"Save as 1m"** action button
- If user clicks the button → 1-minute entry saved
- If not clicked → nothing happens (timer state cleared)

### Timer discard
- User discards the running timer
- Timer state cleared, **no time entry created**
- **Mutation**: `timer.discard()` → clears timer state only

### Concurrent timer (two browser tabs)
- Server-side state is the source of truth
- Convex reactive query: `users.timerTaskId` and `timerStartedAt` sync in real time across all tabs
- If tab A starts a timer and tab B also starts one → the last one wins (auto-stop the previous)

---

## Manual entry

### Format parser
The user can enter time in any format:

| Input | Interpretation | Minutes |
|-------|---------------|---------|
| `30m` | 30 minutes | 30 |
| `2h` | 2 hours | 120 |
| `1h 30m` | 1.5 hours | 90 |
| `1:30` | 1.5 hours | 90 |
| `1.5` | 1.5 hours | 90 |
| `90` | 90 minutes | 90 |

**Rounding**: Same org rounding setting as the timer. Always ceil.

### Quick buttons
15m · 30m · 45m · 1h · 2h · 3h · 4h · 6h · 8h

- One click = **instant time entry** (no confirmation)
- Toast: "2h logged on [task name]"
- Method: "manual"

### Entry location
- **Task detail modal > Time tab**: Duration input + note + date picker + quick buttons + "Log time" button
- **Task list > Time column**: Hover-to-show quick-log (v2, not Phase 7)

### Validation
- `durationMinutes` > 0 (after rounding)
- Task has a `projectId` (otherwise blocks)
- Task is not archived
- **Rate check**: If no applicable rate → blocks, "Set a rate for this category on the project first"

---

## Rate snapshot logic

When creating a time entry (timer OR manual), the applicable rate is stored on the entry.

### Which rate?

**Depends on the task's project**:

| Project type | Rate field | Source |
|-------------|-----------|--------|
| T&M flat | `appliedRate` | `project.hourlyRate` |
| T&M per-category | `appliedRate` | `project.tmCategoryRates.find(task.workCategoryId)` |
| Fixed | `appliedCostRate` + `appliedBillRate` | `projectCategoryEstimates.find(task.workCategoryId)` |
| Retainer | `appliedCostRate` + `appliedBillRate` | (Phase 4 defines — null for now) |

### Fallback logic
1. If the task has a `workCategoryId` → look up the rate in the project config
2. If the task has no category AND T&M flat → `project.hourlyRate` (this is OK)
3. If the task has no category AND T&M per-category → **BLOCKS**: "Set a category on this task first"
4. If the category isn't in the project's rate list → **BLOCKS**: "Set a rate for [category] on the project first"
5. If Fixed and no estimate row for this category → `appliedCostRate` and `appliedBillRate` remain null (OK — Fixed never generates invoices)

### Why snapshot?
If the project's rate changes later, old entries keep the **old rate**. Invoices always calculate from the rate stored on the entry. Bulletproof — no retroactive rate change problems.

---

## Floating timer widget

### Appearance
- **Fixed position**: bottom-right (desktop), bottom-left (mobile)
- **Only visible when timer is running** — otherwise hidden
- Convex reactive query: `users.timerTaskId` → if set, show widget

### Content
```
┌─────────────────────────────────┐
│ 🔴 Homepage redesign            │
│    Acme / Brand Refresh         │
│    01:23:45              [Stop] │
└─────────────────────────────────┘
```

- **Task name**: clickable link → navigates to task detail modal
- **Project name**: client / project
- **Live HH:MM:SS counter**: `Date.now() - timerStartedAt`, `setInterval(1000)`
- **Stop button**: stops timer (with the logic described above)

### Interaction
- Always above content (z-index)
- Must not obscure critical UI elements
- Mobile: smaller, more compact layout

---

## Time entry CRUD

### Editing
- **Where**: Task detail modal > Time tab > entry row > ⋮ menu > Edit
- **What**: duration (same parser), note, date
- **Invoiced entry** (`invoicedInReportId` set): **read-only**, not editable, not deletable
  - UI: lock icon + tooltip "This entry is invoiced"
- **Member**: can only edit their own entries
- **Admin**: can edit anyone's entries
- **Rate snapshot**: does NOT update on edit (rate stays from creation time)

### Deletion
- Confirmation dialog: "Delete this time entry? This cannot be undone."
- Invoiced → not deletable
- Member → only their own

### Audit
- Activity log entry (Phase 2): "AT changed duration 2:00 → 8:00", "AT deleted entry 2:00"

---

## Queries / Mutations

```
// Timer
timer.start          — start timer (auto-stop if another is running)
timer.stop           — stop timer → create time entry
timer.discard        — discard timer (no entry)
timer.getState       — user's current timer state (reactive)

// Time entries
timeEntries.list     — all entries for a task (sorted by date desc)
timeEntries.create   — manual entry (duration parser + rate snapshot + rounding)
timeEntries.update   — edit (admin: any, member: own only)
timeEntries.remove   — delete (admin: any, member: own only, invoiced: no)

// Aggregations (for other modules)
timeEntries.sumByTask        — total logged time for a task
timeEntries.sumByProject     — project monthly breakdown (aggregated per task)
timeEntries.sumByCategory    — project per-category totals
timeEntries.getUninvoiced    — a project's uninvoiced entries
```

---

## Rounding utility

```typescript
// convex/lib/rounding.ts
export function roundMinutes(rawMinutes: number, roundingMinutes: number): number {
  if (roundingMinutes <= 1) return Math.ceil(rawMinutes);
  return Math.ceil(rawMinutes / roundingMinutes) * roundingMinutes;
}

// Examples (roundingMinutes = 15):
// 7 → 15, 15 → 15, 16 → 30, 1 → 15, 0.5 → 15
```

## Duration parser utility

```typescript
// convex/lib/duration.ts or components/lib/duration.ts (client-side)
export function parseDuration(input: string): number | null {
  // "30m" → 30
  // "2h" → 120
  // "1h 30m" → 90
  // "1:30" → 90
  // "1.5" → 90 (interpreted as hours)
  // "90" → 90 (interpreted as minutes)
  // Returns: number of minutes, or null if not parseable
}
```

---

## Acceptance criteria

- [ ] Timer starts: click play button on task list or detail modal
- [ ] Timer runs: HH:MM:SS counter in floating widget and task row
- [ ] Timer stops: rounded time entry saved, rate snapshot applied
- [ ] Auto-stop: starting on another task → previous stops + toast
- [ ] Under 30s: toast + "Save as 1m" button
- [ ] Discard: timer cleared, no entry
- [ ] Browser close + reopen: timer continues (server-side)
- [ ] Concurrent tabs: Convex reactive sync
- [ ] Manual entry: all formats parse (30m, 2h, 1:30, 1.5, 90)
- [ ] Quick buttons: 1 click = instant entry + toast
- [ ] Rounding: org setting (1/5/6/15m), always ceil
- [ ] Midnight crossing: stop date in org timezone
- [ ] Rate snapshot: correct rate on entry (fallback logic)
- [ ] No rate: blocks time entry ("Set a rate first")
- [ ] Floating widget: appears when running, disappears when not
- [ ] Time entry editing: duration, note, date
- [ ] Invoiced entry: read-only, not editable/deletable
- [ ] Member: only manages their own entries
