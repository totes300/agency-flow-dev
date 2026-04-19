# PRD — Project Summary Card Refactor

**Status**: Approved, ready for implementation
**Owner**: Adam
**Date**: 2026-04-18
**Scope**: single PR
**Business criticality**: HIGH — the numbers on this card drive pricing, hiring and go/no-go decisions for agencies. Wrong numbers = real financial harm.

---

## 1. Problem

The three project Overview cards today (`components/projects/{fixed,tm,retainer}-overview.tsx`) suffer from:

1. **Incorrect / imprecise numbers** in the top metric grid — "Invoiced amount" divergence between entry ledger and invoice ledger, profit computed from `fixedPrice` alone ignoring extras, retainer overage not surfaced mid-cycle.
2. **Inconsistent semantics** — the same label ("Revenue", "Invoiced") means different things per billing type.
3. **No unit tests** on the aggregation logic (`timeEntries.projectOverview`, entry-level invoiced/uninvoiced splits). Business-critical math is unverified.
4. **Duplicated UI logic** — three separate components implement the same card layout pattern with different props + copy.

---

## 2. Goal

Replace the top metric grid on all three overview types with **one unified `<ProjectSummaryCard>`** backed by a **single validated calc layer** (`convex/lib/projectSummary.ts`) and **one query** (`api.projects.getSummary`).

Numbers must be:
- **Accurate** (raw, no rounding artifacts)
- **Consistent** across the three types (same philosophy: "current state of project economics")
- **Unit-tested** (100% coverage on pure calc functions, fixture-per-formula minimum)
- **Type-safe** (discriminated union output, zero TypeScript errors)

The scope is **minimum**: only the top metric grid is replaced. The Budget table (Fixed), Monthly Breakdown accordion (Retainer), Time Log (T&M), and existing Alerts (overage/missing-rate) stay untouched.

---

## 3. Target UX

### Card layout (all types)

Single wide card with 3 vertical sections separated by hairline dividers. Bonsai-style.

```
┌─ Project Finances ─────────────────────────────── [trailing slot] ─┐
│  [subtitle — billing type]                                         │
│                                                                    │
│  [COLUMN 1]            │  [COLUMN 2]          │  [COLUMN 3]        │
│  Section title         │  Section title       │  Section title     │
│  Metric rows           │  Metric rows         │  Metric rows       │
└────────────────────────────────────────────────────────────────────┘
```

### Trailing slot per type

| Type | Trailing slot content |
|---|---|
| **T&M** | Date range picker: `This month` / `This quarter` / `This year` / `All time` / **Custom range** |
| **Fixed** | *(empty — lifetime view)* |
| **Retainer** | Cycle navigator `← Cycle N →` + `Uninvoiced` badge if ≥1 closed+uninvoiced month |

### Subtitle per type

- T&M: `"Time & Materials Billing"`
- Fixed: `"Fixed Fee Billing"`
- Retainer: `"{Start} – {End} · {cycleLength}-month {monthly|rollover}"`

### Column contents

#### T&M

| Col 1 — Billing Status | Col 2 — Time Breakdown | Col 3 — Profitability |
|---|---|---|
| Unbilled Amount · `Unbilled hours` | Total hours | **Earned Revenue** |
| Billed Amount · `Billed hours` | Billable hours | Total cost |
| | Non-billable hours | Profit |
| | | Margin |

#### Fixed

| Col 1 — Billing Status | Col 2 — Time Breakdown | Col 3 — Profitability |
|---|---|---|
| Fixed fee | Total hours (`/ budget`) | **Contract Value** |
| Billed Amount | Total remaining | Total cost |
| *(conditional slot)* — see below | | Profit |
| | | Margin |

**Conditional 3rd slot** based on `billed` vs `fixedPrice`:
- `billed < fee` → `Unbilled Amount` (muted)
- `billed = fee` → `Fully invoiced` ✓ (subtle closure signal)
- `billed > fee` → `Extra billed` (subtle positive accent, `+€X beyond fixed fee` detail)

