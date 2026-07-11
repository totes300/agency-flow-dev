# 00 — Shell split + workspace switch + empty rail

**Type:** AFK · **Blocked by:** none — can start immediately
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Implementation Decisions › Full-screen workspace*, *UX decisions › Rail structure / First-run*, *Further Notes › dashboard-shell split*

## What to build

The load-bearing structural refactor, shipped alone and verified before any agent logic exists. Split the dashboard route group so `/agents` gets its own full-screen layout outside the shared shell (no dashboard header, no `md:px-12` padding). Add the workspace switch: a compact two-icon segmented toggle at the very top of the sidebar (above the team switcher), present symmetrically in **both** shells, so App UI ⇄ Agents is always one click each way. Inside the workspace, render the three-zone skeleton: left rail (Agents section + Recent threads section, both with empty states), empty center pane, no canvas yet.

No schema, no Convex functions, no agent anything — this slice is pure layout plumbing plus the switch. It cuts through routing → layout → navigation → empty-state layers end-to-end.

## Acceptance criteria

- [ ] `/agents` renders a full-height, full-width layout with no dashboard header/breadcrumb/padding.
- [ ] The two-icon toggle appears at the top of the sidebar in the app shell AND at the top of the workspace rail; clicking flips between the two worlds and back.
- [ ] The switch does not appear inside modals/drawers and `lib/navigation.ts` is not forked (the switch is layout chrome, not a nav item).
- [ ] Rail shows an Agents section and a Recent threads section, each with a dedicated empty-state component ("No threads yet — pick an agent to start").
- [ ] Every existing dashboard page still renders identically (spot-check tasks, planner, invoices, settings) — the route-group split changes nothing outside `/agents`.
- [ ] Content-aware skeleton for the workspace while auth/data boots.
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 1 (workspace switch), US 2 (dedicated full-screen layout), US 5 (empty states — partial, no data yet)
