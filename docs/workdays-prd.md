# PRD: Workday — Weekly Team View

**Phase:** 8 (post Phase 7 Time Tracking)
**Route:** `/workday`
**Owner:** Adam Toth
**Status:** Spec locked, design approved, ready to implement
**Companion docs:** `docs/workdays-plan.md` (implementation plan), `docs/workday-prototype.html` (visual reference)

---

## Problem Statement

An agency owner running a team of designers, developers, and PMs has no single place to answer "what did my team actually work on this week?" Today, the only way to reconstruct that picture is to open the tasks list, filter by assignee, eyeball the time entries one user at a time, and mentally aggregate per-day totals. The information exists, but it's scattered across rows in a flat table and offers no sense of *when* in the day work happened, *how much* of each day was logged, or *which categories of work* dominated the week.

Members have a related but smaller version of the same gap: they want a calendar-style read on their own week — what they did, when, and how much — that's easier to scan than a chronological list of entries.

## Solution

A weekly grid at `/workday` that lays out every team member as a row and every day of the selected week as a column. Within each cell, time entries collapse into colored, calendar-style boxes — one box per (user, day, task) — sized proportionally to duration and tinted by the task's work category. At a glance, the admin can see who worked on what, when, for how long, and where the gaps are.

The view is **read-only in v1.** Hovering a box surfaces a popover listing the underlying entries. Clicking a box opens the existing task drawer. The data model gains the field needed (`startedAt` on `timeEntries`) so future versions can layer on drag-to-move, inline-create, and resize without a second migration.

Admins see the full team grid with a member filter; members see only their own row.

## User Stories

### Admin — viewing the team

1. As an admin, I want a weekly view that shows every team member's work as colored time boxes per day, so that I can scan what the whole team did without opening individual tasks.
2. As an admin, I want each box's height to reflect its duration, so that a 4-hour box visually dominates a 30-minute one and I can spot uneven days at a glance.
3. As an admin, I want each box tinted by its work category color, so that I can visually distinguish design vs. dev vs. PM work without reading every label.
4. As an admin, I want a per-day total under every cell and a per-week total in each member's identity column, so that I have a quantitative read alongside the visual one.
5. As an admin, I want today's column visually marked, so that I always know my temporal anchor in the grid.
6. As an admin, I want to navigate to the previous or next week with one click, so that I can scrub through history quickly.
7. As an admin, I want to jump to a specific week via a calendar popover, so that I can answer "what did the team do the week of Mar 17?" without arrowing through twelve clicks.
8. As an admin, I want the calendar popover to highlight whole-week rows on hover and select an entire week on click, so that I never accidentally pick a single date when I meant the week containing it.
9. As an admin, I want to filter the grid to a subset of members, so that I can focus on one squad or pair when reviewing.
10. As an admin, I want the member filter to handle 30+ people via a searchable popover (not avatars on the toolbar), so that the page scales as the team grows.
11. As an admin, I want to toggle weekend columns on or off, so that I can include Saturday/Sunday work when reviewing crunch weeks but hide them by default for the typical Mon–Fri view.
12. As an admin, I want my week, member filter, and weekend toggle persisted in the URL, so that browser back/forward works, refresh preserves state, and I can share a link to a specific view.

### Admin — clicking through

13. As an admin, I want hovering a box to reveal a popover listing the underlying time entries (start–end, duration, note, billable flag), so that I can read the detail without leaving the grid.
14. As an admin, I want the popover to open with a short delay (~200ms), so that scanning quickly across boxes doesn't spam popovers.
15. As an admin, I want clicking a box to open the existing task drawer, so that I can edit the task or its entries with the tools I already use.
16. As an admin, I want clicking an entry row inside the popover to open the task drawer scrolled to that entry's place in the Time tab, so that I can jump straight to the row I'm questioning. (Nice-to-have; opening the drawer at all is the v1 requirement.)
17. As an admin, I want the drawer's prev/next navigation to step through the week's visible task IDs, so that I can review tasks in scan order rather than jumping between unrelated lists.

### Member — viewing themselves

18. As a member, I want to see only my own row at `/workday`, so that I can review my week without seeing teammates' time.
19. As a member, I want the member-filter button hidden, so that the UI doesn't tease functionality I'm not allowed to use.
20. As a member, I want the same week navigation, weekend toggle, hover popover, and click-to-drawer behavior that admins have, so that my self-review tools are first-class, not a stripped-down view.

