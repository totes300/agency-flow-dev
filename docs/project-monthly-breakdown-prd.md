# Project Monthly Breakdown — PRD

> Last updated: 2026-04-21
> Status: Design validated via interactive HTML prototype (`prototype-monthly-breakdown.html`)
> Prototype: `/prototype-monthly-breakdown.html` (open in browser for visual reference)

---

## What This Is About

The **Overview tab** on every project detail page shows a monthly time breakdown below the project finances / summary card. Today this breakdown is split across three divergent implementations (T&M, Fixed, Retainer), uses a nested category-rowgroup layout that's hard to scan, and retainer especially is visually cluttered with decorative elements (CycleDots, balance badges, 3-col stat grid, cycle spines) that obscure the important numbers.

This PRD unifies all three into a **single component** with a clean, Notion/ClickUp-style visual language. Retainer gets special treatment for rollover/deficit tracking and cycle identity, but uses the same primitives.

### Goals

1. **One unified component** for all three project types — type-specific differences are adapter-driven data, not branch logic.
2. **Flat task list** — drop nested category rowgroups, category becomes a pill column.
3. **Cycle clarity** on retainer — make rollover chain and cycle settlement visually verifiable.
4. **Minimal chrome** — no decorative spines, no duplicate balance signals, tipography + spacing carry hierarchy.
5. **Plain-English microcopy** — drop jargon (`forfeit`, `overage`, `allotment`, `settlement`).

### Non-goals (v1)

- Reworking the Project Finances / Project Summary card above the breakdown.
- Insights / trend views across cycles.
- Editing time entries inline in the overview.
- Export / PDF generation of the breakdown.

---

## Current State (what we're replacing)

| Project type | Uses | Wrapper |
|---|---|---|
| **T&M** (`tm-overview.tsx:78`) | `MonthlyTimeBreakdown` → `MonthTaskTable` | `SectionCard` per month, `showAmounts` |
| **Fixed** (`fixed-overview.tsx:90`) | `MonthlyTimeBreakdown` → `MonthTaskTable` | Same, `showAmounts={false}` |
| **Retainer** (`retainer-overview.tsx:139-223`) | Custom `<Accordion>` in `<Card>` + `MonthTaskTable` directly | Per-month: `CycleDots`, `RetainerBalanceBadge`, 3-col Start/Available/Worked grid, "Invoice this month" button per closed month |

**Shared pain points (all three):**
- `MonthTaskTable` uses a nested `CategorySection` rowgroup (grey header bar) that adds a visual layer without scan benefit.
- Redundant `Status` column (always "Billable" on T&M/Fixed overviews), `Entries` column almost always `1`.
- No per-task Amount column on T&M (you can see $1,850 in Project Finances but not which task earned how much).

**Retainer-specific pain points:**
- CycleDots are decorative only.
- `RetainerBalanceBadge` + `endBalance` number + `worked/available` all signal the same thing 3 ways.
- 3-col Start/Available/Worked grid inside expanded month = debug info, not user-facing clarity.
- No visible chain verification: you can't see "Feb's balance = Mar's rollover" without mental math.
- Cycle identity is implicit — you can't tell which months belong to the same cycle at a glance.
- Past cycles are not surfaced at all — user has to change `?cycleOffset=` manually.

---

## Design Decisions (validated via prototype)

### D1 — One component, adapter-driven data shape

All three overviews call **one React component** (working name: `ProjectMonthlyBreakdown`). The component has no `billingType` awareness. Differences are carried as optional fields on each month row.

### D2 — Flat task table

Category moves from rowgroup header to a pill column (tinted text + dot). Columns: `Task · Category · Last logged · Entries · Hours · Amount?`. `Status` column dropped. `Entries` cell rendered empty when `=== 1`.

### D3 — Retainer cycle identity = badge + settlement row (no spine, no header bar)

Each month row gets a tiny `N/M` badge (e.g. `1/3`, `2/3`, `3/3`). The closing month (`3/3`) has a subtly tinted badge variant. Right after the closing month (inside the same card), a **settlement row** appears with: `Worked / Plan · Net · Extra amount · [Invoice extra hours]` CTA. Settlement row **only renders when cycle is closed** (`isCycleClosed`).

No cycle header bar, no vertical spine, no CycleDots, no RetainerBalanceBadge.

### D4 — Ledger strip (retainer only, inside expanded month)

