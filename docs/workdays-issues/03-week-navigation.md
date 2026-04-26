# Slice 3 — Week navigation (arrows + calendar popover + URL state)

## Parent PRD

`docs/workdays-prd.md`

## What to build

Add the week control: previous/next arrows, a date label that opens a calendar popover with whole-week-row hover and click-to-select, plus URL-state persistence so back/forward, refresh, and link sharing all preserve the selected week.

This is the slice that introduces the `use-workday-query-args` hook (in its first form, holding only `week`) and the `use-week-picker` pure-date module. Both are tested.

This includes:

- Hook: `lib/hooks/use-week-picker.ts` — pure functions `startOfWeek(d)`, `addDays(d, n)`, `sameWeek(a, b)`, `formatRange(a, b)` (e.g. `Apr 21 – 25, 2026`), ISO-week parse/format (`2026-W17`), and a 6×7 calendar grid generator with selected/today markers. No React state — just pure functions plus a thin grid-builder hook.
- Hook: `lib/hooks/use-workday-query-args.ts` — reads `week` from search params, falls back to `startOfWeek(today)`, returns `{ queryArgs, selectedWeek, setWeek }`. Setters use `router.push` with merged search params (CLAUDE.md "filterable views persist state in URL").
- Component: `components/workday/workday-header.tsx` — page toolbar shell (title + sub on left, week control on right). Composes the next component.
- Component: `components/workday/workday-week-picker.tsx` — `◀ [Apr 21 – 25, 2026 ▾] ▶`. The label opens a 320px calendar popover. Whole-week rows are the click target — hover highlights the entire row in `--surface-2`; click selects the week and closes the popover. Today gets `--accent` text + a 3px accent dot below the number. Out-of-month days dim to 55% opacity but stay selectable as part of their week. Footer link "Jump to this week" in `--accent`.
- URL contract: `?week=2026-W17`. Missing → current week.
- Page wiring: page reads `useWorkdayQueryArgs()`, passes `week` to the query, passes setters down to the picker.
- Tests (`use-week-picker`):
  - `startOfWeek` returns Monday across DST transitions.
  - ISO-week parse/format roundtrips, including year-boundary edge cases (`2025-W01`, `2026-W53` if applicable).
  - `sameWeek` is true across timezone shifts within the same ISO week.
  - 6×7 grid generator returns 42 days with correct prior/next-month overflow.

## Acceptance criteria

- [ ] `lib/hooks/use-week-picker.ts` exists with named exports for the pure functions plus a hook returning the 6×7 grid + selected/today markers.
- [ ] `lib/hooks/use-workday-query-args.ts` exists and is the single source of truth for URL-driven Workday state. Reads `week`; setters merge into existing search params (don't clobber siblings).
- [ ] Visiting `/workday` with no params lands on the current ISO week.
- [ ] Visiting `/workday?week=2026-W17` lands on that exact week regardless of today's date.
- [ ] `◀` / `▶` buttons step the week and update the URL.
- [ ] Clicking the date label opens the calendar popover. Hovering any week-row in the popover highlights the whole row. Clicking selects that week and closes.
- [ ] Today is visually marked in the calendar with `--accent` text + a 3px accent dot.
- [ ] Out-of-month days are dimmed but still part of their week's clickable row.
- [ ] "Jump to this week" footer link returns to the current week.
- [ ] Browser back/forward preserves week selection. Refresh preserves week selection.
- [ ] Visual diff against `docs/workday-prototype.html` for the week picker is near zero.
- [ ] Unit tests for `use-week-picker` pure functions cover DST, ISO-week roundtrip including year boundaries, `sameWeek` across timezones, and 6×7 grid generation.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #01 (page shell + query)

## User stories addressed

- 6 (one-click prev/next)
- 7 (jump to a specific week via calendar)
- 8 (whole-week-row hover/select semantics — never accidentally pick a single date)
- 12 (URL-persisted week)
- 32 (`?week=YYYY-Www` deterministic deep link)

## Notes

- **Re-use, not reinvent:** if `lib/format.ts` or similar already has date helpers, extend rather than fork.
- **Verify with Context7** before reaching for any date library — only `date-fns` (or whatever the repo already uses) should appear in imports.
- **The Insights nav group already exists from slices 1+2** — no nav edits in this slice.
