# 07 — `<InvoiceBanner />` shared component (wired across all 3 project Overviews)

**Type**: HITL
**Blocked by**: #02 (`formatLastInvoiced`), #04 (resume-existing draft path on Generate)
**Unblocks**: #13 (cleanup once banner replaces old surfaces)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #1 · User stories 24, 25, 26, 27, 28
**Visual reference**: `docs/invoicing-update.md` § Component Spec · `prototypes/invoicing-final.html`

## What to build

A single shared component `components/invoices/invoice-banner.tsx`, then wire it into the Fixed, T&M, and Retainer project Overview pages, replacing the existing duplicate / variant banners.

### Layout (per visual reference)

| Slot | Content |
|---|---|
| Icon | Lucide per type: `Receipt` (Fixed), `Repeat` (Retainer), `FileText` (delivery report €0), `Timer` (T&M) |
| Title | Per type — see `prototypes/invoicing-final.html` |
| Subline | Last-invoiced context via `formatLastInvoiced()` |
| Cadence chip | `⌛ {N} days` only when T&M or Fixed AND `daysSinceLastInvoice ≥ 30` |
| Amount column | Right-aligned, in its own grid column. One-word status label below. |
| CTA | `Generate invoice` button — opens `CreateInvoiceModal` pre-filled |

**No `variant` prop.** Banner is always actionable when rendered.

### When to render (visibility rules per project type)

- **Fixed**: render whenever `remaining > 0`. Cadence chip if applicable.
- **T&M**: render whenever there are uninvoiced hours from any closed period. Cadence chip if applicable.
- **Retainer monthly (no rollover)**: render when ≥1 closed-uninvoiced month exists.
- **Retainer cycle-rollover, mid-cycle**: render **nothing**. Cycle progress lives in the Monthly Breakdown header (#08).
- **Retainer cycle-rollover, just-closed**: render with `"{monthRange} cycle closed"` title and cycle-level overage (or €0).

### CTA behavior

Click → opens `CreateInvoiceModal` pre-filled to the most relevant period (per User Story 42). If `createInvoice` (#04) returns an existing draft, show toast `"Resuming draft {invoiceNumber}"` and open the editor on that draft.

## Acceptance criteria

- [ ] `components/invoices/invoice-banner.tsx` is the single source of truth — no duplicate banners on any project page.
- [ ] Wired into all 3 project Overview page files (Fixed, T&M, Retainer).
- [ ] Mid-cycle rollover retainer renders no banner (verify with a fixture project mid-cycle).
- [ ] Cycle-just-closed renders the closed banner.
- [ ] Cadence chip appears at exactly 30 days, not earlier.
- [ ] Resume-draft toast fires when an existing draft is returned from `createInvoice`.
- [ ] Visual fidelity matches `prototypes/invoicing-final.html` (HITL review).
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

For each project type, walk a realistic fixture project through:
- Fresh project, nothing to bill → banner renders with appropriate empty/zero state per design.
- Closed period with money owed → banner renders with amount + CTA.
- 30+ days since last invoice → cadence chip appears.
- Mid-cycle rollover retainer → no banner.
- Cycle-closed retainer → closed banner with month range.

Click Generate twice on the same period → second click opens the same draft + shows resume toast.

## User stories addressed

- 24 (single banner per project)
- 25 (per-type icon + layout)
- 26 (cadence chip)
- 27 (mid-cycle = no banner, no info card)
- 28 (cycle-closed banner)
- 42, 43 (modal pre-select + resume-draft toast — UI side; backend in #04)

## Notes

- Per `CLAUDE.md`: page files stay thin orchestrators. `<InvoiceBanner />` lives in `components/invoices/`, project Overview pages just import + pass props.
- **Use `frontend-design` skill** for visual polish iteration before HITL review.
- Existing duplicate banners on Retainer Overview must be deleted as part of this issue. The old `<ReadyToInvoiceCard />` (mid-cycle info card) is deleted in #08, not here.
- All data the banner needs (last-invoiced date, amount, status, project type, cycle state) should come from existing queries — `getRetainerCycleData`, `getProjectInvoiceMetrics`, plus the unified query from #09 if convenient. Avoid creating a new project-banner-specific query unless absolutely needed.