When a retainer month is expanded, above the task table, render a horizontal ledger strip showing the 4-part balance formula:

```
START      +      BUDGET      −      USED      =      END
+5:00             40:00              38:00            +7:00
```

This makes the rollover chain manually verifiable: Feb's `End` should equal March's `Start`. The prototype explicitly aligns these columns vertically.

### D5 — Past cycles, fixed-grid table

Separate section under a `Past cycles` heading. 4-column fixed grid per row: `[Cycle name + date range]  [outcome chip]  [invoice chip]  [···]`. Hours numbers drop from the collapsed row (available on expand). Kebab menu for rare actions (view statement, open invoice, export).

Three outcome variants visually:
- `−X:00 over` (red chip)
- `+X:00 unused` (neutral/slate chip — see microcopy decision)
- `balanced` (neutral chip, zero delta case)

### D6 — Microcopy: plain US English

Drop jargon throughout:

| Before | After |
|---|---|
| `forfeit` | `unused` |
| `on target` / `on budget` | `balanced` |
| `Cycle settlement` | `Cycle N closed` |
| `overage` | `extra` / `extra hours` |
| `Invoice overage →` | `Invoice extra hours →` |
| `Rollover` (ledger) | `Start` |
| `Allotment` (ledger) | `Budget` |
| `Worked` (ledger) | `Used` |
| `Balance` (ledger) | `End` |

### D7 — Number hierarchy: used = bold, plan = muted

Everywhere we render `worked / plan` (e.g. `35:00 / 40:00`), the **used** number is `font-weight: 600` and `/ 40:00` is muted. Makes the actively-changing number scan-first.

### D8 — Unused chip = neutral, not amber

Semantically, unused hours aren't a warning (client already paid). Use a neutral slate chip (`end-target` variant). Red (`over`) is the only signal color in past cycle outcome.

### D9 — Settlement row: neutral background, color on text only

Drop the colored tint backgrounds (red/amber/green). Keep the settlement row's background `bg-muted`. Color applies only to the `−3:00 over` / `+X unused` values. Less visual noise, signal stays with the numbers.

### D10 — Kebab menu = hover-only

On past-cycle rows, `···` button has `opacity: 0` by default, `opacity: 1` on row hover. Scales cleanly when the list grows. Notion pattern.

---

## Component API

### `ProjectMonthlyBreakdown`

```ts
type MonthRow = {
  id: string                          // unique per row (month-key)
  label: string                       // "April 2026"
  taskCount: number

  // Right-aligned header stats
  primaryStat: {
    used: string                      // formatMinutes — "35:00"
    plan?: string                     // "40:00" (retainer only — null for T&M/Fixed)
  }
  secondaryStat?: string              // "$1,850.00" (T&M only)
  endBalanceChip?: {                  // Retainer only — colored pill on the right
    value: string                     // "+5:00" | "−3:00"
    tone: "under" | "over" | "target"
  }

  // Retainer-only: position within cycle
  cyclePosition?: {
    current: number                   // 1
    total: number                     // 3
    isClosing: boolean                // current === total
  }

  // Retainer-only: full ledger (shown inside expanded state)
  ledger?: {
    startMinutes: number              // rollover in
    budgetMinutes: number             // monthly allotment
    usedMinutes: number
    endMinutes: number
  }

  // Task rows (all types)
  tasks: TaskRow[]
  showAmounts: boolean                // T&M: true, Fixed/Retainer: false

  // Optional in-month footer action (retainer: "View INV-NNN" on closed months with invoice)
  footerAction?: React.ReactNode
}

type TaskRow = {
  taskId: string
  title: string
  categoryName: string | null         // null → "Uncategorized"
  categoryColor: string               // hex or tailwind-compatible color
  lastDate: string                    // ISO date
  entryCount: number
  totalMinutes: number
  amount?: number                     // T&M only (per-task $ billable)
  // Mixed-billable indicator (optional second-line under task title)
  mixedBilling?: {
    billableMinutes: number
    nonBillableMinutes: number
  }
}

type CycleSettlement = {
  cycleNumber: number                 // 3
  label: "closed" | "in_progress"     // closed → renders settlement row; in_progress → no settlement row
  // Only populated when label === "closed":
  totalUsedMinutes: number
  totalBudgetMinutes: number
  netMinutes: number                  // totalBudget - totalUsed (can be negative)
  netTone: "over" | "unused" | "balanced"
  extraAmount?: number                // in currency, when over + overageRate set
  extraCalc?: { minutes: number; rate: number }  // for "3:00 × $150/h"
  currency: string
  invoiceAction?: {                   // button on the right side
    label: string                     // "Invoice extra hours →"
    onClick: () => void
  }
}

type PastCycle = {
  cycleNumber: number
  label: string                       // "Nov 2025 – Jan 2026"
  outcome: {
    tone: "over" | "unused" | "balanced"
    text: string                      // "−6:00 over" | "+2:00 unused" | "balanced"
  }
  invoice?: {
    number: string                    // "INV-038"
    status: "paid" | "pending"
    href: string                      // link to invoice detail
  }
  // Lazy-loaded on expand:
  months?: MonthRow[]                 // undefined until expanded
  settlement?: CycleSettlement        // settlement info for the past cycle
}

type ProjectMonthlyBreakdownProps = {
  currentCycleMonths: MonthRow[]      // 1-N months of the current cycle (or all months for T&M/Fixed)
  currentCycleSettlement?: CycleSettlement  // retainer only; absent = not applicable
  pastCycles?: PastCycle[]            // retainer only; empty or undefined = no past cycles section
  onTaskClick: (taskId: string) => void
  onLoadPastCycle?: (cycleNumber: number) => Promise<void>  // lazy loader
}
```

