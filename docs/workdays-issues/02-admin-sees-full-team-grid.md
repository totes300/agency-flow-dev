# Slice 2 — Admin sees the full team grid

## Parent PRD

`docs/workdays-prd.md`

## What to build

Extend the data path so an admin sees every team member as a row, including members who logged zero entries this week (preserves team awareness — see user story 25). The page composition stays the same; only the user list expands and a few rendering details handle the multi-row case.

This slice also moves Reports out of the Finance group into Insights — bundled here per memory `feedback_one_pr_refactors.md` because both nav edits land in `lib/navigation.ts` and shipping them together prevents two churns of the sidebar.

This includes:

- Backend: extend `weekGrid` so when the caller is an admin and `userIds` is undefined, it returns *every* member of the org (not just members with entries). Members with no entries still get a row with `days[].boxes = []` and `totalMinutes = 0`.
- Member list source: query `users` filtered by `orgId`. Sort by display name (consistent ordering across renders).
- Frontend: `workday-grid` and `workday-user-row` already render multiple rows in slice 1's structure — verify spacing, dividers, and per-row chrome from `docs/workday-prototype.html` hold up at 8–12 rows.
- Nav: remove Reports from the Finance group and add it to the Insights group. `lib/route-access.ts` admin-only enforcement carries over unchanged.

## Acceptance criteria

- [ ] As an admin (no `userIds` filter), `weekGrid` returns one entry in `users[]` per organization member, not just members with time entries.
- [ ] Members with zero entries this week render as a row with `days[].totalMinutes === 0` and empty `boxes` arrays. The row is visible in the grid.
- [ ] User ordering is stable across queries (sort by name).
- [ ] As an admin, `/workday` renders rows for every team member; visual spacing/dividers from the prototype hold up at realistic team sizes (seed at least 8 members for verification).
- [ ] As a member, the page still shows only your own row (auto-scope still wins).
- [ ] `lib/navigation.ts`: Reports moved from Finance into the Insights group, sitting under Workday. Finance group no longer contains Reports.
- [ ] Reports admin-only enforcement still works (members can't reach `/reports` directly).
- [ ] Convex test: admin in org A never sees rows or entries from org B. Test seeds two orgs with overlapping IDs and asserts isolation.
- [ ] Convex test: admin call without `userIds` returns all org members, including a seeded member with zero entries.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #01 (schema, query, page shell)

## User stories addressed

- 1 (admin sees the whole team)
- 25 (zero-entry members still rendered)
- 31 (multi-tenancy isolation, asserted)

## Notes

- **Per-cell empty hint** ("No work logged" inside a day cell) is **slice 9**, not here. This slice just makes empty cells render nothing — that's fine for now.
- **Week-level empty state** is **slice 9** too.
- **N+1 sanity:** the user list expansion may pull more user docs than slice 1 anticipated. Use the same single-round-trip hydration pattern.
