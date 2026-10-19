# 07 — Client documents (carried grouping, stamp-based reads)

## Parent PRD

`docs/prd-month-close.md` — sections: Core invariants (I4), User Stories (Client-facing
documents), Implementation Decisions (commit integration → report), Open Questions (carried copy).

## What to build

Make the client-facing story honest and stable. Demo: a July report/invoice showing a "Carried
over from June" group with true June dates; the June report not containing those entries; a
backdated insert after close changing nothing on the delivered June report.

- Monthly report reads membership from settlement stamps for closed periods (never re-derives from
  dates); open-period previews use `billingScope` (consistent with the workspace).
- "Carried over from <month>" group on the monthly report and the invoice work breakdown, entries
  listed with their true dates.
- v1 copy: a single "Carried over from <month>" label for both carried reasons (the internal model
  keeps the distinction; client-side differentiation deferred per the PRD's open question).

## Acceptance criteria

- [x] Closed-period report output is a pure function of settlement stamps: `computeReportMonths`
      maps a settled entry to `settledPeriodStart`'s month; a backdated open insert resolves to the
      first open period, never a closed one (unit test `reportMembership.test.ts` "stability").
- [x] Each entry appears on exactly one client document lineage. **Browser-verified**: skipped an
      Arlow June entry → June's report drops it (task = 00:20, used 12:50) and July's report shows
      it in "Carried over from June 2026" (used 08:35) with its true June date.
- [x] Carried group renders on the **monthly report** matching existing typography (reuses
      `CategorySection`). **Invoice work-breakdown carried grouping is deferred** — the invoice
      document renders from stored `invoiceLineItems`, which carry no per-entry origin month; the
      carried WORK is already correctly *billed* (slice 06 puts carried entries in the line items),
      only the visual "Carried over" separator on the invoice doc is not added (needs line-item
      metadata — tracked in backlog).
- [x] Open-period report preview uses the same `billingScope` membership as the workspace
      (`resolveEntryPeriods` effective period). Verified via the July (current-month) round-trip.
- [~] Worksheet/CSV exports — **deferred**: they still enumerate by date range. The report (the
      client-facing document) is the priority; the worksheet is an internal export. Tracked in
      backlog.
- [x] `npx tsc --noEmit` clean; eslint clean; 712 convex tests pass (only the pre-existing
      `taskActivityIndicators` time-flake fails).

## Blocked by

- Blocked by 06 (`06-commit-integration.md`). May run in parallel with 08.

## User stories addressed

- User stories 31, 32.