### Three thin adapters

Each overview component (`tm-overview.tsx`, `fixed-overview.tsx`, `retainer-overview.tsx`) wires its existing Convex data into this shape.

**T&M adapter** (from `api.timeEntries.projectMonthlyBreakdown`):
```ts
{
  primaryStat: { used: formatMinutes(m.totalMinutes) },
  secondaryStat: formatCurrencyPrecise(m.totalAmount, currency),
  tasks: mergeBillableNonBillable(m),
  showAmounts: true,
  // no cyclePosition, no ledger, no endBalanceChip
}
```

**Fixed adapter** (same source):
```ts
{
  primaryStat: { used: formatMinutes(m.totalMinutes) },
  tasks: mergeBillableNonBillable(m),
  showAmounts: false,
}
```

**Retainer adapter** (from `api.projects.getRetainerData`):
```ts
{
  primaryStat: {
    used: formatMinutes(m.workedMinutes),
    plan: formatMinutes(m.available),    // includes rollover
  },
  endBalanceChip: { value: signedMinutes(m.endBalance), tone: deriveTone(m) },
  cyclePosition: {
    current: m.cyclePosition,
    total: cycleLength,
    isClosing: m.cyclePosition === cycleLength,
  },
  ledger: {
    startMinutes: m.startBalance,
    budgetMinutes: monthlyAllotment,
    usedMinutes: m.workedMinutes,
    endMinutes: m.endBalance,
  },
  tasks: mergeBillableNonBillable(m),
  showAmounts: false,
  footerAction: m.invoice ? <ViewInvoiceLink {...m.invoice} /> : undefined,
}
```

### Backend additions needed

Most data exists. Gaps:

1. **`api.projects.getRetainerData`** currently returns the current cycle only. Need to extend or add:
   - `currentCycleSettlement` aggregate when `isCycleClosed`
   - `pastCycles: PastCycle[]` — list of closed cycles with outcome + invoice status, **WITHOUT** the full month detail (months fetched lazily)
2. **`api.projects.getRetainerCycleDetail(cycleNumber)`** — new query, lazy-loads the months + settlement for a specific past cycle when the user expands it. Reuses the same month-computation logic as `getRetainerData`.

Alternative: include all past cycles up front if the typical project has <5 cycles. Measure during implementation.

---

## Visual Spec

**Source of truth: `prototype-monthly-breakdown.html`** at the repo root. Open in browser. Every visual decision is implemented there.

### Colors (use existing CSS variables / Tailwind classes)

| Token | Hex | Usage |
|---|---|---|
| `--fg` | `#0f172a` | Primary text (numbers, month names) |
| `--fg-muted` | `#64748b` | Secondary text (dates, task counts) |
| `--fg-subtle` | `#94a3b8` | Tertiary text (`/ 40:00`, ledger labels) |
| `--border` | `#e2e8f0` | Card borders |
| `--border-soft` | `#eef2f7` | Row dividers |
| `--bg-muted` | `#f8fafc` | Hover, ledger strip bg, settlement row bg |
| Chip over | bg `#fef2f2` / text `#dc2626` | `end-over` |
| Chip unused | bg `#f0f5fb` / text `#334155` | `end-target` (neutral — per D8) |
| Chip target | bg `#f0f5fb` / text `#334155` | `end-target` |

