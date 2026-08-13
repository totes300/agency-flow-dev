---
title: My Tasks row anatomy — title-dominant row, demoted category badge
labels: [wayfinder:prototype]
status: open
assignee:
blocked-by: [01-today-first-layout-prototype.md]
---

## Question

What is the My Tasks row's anatomy so the **title dominates** and the category
badge stops distorting the card's proportions? Fresh prototype round (via
`/prototype` + `frontend-design`/`emil-design-eng` skills), NOT a mechanical
application of the earlier approved badge hierarchy — though it is the natural
starting point (status = pill, category = color dot + muted text, project =
plain text).

Resolve: placement/weight of status, category, project, due date, comment count,
time counter, and the sun affordance on a row; hover vs persistent elements;
density difference (if any) between Today rows and demoted-section rows.

Hard constraints (standing feedback, 2 strikes): no bordered pills, no
primary-filled badges, Linear-style filled icons over pills. Blocked by the
layout prototype because the density decision shapes the row.

Inputs from the closed layout ticket (now UNBLOCKED): the decided layout is
Today | Earlier | All work tabs. Owner already flagged row-level issues during
the layout rounds — fold them in here: (1) **every row starts on one left
line** — kill the `lg:-ml-6` gutter + per-section spacer offsets, re-solve
drag-handle placement deliberately; (2) completed rows' right-edge columns
(checkbox/time) don't align perfectly — audit the fixed-width column grid;
(3) NO opacity-dimming as demotion on Earlier rows (dedicated tab renders
full color) — if demotion is ever needed again it must not be opacity-on-text.
