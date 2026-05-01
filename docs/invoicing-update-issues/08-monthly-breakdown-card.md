# 08 — `<MonthlyBreakdownCard />` rebuild

**Type**: HITL
**Blocked by**: #02 (`formatLastInvoiced` for in-card dates)
**Unblocks**: #13 (deletes legacy `<ReadyToInvoiceCard />` as part of this issue)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #5 · User stories 29–36
**Visual reference**: `docs/invoicing-update.md` § Monthly Breakdown · `prototypes/invoicing-final.html`

## What to build

Rebuild `<MonthlyBreakdownCard />` (Retainer project Overview) into a 6-column grid with a fixed pill dictionary. Delete the now-redundant `<ReadyToInvoiceCard />` (the mid-cycle info card).

### Grid (6 columns)

`dot · month · hours · state pill · amount · action`

Every row aligns vertically — no inline content variations between rows.

### State pill — exactly 3 fixed values

- `within budget` (emerald)
- `over budget` (amber)
- `in progress` (zinc)

**No dynamic data inside the pill ever.** It's a category tag, not a sentence.

### Dot color

Mirrors the pill (emerald / amber / zinc). Footer carries a small legend so dot semantics are self-documenting.

### Highlight: oldest closed-uninvoiced row

Subtle background wash + `font-medium` on the month name. This is the next billing action — eye should land here without chrome.

### Generated rows

The invoice number (`INV-2026-01 ↗`) **is the link**. No separate "view" button.

### Sort toggle

Header carries an oldest-first / newest-first toggle. Default: oldest first. **Component state only** — does NOT persist to URL or localStorage. (Intentional deviation from the `filterable-views-persist-state-in-URL` rule per PRD § Further Notes.)

### Cycle-rollover retainers

When the project is rollover-ON, the card header carries:
`"{monthRange} cycle · {X}/{cycleLength} months closed · {Y}% used"` plus a `Cycle closes/closed {date}` pill.

This replaces the deleted `<ReadyToInvoiceCard />` info card.

## Data source

`getRetainerCycleData` (`convex/projects.ts:752`) — **unchanged**. The new card reads existing fields:
- `monthlyData[]` for rows
- `utilization` for the cycle % used
- `monthlyData.filter(m => m.isMonthClosed).length` for closed-in-cycle count
- `isCycleClosed`, cycle date range for the header pill

## Acceptance criteria

- [ ] Card lives at `components/projects/monthly-breakdown-card.tsx` (or current location, rewritten).
- [ ] All 3 pill states render correctly across rows.
- [ ] Oldest closed-uninvoiced row gets the subtle highlight.
- [ ] Generated row's invoice number is the clickable link (no separate view button).
- [ ] Sort toggle flips order, doesn't persist on refresh.
- [ ] Cycle-rollover header line + pill renders for rollover-ON projects only.
- [ ] `<ReadyToInvoiceCard />` is deleted from the Retainer Overview page (and the file itself if no other consumers exist — `git grep ReadyToInvoiceCard` to verify).
- [ ] Visual fidelity matches `prototypes/invoicing-final.html` (HITL review).
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.

## Verification

1. Visit a rollover-OFF retainer with mixed within/over/in-progress months → all 3 pills render, dots match, legend in footer.
2. Visit a rollover-ON retainer mid-cycle → header shows cycle progress + "closes" pill; old info card is gone.
3. Visit a rollover-ON retainer cycle-closed → header pill says "closed".
4. Click sort toggle → rows reorder, refresh → reverts to default oldest-first.
5. Click an invoice number → navigates to invoice doc.

## User stories addressed

- 29 (6-col grid)
- 30 (3 fixed pill values, no dynamic data)
- 31 (dot mirrors pill + legend)
- 32 (oldest uninvoiced highlight)
- 33 (invoice number is the link)
- 34, 35 (sort toggle + component-state-only)
- 36 (cycle-rollover header line + pill)

## Notes

- Per `CLAUDE.md`: page file stays a thin orchestrator. All grid-row + header logic lives inside the card component.
- Use `shadcn` skill before building pill / dot UI — confirm shadcn `Badge` API.
- `CategoryBadge` / `StatusBadge` — domain badges per `CLAUDE.md` rule are shared. If the pill colors here match an existing badge component's variants, reuse; if not, this is the canonical state pill for billing months and may belong in `components/invoices/billing-state-pill.tsx`.
- Use `frontend-design` skill for polish.
