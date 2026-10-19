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

- [x] Commit re-derives scope server-side via `computeCommitScope` + `selectCommitEntries`; the
      workspace commit sends only `{projectId, period}` — never entry ids or amounts. Path B
      (explicit ids) and ad-hoc T&M ranges keep the legacy date filter; whole-month T&M + all
      retainer route through `billingScope`.
- [x] Generated draft's line items + `invoiceId` stamps equal the scope exactly.
      **Browser-verified**: Arlow April → $860 (20h45m, full scope); after skipping the 8h entry →
      **$220 (12h45m)** — the skipped entry is absent from the invoice's Work Breakdown and stamps.
- [x] Close & report (`closePeriod`/`closeRetainerCycle`) settles exactly the in-scope entries
      (incl. non-billable per I2) via `selectCommitEntries(scope).settleEntryIds`; skipped entries
      are not in scope so stay open; carried-in entries settle into the RECEIVING period's boundary
      (cycle: natural month, or first month for carried — per-month reopen preserved).
- [x] Oldest-first (I3): `createInvoice` / `closePeriod` / `closeRetainerCycle` throw a typed error
      on `not-earliest-open`; the workspace disables the button with "Close the earlier open period
      first." **Browser-verified** (June disabled while April open). Zero-scope retainer close
      succeeds within-budget (`selectCommitEntries` returns empty sets → closePeriodInternal closes
      the period, settles nothing).
- [x] Missing overage rate blocks Generate (`CloseCommitButton` shows "Set rate" → project
      settings when `issues` has `missing-overage-rate`); running timer is checklist-warning only,
      never a commit blocker (it's not in `scope.issues`).
- [x] Hybrid navigation (amended story 26): Generate → invoice editor (`/invoices/<id>`);
      Close & report → `/invoices` + success toast with an "Open report" action.
- [x] Double-commit / concurrent-commit rejected by the existing resume/duplicate gates + the
      commit-time open-guard in `closePeriodInternal`; the reactive query refreshes the view.
- [x] Draft delete returns the period to closable (existing unsettle path unlocks entries; skip
      stamps are untouched). **Browser-verified** (delete → April back to $860 open).
- [x] `commitScope.test.ts` added; existing invoice/retainer/settle suites all green (106 in the
      commit-critical set; 707 across all convex suites — only the pre-existing time-dependent
      `taskActivityIndicators` flake fails). `npx tsc --noEmit` clean; eslint clean.

## Blocked by

- Blocked by 04 (`04-review-checklist.md`) and 05 (`05-skip-to-next-close.md`).

## User stories addressed

- User stories 24, 25, 26, 27, 28, 29 (workspace side), 30, 33, 34, 35.
