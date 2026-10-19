# 02 — Close workspace, read-only tracer

## Parent PRD

`docs/prd-month-close.md` — sections: Solution (stage 2), UX Decisions (layout, states,
responsive), Module Design (Close workspace surface).

## What to build

The first end-to-end visible slice: a full-page, admin-only Close workspace addressable by
project + period start, rendering one period's scope report **read-only**. Demo: open the Arlow
June close and see the raw ledger exactly as in the approved prototype — no editing, no commit yet.

- New route + Convex query that composes `billingScope` server-side and returns the scope report
  (entries grouped by task, budget numbers, carried info, issues).
- Header: period title, project meta line, inline budget summary
  (Included · Logged · Balance · Overage × rate = amount), raw-ledger note ("nothing is rounded
  here… nothing locks until commit").
- Task-grouped lean entry rows per UX Decisions (date, note, member avatar, duration, amount,
  category dot); task title opens the existing task peek.
- Carried-in entries show the inline muted "carried · <month>" label with a reason tooltip.
- Calculation-row style table footer (total logged, over/within budget).
- States: content-aware skeleton, zero-scope state per UX Decisions, error handling.

## Acceptance criteria

- [x] Workspace is deep-linkable by project + period start; admin-only; back navigation returns to
      the Billing list; works for retainer-monthly, retainer-cycle, T&M, and fixed periods.
      (Verified live: Arlow retainer June over-budget $1,867, T&M open Pragmatico May $200 matching
      the Ready feed, T&M closed April rendering the historical settled ledger via I4, Fixed
      $3,750 remaining fee matching Ready.)
- [x] All displayed numbers come from the `billingScope` report — no date math in the UI layer
      (the route/components only format; the query composes `computeBillingScope` server-side).
- [x] Raw, unrounded values everywhere; the ledger note is present ("Raw hours — nothing is rounded
      here, and nothing locks until you commit.").
- [x] Lean rows per UX Decisions; no invoice-number / billing-status / rate columns.
- [x] Task peek opens from task titles without leaving the workspace (reuses `TaskDetailDrawer` via
      the `?detail=` param).
- [x] Carried labels render with correct reason (`CarriedLabel` component; `skipped` cannot occur
      until slice 05, `logged-late` renders via I4 for late entries — logic proven by slice-01 tests).
- [x] Skeleton mirrors the real layout (budget line + task group); zero-scope state shows the
      budget line at zero + gray callout; loading→empty→content order respected.
- [x] Page file is a thin orchestrator; sections are components under `components/billing/`;
      `npx tsc --noEmit` clean; eslint clean.

## Blocked by

- Blocked by 01 (`01-billing-scope-core.md`).

## User stories addressed

- User stories 7, 8, 9, 11, 15 (display part), 16 (read path).
