# 03 — Timesheet deterministic tool + table block

**Type:** AFK
**Blocked by:** 01
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Timesheet agent specifics*, *Module 6*, *UX decisions › Formatting*

## What to build

The deterministic half of the Timesheet agent, end-to-end: a net-new `collectTimesheetData(clientId, period, filters?)` tool that loops the client's projects over the existing per-project worksheet collector and adds the **category→columns pivot**, plus the `table` block renderer that shows the result in the chat. No AI columns yet — the point is proving billing-grade numbers through the full stack first.

Scope:
- `collectTimesheetData`: client + period (month or date range), optional project/category/billable filters; per-task rows with first/last worked dates, per-category minutes, per-row totals, grand totals; each row also carries the Phase 9 AI-input payload (used by slice 05, unused here).
- Register it in the tool registry (admin scope — the underlying collector is admin-gated; the tool must not bypass that).
- Seed the **Timesheet Generator** agent (replacing/upgrading the tracer test agent) with instructions + this tool.
- `table` block renderer: read-only grid using the app's table tokens, deterministic cells in the slice-02 determinism treatment (tabular-nums), totals row; all numbers/dates through the shared format helpers — never model strings.
- Vitest: the category→columns pivot and totals math (pure functions) — billing-grade, so tested.
- Empty-period behavior: agent states there's no data; no empty table emitted.

## Acceptance criteria

- [ ] Asking the Timesheet agent for a real client + month yields an in-chat table: per-task rows, hours per work category as columns, row totals, grand total.
- [ ] Every hour cell equals the deterministic query — spot-checked against the project overview for at least two projects.
- [ ] Filters (project / category / billable) narrow the table correctly when asked for.
- [ ] A period with no entries produces a prose "no data" answer, not an empty table.
- [ ] A member running an agent with this tool cannot reach the data (admin scope enforced at both registry and function level).
- [ ] Pivot + totals covered by passing Vitest unit tests.
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 9 (in-chat tables, verbatim numbers), US 18 (determinism law), US 29 (partial — deterministic columns of the timesheet), US 32 (spot-checkable hour cells)
