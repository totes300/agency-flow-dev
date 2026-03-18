# Phase 7: Time Tracking — Implementation Plan

## Context

Time tracking is Agency Flow's revenue engine. Every billable minute tracked flows into reports and invoices. This plan prioritizes **correctness** — pure utility functions tested first, backend mutations tested second, UI wired last. The architecture isolates all business-critical math into pure, independently testable functions.

**Spec sources**: `docs/phase-7-time-tracking.md` (backend), `docs/time-tracking-prd.md` (UI/UX)

---

## Sub-Phase 7.0: Test Infrastructure + Pure Utilities

All time math lives in pure functions. These are tested exhaustively before touching Convex or React.

### 7.0.1 — Set up Vitest
- **Add**: `vitest`, `@vitest/coverage-v8` to devDependencies
- **Create**: `vitest.config.ts` with `@/` path alias
- **Add scripts**: `"test": "vitest run"`, `"test:watch": "vitest"`
- **Verify**: `npm run test` runs (reports "no tests found")

### 7.0.2 — Duration parser (`lib/duration.ts` + `lib/duration.test.ts`)
```
parseDuration(input: string): number | null
formatDuration(minutes: number): string       // "1h 30m"
formatTimerDisplay(ms: number): string         // "01:23:45"
```
**Tests** (minimum 20 cases):
- 6 PRD formats: `"30m"→30`, `"2h"→120`, `"1h 30m"→90`, `"1:30"→90`, `"1.5"→90`, `"90"→90`
- Edge: `"0"→null`, `"0.5"→30`, `"0:01"→1`, whitespace handling, invalid input→null
- `formatDuration`: `0→"0m"`, `30→"30m"`, `60→"1h"`, `90→"1h 30m"`, `480→"8h"`
- `formatTimerDisplay`: `0→"00:00:00"`, `3661000→"01:01:01"`

### 7.0.3 — Rounding (`convex/lib/rounding.ts` + `convex/lib/rounding.test.ts`)
```
roundMinutes(raw: number, roundingMinutes: number): number
```
- `Math.ceil(raw / rounding) * rounding` (rounding<=1: just ceil)
- **Tests**: all 4 rounding options (1/5/6/15) at boundaries. `0→0` (no phantom time).

### 7.0.4 — Timer helpers (`convex/lib/timer.ts` + `convex/lib/timer.test.ts`)
```
computeElapsedMs(startedAt, now): number
totalElapsedMs(startedAt, now, accumulatedMs): number
msToMinutes(ms): number
getDateInTimezone(timestampMs, timezone): string  // "YYYY-MM-DD"
```
- **Tests**: basic math, negative→0, accumulated across segments, timezone date computation (midnight crossing, DST)

### 7.0.5 — Rate resolver (`convex/lib/rates.ts` + `convex/lib/rates.test.ts`)
```typescript
type RateSnapshot = { appliedRate?: number; appliedCostRate?: number; appliedBillRate?: number }
resolveRate(ctx: RateContext): RateSnapshot | { error: string }
```
**Tests**:
- T&M flat → `{ appliedRate: project.hourlyRate }`
- T&M per-category + matching category → `{ appliedRate: rate }`
- T&M per-category + no task category → error
- T&M per-category + category not in list → error
- Fixed + estimate → `{ appliedCostRate, appliedBillRate }`
- Retainer → `{ appliedCostRate, appliedBillRate }` from overageRate

---

## Sub-Phase 7.1: Schema + Backend

### 7.1.1 — Schema changes (`convex/schema.ts`)

**Add to `users` table:**
```typescript
timerTaskId: v.optional(v.id("tasks")),
timerStartedAt: v.optional(v.number()),
timerAccumulatedMs: v.optional(v.number()),
timerStatus: v.optional(v.union(v.literal("running"), v.literal("paused"))),
```

