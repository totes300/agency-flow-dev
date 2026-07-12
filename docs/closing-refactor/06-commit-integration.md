# 06 — Commit integration (Generate / Close & report)

## Parent PRD

`docs/prd-month-close.md` — sections: Solution (stage 3), Core invariants (I3, I4), User Stories
(Commit block), UX Decisions (flow & navigation), Implementation Decisions (Scope and money).

## What to build

The commit point — the only slice that touches existing money mutations, which by now consume a
fully proven scope module. Demo: full happy path — review Arlow June, Generate, land in the
invoice editor with exactly the reviewed entries; SEED within-budget close stays in the queue
context with a toast.

- Topbar commit summary + single primary button, flipping live between "Generate invoice draft ·
  $X" and "Close & report" as edits move the period across the budget line.
- Route entry selection in `createInvoice`, `closePeriodInternal`, and `closeRetainerCycle`
  through `billingScope`, re-derived **server-side at commit time**; retainer snapshot computed
  from scope usage. External contracts of these mutations unchanged.
- Stale-draft refresh respects skip stamps.
- Oldest-first (I3) enforced server-side with a typed error.
- Blocking/warning rules: missing overage rate blocks Generate (settings link); running timer
  warns but never blocks.
- Hybrid post-commit navigation per UX Decisions: Generate → invoice editor; Close & report →
  back to the Billing list with a toast carrying an "Open report" link.

## Acceptance criteria

- [ ] Commit re-derives scope server-side; client-provided ids/amounts are never trusted
      (attempted mismatch is ignored/rejected — test).
- [ ] Generated draft's line items and stamped entries equal the scope exactly (skipped entries
      excluded from `invoiceId` stamping and from settling in all paths — tests per billing type).
- [ ] Close & report settles exactly the in-scope entries (incl. non-billable per I2), excluding
      skipped ones; skipped entries remain open with stamps intact.
- [ ] Oldest-first violation returns a typed error and the UI communicates it; zero-scope retainer
      close succeeds as within-budget.
- [ ] Missing overage rate blocks Generate with a settings link; running timer shows a warning and
      commit proceeds if chosen; the timer's later entry resolves as `logged-late` (test).
- [ ] Hybrid navigation implemented exactly per amended story 26.
- [ ] Double-commit / concurrent-commit rejected by existing gates; UI refreshes safely.
- [ ] Draft delete and invoice void return the period to closable state with entries unlocked and
      skip stamps intact (extend existing unsettle tests).
- [ ] Existing invoice/retainer suites extended with skip/carried/late-entry commit scenarios; all
      suites green; `npx tsc --noEmit` clean.

## Blocked by

- Blocked by 04 (`04-review-checklist.md`) and 05 (`05-skip-to-next-close.md`).

## User stories addressed

- User stories 24, 25, 26, 27, 28, 29 (workspace side), 30, 33, 34, 35.
