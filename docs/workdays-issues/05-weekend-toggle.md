# Slice 5 — Weekend toggle (5↔7 day grid)

## Parent PRD

`docs/workdays-prd.md`

## What to build

A Notion-style switch in the page header that flips the grid between Mon–Fri and Mon–Sun. URL-persisted. Hidden by default — agencies don't usually want weekends in scan view, but crunch-week reviews need them.

This includes:

- Hook: extend `use-workday-query-args` with `showWeekend: boolean` (read `weekend=1` from URL; absent → false). Setter pushes/removes the param.
- Component: `components/workday/workday-weekend-toggle.tsx` — Notion-style switch with a "Weekend" label. Wired to URL state, not local state.
- Grid: `workday-grid.tsx` and `workday-day-cell.tsx` already iterate the date range. Extend the date range when `showWeekend` is true (Mon–Sun = 7 days; Mon–Fri = 5 days). Weekend cells get `--surface-2` background per the prototype.
- Header strip: lowercase day labels still apply (`mon`, `sat`, `sun`).
- The `weekGrid` query already takes `{ startDate, endDate }` — page just passes a 5- or 7-day range.

## Acceptance criteria

- [ ] `lib/hooks/use-workday-query-args.ts` reads/writes `weekend=1` (absent → false).
- [ ] Toggle in the page header flips Mon–Fri ↔ Mon–Sun. URL updates.
- [ ] `?weekend=1` deep link lands on the 7-day grid; refresh preserves.
- [ ] Sat/Sun cells use `--surface-2` background; the rest of the grid is unchanged.
- [ ] Day-name labels for `sat` and `sun` follow the same lowercase 11.5px style.
- [ ] Visual diff against `docs/workday-prototype.html` for weekend on/off matches.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #03 (URL state hook + header shell)

## User stories addressed

- 11 (toggle weekend on/off; hidden by default)
- 12 (URL-persisted toggle)

## Notes

- **The grid's `grid-template-columns` changes** from `200px repeat(5, …)` to `200px repeat(7, …)`. Make sure the per-row template is shared so identity column + day cells stay in sync — composing this from a single CSS variable is cleaner than recomputing.
- **No backend change** — the same query handles 5 or 7 days.
- **shadcn check** — confirm the current `Switch` API before composing.
