---
title: Today-first layout — what exactly gets demoted, and how
labels: [wayfinder:prototype]
status: closed
assignee: claude (prototype session, 2026-07-19)
blocked-by: []
---

## Question

In the "mai terv elöl, többi tompítva" model, how exactly are the non-Today parts
of My Tasks demoted? Prototype (via `/prototype`) against realistic density
(the owner's real screen: 0 Today, 11 Earlier, 5 In progress) and react with the
owner. Resolve at least:

- Earlier and the status groups: collapsed by default? dimmed? behind a
  toggle/tab? What expands them, and does that state persist?
- **Duplication**: a task can appear in Earlier AND its status group at once
  (e.g. "Teso" shows twice today). Show once, or keep both with demotion?
- What does the completed-today group do in the new layout?
- What does the screen look like when Today is empty (the current empty state
  pushes Earlier below the fold — is that right, or should Earlier step up)?

Constraints from the map Notes: quiet ghost toolbar controls, counts as muted
text, no permanent property chips, no silent hiding that makes an empty state
lie (see `feedback_time_entries_no_default_filter` for the spirit).

## Assets (prototype built 2026-07-19, awaiting owner reactions)

- **Live prototype** on the real `/my-tasks` route with real data, per the
  /prototype skill (sub-shape A): `components/my-tasks/prototype/` +
  a gate swap in `app/(dashboard)/my-tasks/page.tsx`. Switch with
  `?variant=a|b|c` or the floating bottom bar (←/→ keys). Dev-only; throwaway.
  - `a` — Collapsed stack: Today hero, divider, everything else as quiet
    collapsed one-liners; Earlier deduped out of status groups.
  - `b` — Dimmed inline: everything visible but non-Today sections dimmed
    until hovered; deduped; tiny uppercase section caps.
  - `c` — Today / All work: quiet toggle; Today tab = plan + one-line Earlier
    nudge; All work = full current truth (duplicates kept on purpose).
  - All three: compact one-line Today empty state (a/b) so Earlier isn't
    pushed below the fold; no drag-reorder or per-group inline add (not the
    question).
- **Static preview** (no dev server needed): [assets/layout-mockup.html](../assets/layout-mockup.html)
  — same structures with the owner's real task names, tab-switchable.

## Owner reactions (2026-07-19)

- Round 1: **C (Today / All work) is the favourite** — navigation-based
  demotion wins over collapse (A) and dimming (B). Open follow-up from the
  owner: should every section (Earlier, Backlog, In progress, Review) be its
  OWN tab instead of one combined "All work"? Would separate better?
- → Built **variant D — Section tabs** for a live comparison (`?variant=d`,
  also in the static mockup): Today | Earlier | <each status group> | Done
  today, tabs derived from the real groups, counts as muted text. Duplicates
  across tabs kept (Teso in Earlier AND In progress) — decide on reaction.
- Still to decide before closing: C vs D; duplicate handling in the chosen
  shape; whether tab choice persists; Done-today placement.
- Round 2: owner asked for the hybrid — C's two-tab structure with
  **collapsible section headers inside All work**. → Built **variant E —
  Tabs + collapsible** (`?variant=e`, also in the static mockup): Today /
  All work toggle from C; inside All work every section is a quiet
  collapsible one-liner (A's header style) — Earlier and status groups
  default OPEN (overview preserved), Done today defaults closed.
  Duplicates still kept (Teso in Earlier + In progress) — decision pending.
- Round 3: owner proposed **Today | Earlier | All work** — Earlier promoted to
  its own tab because "we already started those" (it's plan-debt, not a status
  group). → Built **variant F** (`?variant=f`, also in the static mockup):
  three quiet tabs; Today's nudge now points at the Earlier tab; All work =
  pure status overview with E's collapsible sections. This resolves the
  duplication question BY MEANING: Earlier tab = plan leftovers, All work =
  status truth; overlap flagged on section headers as "· N in Earlier".
  Accepted risk: Earlier tab reads 0 on good days — honest and rewarding, not
  a lying empty state.

## Resolution

**Winner: variant F — Today | Earlier | All work** (owner verdict, 2026-07-19,
round 4). The decided layout, liftable into the spec:

- **Three quiet ghost tabs**, counts as muted text: Today | Earlier | All work.
  No pills, no colored badges on tabs.
- **Today tab** = the plan: rows + inline add + (when Earlier > 0) a one-line
  nudge pointing at the Earlier tab. **Done-today lives HERE** as a quiet
  "Done" block at the bottom of the Today tab — completing a task keeps the
  ceremony on the tab where the work happened. Done is NOT a tab and NOT in
  All work. No duplicated section header — the tab itself is the header.
- **Earlier tab** = plan debt ("we already started these"): age chips +
  move-to-today sun, explainer line, honest 🎉 zero state. Rows render **full
  color** — the opacity-55 demotion was an inline-section device and is wrong
  in a dedicated tab (owner: "tiszta hülyeség" half-faded).
- **All work tab** = pure status overview: collapsible quiet section headers,
  **default OPEN** (owner verdict); overlap flagged as "· N in Earlier" /
  "· N in Today" header hints. Duplication resolved by meaning (Earlier =
  plan leftovers, All work = status truth).
- **One left alignment line**: every row and header starts on the same gutter.
  The production `lg:-ml-6` drag-handle gutter + Earlier spacer offsets must
  be re-solved deliberately during implementation (drag handles, if kept,
  hang in a reserved gutter — rows never indent per-section).

Carried to the spec ticket (not re-decided here): tab choice does NOT persist
— My Tasks always opens on Today (it's the daily ritual); mobile behavior of
the three tabs; whether per-group inline add returns inside All work.
