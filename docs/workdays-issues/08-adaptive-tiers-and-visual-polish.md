# Slice 8 — Adaptive box content tiers + Notion-grade visual polish

## Parent PRD

`docs/workdays-prd.md`

## What to build

Bring the box rendering to prototype parity. Slice 1 shipped boxes that work; this slice makes them look right. Adaptive content tiers based on box height, category color tinting, today-column accents, focus rings, hover behavior — all the polish that separates "functional grid" from "Notion-grade scan view."

This includes:

- Box content tiers in `workday-task-box.tsx`:
  - **≥ 60px** — title (12.5px / 500 / `--fg`) · duration (right-aligned, 11px mono `--fg-muted`) → project subtitle (11.5px `--fg-muted`).
  - **36–59px** — title · duration on a single line.
  - **18–35px** — title only, truncated, no duration.
  - **< 18px** — colored sliver, min 6px, no text. Background `color-mix(in srgb, var(--cat-color) 50%, transparent)`.
- Box visual:
  - Tinted background `color-mix(in srgb, var(--cat-color) 11%, transparent)` (reuse formula from `components/category-badge.tsx`).
  - 6×6 category dot at `8px, 9px` top-left.
  - Hover: tint deepens 11% → 18%. No scale, no shadow, no lift.
  - Focus ring: 2px solid `var(--cat-color)` with `-1px` offset.
  - Per-box CSS var: `style={{ "--cat-color": category.color }}`.
- User-row card chrome:
  - Background `var(--surface)`, border `1px solid var(--border)`, radius `8px`.
  - **No drop shadow** at rest. Hover only changes border to `--border-strong`.
  - 10px gap between cards.
  - **No colored left stripe** (explicitly rejected).
  - Identity column: 200px wide, `--surface-2` background, `1px solid var(--border)` right divider, 32px `<UserAvatar>`, week total 22px / 600 / tabular numerals + "this week" label below in muted 12px.
- Header strip:
  - "Team member" column header invisible (`color: transparent` on a `·`).
  - Day columns: lowercase day name (`mon`) at 11.5px in `--fg-subtle`; number `21` at 18px / 600 / `-0.01em` tracking.
  - **Today column:** day name + number both in `--accent`. No underline, no badge.
- Day cell:
  - Padding `14px 10px 12px`. 1px solid right divider in `--border`.
  - **Today** day cell: subtle vertical accent gradient at top — `linear-gradient(to bottom, rgba(35,131,226,0.025) 0%, transparent 80px)`.
  - Day total at bottom: hairline top border, 10px padding-top, "total" label left in muted, value right-aligned monospace.

## Acceptance criteria

- [ ] All four content tiers render correctly. Verify by seeding entries of 5m, 25m, 45m, and 90m on the same day.
- [ ] Sliver entries (<18px) have no text and use the 50% tint formula. Hover popover from slice 7 still surfaces full detail.
- [ ] Boxes use `color-mix` tint at 11%; hover deepens to 18%. No transform on hover.
- [ ] Category dot (6×6) sits at top-left of each box (when height permits).
- [ ] Focus ring is 2px `var(--cat-color)` with `-1px` offset, keyboard-accessible.
- [ ] User-row cards have no drop shadow at rest; hover changes border color only.
- [ ] Identity column is 200px, `--surface-2` background, with the `<UserAvatar>` (32px) + name + role + week total + "this week" muted label.
- [ ] Header strip uses lowercase day names (11.5px `--fg-subtle`) and 18px / 600 day numbers.
- [ ] Today column's day name and number are both rendered in `--accent`.
- [ ] Today's day cells have the subtle vertical accent gradient at the top.
- [ ] Day total at the bottom of each cell has the hairline divider + "total" label + monospace value.
- [ ] Visual diff against `docs/workday-prototype.html` is near zero across all box tiers, today column, identity column, and day-cell footer.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #01 (boxes + grid + day cells exist)

## User stories addressed

- 2 (height reflects duration)
- 3 (category color tinting)
- 4 (per-day total + per-week total)
- 5 (today column visually marked)
- 29 (tiny entries as colored slivers)

## Notes

- **Reuse `color-mix` formula from `category-badge.tsx`** — don't reinvent (memory `feedback_no_custom_components.md`).
- **Tokens map to existing shadcn theme** — only the prototype uses raw Notion hex values. PRD §6.1 lists the mapping.
- **Today detection:** compute once at the page level (today's ISO date in org timezone) and pass down — don't recompute per cell.
- **Overtime visuals (red total, +Xh pill, 8h hairline) are slice 9**, not here. This slice ships the normal-day polish.
