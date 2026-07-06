# 04 — Triage everywhere: /tasks rows, bulk action, Plan section self-service

**Type**: AFK
**Blocked by**: 02
**Unblocks**: —

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Implementation Decisions (UI surfaces for the sun gesture, Plan section), § User Stories 11–13, 22, 39–41

## What to build

The sun gesture escapes My Tasks: **triage from the org-wide task table (row + bulk) and full self-service in the task detail's Plan section** — same shared button, same mutations, no new write paths.

### Schema

- None.

### Backend (Convex)

- Small membership query for the `/tasks` surface: given the caller, return the set of taskIds with a covering segment today (`mySegmentsToday` style, index-backed) — so every row can render the correct sun state without N queries.
- Bulk path: `addToToday` accepted per task; either a `bulkAddToToday(taskIds)` mutation or client-side fan-out with per-task idempotency (implementer's call; bulk mutation preferred to match the existing `bulkUpdate` pattern).
- `taskSegments` (Plan section query): no change expected — verify it returns enough for self-service gating (segment `userId` vs caller).

### Frontend

- **`/tasks` rows** (`TaskRow`): `AddToTodayButton` in the hover-action cluster (same `opacity-0 group-hover` pattern as the selection checkbox; always-visible muted on touch). Filled state for tasks already in my Today.
- **Bulk toolbar** (`BulkToolbar`): quiet "Add to Today" action (sun icon + text, ghost style, consistent with existing actions); applies to the selection, idempotent per task; result toast with count ("3 added to today").
- **Plan section** (`TaskPlanSection` in drawer + modal):
  - Highlight segment rows covering today (subtle tint, per prototype's today-chip).
  - Unschedule (×) enabled for **my own** segments as a member (was admin-only UI gating; server already allows since 02); other users' segments stay read-only for members; admin unchanged.
  - "Add to Today" affordance (dashed quiet button, per prototype) when I have no covering segment and the task isn't archived.
- All new UI through the shared `AddToTodayButton` / existing metadata-row patterns — no bespoke one-off controls.

### Tests

- Membership-set helper test (taskIds covering today, dedupe).
- Bulk mutation test: mixed selection (some already in Today, one archived) → idempotent adds, archived rejected, others succeed; response supports an honest toast.

## Acceptance criteria

- [ ] On `/tasks`, hovering any row shows the sun; clicking adds to my Today (state flips to filled); the task appears in My Tasks → Today and my Planner row.
- [ ] Selecting 5 tasks → bulk "Add to Today" plans all 5; re-running it creates no duplicates; toast reports the real count.
- [ ] In the task drawer, a member can delete their own segment and add-to-today; another user's segment shows no × for members; admins retain full control.
- [ ] The Plan section visually distinguishes the segment(s) covering today.
- [ ] The sun state on `/tasks` is correct on first paint (no flicker of wrong state) and updates live when a segment changes elsewhere.
- [ ] Tests green; `npx tsc --noEmit` 0 errors.

## User stories addressed

11–13, 22, 39–41
