# Slice 7 — Hover popover + click-to-drawer + drawer prev/next

## Parent PRD

`docs/workdays-prd.md`

## What to build

The interaction layer on top of the boxes. Hovering a box reveals the underlying time entries; clicking opens the existing task drawer. Drawer prev/next steps through the visible week's tasks in scan order.

This includes:

- Component: `components/workday/workday-task-popover.tsx` — 280–360px wide. Header: 8px category dot + task title (13.5px / 600), small muted "Project · Category" line. Entry rows: grid `96px 48px 1fr auto` — `09:00–10:30` (mono) · `1.5h` (mono muted) · note (truncates) · billable dot. Footer: hairline + "Total today" label + bold mono total. Animation: opacity 0→1 with 2px slide, 120ms.
- Open delay: 200ms — prevents popover spam when scanning across boxes.
- Click box body: push `?task=<taskId>` (uses existing `useTaskDetail` URL-driven hook).
- Click an entry row: push `?task=<taskId>&entry=<entryId>`. The drawer's Time tab reads `entry` and scrolls/highlights that row. If the drawer-side `entry` param isn't ready, opening the drawer at the task is acceptable for v1 (PRD open question 1).
- Drawer `taskIds` prop: pass the visible week's task IDs (de-duplicated, sorted by first appearance — earliest `firstStart` across the visible grid). This makes prev/next step through tasks in the scan order the user actually sees.

## Acceptance criteria

- [ ] Hovering a box opens the popover after a 200ms delay; moving away cancels the open.
- [ ] Popover header shows category dot + task title + "Project · Category" line.
- [ ] Entry rows render `start–end` (HH:MM 24-hr), duration, note (truncates), billable dot.
- [ ] Footer shows "Total today" + summed total in tabular monospace.
- [ ] Clicking a box body pushes `?task=<taskId>` and the existing task drawer opens.
- [ ] Clicking an entry row pushes `?task=<taskId>&entry=<entryId>`. Drawer opens (entry-scroll wired if the drawer supports it; otherwise opens at the task — PRD acceptable).
- [ ] Drawer's prev/next steps through the visible week's task IDs in scan order (earliest `firstStart` first), de-duplicated.
- [ ] Visual diff against `docs/workday-prototype.html` for the popover is near zero.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Blocked by

- Blocked by #01 (boxes exist and are clickable)

## User stories addressed

- 13 (hover reveals entries)
- 14 (200ms delay)
- 15 (click → task drawer)
- 16 (click row → drawer scrolled to that entry, nice-to-have)
- 17 (drawer prev/next steps through visible week's tasks)

## Notes

- **shadcn check** — `HoverCard` / `Tooltip` / `Popover` may have current API shifts; verify before composing.
- **`useTaskDetail` is the existing URL-driven hook** — don't fork it; reuse exactly.
- **Drawer integration:** `taskIds` is computed from the page's `data.users[].days[].boxes`. De-dupe and sort once at the page level, not per-row.
- **Entry-deep-link is gated by drawer support** — if the drawer doesn't read `entry` yet, ship the popover row click as `?task=<taskId>` only and note in the PR that this is the v1 acceptable fallback per PRD §"Open Questions" item 1.