### Logging time — the upstream change

21. As anyone logging time via the manual-log popover, I want to specify *when* the work happened (a start time), so that the new Workday grid can place my entries on the correct hour-of-day axis (and so future calendar integrations work without another migration).
22. As anyone logging time, I want the start-time field to default to "now − duration" (the "I just finished doing this" case), so that the most common path stays one click.
23. As anyone logging time, I want quick presets (15m / 30m / 1h ago) plus a free-form picker, so that I'm not forced into a date-time keyboard for routine entries.
24. As the running timer, I want each commit to record an accurate `startedAt` so that timer-driven entries also place correctly on the grid.

### Failure / edge cases

25. As an admin, when a member has zero entries for the selected week, I want their row still rendered with zero totals (not omitted), so that I can see at a glance who didn't log anything.
26. As an admin, when the entire visible week has zero entries across the team, I want a centered empty state instead of a wall of empty cells, so that the page doesn't read as broken.
27. As an admin, when a single day's cell has zero entries, I want a quiet "No work logged" hint inside the cell (not a full empty state), so that it's clear the data is intentional, not missing.
28. As an admin, when a member logs more than 8 hours in a single day, I want the day total to render in red with a `+Xh` overtime pill *and* a hairline marker at the 8h capacity line, so that overtime is visible without clipping the data.
29. As an admin, when an entry is shorter than ~25 minutes, I want it rendered as a colored sliver (no label) with the popover still surfacing the detail, so that micro-entries don't crowd out readable boxes.
30. As an admin, when the Convex query is loading, I want a skeleton with the same column widths and row heights as the final grid, so that the layout doesn't jump on data load.
31. As an admin in another organization, I want zero risk of seeing another tenant's time entries on this page, so that multi-tenancy isolation holds (every query filters by `orgId`).
32. As an admin who navigates to a week with the URL `?week=2026-W17`, I want the page to land on that exact week regardless of today's date, so that shared links are deterministic.
33. As an admin who clears the member filter to "none selected," the system should treat empty selection as "all members" rather than rendering an empty grid, so that I never end up looking at a useless blank state.

### Out of scope but implied (called out so they're explicit)

34. As an admin, I do *not* expect to drag boxes between days, resize them by edge, or click empty space to inline-create entries in v1. These are v2+. The schema is built to support them.
35. As an admin, I do *not* expect PTO/out-of-office annotations in v1 — a member with no entries shows zero, not "Off."

---

## Implementation Decisions

### Schema change (one new field, required)

- Add `startedAt: v.number()` (epoch milliseconds) to the `timeEntries` table. **Required, not optional.** Toggl/Harvest/Clockify/Tempo all store start time; making it required now unlocks the future editor, calendar integrations, overtime billing rules, and overlap detection without a second migration.
- Do **not** store `endedAt`. End is derived as `startedAt + durationMinutes * 60_000`. This avoids a rounding paradox where `durationMinutes` is rounded per `orgSettings.roundingMinutes` but the wall-clock end isn't.
- Keep the existing denormalized `date` (YYYY-MM-DD, org timezone) field. It powers existing indexes (`by_userId_date`, `by_orgId_date`) and stays derived from `startedAt + org timezone` at write time.
- Repo is on dummy data only (per memory `project_mvp_dummy_data.md`); no Convex migration component is required — wipe and re-seed.

### Mutation changes

- `convex/timer.ts:commitEntry` writes `startedAt = Date.now() - elapsedMs` (wall-clock equivalent of session start). Acceptable that pause/resume produces a slightly synthetic start; tracking original-first-start through pauses is a follow-up, not a blocker.
- The manual-create mutation in `convex/timeEntries.ts` accepts a required `startedAt: v.number()`.
- Seed/dummy scripts distribute entries across 9:00–18:00 per day in org timezone so the grid renders meaningfully out of the box.

### Manual-log popover (component change)

- `components/tasks/time-log-popover.tsx` gains a "Started at" chip below the duration row.
- Default value: `now − duration`.
- Quick options: `now − duration`, `15m ago`, `30m ago`, `1h ago`, `Pick time…` (reveals an inline HH:MM input).
- The chip writes `startedAt` on save. The selected `date` from the date picker provides the calendar day; the time portion comes from this chip.

### Backend query

