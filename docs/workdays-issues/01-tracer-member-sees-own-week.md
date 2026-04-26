# Slice 1 — Tracer: a member sees their own week

## Parent PRD

`docs/workdays-prd.md`
Companion: `docs/workdays-plan.md` (PR 1 + parts of PR 2)

## What to build

The end-to-end spine. After this slice, a logged-in member can navigate to `/workday` and see *their own* week of work as colored boxes positioned on a per-day, hour-of-day axis. No filters, no week navigation, no popovers, no admin view, no polish — just the data path proving every layer is wired.

This includes:

- Schema change: add required `startedAt: v.number()` to `timeEntries` (no `endedAt` — derived).
- Mutations: `convex/timer.ts:commitEntry` writes `startedAt = Date.now() - elapsedMs`. The manual-create mutation in `convex/timeEntries.ts` accepts a required `startedAt`.
- Seed/dummy data: distribute entries across 9:00–18:00 in org timezone so the grid renders meaningfully. Wipe & re-seed (no migration needed — dummy data only per memory `project_mvp_dummy_data.md`).
- Backend: `convex/workday.ts:weekGrid` query that takes `{ startDate, endDate }`, filters by `orgId` first (always — CLAUDE.md hard rule), auto-scopes non-admins to `[userId]`, and returns the nested `users → days → boxes` shape with single-round-trip hydration. Aggregate (user, day, task) into one box; sort entries by `startedAt` asc; sort boxes within day by `firstStart` asc.
- Nav: add new **Insights** group to `lib/navigation.ts` with Workday entry. (Reports stays where it is until slice 2 — keeps this slice focused.) → see Q1 in slicing notes.
- Page: `app/(dashboard)/workday/page.tsx` thin orchestrator (under 200 lines, no inline components) defaulting to current week, no params.
- Loading state: `app/(dashboard)/workday/loading.tsx` content-aware skeleton mirroring the final grid scaffold.
- Components (minimal): `components/workday/workday-grid.tsx`, `workday-user-row.tsx`, `workday-day-cell.tsx`, `workday-task-box.tsx`. Single rendering tier (no adaptive content sizing yet — that's slice 8). Boxes positioned at 1h = 40px scale.

## Acceptance criteria

- [ ] `convex/schema.ts` `timeEntries` table has required `startedAt: v.number()`.
- [ ] `convex/timer.ts:commitEntry` writes `startedAt = Date.now() - elapsedMs`. Existing time logging path still works.
- [ ] Manual-entry mutation in `convex/timeEntries.ts` requires `startedAt`. (Popover UI changes ship in slice 6 — this slice only updates the mutation signature; existing callers pass a sensible default like `Date.now()` to keep TS happy until slice 6 lands.)
- [ ] Seed scripts produce realistic intra-day `startedAt` values across the 9–18 band.
- [ ] Database wiped & re-seeded; dummy data renders on the page.
- [ ] `convex/workday.ts:weekGrid` query exists; filters by `orgId` in the index call; auto-scopes non-admins to their own `userId`; returns `users → days → boxes` with `firstStart`, `totalMinutes` precomputed.
- [ ] Hydration is single round-trip (`Promise.all(ids.map(ctx.db.get))` per ID set — tasks, projects, categories, users). No N+1.
- [ ] `lib/navigation.ts` has an Insights group with a Workday entry. Sidebar updates automatically.
- [ ] `/workday` route exists, renders for any signed-in user (member or admin).
- [ ] `loading.tsx` skeleton has the same column widths and row height as the final grid (no jump on load).
- [ ] As a member, visiting `/workday` shows your own row only. Day cells render boxes positioned by `startedAt` at 40px/hour. Day total renders under each cell.
- [ ] Admin's view in this slice is allowed to look identical to a member's (only own row) — slice 2 brings the all-team rendering.
- [ ] Convex test: `weekGrid` filters by `orgId` (cross-tenant entries never returned) and auto-scopes a member to their own `userId` regardless of any `userIds` arg supplied.
- [ ] `npx tsc --noEmit` returns zero errors.
- [ ] `npm run lint` clean.

## Blocked by

None — can start immediately.

## User stories addressed

From `docs/workdays-prd.md`:

- 1 (admin sees team work as colored boxes — partially; this slice does the box rendering, slice 2 brings the all-team view)
- 18 (member sees only own row)
- 21, 24 (entries persist `startedAt` from manual log + timer)
- 25 (member with zero entries still gets a row — covered by query returning the user list)
- 30 (skeleton matches final layout)
- 31 (multi-tenancy isolation)

## Notes

- **No member filter button, no week picker, no weekend toggle, no popover, no overtime visuals, no adaptive box tiers** — those are dedicated slices. Keep this one's diff lean and the demo concrete.
- **Currency invariant (D1) is irrelevant** — this query reads but never computes money totals.
- **Convex 16k-doc safety** — fine for v1 team sizes; document the back-pocket plan in a code comment near the query.
