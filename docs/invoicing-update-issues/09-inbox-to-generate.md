# 09 — Inbox: To-generate section + `getReadyToInvoiceUnified` + batch generate

**Type**: HITL
**Blocked by**: #04 (`createInvoice` extension — auto-Paid path used by batch; resume-existing used by per-row)
**Unblocks**: #11 (Inbox shell composes this), #12 (sidebar count reads same query), #13 (deletes legacy `getReadyToInvoice`)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #2, #4, #8 · User stories 12–20, 49
**Visual reference**: `docs/invoicing-update.md` § Inbox · `prototypes/invoicing-final.html`

## What to build

End-to-end: a unified Convex query, a batch mutation, a UI section.

### Backend

**Query: `getReadyToInvoiceUnified` (admin-only, tested)**

Returns one row per pending billing unit across **all** projects in the org. Replaces retainer-only `getReadyToInvoice` (the old query is deleted in #13 once all callers migrate).

Row shape:
```ts
{
  kind: "retainer-monthly" | "retainer-cycle" | "fixed" | "tm",
  projectId: Id<"projects">,
  projectName: string,
  clientName: string,
  period?: { year: number; month: number; cycleId?: Id<"retainerPeriods"> },
  amount: number,
  currency: string,
  badgeKind: "within-budget" | "over-budget" | null,
  overageHours?: number, // when badgeKind === "over-budget"
  lastInvoicedAt: number | null,
}
```

Rules per project type:
- **Fixed**: row when `remaining > 0` AND no draft invoice already exists for the remaining slice. `badgeKind: null`.
- **T&M**: row when ≥1 closed period has uninvoiced hours. Mid-cycle T&M is **excluded**. `badgeKind: null`.
- **Retainer monthly (no rollover)**: one row per closed-uninvoiced month. `badgeKind: "within-budget" | "over-budget"`.
- **Retainer cycle-rollover**: one row per closed-uninvoiced cycle. Mid-cycle cycles excluded.
- Multi-currency: rows are not aggregated; each row carries its own `currency`.

**Mutation: `generateAllWithinBudgetRetainerInvoices` (admin-only, tested)**

Enumerates closed uninvoiced retainer periods where computed total = 0, calls `createInvoice` per row, accumulates failures.

Returns `{ created: Id<"invoices">[], failed: Array<{projectId, period, reason}> }`.

Partial-fail is the chosen pattern — one bad row does not roll back the rest. (Per PRD, no all-or-nothing transaction.)

### Tests (mandatory)

`getReadyToInvoiceUnified`:
- Retainer monthly closed within-budget
- Retainer monthly closed over-budget
- Retainer cycle closed
- Retainer cycle mid-cycle (excluded)
- Fixed `remaining > 0` with no prior invoices
- Fixed `remaining > 0` with prior partial invoice (non-zero remaining still listed)
- T&M with prior-month uninvoiced hours
- T&M mid-cycle (excluded)
- Multi-currency org (rows carry their own currency)
- Edge: project deleted with hanging time entries (does not crash the query)
- Member call → rejected

`generateAllWithinBudgetRetainerInvoices`:
- All-success → `created.length` matches eligible rows, `failed` empty
- Mixed success/fail (one row fails because project was deleted mid-batch) → other rows succeed, failure reason captured
- Currency mismatch handling (each invoice in own project's currency, no aggregation)
- Member call → rejected

Mirror prior art at `convex/lib/__tests__/retainerBalance.test.ts`.

### UI

**Component: `components/invoices/inbox-to-generate-section.tsx`**

- Row layout: `[ checkbox ] · headline · badge column · amount · [Generate]`
- Headline: `{Project name}` line + subline `Last invoiced {formatLastInvoiced(lastInvoicedAt)}`. Use month range for cycles (e.g. `Apr–Jun cycle`) — never sequence numbers.
- Badge column: dedicated grid column (vertical alignment across all rows). Renders `within budget` / `{N}h over` for retainers; **empty** for fixed and T&M.
- Per-row Generate: opens `CreateInvoiceModal` pre-filled to that period. If `createInvoice` returns existing draft → toast `"Resuming draft {invoiceNumber}"`, open editor on that draft.
- Header batch button: **only visible when ≥1 €0 row exists**. Label: `Generate all within-budget reports (N)`. Click → `generateAllWithinBudgetRetainerInvoices`.
- Partial-fail toast: `"{N} reports generated · {M} failed [View]"` opens a small dialog listing each failure (project name + reason).

## Acceptance criteria

- [ ] `getReadyToInvoiceUnified` implemented + admin-only + all tests pass.
- [ ] `generateAllWithinBudgetRetainerInvoices` implemented + admin-only + all tests pass.
- [ ] `<InboxToGenerateSection />` renders rows from the query, all 3 row types display correctly.
- [ ] Badge column always present (empty cell for fixed/T&M, populated for retainer).
- [ ] Cycle row references use `Apr–Jun cycle` style — no sequence numbers anywhere user-facing.
- [ ] Per-row Generate works for all 4 project types (Fixed, T&M, retainer-monthly, retainer-cycle).
- [ ] Resume-draft toast fires on duplicate Generate.
- [ ] Header batch button visibility toggles correctly (≥1 €0 row).
- [ ] Batch click commits visibly, partial-fail toast renders failure dialog.
- [ ] `npx tsc --noEmit` clean.

## Verification

Use dummy data (per memory `project_mvp_dummy_data`) to seed:
- A retainer with a closed within-budget month, a closed over-budget month, an in-progress month.
- A T&M project with prior-month uninvoiced hours and current-month hours.
- A Fixed project with `remaining > 0`.
- A second org-currency project to test multi-currency rows.

Visit `/invoices` → see all rows. Click per-row Generate → editor opens. Click batch (when €0 rows exist) → all generated, see correct toast. Force a failure (e.g. delete a project mid-batch via dashboard) → partial toast renders.

## User stories addressed

- 12 (one row per closed billable unit, all project types)
- 13 (badge: within-budget / Nh over for retainers)
- 14 (fixed/T&M skip badge)
- 15 (badge in dedicated grid column)
- 16 (last-invoiced subline)
- 17 (month-range cycle references)
- 18 (header batch button visibility)
- 19 (partial-fail toast)
- 20 (Generate on existing draft → opens that draft)
- 49 (batch partial failure surfaced)

## Notes

- Per `CLAUDE.md`: page file is a thin orchestrator. This issue ships only the section component, not the full Inbox page (#11 composes the page).
- All mutations must use `.catch(toastError)` per `CLAUDE.md` mutation rule.
- Do **not** add a confirmation dialog on batch generate — undo is via the failure toast and individual invoice deletion if needed.
- Use `shadcn` skill for Checkbox / Button / Toast (Sonner) APIs.
- Use `frontend-design` skill for polish.