- New `convex/workday.ts:weekGrid` query takes `{ startDate, endDate, userIds? }` and returns nested `users → days → boxes` shape, with each box aggregating one (user, day, task) tuple's entries (sorted by `startedAt` ascending, with `firstStart` and `totalMinutes` precomputed for box ordering and sizing).
- **Multi-tenancy:** filters by `orgId` from `getAuthContext` first, always (per CLAUDE.md hard rule). User-list filtering layers on top.
- **Member auto-scope:** non-admins are auto-scoped to their own `userId`; the admin-only `userIds` filter is ignored for them.
- **Hydration:** single round-trip per ID set (`Promise.all(ids.map(ctx.db.get))`) for tasks, projects, categories, users — no N+1.
- **Convex 16k-doc safety:** safe for v1 team sizes (≈700 docs/week for 10 users). Add a back-pocket plan to switch to per-user paged queries past ~5k entries/week/org.
- **Currency invariant (D1) is irrelevant here** — the query reads but never computes money totals.

### Routing & navigation

- Page lives at `app/(dashboard)/workday/page.tsx`. Not admin-only — members see their own row.
- Add a new **Insights** group to `lib/navigation.ts` containing Workday + Reports. Remove Reports from the Finance group at the same time. (Bundled per memory `feedback_one_pr_refactors.md`.)
- Existing `lib/route-access.ts` admin-only enforcement for `/reports` carries over unchanged.

### URL state contract

```
/workday                                          → current week, all members, weekend hidden
/workday?week=2026-W17                            → ISO week
/workday?week=2026-W17&users=u_abc,u_def          → filtered to two users
/workday?week=2026-W17&weekend=1                  → 7-day grid
```

- `week` is ISO week (`YYYY-Www`). Falls back to `startOfWeek(today)` when missing.
- `users` is comma-separated user IDs. Empty/missing means "all members."
- `weekend` is `1` or absent.
- Browser back/forward, refresh, and link sharing all preserve state. Per CLAUDE.md "filterable views persist state in URL."

### Click-through

- **Box body click:** push `?task=<taskId>` — opens the existing `TaskDetailDrawer` via the existing `useTaskDetail` URL-driven hook.
- **Entry row click in popover:** push `?task=<taskId>&entry=<entryId>` (new optional param). The drawer's Time tab reads `entry` and scrolls/highlights that row. If the entry-scroll feature isn't ready, opening the drawer at the task is acceptable for v1.
- **Drawer's `taskIds` prop:** pass the visible week's task IDs (de-duplicated, sorted by first appearance) so the drawer's prev/next steps through them in scan order.

### Reuse, not reinvent

- `<UserAvatar>` from `components/user-avatar.tsx` (per memory `feedback_no_custom_components.md`).
- Category color tint via the `color-mix` formula from `components/category-badge.tsx`.
- `<EmptyState>` from `components/empty-state.tsx`.

### Visual contract

- Hour scale: **1 hour = 40 px**, full 8-hour workday = 320 px column height.
- **Adaptive content tiers** by box height: ≥60px shows title + duration + project subtitle; 36–59px shows title + duration; 18–35px shows title only; <18px is a 6px sliver, no text.
- **Overtime:** day-stack grows past 320px; a hairline at the 8h mark is labeled "8h"; day total turns red with a `+Xh` pill.
- **Today column:** day name and number both in `--accent`. Subtle vertical accent gradient at the top of today's day cells.
- **Weekend cells:** `--surface-2` background.
- **No drop shadow** on user-row cards at rest. **No colored left stripe** (explicitly rejected). **No avatars row** in the toolbar.
- All exact values live in `docs/workday-prototype.html` and the implementation plan; this PRD references them rather than re-stating CSS.

### Permissions

- `getAuthContext` provides `{ orgId, userId, isAdmin }` server-side.
- Server: members are scoped to `[userId]` regardless of any `userIds` argument supplied by the client.
- Client: the `WorkdayMemberFilter` button is hidden for members. The page does not rely on client-side hiding for security — the server enforces.

---

## Module Design

### `convex/workday.ts:weekGrid` (query)

- **Responsibility:** Given a date range and an optional admin user filter, return the nested team-week grid with boxes precomputed.
- **Interface:**
  - **Inputs:** `{ startDate: string, endDate: string, userIds?: Id<"users">[] }`
  - **Output:** `{ users: Array<{ user, days: Array<{ date, totalMinutes, boxes: Box[] }> }> }`, where each `Box` has `{ taskId, task, project, category, totalMinutes, firstStart, entries[] }`, sorted by `firstStart` ascending; entries within a box sorted by `startedAt` ascending.
  - **Failure modes:** unauthenticated → throws; no entries → returns user list with empty `boxes` and zero totals.