**Edge case — `fixedPrice` not set**: Col 1 replaced by inline CTA "Set a fixed fee to track billing" → Settings link. Col 2 + Col 3 render normally.

#### Retainer

| Col 1 — Time Breakdown | Col 2 — Overage | Col 3 — Cycle Profitability |
|---|---|---|
| Total hours (`/ budget`) | Over budget | **Earned Cycle Revenue** |
| Billable hours | Overage due | Total cost |
| Non-billable hours | | Profit |
| | | Margin |

### Responsive behavior

- Desktop (`md+`): 3 columns horizontally.
- Mobile (`< md`): columns stack vertically with same hairline divider between them.

---

## 4. Semantics & formulas (per type)

All formulas operate on **raw ledger values — NO rounding anywhere on this card.** Rounding stays where it belongs: at invoice generation (`getInvoicePreview`).

All formulas assume **every in-scope entry has `rateCurrency == project.currency`**. Enforcement is a separate dependency ticket (see §9).

### T&M

Let `E_range = entries where entry.date in dateRange`.

```
Billed hours       = sum(E_range where isBillable && invoiceId).durationMinutes
Unbilled hours     = sum(E_range where isBillable && !invoiceId).durationMinutes
Billed Amount      = sum(E_range where isBillable && invoiceId).durationMinutes/60 × billableRate
Unbilled Amount    = sum(E_range where isBillable && !invoiceId).durationMinutes/60 × billableRate

Total hours        = sum(E_range).durationMinutes
Billable hours     = sum(E_range where isBillable).durationMinutes
Non-billable hours = sum(E_range where !isBillable).durationMinutes

Earned Revenue     = Billed Amount + Unbilled Amount
Total cost         = sum(E_range).durationMinutes/60 × costRate   [billable + non-billable]
Profit             = Earned Revenue − Total cost
Margin             = Earned Revenue > 0 ? round(Profit / Earned Revenue × 100) : null
```

### Fixed

Let `E_all = all entries (lifetime, no date filter)`. Let `I = non-draft invoices where invoice.projectId == projectId`. Let `L = invoiceLineItems on I`.

```
Total hours        = sum(E_all).durationMinutes
Estimated budget   = sum(projectCategoryEstimates).estimatedMinutes   (if any)
Total remaining    = Estimated budget − Total hours   (if budget set, else null)

Fixed fee          = project.fixedPrice
Billed Amount      = sum(L where lineType="fixed").amount
Total billed       = sum(L).amount   [all line types — fixed + manual + time]

Contract Value     = max(fixedPrice, Total billed)
                     // If total billed > fixedPrice (e.g. manual out-of-scope lines),
                     // Contract Value reflects actual earned revenue.

Total cost         = sum(E_all).durationMinutes/60 × costRate   [billable + non-billable]
Profit             = Contract Value − Total cost
Margin             = Contract Value > 0 ? round(Profit / Contract Value × 100) : null
```

### Retainer (per selected cycle)

Let `cycleStart`, `cycleEnd` = date boundaries of selected cycle (same logic as current `getRetainerData`).
Let `E_cycle = entries where entry.date between cycleStart and cycleEnd`.

```
Total hours        = sum(E_cycle).durationMinutes
Billable hours     = sum(E_cycle where isBillable).durationMinutes
Non-billable hours = sum(E_cycle where !isBillable).durationMinutes

cycleBudget        = project.includedMinutesPerMonth × project.cycleLength
Over budget        = max(0, Billable hours − cycleBudget)
Overage due        = Over budget/60 × project.overageRate   (live, regardless of cycle open/closed state)

Earned Cycle Revenue = project.monthlyFee × project.cycleLength + Overage due
Total cost         = sum(E_cycle).durationMinutes/60 × costRate   [billable + non-billable]
Profit             = Earned Cycle Revenue − Total cost
Margin             = Earned Cycle Revenue > 0 ? round(Profit / Earned Cycle Revenue × 100) : null
```