### Typography

- Month name: `font-weight: 500`, `text-[15px]` (slate-900)
- Task count inline: `text-[12px]` subtle (`· 6 tasks`)
- Primary stat main: `font-weight: 600`, `text-[14px]` tabular
- Primary stat sub: `font-weight: 400`, `text-[14px]` subtle tabular
- Chip: `text-[12px]`, `font-weight: 500`, `px-2 py-0.5` pill
- Cycle badge: `text-[11px]`, `font-weight: 500`, `px-1.5 h-[18px]`, `border rounded`
- Group heading ("Current cycle", "Past cycles"): `text-[11px]`, uppercase, `letter-spacing: 0.08em`, `color: var(--fg-subtle)`

### Spacing (match prototype)

- Month row: `py-3 px-4`
- Past cycle row: `py-3 px-4`, grid `minmax(240px, 1fr) 140px 140px 2rem`
- Ledger strip: `px-5 py-3.5`, grid `1fr auto 1fr auto 1fr auto 1fr`, indented `margin-left: 1.75rem`
- Settlement row: `py-3 px-4 pl-7.5` (left-indented ~30px to align with chevron column)
- Task table: `margin-left: 1.75rem` (same indent as ledger)

---

## Microcopy Spec

All strings, in order they appear in the UI:

| Location | String |
|---|---|
| Group heading above current cycle (retainer only) | `Current cycle` |
| Group heading above past cycles | `Past cycles` |
| Cycle badge | `1/3`, `2/3`, `3/3` (computed from position) |
| Month row task count | `{n} tasks` / `{n} task` |
| End-balance chip (retainer) | `+5:00` or `−3:00` (signed, tabular) |
| Settlement row label | `Cycle {N} closed` |
| Settlement row stats | `{used} / {plan} used` · `{net} over` / `{net} unused` / `balanced` · `Extra {$amount} ({mm:ss} × ${rate}/h)` |
| Settlement row button (over) | `Invoice extra hours →` |
| Past cycle outcome chip — over | `−{N:MM} over` |
| Past cycle outcome chip — unused | `+{N:MM} unused` |
| Past cycle outcome chip — balanced | `balanced` |
| Invoice status chip — paid | `{invoiceNumber} · paid` |
| Invoice status chip — pending | `{invoiceNumber} · pending` |
| Ledger labels | `Start`, `Budget`, `Used`, `End` |
| Ledger operators | `+`, `−`, `=` (muted, structural — don't translate as plus/minus/equals aria-labels — use the math as-is) |
| Empty month task list | `No time logged this month.` |
| Empty past cycles (new retainer) | (section hides — no "no past cycles" placeholder) |

**Rule:** no `forfeit`, no `overage`, no `settlement` (except in the internal type name `CycleSettlement`), no `rollover` in user-facing copy (ledger says `Start`).

---

## Accessibility Requirements

### Interactive elements must use `<button>`, not `<div onclick>`

All three collapsible row types (month row, past-cycle row, and expandable task rows if we add them) render as `<button type="button">`. Use `flex` + `w-full` + `text-left` to preserve the row layout.

### ARIA

- Collapsible row: `aria-expanded={boolean}` + `aria-controls={content-id}`
- Kebab button: `aria-label="More actions for Cycle {N}"`
- Cycle badge: `aria-label="Month {current} of {total} in cycle"`
- End-balance chip: `aria-label` converts `+5:00` → `"5 hours under budget this month"`, `−3:00` → `"3 hours over budget this month"`
- Outcome chip: same pattern — `"2 hours unused this cycle"`, `"6 hours over this cycle"`, `"balanced this cycle"`
- Invoice chip: `aria-label="Invoice {number}, {status}"` + the chip itself is a link (`<a>`) pointing to `/invoices/[id]`

### Focus

- All interactive rows get `focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1` (match existing codebase `task-name-btn` style).
- Tab order: chevron-expanding row → its kebab (if any) → next row.

### Keyboard

- Enter/Space on a row toggles expand.
- Escape on an expanded row closes it (not mandatory v1, nice to have).

### Color contrast

- Test `end-over` (text `#dc2626` on `#fef2f2`) and `end-target` (text `#334155` on `#f0f5fb`) for WCAG AA (4.5:1 text contrast). Adjust if borderline.

---

## Responsive Behavior

### Breakpoint strategy

Tailwind default breakpoints. Primary breakpoint is `sm` (640px).

### `< 640px` (mobile)

- **Past cycle row**: grid breaks into 2 visual rows per item. Row 1: chevron + cycle name + date range. Row 2 (indented): outcome chip + invoice chip + kebab (flex, gap-2).
- **Ledger strip**: 7-col grid collapses to 2×2 layout. Row 1: `Start + Budget`. Row 2: `Used = End`. Operators remain inline.
- **Task table**: hide `Category` and `Entries` columns. Keep `Task`, `Last logged`, `Hours`, `Amount` (T&M).
- **Month row**: keep single line but allow right-side stats to shrink — drop the space around primary stat if needed.
- **Settlement row**: already wraps (`flex-wrap`). Stack vertically on tight viewports; button drops below.

### `≥ 640px`

Full layout as in the prototype.

### `≥ 1024px`

No changes — prototype already targets this width.

---

## Edge Cases / State Handling

### Retainer — cycle in progress

- **Current cycle has months, but `isCycleClosed === false`**: do not render the settlement row. Optionally render a lightweight hint at the bottom of the card: `Cycle {N} in progress · {closed} of {total} months closed` in muted text. (Lower priority — can defer to P2.)

### Retainer — brand-new, no cycles

- No Past cycles section renders.
- Current cycle card shows the months that exist (might be just 1 row).

### Retainer — `cycleLength === 1` (monthly cycles)

- Cycle badge **hidden** (no-op info — `1/1` on every row is noise).
- Every month is a closing month — settlement row appears after every closed month.

### Retainer — negative start balance (rolled-over deficit)

- Ledger `Start` renders `−X:00` in red.
- The math `Start + Budget − Used = End` still works. End balance can go more negative.

### Retainer — past cycle invoice not yet paid

- Invoice chip: `INV-038 · pending` (amber `.inv-chip.pending`).

### Retainer — past cycle has no invoice (unused / balanced)

- Invoice column renders `—` subtle em-dash.

### Month with no logged time

- Tasks array empty → task table area renders `<EmptyMonthState />` component with copy: `No time logged this month.` Centered, muted, `py-8`.
- Ledger still renders (retainer) with `Used: 0:00`.

### Month with mixed billable / non-billable time

- Task row: under the task title, render a small muted second line: `{billable} billable · {nonBillable} non-billable` (matches current `MonthTaskTable` mixed-variant behavior but inline, not in Status column).

### T&M / Fixed — no months at all

- Task breakdown area renders nothing (the existing `TimeLogPlaceholder` / empty state from `monthly-time-breakdown.tsx` stays).

### Settlement row overage but `overageRate === 0`

- Render the settlement row with `over` tone on the `−3:00 over` stat.
- Omit the `Extra $amount` stat.
- Replace the `Invoice extra hours →` button with a muted inline note: `Set overage rate in settings to bill extra hours.` with a link to the Retainer settings section.

---

## File-Level Changes

### Create

- `components/projects/monthly-breakdown/project-monthly-breakdown.tsx` — main component
- `components/projects/monthly-breakdown/month-row.tsx` — collapsible month row
- `components/projects/monthly-breakdown/month-ledger-strip.tsx` — retainer ledger (4-part formula)
- `components/projects/monthly-breakdown/flat-task-table.tsx` — replaces `MonthTaskTable`
- `components/projects/monthly-breakdown/cycle-badge.tsx` — the `N/M` indicator
- `components/projects/monthly-breakdown/cycle-settlement-row.tsx` — inline settlement row
- `components/projects/monthly-breakdown/past-cycle-row.tsx` — grid row for past cycles
- `components/projects/monthly-breakdown/past-cycle-kebab-menu.tsx` — `···` dropdown
- `components/projects/monthly-breakdown/end-balance-chip.tsx` — `+5:00` / `−3:00` pill
- `components/projects/monthly-breakdown/outcome-chip.tsx` — `over` / `unused` / `balanced` pill
- `components/projects/monthly-breakdown/invoice-chip.tsx` — `INV-NNN · paid/pending` link
- `components/projects/monthly-breakdown/empty-month-state.tsx`
- Adapters co-located OR inside each overview file (`tm-overview.tsx` etc.) — pick whatever reads cleaner. Preference: one file per adapter under `lib/adapters/monthly-breakdown/`.

### Refactor / replace

- `tm-overview.tsx`: replace `MonthlyTimeBreakdown` usage with `ProjectMonthlyBreakdown` + `tmAdapter(monthlyData)`.
- `fixed-overview.tsx`: same pattern, `fixedAdapter(monthlyData)`.
- `retainer-overview.tsx`: **remove** the inline `<Card><Accordion>…</Accordion></Card>` structure entirely. Replace with `ProjectMonthlyBreakdown` + `retainerAdapter(getRetainerData, pastCycles)`. Keep the overage alerts (`<Alert>` blocks above) as-is — they're a separate concern.

### Backend

- `convex/projects.ts` — extend `getRetainerData` to include:
  - `currentCycleSettlement` when `isCycleClosed`.
  - Or add new query `api.projects.listRetainerCycles(projectId)` returning past-cycle summaries (cycleNumber, label, outcome, invoice).
- `convex/projects.ts` — add `api.projects.getRetainerCycleDetail(projectId, cycleNumber)` for lazy-load on past-cycle expand.

### Delete (after migration)

- `components/projects/monthly-time-breakdown.tsx`
- `components/projects/month-task-table.tsx`
- Any `MonthCard`, `CategorySection` helpers that become unused.
- `CycleDots` (`components/cycle-dots.tsx`) — if only used by retainer overview, delete. Grep first.
- `RetainerBalanceBadge` (`components/retainer-balance-badge.tsx`) — same.
- The 3-col Start/Available/Worked grid block inside `retainer-overview.tsx:166-178`.
- Per-month "Invoice this month" button on closed months (`retainer-overview.tsx:194-218`) — moved into `CycleSettlementRow`.

---

## Implementation Checklist

### Foundation

- [ ] Create `components/projects/monthly-breakdown/` directory structure.
- [ ] Build `ProjectMonthlyBreakdown` skeleton with typed props matching the API above.
- [ ] Build `MonthRow`, `FlatTaskTable`, `EndBalanceChip`, `OutcomeChip`, `InvoiceChip`, `CycleBadge` leaves.
- [ ] Build `MonthLedgerStrip` with the 4-part formula + operator glyphs.
- [ ] Build `CycleSettlementRow` with invoice CTA + overage-rate-missing state.
- [ ] Build `PastCycleRow` with the fixed 4-col grid + `PastCycleKebabMenu`.
- [ ] Build `EmptyMonthState`.

### Adapters

- [ ] `lib/adapters/monthly-breakdown/tm.ts` — takes `monthlyData` + currency, returns `ProjectMonthlyBreakdownProps`.
- [ ] `lib/adapters/monthly-breakdown/fixed.ts` — same minus amounts.
- [ ] `lib/adapters/monthly-breakdown/retainer.ts` — from `getRetainerData` + optional `pastCycles`. Includes `cyclePosition`, `ledger`, `endBalanceChip` per month; `CycleSettlement` aggregation when closed.

### Backend (Convex)

- [ ] Extend `api.projects.getRetainerData` or add new queries for past cycles (decide based on perf — past cycles can be heavier, prefer separate lazy query).
- [ ] Add `api.projects.listRetainerCycles(projectId)` — summary per closed cycle.
- [ ] Add `api.projects.getRetainerCycleDetail(projectId, cycleNumber)` — full month data for one past cycle.
- [ ] All queries must filter by `orgId` (per CLAUDE.md).

### Wire up overviews

- [ ] Replace body of `tm-overview.tsx` monthly section with adapter + `ProjectMonthlyBreakdown`.
- [ ] Replace body of `fixed-overview.tsx` monthly section.
- [ ] Replace body of `retainer-overview.tsx` accordion section.
- [ ] Verify all three overviews render identically to the prototype at `≥1024px` width.

### Accessibility

- [ ] All rows use `<button>` with `aria-expanded` / `aria-controls`.
- [ ] Kebab button `aria-label` per row.
- [ ] Cycle badge `aria-label`.
- [ ] Chip `aria-label` for balance/outcome/invoice.
- [ ] Focus-visible ring on all interactive elements.
- [ ] Manual keyboard-nav test: Tab through rows, Enter expands, all content reachable.
- [ ] WCAG AA contrast check on chips (axe DevTools).

### Responsive

- [ ] `< 640px` breakpoint: past-cycle row 2-line layout.
- [ ] `< 640px` breakpoint: ledger 2×2 layout.
- [ ] `< 640px` breakpoint: task table hides Category + Entries columns.
- [ ] Manual test on iPhone 13 mini width (375px).

### Edge cases

- [ ] Cycle in progress → no settlement row.
- [ ] `cycleLength === 1` → hide cycle badge, settlement after every month.
- [ ] Negative `startMinutes` (rolled-over deficit) → red `Start` in ledger.
- [ ] Past cycle with no invoice → `—` in invoice column.
- [ ] Past cycle pending invoice → amber `.inv-chip.pending`.
- [ ] Month with zero tasks → `EmptyMonthState`.
- [ ] Mixed billable/non-billable task → inline second-line on task row.
- [ ] Overage without `overageRate` → inline note instead of CTA button.

### Cleanup

- [ ] Delete `MonthlyTimeBreakdown`, `MonthTaskTable` when no longer imported anywhere.
- [ ] Grep `CycleDots` usage; delete if zero references remain.
- [ ] Grep `RetainerBalanceBadge` usage; delete if zero.
- [ ] Remove the 3-col grid + per-month invoice button blocks from `retainer-overview.tsx`.
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `npm run lint` → 0 errors.
- [ ] Update `docs/backlog.md` with this refactor marked done.

### Post-merge validation

- [ ] Manual walkthrough of all three project types in dev (create one of each if needed).
- [ ] Retainer: expand a month, verify ledger math: `Start + Budget − Used = End`.
- [ ] Retainer: verify `Feb.End === Mar.Start`, `Mar.End === Apr.Start` across consecutive months.
- [ ] Retainer: close a cycle (manually set `isCycleClosed` in a test project), verify settlement row renders.
- [ ] Retainer: past cycle with an invoice → click invoice chip → navigates to `/invoices/[id]`.
- [ ] Retainer: past cycle kebab → open menu → actions visible (even if stubs).
- [ ] Keyboard-only walk-through of all three overviews.

---

## Decisions Still Pending (confirm before build)

These came up at the end of design review. Defaults in bold — agent should use these unless overridden:

1. **Unused-outcome chip color**: neutral (slate) vs amber → **neutral**.
2. **Settlement row background**: neutral-muted with only text colored vs tinted → **neutral-muted, text-colored**.
3. **Invoice CTA wording**: `Invoice extra hours →` vs `Bill extra hours →` → **`Invoice extra hours →`** (matches "Create Invoice" pattern elsewhere in the app).
4. **Zero-delta cycle outcome chip text**: `balanced` vs `exact` vs `0:00` → **`balanced`**.
5. **"Cycle {N} in progress" hint** on non-closed current cycles → **defer to P2** (ship without it, add later if users ask).
6. **Retainer contract summary line** (`40h/month · 3-month cycles · $150/h extra · rollover on`) above the breakdown → **defer to P2**.

---

## Out of Scope

- Redesigning Project Summary Card / Project Finances card above the breakdown.
- Cross-cycle trend visualization (Insights tab territory).
- Pagination / "Show older" for past cycles (add when a real project has >10 cycles).
- Export / PDF of cycle statements (kebab menu is a placeholder for this).
- Inline time-entry editing from the breakdown.
- Notifications / alerts on cycle close.

---

## References

- Prototype: `/prototype-monthly-breakdown.html` (visual source of truth)
- Existing overview files: `components/projects/tm-overview.tsx`, `fixed-overview.tsx`, `retainer-overview.tsx`
- Existing breakdown components (to delete): `components/projects/monthly-time-breakdown.tsx`, `components/projects/month-task-table.tsx`
- Backend data: `convex/timeEntries.ts` (`projectMonthlyBreakdown`), `convex/projects.ts` (`getRetainerData`)
- Design memory: `feedback_badge_design.md`, `feedback_design_process.md`, `feedback_no_custom_components.md`
- Related PRDs: `docs/invoicing-prd.md` (for the "Invoice extra hours" CTA target behavior)
