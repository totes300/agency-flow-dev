# 11 — Inbox page shell + metric cards + empty state

**Type**: AFK
**Blocked by**: #09 (To-generate section), #10 (Overdue section)
**Unblocks**: nothing strictly — final UI assembly.

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Multi-currency · § URL state convention · User stories 21, 22, 23
**Visual reference**: `docs/invoicing-update.md` § Inbox · `prototypes/invoicing-final.html`

## What to build

The `/invoices` page itself: assemble the two sections from #09 and #10, render 3 metric cards above them, render the empty state when both sections are empty. Wire URL tabs.

### Page layout (top to bottom)

1. Page header (existing or new — minimal)
2. **3 metric cards** in a grid: `Outstanding · Overdue · Drafts`
3. Tab nav (URL-driven): `?tab=all|draft|outstanding|paid`
4. **Overdue section** (#10) — only when ≥1 overdue
5. **To-generate section** (#09) — only when ≥1 to-generate
6. **Empty state** — when both Overdue and To-generate are empty

### Metric cards

Always render all 3, even at zero. Layout is stable.

**Multi-currency**: when `getInvoiceMetrics` returns ≥2 currencies, render **one row per currency** inside each card (no blended totals). Reuses the existing per-currency Record shape at `convex/invoices.ts:240` — no new query needed.

### URL state

Tabs, search, filters live in URL search params via `useSearchParams` / `router.push` per `CLAUDE.md` rule. No `useState` for filterable state.

### Empty state

Centered, "All caught up" reward state. Includes:
- Last-invoiced context (most recent invoice across the org, formatted via `formatLastInvoiced`)
- Next month-close context (e.g. "Next month closes in 12 days")

Shared component: `components/invoices/inbox-empty-state.tsx`.

### Three-phase loading rule (from `CLAUDE.md`)

1. **Loading** (data === undefined) → content-aware skeleton mirroring the page (3 metric cards + 1-2 row placeholders per section).
2. **Empty** → `<InboxEmptyState />`.
3. **Content** → render sections.

## Acceptance criteria

- [ ] `/invoices` page renders 3 metric cards always (showing zero when applicable).
- [ ] Multi-currency: each card renders one row per currency when org has ≥2 currencies.
- [ ] Tabs persist in URL; back button works; refresh preserves tab.
- [ ] Both-sections-empty triggers `<InboxEmptyState />` with last-invoiced + next-close context.
- [ ] Loading state uses a content-aware skeleton (per `CLAUDE.md` rule).
- [ ] No inline empty-state `<p>` tags — only the dedicated component.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

1. Empty org → `/invoices` shows `<InboxEmptyState />` centered, with reward copy + dates.
2. Org with overdue → Overdue section appears at top.
3. Org with to-generate → To-generate section appears.
4. Multi-currency org (seed dummy data with 2 currencies) → metric cards each show 2 rows.
5. Switch tabs → URL updates, back button reverses.
6. Refresh on `?tab=draft` → page restores draft tab.

## User stories addressed

- 21 (3 metric cards always rendered, including zero)
- 22 (multi-currency one-row-per-currency)
- 23 (centered "All caught up" reward state with context)

## Notes

- Page file is a thin orchestrator per `CLAUDE.md` — composes `<InboxOverdueSection />`, `<InboxToGenerateSection />`, `<InboxEmptyState />`, and metric cards.
- Use `frontend-design` skill for the empty state visual.
- Don't reinvent metric cards — if `<MetricCard />` exists, reuse; otherwise add it as a shared component since it's likely to be reused on the dashboard later (still — only build what this PRD needs).
