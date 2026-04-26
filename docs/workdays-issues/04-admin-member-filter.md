# Slice 4 — Admin member filter (searchable popover)

## Parent PRD

`docs/workdays-prd.md`

## What to build

Admin-only sub-selection of which members appear in the grid, via a searchable checkbox popover that scales to 30+ people. The button is hidden for members. The server enforces auto-scope regardless of what the client sends — defense in depth.

This includes:

- Backend: `weekGrid` already accepts `userIds?` from slice 1. This slice adds the explicit test that an admin's `userIds` filter narrows the result, and a member's `userIds` arg is ignored (already true; assert it).
- Hook: extend `use-workday-query-args` with `users` (comma-separated). Empty/missing → "all members."
- Component: `components/workday/workday-member-filter.tsx` — popover button (`👥 N members ▾`) + 280px popover with:
  - Search field at top (`Search members…`), focuses with `--accent` border.
  - Each row: 16px checkbox + 22px `<UserAvatar>` + name + small role label.
  - Footer: "Select all" / "Clear" actions. Clear resets to all (not to literally empty — empty is treated as all per user story 33).
  - Dynamic button label: `All members` / `3 of 12 members` / a single user's full name.
- Wiring: `workday-header` includes the filter button between week-picker and (future) weekend toggle, with hairline dividers (1px × 18px in `--border`, `0 4px` margin). Hidden entirely for non-admin users (use Clerk role check; do not rely on client hiding for security — the server already auto-scopes).
- URL contract: `?users=u_abc,u_def`. Empty/missing → all.

## Acceptance criteria

- [ ] `lib/hooks/use-workday-query-args.ts` reads/writes `users` as a comma-separated list. Empty/missing → undefined `userIds` passed to the query.
- [ ] As an admin, the member filter button is visible in the page header. As a member, it's hidden.
- [ ] Popover opens, search filters the list client-side, checkboxes toggle inclusion.
- [ ] Button label updates dynamically: `All members`, `3 of 12 members`, or the single selected user's name.
- [ ] "Select all" rechecks every member; "Clear" resets to "all members" (treated as no filter — see user story 33), not to a literal empty selection that produces a blank grid.
- [ ] `?users=u_abc,u_def` deep link narrows the grid to those two users; refresh preserves.
- [ ] List uses `<UserAvatar>` from `components/user-avatar.tsx`. No bespoke avatar (memory `feedback_no_custom_components.md`).
- [ ] Visual diff against `docs/workday-prototype.html` for the filter button + popover is near zero.
- [ ] Convex test: an admin's `userIds: [a, b]` returns only those users; auto-scope is bypassed.
- [ ] Convex test: a member who passes `userIds: [otherMemberId]` is still scoped to themselves; the arg is ignored. (Server-side enforcement.)
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #02 (admin team rendering)
- Blocked by #03 (URL state hook + header shell)

## User stories addressed

- 9 (filter to a subset)
- 10 (popover scales to 30+ via search, not avatars on toolbar)
- 12 (URL-persisted filter)
- 19 (member-filter button hidden for members)
- 33 (empty selection treated as "all" — never blank grid)

## Notes

- **shadcn check first** — `Popover`, `Command`, `Checkbox` may have current API shifts; run the `shadcn` skill before composing.
- **Search is client-side** — the user list is already in memory from `weekGrid`. No additional query.
- **Hairline dividers** between toolbar controls are part of this slice since they live in `workday-header.tsx`.
