# 03 — Cutover: DB wipe + reseed + verification + backlog

**Type**: HITL
**Blocked by**: #01, #02
**Unblocks**: nothing (final cutover)

## Parent PRD

[`docs/invoicing-refactor.md`](../invoicing-refactor.md) — § Migration, § Verification (Definition of Done), § Backlog tracking, § Out of Scope

## What to build

Final cutover for the refactor: wipe the dummy DB so no `retainer_fee` line items remain, reseed via the existing seed script with realistic data covering every scenario row in the per-project-type behavior table, run the full Verification (Definition of Done) checklist end-to-end, and update `docs/backlog.md` with this refactor's tasks plus the explicit "TODOs deferred to later phases" list.

This is HITL because the wipe is destructive (even on dummy data) and the verification list requires manual smoke testing across every retainer scenario.

### Migration steps
1. Confirm with the user that the dev/dummy data is OK to wipe. (No production migration concerns — `project_mvp_dummy_data.md` memory: dummy data only.)
2. Wipe `invoices`, `invoiceLineItems`, `retainerPeriods` via the Convex dashboard.
3. Reseed via the existing seed script. Verify the seed covers, at minimum:
   - A retainer (monthly, no rollover) with a within-budget closed month → no Ready row, Monthly Report renders.
   - A retainer (monthly, no rollover) with an over-budget closed month → Ready row with overage amount.
   - A retainer (rollover-enabled) mid-cycle → no Ready row even with mid-cycle overage, Monthly Report renders with cycle-to-date.
   - A retainer (rollover-enabled) at cycle-end with cycle overage > 0 → single Ready row covering full cycle range.
   - A retainer (rollover-enabled) at cycle-end fully within budget → no Ready row, cycle-end Monthly Report renders.
   - A T&M project with billable hours → unchanged Ready behavior.
   - A Fixed-price project with remaining balance → unchanged Ready behavior.
   - At least one retainer with the **current** in-progress month so the "In progress — partial data" badge can be verified.

### Verification checklist (Definition of Done from PRD)
Run each manually after the wipe + reseed.

- [ ] `npx tsc --noEmit` returns 0 errors.
- [ ] `npx vitest run` — all updated and new tests pass.
- [ ] `npm run build` succeeds.
- [ ] DB wipe + reseed verified: no `retainer_fee` line items remain. (`rg "retainer_fee"` zero matches; query `invoiceLineItems` for the literal returns empty.)
- [ ] Zero retainer rows in `/invoices` Ready for within-budget projects.
- [ ] `/invoices` tabs (Ready / Draft / Sent / Paid / Overdue) all render and function as before.
- [ ] Monthly Report download works for every closed retainer period (mid-cycle and cycle-end, rollover and non-rollover).
- [ ] Monthly Report renders for in-progress current month with "In progress — partial data" badge.
- [ ] Stripe disclaimer line visible on retainer Project pages.
- [ ] Generate invoice: clicking Ready row → lands on draft page (no modal).
- [ ] Within-budget rows on Monthly Breakdown card show only "Download report" — no Generate invoice.
- [ ] Overage rows on Monthly Breakdown card show only "Generate invoice" (or invoice number link if billed) — no secondary statement download.
- [ ] Voiding an overage invoice causes the period to reappear in Ready. Voided invoice remains visible in the Voided tab with audit trail.
- [ ] T&M and Fixed Price flows demonstrate no behavioral change vs. pre-refactor.
- [ ] `/reports` global route removed from nav and unreachable via URL (404).

### Backlog update (`docs/backlog.md`)
Per `CLAUDE.md` — "Backlog tracking is mandatory". Add a new section for this refactor with:

- Task-level checkboxes mirroring the module changes from #01 and #02 (so the backlog is the durable record of what shipped).
- The verification checklist above (carried over so future audits can re-run it).
- A "TODOs deferred to later phases" section explicitly listing:
  - One-click "Send" via Resend (auto-send reports and invoices).
  - Period locking when reports are downloaded or sent.
  - Cross-client global "monthly reports queue" view.
  - Pro-rated included budget for partial months.
  - Stripe webhook for payment-date display + payment reconciliation.
  - `/reports` analytics view (revenue mix, margin, utilization) — to be re-introduced when demand emerges.
  - Credit notes (currently handled by void + re-create).
  - Statement / report sent-tracking entity.

## Acceptance criteria

- [ ] All 13 verification checklist items above pass.
- [ ] Seed data covers every scenario row enumerated in the migration steps.
- [ ] `docs/backlog.md` contains the new refactor section with checkboxes, verification list, and the deferred-TODOs list above.
- [ ] No `retainer_fee` literal remains in DB or codebase.

## User stories addressed

- 12 (void overage invoice → period back to Ready)
- 13 (voided invoice visible in Voided tab with audit trail)
- 14 (back-dated time entries reflect on next render — live truth, no locking)
- 20 (`/invoices` tab structure preserved)
- 29 (pro-rated months: full bucket, logged as known limitation)
- + the full Verification (Definition of Done) list from the PRD

## Notes

- Coordinate the wipe with the user before running it, even on dummy data — multi-agent worktree means someone else may be mid-task. Per `CLAUDE.md` git-safety rules, the same caution applies to destructive DB ops.
- The seed script likely needs new fixtures for the in-progress-month scenario and the rollover cycle-end scenarios. If gaps are found, extend the script as part of this slice rather than punting to a follow-up.
- Voided-invoice → reappears-in-Ready is verified here even though the underlying behavior was implicit in #01 (Ready computation reads invoice status). This is the first slice where it can be exercised against seeded data.