**Important**: Retainer formulas use **Billable hours** (not Total hours) to compute `cycleBudget` utilization and overage. Non-billable time does not consume retainer balance (matches existing `getRetainerData` behavior). Non-billable time **does** contribute to Total cost (affects margin).

### Display rules (all types)

- `—` (em dash, muted) when a value is null or when `revenue ≤ 0` (margin).
- Negative Profit → destructive text color.
- `Extra billed` state → subtle positive accent (emerald-500 or primary), not full green badge.
- All currency amounts: `formatCurrencyPrecise(amount, currency)` (2 decimals).
- All hours: `formatMinutes(minutes)` (`HH:MM` format).

---

## 5. Permissions

**Role-aware output** from `api.projects.getSummary`:

| Field group | Admin | Member |
|---|---|---|
| Time breakdown (hours) | ✓ | ✓ |
| Billing Status (amounts) | ✓ | hidden |
| Profitability (Revenue/Cost/Profit/Margin) | ✓ | hidden |
| Retainer Overage | ✓ | hidden |

**Member view**: only the Time Breakdown column renders. The card shell still shows the title + subtitle + trailing slot (date range / cycle navigator) so members can still filter their own time view.

**Implementation**: `getSummary` checks `getAuthContext(ctx).isAdmin`. Non-admin return shape has `billingStatus`, `profitability`, `overage` fields set to `undefined`. UI discriminates via `if (summary.billingStatus) { render column }`.

---

## 6. States

### Loading
Unified `<ProjectSummaryCardSkeleton>` colocated in the card file, mirroring the 3-column layout (3 skeleton columns + hairline divider placeholders + title/subtitle skeleton). Mobile: stacked.

### Empty
- **No entries logged yet** → numeric fields show `0`, derived fields (`Profit`, `Margin`) show `—`. Subtle hint row below Time column: *"No time logged yet"*.
- **Fixed without `fixedPrice`** → Col 1 replaced by inline CTA to Settings (see §3).
- **Retainer without `overageRate` but with overage** → existing Alert below card stays (Scope A).

### Error
Inline error state filling the card shell: *"Couldn't load project summary."* + `Retry` button that refetches the query. No toast.

---

## 7. URL state

Per CLAUDE.md rule ("filterable views persist in URL"):

- **T&M date range** → `?summaryRange=this_month|this_quarter|this_year|all|custom&summaryFrom=YYYY-MM-DD&summaryTo=YYYY-MM-DD`
- **Retainer cycle offset** → `?cycleOffset=-1|0|1` (default `0` = current cycle)

Both participate in the existing tab param (`?tab=overview`). Defaults omitted from URL to keep clean URLs.

---

## 8. Backend

### Query

```ts
// convex/projects.ts
export const getSummary = query({
  args: {
    projectId: v.id("projects"),
    dateRange: v.optional(v.object({
      preset: v.union(
        v.literal("this_month"),
        v.literal("this_quarter"),
        v.literal("this_year"),
        v.literal("all"),
        v.literal("custom"),
      ),
      from: v.optional(v.string()),  // YYYY-MM-DD, required if preset="custom"
      to:   v.optional(v.string()),
    })),
    cycleOffset: v.optional(v.number()),  // retainer only; 0 = current cycle
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin } = await getAuthContext(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;

    // Fetch once, dispatch by billingType.
    // Returns discriminated union shape.
    switch (project.billingType) {
      case "t_and_m":     return await computeTmSummary(ctx, project, args.dateRange, isAdmin);
      case "fixed":       return await computeFixedSummary(ctx, project, isAdmin);
      case "retainer":    return await computeRetainerSummary(ctx, project, args.cycleOffset ?? 0, isAdmin);
      case "non_billable": return null;
    }
  },
});
```

### Return shape (discriminated union)