**Add new table:**
```typescript
timeEntries: defineTable({
  orgId: v.string(),
  taskId: v.id("tasks"),
  userId: v.id("users"),
  date: v.string(),                         // YYYY-MM-DD (org timezone)
  durationMinutes: v.number(),
  note: v.optional(v.string()),
  isBillable: v.boolean(),
  method: v.union(v.literal("timer"), v.literal("manual")),
  // invoicedInReportId deferred to Reports phase (no reports table yet)
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
  .index("by_orgId_date", ["orgId", "date"])
```

**Add validators** (`convex/lib/validators.ts`):
- `timeEntryMethodValidator`

### 7.1.2 — Timer mutations (`convex/timer.ts`)

| Function | Type | Purpose |
|---|---|---|
| `start(taskId)` | mutation | Validate task, set timer fields (NO auto-stop — see below) |
| `stop()` | mutation | Compute elapsed, clear timer, return data for client commit |
| `pause()` | mutation | Accumulate current segment, set status="paused" |
| `resume()` | mutation | Set startedAt=now, status="running" |
| `discard()` | mutation | Clear all timer fields |
| `commitEntry(...)` | mutation | Create time entry from committed timer data |
| `getState()` | query | Reactive: timer fields + task name + project/client |

**Client orchestrates auto-stop** (not the mutation):
The PRD says switching tasks shows a "Commit time" popover for the previous task. A mutation can't show UI. So the **client** handles this:
1. User clicks play on Task B
2. Client detects timer running on Task A (via context)
3. Client calls `stop()` → gets previous timer data
4. Client shows commit popover for Task A
5. User commits/discards → client calls `commitEntry()` or does nothing
6. Client calls `start(taskB)` → clean start

`start()` is simple: validate task + set fields. It **requires no active timer** (client must stop first). If called with an active timer, it throws — this is a programming error, not a user flow.

