# Slice 6 — Manual-log "Started at" chip

## Parent PRD

`docs/workdays-prd.md`

## What to build

The upstream UX change for `startedAt`: when a user logs time manually via the existing `time-log-popover.tsx`, they can specify *when* the work happened. Defaults to the most common case ("I just finished doing this") so the one-click path stays one click.

This slice ships the visible upgrade for everyone using the time-log popover — independent of the Workday page itself. Slice 1 already updated the mutation signature; this slice updates the UI that calls it.

This includes:

- Component: `components/tasks/time-log-popover.tsx` adds a "Started at" chip below the duration row.
- Default value: `now − duration`. Recomputes whenever the duration changes.
- Quick options dropdown: `now − duration`, `15m ago`, `30m ago`, `1h ago`, `Pick time…`.
- `Pick time…` reveals an inline HH:MM input. The chosen time combines with the popover's selected `date` to form `startedAt` (epoch ms) on save.
- Passes the resulting `startedAt` to the manual-create mutation. Existing callers that previously passed `Date.now()` as a stub get cleaned up.

## Acceptance criteria

- [ ] `time-log-popover.tsx` renders a "Started at" chip with `now − duration` as the default label.
- [ ] Changing duration updates the default `startedAt` (recomputed during render — no `useEffect` sync loop, per CLAUDE.md "compute, never sync").
- [ ] Dropdown shows `now − duration`, `15m ago`, `30m ago`, `1h ago`, `Pick time…` options.
- [ ] `Pick time…` reveals an inline HH:MM input; choosing a time sets `startedAt` to that hour/minute on the popover's selected date.
- [ ] Saving the entry persists `startedAt` correctly. The entry shows up on `/workday` in that hour band.
- [ ] Slice 1's stub callers (any place that passed `Date.now()` to satisfy TS) are removed in favor of the chip's value.
- [ ] Mutation error path uses `toastError` per CLAUDE.md "every mutation must handle errors."
- [ ] Visual diff against the prototype (`docs/workday-prototype.html` reference for the chip styling) is near zero.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #01 (schema + mutation signature change)

## User stories addressed

- 21 (specify *when* work happened)
- 22 (default to `now − duration`)
- 23 (quick presets + free-form picker, not a date-time keyboard)

## Notes

- **Verify date helpers via Context7** if reaching for any new library APIs.
- **One-click path stays one click.** If the user just wants to log "1h, just finished," they shouldn't see the picker — the default chip label answers the question.
- **No timer changes here.** `commitEntry` already writes `startedAt` from slice 1.