```ts
type ProjectSummary =
  | {
      billingType: "t_and_m",
      subtitle: string,
      dateRange: { from: string, to: string, preset: string },
      timeBreakdown: { totalMinutes, billableMinutes, nonBillableMinutes },
      billingStatus?: {    // admin only
        billedMinutes, unbilledMinutes,
        billedAmount,  unbilledAmount,
      },
      profitability?: {    // admin only
        earnedRevenue, totalCost, profit, marginPercent,
        currency,
      },
    }
  | {
      billingType: "fixed",
      subtitle: string,
      timeBreakdown: { totalMinutes, estimatedBudgetMinutes: number | null, remainingMinutes: number | null },
      billingStatus?: {
        fixedPrice: number | null,
        billedAmount,
        slot: "unbilled" | "fully_invoiced" | "extra_billed",
        slotAmount: number,   // unbilled amount OR extra billed amount; 0 if fully invoiced
      },
      profitability?: {
        contractValue, totalCost, profit, marginPercent,
        currency,
      },
    }
  | {
      billingType: "retainer",
      subtitle: string,
      cycle: {
        number, offset, start, end, length, isCycleClosed, hasPreviousCycle, hasNextCycle,
        hasUninvoicedClosedMonth: boolean,   // drives header badge
      },
      timeBreakdown: { totalMinutes, billableMinutes, nonBillableMinutes, cycleBudgetMinutes },
      overage?: {
        overBudgetMinutes, overageDueAmount, currency,
      },
      profitability?: {
        earnedCycleRevenue, totalCost, profit, marginPercent,
        currency,
      },
    };
```

### Pure calc layer

```
convex/
├── projects.ts                                  (exports getSummary query)
└── lib/
    ├── projectSummary.ts                        (pure functions)
    │   ├── computeTmSummary(entries, project, dateRange, isAdmin)
    │   ├── computeFixedSummary(entries, project, invoices, lineItems, isAdmin)
    │   ├── computeRetainerSummary(entries, project, invoices, cycleContext, isAdmin)
    │   └── helpers: resolveDateRange(), filterEntriesByDate(), sumMinutesBy()
    └── __tests__/
        └── projectSummary.test.ts               (fixture-based unit tests)
```

The Convex query (`getSummary`) is thin: authz + data fetch + call the appropriate `compute*` function. All business logic lives in the pure layer.

### Naming

- **Module (pure)**: `convex/lib/projectSummary.ts`
- **Query**: `api.projects.getSummary`
- **Frontend**: `components/projects/summary/` (see §10)

---

## 9. Dependencies (separate tickets)

### D1 — Currency integrity enforcement

The card assumes all in-scope entries have `rateCurrency == project.currency`. Today the data model does not enforce this.

**Required before this PR ships, or as a gate-keeping follow-up**:

1. Update `resolveRateSnapshot` to prefer `project.currency`-denominated rates in order:
   1. `projectRateOverrides` (already in project currency).
   2. `categoryRates` in project currency.
   3. User rate **only if** `userRate.currency == project.currency`.
   4. Throw with actionable message: `"No rate set in EUR for [user] on this project. Set one in Project Settings → Rates."`
2. Audit existing `timeEntries` for `rateCurrency != project.currency`. Report count per project. Manual or re-snapshot migration as needed.
3. No runtime currency-partition filter in `getSummary`. Trust the invariant.

### D2 — Deprecate old queries (follow-up, out of scope)

`timeEntries.projectOverview`, `projects.getRetainerData`, `invoices.getProjectInvoiceMetrics` **stay** — they power the Budget table, Monthly Breakdown accordion, and Invoices tab. Deprecation is a future refactor when those surfaces are touched.

---

## 10. Frontend structure

```
components/projects/summary/
├── project-summary-card.tsx         (entry: dispatch by billingType, skeleton, error)
├── tm-summary.tsx                   (T&M columns composition)
├── fixed-summary.tsx                (Fixed columns composition)
├── retainer-summary.tsx             (Retainer columns composition)
└── primitives/
    ├── summary-card-shell.tsx       (Card + Header + trailing slot + divider layout)
    ├── summary-column.tsx           (column title + MetricRow stack)
    └── metric-row.tsx               (label + value + optional detail line)
```

### Entry component

```tsx
<ProjectSummaryCard projectId={projectId} />
```

