# Phase 4 — Projects Retainer

> **Goal**: Full implementation of the Retainer billing type — monthly hour allowance, rollover cycles, overage billing.
> **Depends on**: Phase 3 (Projects Core)
> **This is the most complex module in the entire app.**

---

## Decisions

| Question | Decision |
|----------|----------|
| Retainer in v1? | ✅ Yes, with rollover — this is the business value |
| Cycle length? | Configurable 1-12 months (default: 3), not hardcoded |
| Rollover? | ✅ ON: balance chains month-to-month, cycle-end settlement. OFF: monthly independent. |
| Unused hours? | Forfeited at cycle end (lost), cannot carry to next cycle |
| Balance calculation? | Always computed fresh (query, no cache) — v2: cache if needed |
| Rollover toggle change? | Entire history recalculates + confirmation dialog |
| Mid-cycle config change? | Retroactive to the entire cycle + confirmation |
| Active/Inactive? | ✅ Pausable (not archive), data preserved |
| Auto-report? | ✅ Convex cron job on the 1st of each month at 06:00 UTC |
| Cycle navigator? | Prev/next arrows on the Cycle Overview card |
| Overage billing? | Only for closed months. Rollover ON: only at cycle end. Amount = overageMinutes × overageRate |

---

## Schema additions

Retainer fields on the `projects` table (defined in Phase 3, implemented here):

```typescript
// Retainer only fields on projects:
retainerStatus: "active" | "inactive"     // pausable, not archive
includedHoursPerMonth: number             // stored in MINUTES (e.g., 600 = 10 hours)
overageRate: number                       // hourly rate for overage
startDate: string                         // YYYY-MM-DD, cycle start
rolloverEnabled: boolean                  // default: true
cycleLength: number                       // 1-12 months, default: 3
```

```typescript
retainerPeriods: defineTable({
  orgId: v.string(),
  projectId: v.id("projects"),
  periodStart: v.string(),                // YYYY-MM-DD
  periodEnd: v.string(),                  // YYYY-MM-DD
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_projectId", ["projectId"])
```

## How the Retainer works

### Core concept
The client pays a fixed monthly fee in exchange for X hours of work per month. If the team works more than the allowance → overage → billed separately.

### Configuration
- **Monthly hours** (`includedHoursPerMonth`): stored in minutes, e.g., 10h = 600 min
- **Overage rate**: $/h for overage billing
- **Start date**: when the retainer started (cycles are calculated from here)
- **Rollover**: on/off toggle
- **Cycle length**: 1-12 months (default: 3)

### Rollover ON — rolling budget

A cycle is a `cycleLength`-month unit. `cycleBudget = includedHoursPerMonth × cycleLength`.

**Balance chains month-to-month (within a cycle)**:

```
Month 1: startBalance = 0, available = 0 + allowance, endBalance = available - worked
Month 2: startBalance = prev endBalance, available = startBalance + allowance, endBalance = available - worked
Month 3: startBalance = prev endBalance, available = startBalance + allowance, endBalance = available - worked
```

**Cycle end**:
- If endBalance < 0 → **overage**: |endBalance| hours exceeded → billable (overageMinutes × overageRate)
- If endBalance >= 0 → **unused**: remainder is forfeited — NOT carried to next cycle

**Next cycle**: startBalance = 0 (clean slate)

### Rollover OFF — monthly settlement

Each month is independent: startBalance = 0, available = allowance, endBalance = allowance - worked.
- If endBalance < 0 → overage billable monthly
- If endBalance >= 0 → unused, forfeited

### Concrete example (rollover ON, 10h/mo, 3-month cycle)

```
January (cycle 1/3):
  startBalance = 0
  available = 0 + 10h = 10h
  worked = 12h
  endBalance = 10 - 12 = -2h (deficit, but cycle still open)

February (cycle 2/3):
  startBalance = -2h
  available = -2 + 10 = 8h
  worked = 12h
  endBalance = 8 - 12 = -4h (deficit)

March (cycle 3/3):
  startBalance = -4h
  available = -4 + 10 = 6h
  worked = 12h
  endBalance = 6 - 12 = -6h
  → CYCLE END: 6h overage → 6 × $95 = $570 invoice
```

### Balance calculation (computation flow)

**Always computed fresh, no cache.** The logic:

1. Get all timeEntries from the project's tasks (billable, not archived)
2. Group by month (org timezone!)
3. Chain balances from startDate month-to-month
4. Cycle boundaries: startDate + cycleLength

**This is a Convex query**, not a mutation. It stores nothing — the balance is always derived from time entries.

