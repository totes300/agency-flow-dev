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

- [ ] Closed-period report output is a pure function of settlement stamps — backdated inserts and
      later edits to open entries change nothing (story 32 stability test).
- [ ] Each entry appears on exactly one client document lineage: origin month omits skipped
      entries; receiving month shows them in the carried group with true dates (test).
- [ ] Carried group renders on both the monthly report and the invoice work breakdown, matching the
      document's existing typography (no new visual language).
- [ ] Open-period report preview equals the workspace's scope for the same period (consistency
      test).
- [ ] Worksheet/CSV exports that enumerate period entries follow the same membership source
      (stamps for closed, scope for open).
- [ ] `npx tsc --noEmit` clean.

## Blocked by

- Blocked by 06 (`06-commit-integration.md`). May run in parallel with 08.

## User stories addressed

- User stories 31, 32.