- **Tested:** **yes.** This is the deepest module — it owns auth scoping, multi-tenancy filter, aggregation, and overtime semantics. Tests exercise admin vs. member auto-scope, cross-tenant isolation, empty results, multi-entry-per-task aggregation, and overtime totals.

### `convex/timer.ts:commitEntry` & `convex/timeEntries.ts` create mutation (modified)

- **Responsibility:** Persist time entries with the new required `startedAt` field.
- **Interface change:** both mutations now require `startedAt: v.number()`. `commitEntry` derives it from the timer state (`Date.now() - elapsedMs`); the manual-create mutation accepts it from the popover.
- **Tested:** no separate tests added; covered by query tests reading the resulting rows. Existing time-entry mutation paths continue to work; broken callers surface as TS errors.

### `lib/hooks/use-workday-query-args.ts`

- **Responsibility:** Single source of truth for URL-driven workday state. Read `week`, `users`, `weekend` from search params; derive `{ queryArgs, selectedWeek, selectedUserIds, showWeekend, setWeek, setUsers, setShowWeekend }`.
- **Interface:** hook returning the above. All setters use `router.push` with merged search params.
- **Tested:** no — thin wrapper over `useSearchParams` and `router.push`; verified through page integration.

### `lib/hooks/use-week-picker.ts`

- **Responsibility:** Pure date logic — `startOfWeek(d)`, `addDays(d, n)`, `sameWeek(a, b)`, formatting (`Apr 21 – 25, 2026`), ISO-week parsing/formatting (`2026-W17`), and the calendar grid generator (6 weeks × 7 days).
- **Interface:** named exports of pure functions + a hook returning the grid + selected/today markers.
- **Tested:** **yes.** Pure functions are cheap to test and easy to break (timezones, ISO week edge cases at year boundaries, locale Sunday-vs-Monday). Reusable beyond Workday.

### `convex/workday.ts:weekGrid` consumers (`components/workday/*`)