### Rollover toggle change
If admin toggles rolloverEnabled → **entire history recalculates** (automatically, since balance comes from the query).
- **Confirmation dialog**: "This will recalculate all historical balances. Continue?"

### Mid-cycle config change
If admin modifies `includedHoursPerMonth` or `overageRate` → **retroactive to the entire cycle**, recalculates.
- **Confirmation dialog**: "This change affects the current cycle retroactively. Continue?"

### Active / Inactive
- `retainerStatus: "active" | "inactive"`
- **Not archive** — data is preserved, balance calculation still works
- **Inactive**: doesn't appear in billing queue, no auto-report
- UI: toggle on the Settings tab

### Auto-report generation
- **Convex cron job**: 1st of each month at 06:00 UTC
- Creates the previous month's report (`status: "report"`, no statement number)
- Only for active retainer projects
- **Phase 2 (Reports) implements fully** — Phase 4 builds the cron skeleton and trigger logic

## Queries / Mutations

```
projects.getRetainerData  — retainer computed data (balance, cycles, monthly breakdown)
projects.createRetainer   — retainer-type project creation (required fields validation)
projects.updateRetainer   — retainer config modification (confirmation flag)

retainerPeriods.list      — a project's periods
retainerPeriods.ensure    — lazy-create if none exists for the given month

retainerCron.generateMonthlyReports — 1st of month, active retainers
```

## UI

### Detail view — Overview tab (Retainer)

**Header**:
```
Monthly Website Maintenance [Retainer] [Active]
Greenfield Organics · USD · 10:00/mo · 3-month rollover · Jan 2026 – Mar 2026
```

**Cycle Overview card**:
- Last logged: date (top right) + cycle position ("3 of 3")
- 3 metrics:
  - **Hours Used**: donut chart (%) + "36:00 of 30:00 budget"
  - **Over Budget**: "+06:00" (red if exists) + "120% utilization"
  - **Overage Due**: "$570.00" + "06:00 × $95.00/h"
- Progress bar: budget bar + red overage section
- Footer: "{cycleLength} months · {cycleBudget} budget · {used} used"

**Overage invoice banner** (if cycle closed AND overage exists):
- Yellow/red banner: "Overage invoice — $570.00 due" + [ACTION NEEDED] badge + [Create invoice] button
- Create invoice: functional in Phase 2, disabled for now

**Monthly breakdown** (collapsible, current month open):
- Month header: name + cycle position dot + worked/allowance + status badge
  - Badge types: `+06:00 due` (red), `-04:00 deficit` (red), `-02:00 rollover` (amber), `Unused: 03:00` (yellow)
- Expanded: task rows grouped by category (same pattern as Phase 3)
- "Log entry" link at bottom (manual time entry — Phase 7)
- Footer: "{N} entries · {M} tasks · Total"

**Cycle-end settlement card** (inside the final month):
- If overage: "Extra hours invoice" + amount
- If unused: "Unused — forfeited at cycle end"

**Older cycles**: Cycle navigator (prev/next arrows) on the Cycle Overview card.

### Detail view — Settings tab (Retainer)

- Project name, code, currency
- **Retainer config**:
  - Monthly hours (number input, displayed as HH:MM)
  - Overage rate (number input + currency)
  - Cycle length (dropdown: 1-12 months)
  - Rollover toggle (switch) — confirmation if changing
  - Start date (date picker) — warning if modifying
  - Status: Active / Inactive toggle
- Default assignees grid

### Create modal (extension)

In the Phase 3 create modal, when user selects "Retainer":
- Monthly hours (required)
- Overage rate (required)
- Start date (default: 1st of current month)
- Cycle length (default: 3)
- Rollover (default: on)

## Acceptance criteria

- [ ] Retainer project creatable from modal (all required fields)
- [ ] Cycle overview card: donut, progress bar, 3 metrics — with real data
- [ ] Monthly breakdown: balance chaining correct (rollover ON and OFF)
- [ ] Cycle-end settlement: overage OR unused/forfeited
- [ ] Deficit indicator on mid-cycle negative balance
- [ ] Overage invoice banner appears if cycle closed + overage exists
- [ ] Cycle navigator (prev/next) for older cycles
- [ ] Rollover toggle change: history recalculates + confirmation
- [ ] Mid-cycle config change: retroactive + confirmation
- [ ] Active/Inactive toggle works
- [ ] Settings tab: all config editable
- [ ] Balance always computed fresh (no stale data)
- [ ] Auto-report cron skeleton ready (trigger logic, report generation in Phase 2)