That's the entire consumer API. It:
1. Reads `dateRange` + `cycleOffset` from URL.
2. Calls `api.projects.getSummary` with them.
3. Dispatches to `<TmSummary>` / `<FixedSummary>` / `<RetainerSummary>` based on `summary.billingType`.
4. Renders `<ProjectSummaryCardSkeleton>` while loading; inline error shell on error; `null` if `summary === null` (non_billable or not found).

### Shared shell

`<SummaryCardShell title subtitle trailing>{children}</SummaryCardShell>` — provides the outer Card, header row, and divider-between-columns visual. Columns are passed as children.

### Design tokens to reuse

- `<Card>` from shadcn.
- Text styles: existing `CELL_KEY` / `CELL_PRIMARY` / `CELL_SECONDARY` from `lib/table-tokens.ts` (consistent with the Budget table below).
- Icons: Lucide (InfoIcon, CheckIcon for "fully invoiced", TrendingUpIcon for "extra billed" — or icon-less).

### Integration

Replace in `app/(dashboard)/projects/[id]/page.tsx`:

- `FixedOverview` renders at the top: swap its top metric grid + info banner for `<ProjectSummaryCard projectId={projectId} />`. Budget section + Time Log stay.
- `TmOverview`: swap top metric grid + uninvoiced nudge for `<ProjectSummaryCard>`. Time Log stays. (The nudge is redundant with the Billing Status column; remove.)
- `RetainerOverview`: replace the outer `<Card>Cycle Overview</Card>` (containing the 4 metric cards + progress bar) with `<ProjectSummaryCard>`. The missing-overage-rate Alert, overage invoice banner, Monthly Breakdown accordion, and cycle-end settlement card all stay.

Progress bar in the old Cycle Overview card → **removed**. Budget utilization is communicated via the `Total hours / cycleBudget` ratio in Col 1.

### Skeleton placement

The skeleton lives in `project-summary-card.tsx` (colocated, not a separate file). One skeleton for all three types.

---

## 11. Testing

### Pure layer — `convex/lib/__tests__/projectSummary.test.ts`

Fixture-based. Each fixture defines: entries, project config, (for Fixed) invoices + line items, (for Retainer) cycle context. Asserts the complete `ProjectSummary` return shape.

**T&M fixtures (min 5)**:
1. Empty project — no entries.
2. Happy path — 3 billable + 1 non-billable, 1 invoiced, dateRange=all.
3. Date range filter — same entries, dateRange=this_month, only month entries count.
4. All non-billable — Revenue = 0, Margin = null.
5. Custom date range — `{preset:"custom", from, to}` boundary inclusivity.

**Fixed fixtures (min 5)**:
1. Empty — no entries, no invoices, `fixedPrice=5000` set.
2. Billed < fee → slot="unbilled", Contract Value = fixedPrice.
3. Billed = fee → slot="fully_invoiced".
4. Billed > fee with +1000€ manual line → slot="extra_billed", Contract Value = 6000.
5. `fixedPrice` is null — billingStatus.fixedPrice=null, profitability.contractValue=0.

**Retainer fixtures (min 5)**:
1. Open cycle, no entries — Revenue = `monthlyFee × cycleLength`, overage 0.
2. Open cycle, 50% consumed, no overage — overage 0.
3. Open cycle, 120% consumed → live overage shown, added to Revenue.
4. Closed cycle with overage — same formula, cycle navigator shows `hasNextCycle`.
5. Closed cycle with uninvoiced month — `cycle.hasUninvoicedClosedMonth = true` drives the header badge.

**Cross-cutting**:
- `costRate=0` entries — margin = 100%, no warning (per spec).
- Negative Profit — returned value is negative, UI responsibility to color.
- Member view (isAdmin=false) — `billingStatus`, `profitability`, `overage` = undefined.

### Integration smoke test — 1 per billing type

Call `api.projects.getSummary` via `ConvexTestingHelper` (if in use; else skip this layer) with a seeded project + entries. Assert the top-level shape and one business-critical number per type.

### Regression invariant test

