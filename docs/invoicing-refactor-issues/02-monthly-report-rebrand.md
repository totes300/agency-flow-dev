# 02 — Monthly Report rebrand + in-progress support + `/reports` removal

**Type**: AFK
**Blocked by**: none (parallelizable with #01)
**Unblocks**: #03 (cutover)

## Parent PRD

[`docs/invoicing-refactor.md`](../invoicing-refactor.md) — § Solution, D4, D6, D8, D11, D13, Open Questions 1–3, Module Design (`getRetainerMonthlyReport`, `MonthlyReportDocument`)

## What to build

The unified rule for the **report side** of the refactor: every closed retainer period the owner cares about can be rendered on demand as a "Monthly Report" — never persisted, never numbered, never an AMOUNT DUE — and the document is unmistakably not-a-bill so the client's AP team won't process it. Includes in-progress month support for the owner's mid-cycle sanity check, the Stripe disclaimer on the report document, and the deletion of the now-defunct `/reports` global route.

End-to-end vertical:

### Backend (Convex)
- Monthly report query (currently `getRetainerStatement`):
  - Accept the **current month** in addition to past months. Future months → `null`.
  - Add `inProgress: boolean` to the response (true for the current month, false for closed months).
  - Continue to return: balance breakdown, billing summary with fee as **context only** (no AMOUNT DUE), cycle-to-date totals when applicable, brand, parties, billable category groups, linked invoice pointer when an overage invoice exists for the period.
  - Per Open Question 1: keep the server symbol name as-is to minimise churn, OR rename to `getRetainerMonthlyReport` if it lands cleanly. Decide during implementation.

### Frontend
- Rename `StatementDocument` → `MonthlyReportDocument`. Header text: **"Monthly Report"** (D8 — replaces "Activity Statement").
- Drop the AMOUNT DUE block from the report document entirely. The report never renders an amount-to-pay.
- Render the activity summary (used / included / balance, plus cycle-to-date for rollover projects) prominently.
- Add the Stripe disclaimer context line to the report document ("Monthly retainer fee — $X/mo — billed separately via Stripe").
- "In progress — partial data" badge on the report document when the response has `inProgress: true`. Per Open Question 3: badge only — no other UI affordance (no disabled Download button).
- Per Open Question 2: rename the route URL `/projects/[id]/statements/[period]` → `/projects/[id]/reports/[period]` for terminology consistency end to end. Dummy-data only, so URL change is cost-free. Update any in-app links accordingly.
- Owner-facing trigger: clicking "Download report" on a Monthly Breakdown row (within-budget, in-progress, or any closed period for sanity check) opens the report URL **in a new browser tab** so the owner can use the browser's native Print → Save as PDF dialog (per user story 18).
- Delete the `/reports` global route page and remove the corresponding nav entry from `lib/navigation.ts` (D13).

### Tests
- New test in the report query test file: in-progress (current) month returns data with `inProgress: true`. Future month returns `null`. Closed month returns data with `inProgress: false`.
- Pure-presentation components (`MonthlyReportDocument`, in-progress badge) — visual-only, no unit test, manual smoke per the verification checklist.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run` — all tests pass; the new in-progress test covers the three branches above.
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` clean.
- [ ] Report document header renders **"Monthly Report"** (no "Activity Statement", no "Invoice", no "Statement").
- [ ] Report document has **no** AMOUNT DUE block under any branch.
- [ ] Report document renders the Stripe disclaimer context line.
- [ ] Opening the report URL for the **current month** renders the report with the "In progress — partial data" badge visible.
- [ ] Opening the report URL for a **future month** returns Not Found (or null + a friendly empty state).
- [ ] Opening the report URL for a closed month renders without the badge.
- [ ] Rollover projects display both this-month usage AND cycle-to-date totals when the report is for a mid-cycle month (user story 17).
- [ ] "Download report" on the Monthly Breakdown opens in a new tab.
- [ ] `/reports` global route is deleted from `app/(dashboard)/`. The nav entry is removed from `lib/navigation.ts`. Direct URL → 404.
- [ ] If the route URL was renamed (`statements` → `reports`), no in-app link still points at `/statements/`. `rg "statements\\["` and `rg "/statements/"` return only intentional / dead-code-free matches.

## User stories addressed

- 7 (header is "Monthly Report")
- 15 (view report for any closed period)
- 16 (in-progress month + badge)
- 17 (mid-cycle rollover shows both monthly and cycle-to-date)
- 18 (open in new tab → browser print → PDF)
- 19 (per-project surface; no global queue — the global queue is what's being removed in `/reports`)
- 26 (client receives a Monthly Report titled clearly, not prompted to pay)
- 27 (report and invoice share brand identity)

## Notes

- This slice is parallel-safe with #01: the monthly report query, document, route rename, and `/reports` deletion do not touch invoice math or the Ready feed builders.
- Stripe disclaimer text is hardcoded from project config (`monthlyFee`, `currency`). No Stripe API integration. Per D11.
- No `monthlyReports` / `sentReports` tables — reports are pure on-demand renders per D4. Auto-send (Resend) is Future, not in this slice.
- Backdated time-entry edits re-render live on every report view (D7) — no period locking. Verify by editing a closed-period entry and reloading the report.
