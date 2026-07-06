# 02 — Sun gestures: add/remove + admin-or-self permissions

**Type**: AFK
**Blocked by**: 01
**Unblocks**: 03, 04, 06

## Parent PRD

[`docs/today-planner-prd.md`](../today-planner-prd.md) — § Implementation Decisions (idempotent wrapper mutations, trim/split semantics, permission widening, sun icon visibility), § Module Design (Today mutations, `AddToTodayButton`)

## What to build

The write path of the day plan: **one click on a sun icon adds a task to my Today (a one-day segment) or removes it (trim/split surgery on the covering segments)** — member-callable, idempotent, explained by toasts. Includes the server-side permission model everything later builds on.

### Schema

- No changes (index landed in 01).

### Backend (Convex)

- `convex/lib/todayPlan.ts` additions (pure, tested):
  - `planRemovalOps(coveringSegments, todayStr)` → list of ops: single-day → `{delete}`; spans past & future → `{patch end = yesterday}` + `{insert start = tomorrow…}` (split); starts today → `{patch start = tomorrow}`; ends today → `{patch end = yesterday}`.
- New mutations (new file `convex/todayPlan.ts` or extend `convex/planner.ts` — implementer's call, one place):
  - `addToToday(taskId)`: self-scoped (`userId` = caller), idempotent (no-op if a covering segment exists), rejects archived tasks and cross-org ids (mirror `createSegment` checks). Creates a one-day segment for today (org timezone).
  - `removeFromToday(taskId)`: applies `planRemovalOps` to **all** of the caller's covering segments, transactionally.
- Permission widening on the generic segment mutations (`createSegment`, `updateSegment`, `removeSegment`): replace `requireAdmin` with an **admin-or-self** guard (new helper alongside the existing auth helpers): members may create segments only with their own `userId`, may update/remove only segments where `segment.userId === self`, and may not reassign a segment to another user. Admins unchanged. Server-enforced regardless of UI.
- No activity-log writes from any segment mutation (status quo — verify none sneak in).

### Frontend

- New shared component `components/add-to-today-button.tsx` (domain UI = shared component from first use): sun icon ghost button. States: default (outline, hover-revealed on desktop, always-visible muted on touch — the existing `opacity-0 group-hover` pattern gets a touch-visible variant), active (filled, amber, persistent), pending. Fires the wrapper mutations with `.catch(toastError)`.
- Wire into `MyTaskRow`: outline sun on status-group rows (add), filled sun on Today rows (remove).
- Toasts teach the model in plan terms: add → "Added to today — visible in your Planner row"; remove single-day → deletion; remove multi-day → "The bar split — today removed, other days stay planned" (copy per prototype).
- Errors surface via the standard error toast; no optimistic membership flip in v1 (Convex round-trip is fast; revisit only if it feels laggy).

### Tests

- `todayPlan` tests: every `planRemovalOps` branch (single-day, split, trim-start, trim-end, multiple covering segments at once).
- Mutation tests (repo's Convex test pattern): permission matrix — member on own segment (allowed), member on another's segment / creating for another user / reassigning (rejected), admin on anyone (allowed); `addToToday` idempotency; archived-task rejection.

## Acceptance criteria

- [ ] As a **member**, hovering a Next up row shows the sun; one click puts the task in Today and a one-day bar appears in my Planner row.
- [ ] Clicking the sun again on an already-planned task creates no duplicate segment.
- [ ] Removing a task covered by a Mon–Fri segment on Wednesday leaves Mon–Tue and Thu–Fri bars in the Planner; the toast explains the split.
- [ ] Removing a task whose segment starts today shifts the bar to start tomorrow; ends-today shrinks to yesterday; single-day deletes.
- [ ] A member attempting to modify another user's segment (e.g. crafted call) gets a server error; admin flows unchanged.
- [ ] Adding an archived task to Today fails with a clear error toast.
- [ ] On a touch viewport the sun is always visible in muted form; desktop keeps hover-reveal.
- [ ] No `status_changed` or other activity events from any plan action (check a task's activity panel).
- [ ] Tests green; `npx tsc --noEmit` 0 errors.

## User stories addressed

10, 14–16, 18–21, 45, 47, 48
