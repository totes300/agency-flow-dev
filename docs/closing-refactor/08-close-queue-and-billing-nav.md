# 08 — Close queue + Billing nav rename

## Parent PRD

`docs/prd-month-close.md` — sections: Solution (stage 1), User Stories (Queue block), UX Decisions
(layout, search & filter, states, responsive), Implementation Decisions (Naming and navigation).

## What to build

The front door of the ritual. Demo: open Billing → Close, see month-grouped flat rows with
progress and flag counts, review-and-close a period end-to-end from the queue, watch the row flip
to "Drafted · INV-xxx", the month progress advance, and the badge decrease.

- Rename nav Invoices → Billing (navigation module is the single source; route renamed to
  /billing, invoice document URLs unchanged). Tabs: Close (replaces Ready), Drafts, Outstanding,
  Paid, Void.
- Extend the existing ready-row enumeration with flagCount, entryCount, and disabledReason; keep
  feeding the sidebar badge from the same pass (badge and tab can never disagree).
- Month-grouped flat rows per UX Decisions: collapsible month headers with "N of M closed" +
  month total; single-line rows (project + muted client, type dot + muted text, colored hours,
  "N to review" muted, right-aligned amount, hover-revealed quiet Review button → workspace).
- Oldest-first blocked rows: full data, un-dimmed, CTA slot shows muted "Close <period> first".
- Ghost search + Notion "+ Filter" faceted pattern (client, billing type, readiness),
  URL-persisted, no default filter, no permanent chips.
- Remove the one-click Generate from list rows; redirect the T&M "Invoice Unbilled Hours" button
  and the Time-tab bulk-selection invoice path to the corresponding Close workspace (no bypass of
  the scope rule).
- Drafted/closed periods leave the Close tab; their outcome is visible via Drafts/Outstanding as
  today, and just-committed rows show "Open draft" / "Open report" affordances per the prototype.
- Empty state ("All caught up — nothing to close this month"), content-aware skeleton,
  desktop-first reflow.

## Acceptance criteria

- [x] Nav shows Billing (admin-only, unchanged badge component); /billing route serves the hub;
      old list URL redirects; invoice document URLs untouched.
- [x] Close tab lists every open, elapsed period across projects, grouped by month with progress
      and month totals; enumeration extensions covered by the pure `closeQueue` test suite.
- [x] Badge = actionable count from the same enumeration pass + overdue — `getCloseQueue`
      reuses the same `enumerateReadyRows` pass that feeds `getInvoicingNavSignals`, so
      `actionableCount` == the badge total (verified 9==9; badge itself asserted by the existing
      nav-signals suite).
- [x] Row anatomy and blocked-row treatment match UX Decisions exactly; Review opens the workspace.
- [x] Search + faceted filters work, persist in URL, and cross-filter with counts; no default
      filter.
- [x] No remaining UI path creates an invoice without passing through the Close workspace
      (one-click Generate removed; T&M paths redirected).
- [x] Dedicated empty state and content-aware skeleton; loading→empty→content order.
- [x] Desktop-first: queue reflows readably on narrow viewports (type/readiness columns hide on
      sm/md); workspace links still work.
- [x] `npx tsc --noEmit` clean.

## Blocked by

- Blocked by 06 (`06-commit-integration.md`). May run in parallel with 07.

## User stories addressed

- User stories 1, 2, 3, 4, 5, 6, 29 (queue side).