**`stop()` returns data to client** (clears timer, doesn't create entry):
```typescript
{ taskId, elapsedMs, roundedMinutes, taskName, projectName, clientName, isBillable, isStale, rateSnapshot }
```

**`commitEntry` mutation**: Called by client after user fills commit form. Creates the actual time entry with rate snapshot. Validates that data is fresh.

### 7.1.3 — Time entry CRUD (`convex/timeEntries.ts`)

| Function | Type | Purpose |
|---|---|---|
| `create` | mutation | Manual entry: validate, round, rate snapshot, billable default |
| `update` | mutation | Edit: admin=any, member=own, invoiced=blocked |
| `remove` | mutation | Delete: same permissions as update |
| `listByTask` | query | All entries for a task (date desc), enriched with user |
| `listToday` | query | Current user's today entries (org timezone) |
| `sumByTasks` | query | **Batch**: total minutes for multiple tasks (avoids N+1) |
| `sumByProject` | query | Project totals (for retainer/fixed views) |

**N+1 prevention**: `sumByTasks(taskIds[])` returns `Record<taskId, minutes>`. Called once from the task list page with all visible task IDs, not per-row.

**Admin can `create` on behalf**: accepts optional `userId` param (admin only).

### 7.1.4 — Resolve Phase 7 TODOs in existing code

**`convex/tasks.ts`:**
- `archive` → stop timers on this task (query users with timerTaskId)
- `remove` → block if time entries exist ("Archive instead")
- `update` projectId change → warn if time entries exist

**`convex/projects.ts`:**
- `archive` → stop timers on project's tasks
- `getRetainerData` → replace `workedMinutes = 0` with real sumByProject
- `remove` → block if any task has time entries

---

## Sub-Phase 7.2: Frontend — Timer Core

### 7.2.1 — Timer provider (`components/timer-provider.tsx`)
React context wrapping dashboard layout. Single Convex subscription to `timer.getState()`. Provides timer state + mutation wrappers to all children. Live elapsed computed via `setInterval(1000)`.

**Modify**: `app/(dashboard)/layout.tsx` — wrap with `<TimerProvider>` inside `<OnboardingGate>`

### 7.2.2 — Timer hook (`lib/hooks/use-timer.ts`)
Consumes `TimerContext`. Returns:
```typescript
{ timerState, elapsedMs, formattedTime, startTimer, stopTimer, pauseTimer, resumeTimer, discardTimer, isRunningOn(taskId) }
```

### 7.2.3 — Time cell (`components/tasks/inline-time-cell.tsx`)
Replaces mock at `task-row.tsx:107-112`. Shows total time (from batch `sumByTasks` passed as prop) + play/stop button. Uses timer context to detect if this task has active timer. Click opens time log popover (7.4.2).

**Modify**: `components/tasks/task-row.tsx` — replace lines 107-112 with `<InlineTimeCell>`
**Modify**: `app/(dashboard)/tasks/page.tsx` — call `sumByTasks` query once, pass map to `TasksTable`

---

## Sub-Phase 7.3: Frontend — Floating Widget

### 7.3.1 — Widget shell (`components/timer/floating-timer-widget.tsx`)
Fixed bottom-right, z-50. Only visible when timer exists (running or paused). Morphs between 3 states:
- **Running**: red timer, task context, pause + commit + discard
- **Paused**: grey timer, resume + commit + discard
- **Committing**: duration input + note + billable + save/discard

Sub-components in `components/timer/`:
- `timer-display.tsx` — JetBrains Mono counter (shared between states)
- `timer-commit-form.tsx` — post-stop inline form
- `timer-today-section.tsx` — collapsible today entries

**Modify**: `app/(dashboard)/layout.tsx` — add `<FloatingTimerWidget />` as sibling to `<Toaster />`

### 7.3.2 — Stale timer dialog (`components/timer/stale-timer-dialog.tsx`)
Blocking modal when timer >= 8h. Empty duration (user must enter). Triggered on app load check in `TimerProvider`.

---

## Sub-Phase 7.4: Frontend — Manual Entry + Popover

### 7.4.1 — Duration input (`components/time/duration-input.tsx`)
Controlled input using `parseDuration`. Shows parsed preview. Quick buttons (15m/30m/1h/2h/4h/8h).

### 7.4.2 — Time log popover (`components/tasks/time-log-popover.tsx`)
Triggered from time cell click. Contains:
- User selector (admin: dropdown, member: fixed)
- Duration input + play button (combined input)
- Quick buttons
- Date picker (default: today)
- Note field
- Billable toggle (only if task.billable)
- Save button
- Collapsible time entries list

### 7.4.3 — Time entries list (`components/time/time-entries-list.tsx`)
Reusable list of entries with user avatar, date, note, duration, billable dot, action menu (edit/delete). Invoiced entries show lock icon.

---

## Sub-Phase 7.5: My Time Page + Integration

### 7.5.1 — My Time page (`app/(dashboard)/my-time/page.tsx`)
Replace placeholder. Shows today's entries + active timer + daily total.
- `components/my-time/today-summary.tsx`
- `components/my-time/today-entries.tsx`
- `app/(dashboard)/my-time/loading.tsx` (content-aware skeleton)

### 7.5.2 — Retainer integration
Modify `convex/projects.ts` `getRetainerData` — replace `workedMinutes = 0` with real `timeEntries.sumByProject` query.

### 7.5.3 — Format helpers
`formatDuration()` and `formatTimerDisplay()` live in `lib/duration.ts` (created in 7.0.2). `lib/format.ts` re-exports them for discoverability. No duplication.

---

## Sub-Phase 7.6: Polish + Verification

### 7.6.1 — Loading skeletons
- `app/(dashboard)/my-time/loading.tsx` — content-aware

### 7.6.2 — Backlog update (`docs/backlog.md`)
Phase 7 section with checkboxes + deferred items (weekly timesheet, idle detection, etc.)

### 7.6.3 — Final verification
- `npm run test` — all pure function tests pass
- `npx tsc --noEmit` — 0 errors
- `npm run lint` — clean
- Manual E2E: start timer → pause → resume → stop → commit → entry appears with correct rounded duration

---

## Dependency Graph

```
7.0.1 (vitest)
  ├─ 7.0.2 (duration parser + tests)
  ├─ 7.0.3 (rounding + tests)
  ├─ 7.0.4 (timer helpers + tests)
  └─ 7.0.5 (rate resolver + tests)
        │
        v
7.1.1 (schema) ──► 7.1.2 (timer mutations) ──► 7.1.3 (entry CRUD) ──► 7.1.4 (TODO cleanup)
                                                        │
                    ┌───────────────────────────────────┤
                    v                                   v
            7.2.1 (provider)                    7.4.1 (duration input)
            7.2.2 (hook)                        7.4.2 (log popover)
            7.2.3 (time cell)                   7.4.3 (entries list)
                    │
                    v
            7.3.1 (widget)
            7.3.2 (stale dialog)
                    │
                    v
            7.5.1 (my-time page)
            7.5.2 (retainer wiring)
            7.5.3 (format helpers)
                    │
                    v
            7.6 (polish + verify)
```

---

## Key Files

| File | Action | Purpose |
|------|--------|---------|
| `convex/schema.ts` | Modify | Add timeEntries table + timer fields on users |
| `convex/timer.ts` | Create | Timer start/stop/pause/resume/discard + getState |
| `convex/timeEntries.ts` | Create | Time entry CRUD + aggregation queries |
| `convex/lib/rounding.ts` | Create | Pure rounding function |
| `convex/lib/timer.ts` | Create | Pure timer math helpers |
| `convex/lib/rates.ts` | Create | Pure rate snapshot resolver |
| `lib/duration.ts` | Create | Duration parser + formatters |
| `lib/hooks/use-timer.ts` | Create | Timer React hook |
| `components/timer-provider.tsx` | Create | Timer state context |
| `components/tasks/inline-time-cell.tsx` | Create | Time column in task row |
| `components/timer/floating-timer-widget.tsx` | Create | Floating widget (3 states) |
| `components/timer/stale-timer-dialog.tsx` | Create | 8h+ recovery dialog |
| `components/tasks/time-log-popover.tsx` | Create | Manual log popover from time cell |
| `components/time/duration-input.tsx` | Create | Reusable duration input |
| `components/time/time-entries-list.tsx` | Create | Entry list with actions |
| `components/tasks/task-row.tsx` | Modify | Replace mock time cell (lines 107-112) |
| `app/(dashboard)/layout.tsx` | Modify | Add TimerProvider + FloatingTimerWidget |
| `app/(dashboard)/my-time/page.tsx` | Modify | Replace placeholder |
| `convex/tasks.ts` | Modify | Timer stop on archive, block delete with entries |
| `convex/projects.ts` | Modify | Real retainer data, block delete with entries |
| `lib/format.ts` | Modify | Re-export formatDuration, formatTimerDisplay from duration.ts |
| `app/(dashboard)/tasks/page.tsx` | Modify | Call batch sumByTasks query, pass to table |

---

## Testing Strategy

**Philosophy**: All money-affecting math is in pure functions. Test those exhaustively with Vitest. Convex mutations are thin wrappers that call pure functions + do DB I/O — test those via manual E2E (Convex doesn't have a mature test harness yet; `convex-test` may not be compatible with 1.33.1).

| Layer | What | Tool | Count |
|-------|------|------|-------|
| Pure math | Duration parse/format, rounding, elapsed, rates | Vitest | ~60 cases |
| Formatters | formatDuration, formatTimerDisplay | Vitest (in duration.test.ts) | ~15 cases |
| Backend | Timer flow, entry CRUD, permissions | Manual E2E via dev server | ~10 scenarios |

**Business-critical tests** (money-affecting, all in Vitest):
1. Rounding at every boundary for all 4 options (1/5/6/15)
2. Rate snapshot correct for each billing type (T&M flat, T&M per-category, Fixed, Retainer)
3. T&M per-category without category → blocked with clear error
4. Elapsed time correct across pause/resume segments
5. Date computed in org timezone, not UTC (tested via `getDateInTimezone`)

**Manual E2E verification** (after backend is deployed):
1. Start timer → pause → resume → stop → commit → entry has correct rounded duration
2. Member can't start timer on unassigned task
3. Invoiced entries can't be edited/deleted
4. Rate snapshot matches project's billing type
5. Auto-stop flow: play task B while A is running → commit popover for A → entry created → B starts