On the same fixture set, compute both:
- Old `api.timeEntries.projectOverview.totalMinutes` (for T&M + Fixed).
- New `api.projects.getSummary.timeBreakdown.totalMinutes`.

Assert equality. If they diverge, CI breaks. Keeps the old queries (Scope A) and new queries in numerical agreement during the refactor window.

### No UI snapshot tests

TypeScript + the pure layer coverage are the guarantee. Visual regressions caught via manual verification + production usage.

### Coverage bar

100% line coverage on `convex/lib/projectSummary.ts`. No threshold on the Convex query (thin dispatch only).

---

## 12. Rollout

**Single PR.** Internal file sequencing (for reviewer sanity, not deploy):
1. Add pure layer + tests (`convex/lib/projectSummary.ts`, `convex/lib/__tests__/projectSummary.test.ts`).
2. Add Convex query (`api.projects.getSummary` in `convex/projects.ts`).
3. Add UI components (`components/projects/summary/**`).
4. Swap into the three overview components + remove the now-redundant top metric grids + removed redundant banners (T&M uninvoiced nudge, old Retainer Cycle Overview card shell).

No feature flag. Direct replacement. Convex preview deployments + Vercel preview URLs serve as the QA layer.

### Backlog tracking (per CLAUDE.md)

Upon merge, add an entry to `docs/backlog.md` with:
- All task checkboxes from this PRD.
- Verification checklist (each formula manually verified against a real project in production data).
- TODOs deferred section naming D1 (currency integrity enforcement) and D2 (old query deprecation).

---

## 13. Open non-goals (explicitly out of scope)

- FX conversion / cross-currency aggregation.
- Cross-project reporting (client-level revenue, org-level P&L).
- Change-order data model for Fixed projects (distinguishing positive manual extras from discount credits).
- Ledger-vs-invoice divergence warning UI.
- Feature flag / A/B rollout.
- Deprecation of `timeEntries.projectOverview`, `projects.getRetainerData`, `invoices.getProjectInvoiceMetrics`.
- "All cycles" lifetime view on Retainer.
- Replacement of the Budget table (Fixed), Monthly Breakdown accordion (Retainer), or Time Log (all types).
- Reconciliation card comparing entry ledger and invoice ledger.

---

## 14. Acceptance criteria

- [ ] `<ProjectSummaryCard>` renders on Overview tab for all 4 billing types (T&M, Fixed, Retainer, Non-billable returns null).
- [ ] Every number on the card matches a value computable by hand from `timeEntries` + `invoices` + project config, per §4 formulas.
- [ ] Date range picker on T&M persists to URL.
- [ ] Cycle navigator on Retainer persists `cycleOffset` to URL.
- [ ] Members see only the Time Breakdown column; admins see all three.
- [ ] Skeleton is 3-column structured, not a generic bar.
- [ ] Loading → Empty → Content flow consistent with CLAUDE.md rule.
- [ ] 100% pure-layer test coverage; CI passes.
- [ ] Regression invariant test (old vs new `totalMinutes`) passes on all fixtures.
- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `npm run lint` — clean.
- [ ] Manual verification against one real project per billing type (production data, in preview env).
- [ ] Extra billed state on Fixed verified with a manually-crafted +1000€ manual line.
- [ ] Retainer mid-cycle overage verified by logging time past budget in a test retainer.
- [ ] Backlog entry in `docs/backlog.md`.

---

## 15. Out-of-band safety

Because numbers are business-critical:

- **No rounding anywhere on this card. Raw ledger only.** If you're tempted to round for display "niceness", stop. Accuracy > aesthetics.
- **Every formula tested via fixture.** If you add a new derived field, add a fixture.
- **Currency invariant trusted, not checked at runtime.** If D1 (§9) is not shipped first, numbers can silently lie. Gate the PR on D1.
- **Discriminated union at the query boundary.** Frontend narrows by `billingType`. No "any" escapes.
- **Read the formulas in §4 every time you touch the calc layer.** This document is the source of truth, not memory or prior art.