- **`workday-grid.tsx`** — composes the header strip and per-user rows around a shared `grid-template-columns: 200px repeat(N, minmax(168px, 1fr))`.
- **`workday-user-row.tsx`** — one user's identity column + day cells.
- **`workday-day-cell.tsx`** — one day for one user; positions boxes on the 40px-per-hour scale; renders day total.
- **`workday-task-box.tsx`** — colored block; adaptive content tier by height; tooltip trigger + click-to-drawer.
- **`workday-task-popover.tsx`** — hover popover with entry rows + total footer; 200ms delay; click-row → drawer (with optional `entry` param).
- **`workday-header.tsx`** — page toolbar; composes `workday-week-picker.tsx` + `workday-member-filter.tsx` + `workday-weekend-toggle.tsx`.
- **`workday-week-picker.tsx`** — unified week control: arrow buttons + date label + calendar popover with whole-week-row hover and "Jump to this week" footer.
- **`workday-member-filter.tsx`** — searchable checkbox popover; admin-only; dynamic button label ("All members" / "3 of 12 members" / one user's full name).
- **`workday-weekend-toggle.tsx`** — Notion-style switch wired to URL state.
- **`workday-empty-state.tsx`** — centered week-level empty state.
- **Tested:** no component-level RTL tests in v1. Visual diff against `docs/workday-prototype.html` + manual checklist (per Testing Decisions below).

---

## Testing Decisions

What makes a good test for this feature: **test the query's external contract, not its implementation.** Drive it with seeded `timeEntries` rows and assert the returned shape — totals, sort order, scoping, multi-tenancy, overtime — without caring how the aggregation loop is structured.

**Tested in this PRD:**

1. **`convex/workday.ts:weekGrid`** — integration tests against a Convex test harness covering:
   - Admin gets all members in their org; never sees another org's entries.
   - Member auto-scoped to themselves regardless of any `userIds` argument supplied.
   - Empty week returns user list with zero totals (not an empty user list).
   - Multi-entry-per-(user, day, task) aggregates into one box with `totalMinutes` summed and `firstStart = min(startedAt)`.
   - Boxes within a day sorted by `firstStart` ascending; entries within a box sorted by `startedAt` ascending.
   - Overtime: a day with >8h of entries returns the correct `totalMinutes` (no clipping in the data — overtime is purely a render concern).
   - Hydration is N+1-safe (asserted via Convex's query stats or by query count).

2. **`lib/hooks/use-week-picker.ts`** — unit tests for pure functions:
   - `startOfWeek` returns Monday across DST transitions and timezone boundaries.
   - ISO week parsing/formatting roundtrips for year-boundary weeks (`2025-W01`, `2026-W53` if applicable).
   - `sameWeek` returns true across timezone shifts within the same ISO week.
   - 6×7 calendar grid generator returns the expected day count and overflow days from prior/next month.

**Not tested in v1 (deferred to v2 if/when interaction lands):**

- Component rendering, hover/click flows, drawer integration. Verified manually against `docs/workday-prototype.html` and the verification checklist in `docs/workdays-plan.md` §9.
- Mutation tests for `commitEntry` and the manual-create change — exercised transitively by the query tests.

**Prior art:** look at any existing tests in `convex/` for `tasks.ts` or `timeEntries.ts` aggregation queries (if present) for the multi-tenancy assertion pattern. If none exist, this is the first integration-test entry point and worth getting right.

---

## Out of Scope

Explicit non-goals for this phase:

- **Drag a box between days** to move an entry's date.
- **Drag in empty grid space** to create a new entry (would require an hour-grid UI mode).
- **Drag a box edge** to resize duration.
- **Click empty space** to inline-create an entry.
- **Click box to inline-edit** title / duration / category.
- **Hour-grid view mode** (Google Calendar-style with hour rulers).
- **PTO / out-of-office** label or row dimming.
- **Project / category / billable filters** — v1 ships with member + weekend filters only.
- **Workday-level analytics** (utilization heatmap, weekly trend chart, capacity planning).
- **Calendar integration** (Google Calendar sync) — `startedAt` is now ready for it, but no sync code in v1.
- **Overlap detection / warning** when two entries on the same user collide in time.
- **Pagination of entries** beyond 5k/week/org — back-pocket plan documented; not implemented.
- **Per-user weekly capacity overrides** (different working-day length per user). v1 hardcodes 8h as the capacity line for everyone.
- **Localization** of day names, week start (Sunday-first locales), 12-hour clock display. v1 uses lowercase English day names and 24-hour times to match the prototype.
- **Component-level UI tests.** Visual diff + manual checklist only.

The data model supports everything in the first list — the gating constraint is product/UX scope, not data.

## Open Questions

None blocking. The two soft items:

1. **Entry-level drawer scroll target** — opening the drawer at the right entry (`?task=…&entry=…`) is a nice-to-have. **Owner:** Adam. **Resolution path:** ship without it; if the param/feature exists in `useTaskDetail` by integration time, wire it up; otherwise defer.
2. **Pause/resume start-time semantics** — `commitEntry` writes a synthetic `startedAt = Date.now() - elapsedMs` rather than the original session start. **Owner:** Adam. **Resolution path:** acceptable for v1; track the original session start in a follow-up if calendar integrations need wall-clock fidelity.

## Further Notes

- **CLAUDE.md rules invoked on this PRD:**
  - Multi-tenancy: every Convex query filters by `orgId`.
  - Page files thin (under 200 lines, no inline component definitions).
  - Loading skeletons content-aware (mirror final grid layout).
  - Domain UI elements as shared components (avatar, category badge, empty state).
  - Filterable views persist state in URL.
  - Loading → Empty → Content three-phase pattern.
  - 0 TS errors at all times.
  - Backlog tracking mandatory — `docs/backlog.md` gets a Phase 8 entry once shipped.

- **Memories invoked:**
  - `project_mvp_dummy_data.md` — wipe-and-reseed is fine; no Convex migration component required.
  - `feedback_one_pr_refactors.md` — bundle the nav reorganization (move Reports into Insights) with the Workday page in PR 2.
  - `feedback_no_custom_components.md` — reuse `UserAvatar`, `EmptyState`, and the category-badge color-mix formula.
  - `feedback_design_process.md` — Paper-first, ClickUp-match, Context7-verified, frontend-design polish.

- **PR slicing** (per the implementation plan, not re-litigated here):
  - **PR 1:** Schema + mutations + manual-log popover "Started at" chip + seed updates. No user-facing surface for the new field.
  - **PR 2:** Workday query + page + components + nav reorganization (add Insights group, move Reports).

- **Visual source of truth:** `docs/workday-prototype.html`. Keep it open while implementing PR 2; the verification checklist in `docs/workdays-plan.md` §9 is the cutover gate.
