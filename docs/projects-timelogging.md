# Project Time Logging — Implementation Plan

> **Goal**: Wire real time entry data into all 3 project overview types (Fixed, T&M, Retainer) and build the shared monthly time log breakdown.
> **Depends on**: Phase 7 (Time Tracking) — timer + manual entry already implemented.
> **Breaks into 7 committable phases** (0, A0, A, B, C, D, E) — each testable independently.

---

## Current State

### What exists

- `convex/timeEntries.ts` — Full CRUD: `listByTask`, `listToday`, `sumByTasks`, `sumByProject`, `create`, `update`, `remove`
- `convex/timer.ts` — Server-side timer: start, stop, pause, resume, discard
- `convex/projects.ts` — `list`, `get`, `create`, `update`, `archive`, `restore`, `remove`, `getRetainerData`, `updateRetainer`
- `convex/projectCategoryEstimates.ts` — Fixed budget estimate CRUD
- `convex/lib/rates.ts` — Rate snapshot resolver (`resolveRate`)
- `convex/lib/orgHelpers.ts` — `getOrgSettings`, `buildRateContext`

### Frontend components that exist but show hardcoded zeros

| Component | File | What's hardcoded |
|-----------|------|-----------------|
| `FixedOverview` | `components/projects/fixed-overview.tsx` | `actualHours = 0 // Phase 7` on line 37. Per-category table Actual/Remaining columns hardcoded to 0. |
| `TmOverview` | `components/projects/tm-overview.tsx` | All 4 MetricCards hardcoded: `"0h"`, `"$0"`, `"Never"`, `"—"` |
| `RetainerOverview` | `components/projects/retainer-overview.tsx` | `workedMinutes = 0; // Phase 7: real data` on line 493 of projects.ts. Month entries/taskCount are 0. |
| `TimeLogPlaceholder` | `components/projects/time-log-placeholder.tsx` | Static empty state — needs to be replaced with real monthly breakdown. |
| Project header | `app/(dashboard)/projects/[id]/page.tsx` line 138 | `"Last logged: —"` hardcoded |

### Shared UI components available

- `MetricCard` (`components/metric-card.tsx`) — label, value, detail, variant (default/destructive/warning)
- `CategoryBadge` (`components/category-badge.tsx`) — colored badge with name
- `BudgetProgress` (`components/budget-progress.tsx`) — progress bar with used/budget
- `HealthBadge` (`components/health-badge.tsx`) — On track / At risk / Over budget
- `formatMinutes`, `formatCurrency`, `formatCurrencyPrecise`, `formatShortDate` in `lib/format.ts`

### Schema (relevant tables)

```
timeEntries: taskId, userId, date (YYYY-MM-DD), durationMinutes, isBillable, method,
             appliedRate, appliedCostRate, appliedBillRate, note, createdAt
tasks:       projectId, workCategoryId, billable, title, assigneeIds
projects:    billingType, currency, fixedPrice (Phase 0), hourlyRate, tmRateMode, tmCategoryRates,
             includedMinutesPerMonth, overageRate, startDate, rolloverEnabled, cycleLength
projectCategoryEstimates: projectId, workCategoryId, estimatedMinutes, internalCostRate, clientBillingRate
workCategories: name, color
```

Key indexes: `timeEntries.by_taskId`, `tasks.by_orgId_projectId`, `projectCategoryEstimates.by_projectId`

---

## Approved Layouts

### Final UI Contract

This section is the **single source of truth** for what each overview must render in v1. If any earlier section is less specific, follow this contract.

#### Fixed — final overview contract

- Top metric cards (3-column row):
  - `Fixed Fee`
  - `Actual`
  - `Profit`
- `Budget Used` is grouped with the per-category breakdown section (not a top metric card).
- Top metrics use **all logged time**.
- Fixed projects require a mandatory `fixedPrice`.
- Without `fixedPrice`, `Profit` and `Effective Rate` cannot be computed.
- Monthly breakdown uses the shared `MonthlyTimeBreakdown`.
- Fixed monthly breakdown must also use **all logged time** so it reconciles with the top metrics.
- Within each month, `Billable Work` and `Non-billable Work` should still be shown as separate sections for clarity.

#### T&M — final overview contract

- Top metric cards:
  - `Billable Logged`
  - `Non-billable`
  - `Uninvoiced`
  - `Last 3 Months`
- `Billable Logged` and `Uninvoiced` use billable entries only.
- `Non-billable` uses non-billable entries only and exists for owner/operator visibility into write-offs and margin leakage.
- Monthly breakdown uses the shared `MonthlyTimeBreakdown`.
- Each expanded month must keep billable and non-billable work visibly separate:
  - `Billable Work`
  - `Non-billable Work`
- No billable/non-billable toggle is shown in v1.

#### Retainer — final overview contract

- Top metric cards:
  - `Billable Used`
  - `Non-billable`
  - `Over Budget`
  - `Overage Due`
- `Billable Used`, `Over Budget`, and `Overage Due` are based on billable entries only.
- `Non-billable` uses non-billable entries only and exists for owner/operator profitability visibility.
- Retainer uses its own accordion layout, not `MonthlyTimeBreakdown`.
- Each expanded month must show two separate sections when relevant:
  - `Billable Work` — this drives contract consumption
  - `Non-billable Work` — this explains the separate top-level non-billable metric

#### Query ownership by overview

- `timeEntries.projectOverview` must provide everything needed by:
  - Fixed top metrics except `fixedPrice`
  - T&M top metrics
  - project header `Last activity`
- `projects.get` must provide:
  - `fixedPrice` for Fixed projects
  - project header metadata
- `timeEntries.projectMonthlyBreakdown` must provide everything needed by:
  - Fixed monthly breakdown
  - T&M monthly breakdown
- `projects.getRetainerData` must provide everything needed by:
  - Retainer top metrics
  - Retainer month accordion rows
- `Invoices` tab is a separate workflow area and is **not** part of the overview implementations in this plan.

#### Required backend fields

- `timeEntries.projectOverview` must return:
  - `totalMinutes`
  - `totalBillableMinutes`
  - `totalNonBillableMinutes`
  - `lastLoggedDate`
  - `thisMonthMinutes`
  - `last3BillableMonths`
  - `minutesByCategory`
  - `billableMinutesByCategory`
  - `totalActualCost` (Fixed-only semantic field)
  - `uninvoicedMinutes`
  - `uninvoicedAmount`
- `projects.get` must return / already expose:
  - `fixedPrice` for Fixed projects
- Fixed project create/update flows must support:
  - storing and editing `fixedPrice`
- `projects.getRetainerData` must additionally return top-level:
  - `totalNonBillableMinutes` — scoped to the **current cycle only** (matching cycle scope of all other top metric cards)
  - alongside the existing balance/overage fields

#### Naming note

- `billable` / `non-billable` is **not** a property of the work category.
- It is a property of the logged time entry (`entry.isBillable`), and in practice the month section it belongs to.
- The reporting shape should therefore:
  1. split entries into `billable` vs `non-billable`
  2. then group each section by work category for readability
- Avoid names like `billableCategories` that suggest the category itself is billable.
- Prefer names like:
  - `billableCategoryGroups`
  - `nonBillableCategoryGroups`
  or shorter:
  - `billableGroups`
  - `nonBillableGroups`

- Use `Profit` in the Fixed overview.
- Definition: `Fixed Price - Actual Cost`.
- `Actual Cost` is realized labor cost from time entry snapshots: `Σ(entry hours × entry appliedCostRate)`.
- Show `Effective Rate` as the secondary detail under the `Profit` card.
- `totalActualCost` is only meaningful for Fixed projects in this plan.
- For T&M and Retainer, do not treat `totalActualCost` as a profitability metric.

#### Rate setup note

- `uninvoicedAmount` is a **T&M-only** metric in this plan.
- It must use `appliedRate`, not `appliedBillRate`.
- Fixed uses `fixedPrice` for revenue and `appliedCostRate` for realized cost.
- Retainer uses included usage and overage math, not entry-level uninvoiced totals.

### Fixed Project Overview

```
┌────────────────────────┬──────────────────────────┬──────────────────────────┐
│ Fixed Fee              │ Actual                   │ Profit                   │
│ €18,000.00             │ 120:00                   │ €13,170.00               │
│                        │ Labor cost €4,830.00     │ Effective rate €150.00/h │
└────────────────────────┴──────────────────────────┴──────────────────────────┘

Info banner: "Fixed-fee projects track delivery against estimated effort and labor cost."

BUDGET & CATEGORY BREAKDOWN (grouped section):
  Overall: 60% — 120:00 / 200:00  [████████░░░░]
  ┌─────────────┬──────────┬────────┬───────────┬──────────┐
  │ Category    │ Estimated│ Actual │ Remaining │ Progress │
  │ Design      │ 80:00   │ 40:00  │ 40:00     │ 50%      │
  │ Development │ 120:00  │ 80:00  │ 40:00     │ 67%      │
  └─────────────┴──────────┴────────┴───────────┴──────────┘

TIME LOG (shared monthly breakdown component)
```

**Metric definitions:**
- **Fixed Fee** = `fixedPrice`. This is the sold fixed project fee.
- **Actual** = `totalActualMinutes` formatted as HH:MM.
  - Detail: `Labor cost {totalActualCost}`
  - This intentionally shows the same delivery effort in time and money.
- **Profit** = `fixedPrice - totalActualCost`. Green when positive, red (destructive) when negative.
  - `fixedPrice` = the explicit fixed project sale price
  - `fixedPrice` is required for Fixed projects
  - `totalActualCost = SUM(entry.durationMinutes / 60 * entry.appliedCostRate)` across all project entries
  - This is true project profitability against the sold fixed fee, based on realized cost snapshots rather than estimate assumptions.
- **Profit detail** = `Effective Rate = fixedPrice / totalActualHours`.
  - If `totalActualMinutes === 0`, show `"—"` as the detail line.
- **Budget Used** = `(totalActualMinutes / totalEstimatedMinutes) * 100`. Progress bar underneath.
  - Detail: `{totalActualMinutes} / {totalEstimatedMinutes}`
  - If `totalEstimatedMinutes <= 0`, show `"No estimate set"` instead of a percentage or progress bar.

### T&M Project Overview

```
┌────────────────┬────────────────┬────────────────────┬───────────────────────┐
│ Uninvoiced     │ Billable Time  │ Non-Billable Time  │ 3-Month Trend         │
│ $2,940.00      │ 86:30          │ 09:15              │ Jan  ██               │
│ $120.00/h flat │ 08:15 this month│ Internal / non-chargeable │ Feb ████      │
│                │                │                    │ Mar ██████            │
└────────────────┴────────────────┴────────────────────┴───────────────────────┘

Unbilled banner: "Uninvoiced balance: $2,940.00 across 24:30 billable hours." [Create Invoice] (disabled)

TIME LOG (shared monthly breakdown — with separate Billable Work and Non-billable Work sections per month)
```

**Metric definitions:**
- **Billable Logged** = total billable minutes across entire project. Detail line 1: `"{thisMonthMinutes} this month"`.
- **Non-billable** = total non-billable minutes across entire project. This exists for owner/operator visibility into margin leakage and write-offs.
- **Uninvoiced** = for the pre-invoicing phase, treat **all billable time as currently uninvoiced** and compute it from billable entries using `appliedRate`. Detail: rate info (`"$120/h flat"` or `"per-category"`).
  - **Implementation note for future agents:** this is intentionally provisional until the Reports/Invoicing phase adds invoice linkage on time entries. When invoice state ships, replace this logic with true invoice-aware filtering.
- **Last 3 Months chart** = simple bar chart showing billable hours per month for the last 3 calendar months. Each bar labeled with month abbreviation.
- **Invoices** are not shown in the T&M overview. They live under a dedicated `Invoices` tab below the project header.

**T&M month-specific:**
- Month header shows billable hours AND billable dollar amount: `"08:15 · $990.00"`
- Expanded month content must render two clearly separated sections:
  - `Billable Work`
  - `Non-billable Work` (only when that month has non-billable entries)
- Inside each section, group rows by work category for readability.
- Category subtotal in `Billable Work` shows hours + dollars.
- Category subtotal in `Non-billable Work` shows hours only.

### Retainer Project Overview

**Keep the existing outer layout and interaction model.** The current `RetainerOverview` component and `getRetainerData` query structure are the baseline. Changes:
1. Wire real `workedMinutes` per month (replace `workedMinutes = 0`)
2. Inject task-grouped rows inside each month's accordion content (replace the placeholder text)
3. Use the same task row pattern as Fixed/T&M

---

## Phase Breakdown

### Phase 0: Schema — Add `fixedPrice` to projects

**Commit message:** `feat: add fixedPrice field to projects schema for fixed-fee profitability`

**Why:** The plan's Fixed overview metrics (`Profit`, `Effective Rate`, `Budget Used`) all depend on a single sold-price field. This field does not exist in the current schema — Fixed projects only have per-category estimate rows (`projectCategoryEstimates`). Without `fixedPrice`, Phase A and D cannot compute profitability.

**Changes:**

1. **`convex/schema.ts`** — Add `fixedPrice: v.optional(v.number())` to the `projects` table definition.
   - Optional at the schema level so existing projects don't break on migration.
   - Enforced as required in the Fixed project create/update mutation logic (not via schema validator).

2. **`convex/projects.ts`** — Update `create` and `update` mutations:
   - When `billingType === "fixed"`, require `fixedPrice` in args and validate `fixedPrice > 0`.
   - When `billingType !== "fixed"`, ignore `fixedPrice` (don't store it).

3. **Frontend create/update forms** — Add `fixedPrice` input field to the Fixed project form:
   - Show only when `billingType === "fixed"`.
   - Required field with currency formatting.
   - Label: `"Fixed Fee"` (matches the metric card naming).

4. **Backfill consideration:** Existing Fixed projects will have `fixedPrice === undefined`. The Fixed overview must handle this gracefully — show `"Set fixed fee →"` warning instead of computing profit.

### Phase A0: Time logging guardrails — Prevent incomplete rate snapshots

**Commit message:** `feat: enforce complete rate snapshots for billable time entries`

**Why:** The better solution is to prevent incomplete commercial data from entering the database instead of showing downstream warning banners in overview UI. If a billable entry cannot resolve its required rates, the write should fail with a clear setup error.

**Rules:**
1. **Tasks may be created without a category, but billable time logging requires one.**
   - Do not block fast task capture on missing `workCategoryId`.
   - If the user tries to log billable time against a task with no category, block the action and prompt them to set the category first.
   - Treat the "No category" bucket as a reporting fallback, not a valid prerequisite state for billable logging.
2. **Org-level default category rate library should exist.**
   - Maintain default category cost/bill rates at the org level.
   - New projects prefill their rate setup from these defaults.
3. **Project-level rate setup should be prefilled on creation.**
   - Fixed: prefill category estimate rows for active work categories.
   - T&M flat: require project hourly rate.
   - T&M per-category: prefill category bill rates.
   - Retainer: require included minutes + overage rate.
4. **Billable time entries must be rejected if rate resolution fails.**
   - Apply this to:
     - `timeEntries.create`
     - `timeEntries.update` when edited fields affect rate resolution
     - timer-derived entry creation/finalization flows
   - If the task has no category, reject the billable write with a clear setup message such as: `"Set a category on this task before logging billable time."`
   - If `resolveRate` returns an error for a billable entry, reject the write with the resolver's error message.
5. **Non-billable entries may still be saved without commercial rate snapshots.**
   - They remain valid for internal tracking and should not be blocked on bill-rate setup.

**Critical implementation detail — code reorder in `timeEntries.create`:**
The current code resolves rates (line 206) **before** determining `isBillable` (line 213). This means non-billable entries are also rejected when rate resolution fails, violating rule 5. Fix:
1. Move `isBillable` determination (`args.isBillable ?? task.billable`) **before** the rate resolution block.
2. Only call `resolveRate` and enforce its result when `isBillable === true`.
3. For non-billable entries, skip rate resolution entirely (or attempt it without throwing on failure).
4. Apply the same reorder in `update` and timer finalization paths.

**UX contract:**
- Errors from rules 1 and 4 surface as **toast notifications** via the existing `toastError` helper (`lib/toast-helpers.ts`), which extracts `ConvexError` messages into visible Sonner toasts.
- Error messages must be **actionable** — tell the user what to fix, not just what failed. Example: `"Set a category on this task before logging billable time"`, not `"Rate resolution failed"`.
- No silent failures — every rejected write must produce a visible user-facing message.

**Resulting simplification:**
- Reporting can assume billable entries already have the required snapshots.
- No downstream missing-rate warning banners are needed in overview UI.
- Data quality is enforced at write time instead of being patched in reporting.

### Phase A: Backend — Project time aggregation queries

**Commit message:** `feat: add project time aggregation queries for overview metrics`

**File:** `convex/timeEntries.ts` — add 2 new queries

#### 1. `timeEntries.projectOverview`

```typescript
// Args: { projectId: Id<"projects"> }
// Returns: {
//   totalMinutes: number,                 // all entries (billable + non-billable)
//   totalBillableMinutes: number,         // billable entries only
//   totalNonBillableMinutes: number,      // non-billable entries (for T&M detail line)
//   lastLoggedDate: string | null,        // most recent entry date across project
//   thisMonthMinutes: number,             // current month billable minutes
//   last3BillableMonths: Array<{ month: string, minutes: number }>,
//   minutesByCategory: Record<string, number>,  // workCategoryId → total minutes
//   billableMinutesByCategory: Record<string, number>,
//   totalActualCost: number,              // Fixed-only: Σ(entry hours × appliedCostRate) for Fixed profitability
//   uninvoicedMinutes: number,            // pre-invoicing phase: all billable minutes
//   uninvoicedAmount: number,             // pre-invoicing phase: SUM(durationMinutes/60 * appliedRate) across all billable entries
// }
```

**Logic:**
1. Get auth context, validate orgId.
2. Fetch the project via `ctx.db.get(projectId)`. Validate `project.orgId === orgId` — return null or throw if mismatched. Read `project.billingType` for conditional field computation below.
3. Fetch all tasks for the project: `tasks.by_orgId_projectId` (orgId from auth, not from the project record — defense in depth).
4. **Include tasks regardless of `archivedAt`**. Historical project reporting must include all historical time entries, even when a task has since been archived.
5. Fetch all time entries in parallel using `Promise.all` over tasks (same pattern as existing `sumByProject`). For each task, query `timeEntries.by_taskId`.
6. Aggregate totals, grouping by `task.workCategoryId.toString()` (Convex IDs must be stringified for use as record keys).
   - Compute `totalActualCost` only when `project.billingType === "fixed"`.
   - For Fixed projects: `totalActualCost = SUM(entry.durationMinutes / 60 * entry.appliedCostRate)`.
   - For T&M and Retainer projects: return `0` or `null` consistently, and do not treat the field as meaningful profitability data.
   - Billable time entry creation should already enforce complete required snapshots, so reporting does not need downstream missing-rate recovery logic.
7. Compute `thisMonthMinutes` by filtering entries where `date` starts with current month (YYYY-MM format, using org timezone from `getOrgSettings`).
8. Compute `last3BillableMonths` as billable minutes grouped by the last 3 calendar months in the org timezone. This series powers the T&M top-card trend.
9. Compute `uninvoicedMinutes` and `uninvoicedAmount` only when `project.billingType === "time_and_materials"`.
   - `uninvoicedAmount = SUM(entry.durationMinutes / 60 * entry.appliedRate)` across billable T&M entries.
   - Do not fall back to `appliedBillRate` here. This metric is intentionally T&M-specific.
   - For Fixed and Retainer projects: return `0` for both fields.
10. Find `lastLoggedDate` as the max `date` value across all entries.
   - **Implementation note for future agents:** do not invent `invoicedInReportId` filtering yet. The field is not in the schema. Keep a clear code comment that this is temporary until invoice linkage exists.

#### 2. `timeEntries.projectMonthlyBreakdown`

```typescript
// Args: { projectId: Id<"projects"> }
// Returns: Array<{
//   month: string,           // "2026-03"
//   monthLabel: string,      // "March 2026"
//   totalMinutes: number,
//   totalAmount: number,     // for T&M: billable-only SUM(durationMinutes/60 * appliedRate). 0 for Fixed.
//   entryCount: number,
//   billableCategoryGroups: Array<{
//     workCategoryId: string | null,
//     categoryName: string,
//     categoryColor: string,
//     totalMinutes: number,
//     totalAmount: number,
//     tasks: Array<{
//       taskId: string,
//       taskTitle: string,
//       totalMinutes: number,
//       firstDate: string,    // earliest entry date in this month
//       lastDate: string,     // latest entry date in this month
//       entryCount: number,
//     }>
//   }>,
//   nonBillableCategoryGroups: Array<{
//     workCategoryId: string | null,
//     categoryName: string,
//     categoryColor: string,
//     totalMinutes: number,
//     tasks: Array<{
//       taskId: string,
//       taskTitle: string,
//       totalMinutes: number,
//       firstDate: string,
//       lastDate: string,
//       entryCount: number,
//     }>
//   }>,
//   taskCount: number,
//   categoryCount: number,
// }>
```

**Logic:**
1. Get auth context, validate orgId.
2. Fetch the project via `ctx.db.get(projectId)`. Validate `project.orgId === orgId` — return empty array or throw if mismatched. Read `project.billingType` for conditional field computation.
   - `projectMonthlyBreakdown` should only compute `totalAmount` when `project.billingType === "time_and_materials"`.
   - For Fixed projects, return `0` or omit `totalAmount` consistently per the response contract.
3. Fetch all tasks for project (using orgId from auth, not project record).
   - Include archived tasks so historical time remains visible in reporting.
4. Fetch all time entries per task for both Fixed and T&M.
   - Fixed: include **all** entries (billable + non-billable)
   - T&M: also fetch **all** entries, then split within each month into `Billable Work` and `Non-billable Work`
   - Retainer: this shared breakdown is not used
   - Do **not** use `task.billable` as the reporting filter. Reporting must key off `entry.isBillable` because historical entries may differ from the current task default.
5. Enrich tasks with workCategory data (name, color) by fetching `workCategories` for the org.
6. Group entries by month (extract `YYYY-MM` from `entry.date`).
7. Within each month, first split by `entry.isBillable`, then group each side by `task.workCategoryId`.
   - This is important: billable vs non-billable is a property of the time entry, not of the category itself.
   - The category grouping exists only as a second-level readability layer inside each section.
8. Within each category group, group by `task._id` and aggregate: sum minutes, compute first/last date, count entries.
9. Sort: months descending, categories by name, tasks by lastDate descending.
10. Return the nested structure.

**Important:** The `totalAmount` field is only meaningful for T&M projects. For Fixed, it will be 0 or omitted. Compute it as `SUM(entry.durationMinutes / 60 * entry.appliedRate)` for T&M billable entries only.

**Historical note:** grouping is based on the task's current title/category for now. This can drift if tasks are renamed or recategorized later.
- **Planned follow-up:** add snapshot fields on `timeEntries` for historical correctness, at minimum `taskTitleSnapshot` and `workCategoryIdSnapshot`.

### Phase B: Backend — Wire retainer real data

**Commit message:** `feat: wire real time entries into retainer balance computation`

**File:** `convex/projects.ts` — modify `getRetainerData` query

**Changes to `getRetainerData` (starting around line 469):**

Replace the TODO comment block and `workedMinutes = 0` with real data:

1. After building the months array, fetch all tasks for the project:
   ```typescript
   const tasks = await ctx.db.query("tasks")
     .withIndex("by_orgId_projectId", q => q.eq("orgId", orgId).eq("projectId", args.id))
     .collect();
   ```

2. Fetch all time entries for those tasks in parallel (do **not** filter to billable at fetch time):
   ```typescript
   const allEntries = (await Promise.all(
     tasks.map(async (task) => {
       const entries = await ctx.db.query("timeEntries")
         .withIndex("by_taskId", q => q.eq("taskId", task._id))
         .collect();
       return entries.map(e => ({
         ...e,
         taskTitle: task.title,
         workCategoryId: task.workCategoryId,
       }));
     })
   )).flat();
   ```
   - Keep both billable and non-billable entries in memory.
   - Split after fetch:
     ```typescript
     const billableEntries = allEntries.filter(e => e.isBillable);
     const nonBillableEntries = allEntries.filter(e => !e.isBillable);
     ```
   - `billableEntries` drive retainer consumption, balance chaining, `workedMinutes`, `overageMinutes`, and `overageDue`.
   - `nonBillableEntries` drive the separate visibility layer only.
   - Compute `totalNonBillableMinutes` scoped to **current cycle months only** (filter non-billable entries by cycle date boundaries before summing). This keeps the top metric card consistent with the cycle scope of Billable Used, Over Budget, and Overage Due.

3. Group entries by month. For each month in the cycle, compute `workedMinutes`:
   ```typescript
   const entriesByMonth: Record<string, typeof billableEntries> = {};
   for (const e of billableEntries) {
     const monthKey = e.date.slice(0, 7); // "2026-03"
     (entriesByMonth[monthKey] ??= []).push(e);
   }
   ```

4. In the month loop, replace `workedMinutes = 0` with:
   ```typescript
   const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
   const monthEntries = entriesByMonth[monthKey] ?? [];
   const workedMinutes = monthEntries.reduce((sum, e) => sum + e.durationMinutes, 0);
   ```
   - Retainer consumption uses billable entries only.
   - Historical entries on archived tasks remain part of retainer usage and reporting.

5. Enrich with workCategory info for the task-grouped breakdown. Fetch categories once:
   ```typescript
   const categories = await ctx.db.query("workCategories")
     .withIndex("by_orgId", q => q.eq("orgId", orgId)).collect();
   const catMap = new Map(categories.map(c => [c._id.toString(), c]));
   ```

6. Build grouped entries per month for **both** billable and non-billable work. Attach both to each month's data:
   ```typescript
   // Group billable monthEntries by workCategoryId, then by taskId
   // Produce: billableCategoryGroups[] with tasks[] inside
   // Group nonBillableEntries for the same month by workCategoryId, then by taskId
   // Produce: nonBillableCategoryGroups[] with tasks[] inside
   ```
   - This is important: if the Retainer top metric shows non-billable hours, the expanded month must also show which tasks created those hours.

7. Update `entryCount` and `taskCount` on each month from real data.
8. Return top-level `totalNonBillableMinutes` alongside the existing retainer balance fields.
   - This metric is for profitability visibility only.
   - It must not affect retainer balance or overage math.

### Phase C: Frontend — Shared MonthlyTimeBreakdown component

**Commit message:** `feat: add shared MonthlyTimeBreakdown component`

**New file:** `components/projects/monthly-time-breakdown.tsx`

This is the shared component used by Fixed and T&M projects. It receives pre-formatted data and renders collapsible months with category-grouped task rows.

#### Props

```typescript
type MonthData = {
  month: string;           // "2026-03"
  monthLabel: string;      // "March 2026"
  totalMinutes: number;
  totalAmount?: number;    // T&M billable-only amount
  entryCount: number;
  taskCount: number;
  categoryCount: number;
  billableCategoryGroups: Array<{
    categoryName: string;
    categoryColor: string;
    totalMinutes: number;
    totalAmount?: number;
    tasks: Array<{
      taskId: string;
      taskTitle: string;
      totalMinutes: number;
      firstDate: string;
      lastDate: string;
      entryCount: number;
    }>;
  }>;
  nonBillableCategoryGroups: Array<{
    categoryName: string;
    categoryColor: string;
    totalMinutes: number;
    tasks: Array<{
      taskId: string;
      taskTitle: string;
      totalMinutes: number;
      firstDate: string;
      lastDate: string;
      entryCount: number;
    }>;
  }>;
};

type Props = {
  months: MonthData[];
  showAmounts?: boolean;   // true for T&M
  currency?: string;       // needed if showAmounts
  onTaskClick: (taskId: string) => void;
  emptyMessage?: string;
};
```

#### Structure

- Use shadcn `Accordion` (single, collapsible). Default open: first month.
- **Month header row:** Chevron + month label + right-aligned total (hours, and `· $amount` if T&M billable totals are shown).
- Expanded content must always render in two clearly separated rows/sections when relevant:
  - `Billable Work`
  - `Non-billable Work`
- **Category group:** Colored dot + category name (bold) + task count + right-aligned subtotal.
- **Task row:** Date range + task title (clickable) + monospace time.
  - Date formatting: if `firstDate === lastDate`, show `"Mar 15"`. If different, show `"Mar 8-15"`. Use `formatShortDate` from `lib/format.ts`.
  - Time: use `formatMinutes` from `lib/format.ts` with `Geist Mono` font.
  - Click handler calls `onTaskClick(taskId)`.
  - Do **not** render a trailing `>` or chevron glyph in the row. The task title itself is the interaction target.
- **Month footer:** always split billable and non-billable clearly on separate lines or separate labels in the same block.
  - Example:
    - `Billable: {HH:MM}` and, if T&M, `· $amount`
    - `Non-billable: {HH:MM}`
  - Never collapse these into a single ambiguous `Total` label when both kinds of work exist.
- **Empty state:** If `months.length === 0`, render the existing `TimeLogPlaceholder` pattern.

#### Styling

- Use existing shadcn components: `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`.
- Category dot: 8x8px circle using the **saturated** color: `getCategoryColor(color).text` as `backgroundColor` (not `.bg` which is a pale background). Import `getCategoryColor` from `convex/lib/constants`.
- Task row indent: `pl-8` (left padding to nest under category).
- Do NOT use the `CategoryBadge` component — use a simple dot + semibold text for minimal visual weight.
- Monospace time values: `font-mono text-xs font-medium` (maps to Geist Mono in the app).
- **Loading/skeleton states**: All overview rewrites must preserve skeleton patterns. When `overview === undefined` or `monthlyData === undefined`, render a content-aware skeleton matching the final layout (metric card placeholders + accordion row placeholders). Follow the existing `RetainerOverviewSkeleton` pattern.

### Phase D: Frontend — Wire Fixed + T&M overviews

**Commit message:** `feat: wire real time data into Fixed and T&M project overviews`

#### D1. Fixed Overview — `components/projects/fixed-overview.tsx`

**Replace the entire component.** New structure:

1. **3 Metric Cards row** in a `grid grid-cols-2 sm:grid-cols-3` layout:
   - **Fixed Fee**: `value = formatCurrencyPrecise(project.fixedPrice, currency)`.
   - **Actual**: `value = formatMinutes(totalActualMinutes)`, `detail = "Labor cost " + formatCurrencyPrecise(totalActualCost, currency)`.
   - **Profit**: `value = formatCurrencyPrecise(profit, currency)`, `detail = effectiveRate > 0 ? formatCurrencyPrecise(effectiveRate, currency) + "/h" : "—"`. `variant = profit >= 0 ? "default" : "destructive"`.

2. **Info banner** — keep existing Alert with info icon.

3. **Budget & Category Breakdown** — a single grouped section containing the overall budget bar and per-category actual vs estimate rows.
   - **Overall Budget Used** at the top of the group: if `totalEstimatedMinutes > 0`, show `"{percent}%"` with a `BudgetProgress` bar and detail `formatMinutes(totalActualMinutes) + " / " + formatMinutes(totalEstimatedMinutes)`. If `totalEstimatedMinutes <= 0`, show `"No estimate set"`.
   - **Per-Category rows** below: keep existing table structure but wire real `actual` and `remaining` values.
     - Data source: `projectOverview.minutesByCategory` keyed by `workCategoryId`, cross-referenced with `projectCategoryEstimates`.
     - For each estimate row: `actual = minutesByCategory[est.workCategoryId] ?? 0`, `remaining = est.estimatedMinutes - actual`, `progress = est.estimatedMinutes > 0 ? (actual / est.estimatedMinutes) * 100 : null`.
   - **Unestimated category warning** — if `minutesByCategory` contains workCategoryIds that have no corresponding estimate row, show an amber warning at the bottom of this group:
     - Text: `"12:00 logged under QA with no budget estimate — budget tracking is incomplete"`
     - Link: "Add estimate →" navigates to Settings tab
   - **Design rationale:** Budget Used and per-category breakdown are logically the same concern (delivery effort vs estimates). Grouping them makes the relationship immediately visible instead of splitting across separate sections.

6. **Monthly Time Log** — render `<MonthlyTimeBreakdown>` with data from `projectMonthlyBreakdown` query. `showAmounts={false}`.
   - Even for Fixed, render separate `Billable Work` and `Non-billable Work` sections when relevant.

**Filtering rule:** Fixed overview metrics use **all logged time**.
- Fixed monthly breakdown also uses all logged time.

**New query calls in component:**
```typescript
const overview = useQuery(api.timeEntries.projectOverview, { projectId });
const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, { projectId });
```

**Fixed economics calculation:**
```typescript
const totalActualMinutes = overview.totalMinutes;
const totalActualCost = overview.totalActualCost;
const profit = (project.fixedPrice ?? 0) - overview.totalActualCost;
const effectiveRate = totalActualMinutes > 0
  ? (project.fixedPrice ?? 0) / (totalActualMinutes / 60)
  : 0;
const budgetPercent = totalEstimatedMinutes > 0
  ? (totalActualMinutes / totalEstimatedMinutes) * 100
  : null;
```

**Important:** Fixed project profitability must come from the sold fixed fee and realized time-entry cost snapshots, not from `clientBillingRate` or `internalCostRate` on estimate rows. Estimate rows remain useful for planning and burn tracking, but not for top-level profit calculation.
 - If a project is `billingType === "fixed"`, `fixedPrice` must be required at project creation/edit time.
 - Billable time entry creation should already guarantee complete required snapshots, so the overview should not need missing-rate warning states.

#### D2. T&M Overview — `components/projects/tm-overview.tsx`

**Replace the entire component.** New structure:

1. **4 Metric sections** in a card row:
   - **Billable Logged**: `value = formatMinutes(overview.totalBillableMinutes)`, `detail = formatMinutes(overview.thisMonthMinutes) + " this month"`.
   - **Non-billable**: `value = formatMinutes(overview.totalNonBillableMinutes)`, `detail = "margin leakage / write-offs"`.
   - **Uninvoiced**: `value = formatCurrencyPrecise(overview.uninvoicedAmount, currency)`, `detail = rate info string`. Rate info: if `tmRateMode === "flat"` → `"$120/h flat"`, if `per_category` → `"per-category rates"`.
   - **Last 3 Months chart**: A simple inline bar chart. Get the last 3 months of billable data from `overview.last3BillableMonths`. Render 3 bars with month labels. Use simple `div` bars with dynamic height based on max value. No external charting library.

2. **Unbilled banner**: Show if `overview.uninvoicedAmount > 0`. Amber background. `"${amount} uninvoiced · ${hours} billable hours"`. `[Create Invoice]` button, disabled with tooltip `"Coming soon"`.

3. **Monthly Time Log** — render `<MonthlyTimeBreakdown>` with `showAmounts={true}` and `currency={project.currency}`.
   - Each month must render two clearly separated sections:
     - `Billable Work`
     - `Non-billable Work` (only when that month contains non-billable time)
   - The month header amount remains billable-only for T&M because that is the commercial total.

**New props needed:** The component needs `projectId` and `project` (for currency, tmRateMode, hourlyRate).

#### D3. Update project detail page — `app/(dashboard)/projects/[id]/page.tsx`

1. **Wire "Last activity" date**: Call `timeEntries.projectOverview` and display `overview.lastLoggedDate` formatted with `formatShortDate`. If null, show `"—"`.

2. **Project tabs**: The project detail page tabs should be:
   - `Overview`
   - `Invoices`
   - `Settings`
   - `Invoices` is a dedicated workflow area and is not implemented inside the Overview tab.

3. **Do not add a billable toggle in v1.**
   - Fixed overview already shows all logged time where relevant.
   - T&M monthly breakdown separates `Billable Work` and `Non-billable Work` per month.
   - Retainer has no toggle.

4. **Pass projectId and project to TmOverview**: Currently `<TmOverview />` has no props. Change to `<TmOverview projectId={projectId} project={project} />`.

5. **Task dialog integration**: Reuse the existing `TaskDetailModal` from `components/tasks/task-detail-modal.tsx`.
   - It is route-driven via `?detail=<taskId>` URL param (parsed by `parseDetailParam` from `lib/task-detail`).
   - Do **not** invent a second task-detail API or use React state for selected task.
   - `onTaskClick` handler: `router.push(\`\${pathname}?detail=\${taskId}\`, { scroll: false })`.
   - Render `<TaskDetailModal taskIds={allProjectTaskIds} isAdmin={isAdmin} />` on the project detail page.
   - `taskIds` enables prev/next keyboard navigation (J/K). Collect all task IDs visible in the monthly breakdown.

6. **Remove `TimeLogPlaceholder` import** — replaced by real `MonthlyTimeBreakdown` inside each overview component.

### Phase E: Frontend — Wire Retainer overview

**Commit message:** `feat: wire real time data into retainer overview with task rows`

**File:** `components/projects/retainer-overview.tsx`

**Changes:**

1. The `getRetainerData` query now returns real `workedMinutes` and grouped entries per month (from Phase B). No new queries needed.
   - Define the month return shape explicitly after Phase B:
   ```typescript
   type RetainerMonthData = {
     year: number;
     month: number;
     label: string;
     startDate: string;
     endDate: string;
     workedMinutes: number;
     startBalance: number;
     available: number;
     endBalance: number;
     totalNonBillableMinutes: number;
     isMonthClosed: boolean;
     balanceStatus: "due" | "deficit" | "rollover" | "unused" | "on_track";
     cyclePosition: number;
     entryCount: number;
     taskCount: number;
     categoryCount: number;
     billableCategoryGroups: Array<{
       workCategoryId: string | null;
       categoryName: string;
       categoryColor: string;
       totalMinutes: number;
       tasks: Array<{
         taskId: string;
         taskTitle: string;
         totalMinutes: number;
         firstDate: string;
         lastDate: string;
         entryCount: number;
       }>;
     }>;
     nonBillableCategoryGroups: Array<{
       workCategoryId: string | null;
       categoryName: string;
       categoryColor: string;
       totalMinutes: number;
       tasks: Array<{
         taskId: string;
         taskTitle: string;
         totalMinutes: number;
         firstDate: string;
         lastDate: string;
         entryCount: number;
       }>;
     }>;
   };
   ```
   - Define the required top-level additions explicitly:
   ```typescript
   type RetainerOverviewData = {
     totalNonBillableMinutes: number;  // current cycle only — must match scope of other top metrics
     cycleWorked: number;      // billable only, current cycle
     overageMinutes: number;   // billable-only balance math, current cycle
     overageDue: number;       // billable-only balance math, current cycle
     // ...existing fields already returned by getRetainerData
   };
   ```

2. **Cycle overview metrics must preserve both contract tracking and profitability visibility**:
   - Keep billable consumption / budget / overage numbers based on billable entries only. These drive the retainer balance logic.
   - Add a separate **Non-billable** metric card to surface agency effort that does not consume the retainer but still affects delivery margin.
   - This should be treated as an owner/operator visibility metric, not part of retainer balance math.

3. Inside each month's `AccordionContent`, replace the placeholder text with two separate sections:
   ```tsx
   {/* Replace this: */}
   <p className="py-2 text-muted-foreground">
     {month.entryCount} entries · {month.taskCount} tasks
   </p>

   {/* With task-grouped rows: */}
   <section>
     <h4>Billable Work</h4>
     {month.billableCategoryGroups.map(cat => (
       <div key={cat.categoryName}>
         {/* Category header: dot + name + task count + hours */}
         {cat.tasks.map(task => (
          {/* Task row: date range + title (clickable) + time */}
         ))}
       </div>
     ))}
   </section>

   {month.nonBillableCategoryGroups.length > 0 && (
     <section>
       <h4>Non-billable Work</h4>
       {month.nonBillableCategoryGroups.map(cat => (
         <div key={cat.categoryName}>
           {/* Category header: dot + name + task count + hours */}
           {cat.tasks.map(task => (
            {/* Task row: date range + title (clickable) + time */}
           ))}
         </div>
       ))}
     </section>
   )}

   <div className="...footer">
     <div>Billable: {formatMinutes(month.workedMinutes)}</div>
     <div>Non-billable: {formatMinutes(month.totalNonBillableMinutes)}</div>
     <div>{month.entryCount} entries · {month.taskCount} tasks</div>
   </div>
   ```
   - `Billable Work` is the contract-consumption view.
   - `Non-billable Work` explains the separate top-level non-billable metric and only renders when non-billable time exists in that month.

4. Do NOT use the shared `MonthlyTimeBreakdown` component here — the Retainer accordion is structurally different (has balance info, cycle dots, deficit badges). Instead, inline the same **task row pattern** (date range + title + monospace time) directly inside the accordion.

5. Extract a small shared `TaskTimeRow` component to avoid duplication:
   ```typescript
   // components/projects/task-time-row.tsx
   type Props = {
     taskId: string;
     title: string;
     firstDate: string;
     lastDate: string;
     totalMinutes: number;
     onClick: (taskId: string) => void;
   };
   ```
   Both `MonthlyTimeBreakdown` and the Retainer overview use this component.

6. Similarly, extract a `CategoryGroupHeader` component:
   ```typescript
   // components/projects/category-group-header.tsx
   type Props = {
     categoryName: string;
     categoryColor: string;
     taskCount: number;
     totalMinutes: number;
     totalAmount?: number;
     currency?: string;
   };
   ```

7. **Task dialog**: Same URL-driven pattern as Phase D3 — use `router.push` with `?detail=taskId`, no React state needed. Render `<TaskDetailModal>` on the project page (already added in D3).

---

## Testing Checklist

### Phase A
- [ ] `projectOverview` returns correct totals for a project with time entries
- [ ] `projectOverview` returns `lastLoggedDate` as the most recent entry date
- [ ] `projectOverview.thisMonthMinutes` only counts current calendar month (org timezone)
- [ ] `projectOverview.last3BillableMonths` returns billable-only month totals
- [ ] `projectOverview.uninvoicedAmount` correctly computes from `appliedRate` on billable T&M entries in the pre-invoicing phase
- [ ] `projectOverview.totalActualCost` computes from `appliedCostRate` on time entries, not estimate-row rates
- [ ] `projectMonthlyBreakdown` groups entries by month, then by billable state, then category, then task
- [ ] `projectMonthlyBreakdown` returns all entries for Fixed and T&M projects, but keeps billable and non-billable work in separate section data
- [ ] `projectMonthlyBreakdown` filters on `entry.isBillable`, not `task.billable`
- [ ] Historical entries on archived tasks remain included in reporting totals and breakdowns
- [ ] Tasks with no category group under a "No category" bucket
- [ ] Months sort descending, categories alphabetically, tasks by lastDate descending
- [ ] Historical grouping behavior is understood and documented when task title/category changes after time was logged

### Phase A0
- [ ] Tasks can still be created without `workCategoryId`
- [ ] Billable time logging is blocked when task category is missing, with a clear setup prompt
- [ ] Project creation prefills rate setup from org-level category defaults
- [ ] Billable `timeEntries.create` rejects writes when `resolveRate` fails
- [ ] Billable `timeEntries.update` rejects writes when edited fields invalidate rate resolution
- [ ] Timer-derived billable entry creation/finalization rejects writes when `resolveRate` fails
- [ ] Non-billable entries can still be created without commercial rate snapshots

### Phase B
- [ ] `getRetainerData` returns real `workedMinutes` per month
- [ ] Balance chaining is correct with real data (rollover ON and OFF)
- [ ] Overage calculation is correct with real entries and only for closed months/cycles
- [ ] Month entries, taskCount, entryCount reflect real data
- [ ] Billable and non-billable category-grouped tasks returned per month
- [ ] Historical entries on archived tasks remain included in retainer usage and balances

### Phase C
- [ ] `MonthlyTimeBreakdown` renders collapsible months
- [ ] First month is open by default
- [ ] Expanded month renders separate `Billable Work` and `Non-billable Work` sections
- [ ] `Non-billable Work` section only renders when non-billable entries exist for that month
- [ ] Category groups show colored dot + name + count + subtotal
- [ ] Task rows show date range correctly (single date vs range)
- [ ] Task row click triggers `onTaskClick` callback
- [ ] Task rows do not render trailing chevrons or `>` glyphs; the task title is the clickable element
- [ ] T&M mode shows dollar amounts alongside hours in billable section only
- [ ] Empty state renders when no months
- [ ] Footer separates billable and non-billable totals clearly

### Phase D
- [ ] Fixed: 3 metric cards show real values (Fixed Fee, Actual, Profit) + Budget Used in category breakdown section
- [ ] Fixed: Profit turns red when negative (over-budget scenario)
- [ ] Fixed: Effective Rate = Fixed Price / Actual Hours
- [ ] Fixed: Actual card shows actual hours as primary value and actual cost as secondary detail
- [ ] Fixed: Profit card shows profit as primary value and effective rate as secondary detail
- [ ] Fixed: Profit uses `appliedCostRate` snapshots from time entries, not estimate-row `internalCostRate`
- [ ] Fixed: Unestimated category warning appears when hours exist under categories without estimate rows
- [ ] Fixed: Warning links to Settings tab to add missing estimates
- [ ] Fixed: Per-category table shows real Actual/Remaining/Progress
- [ ] Fixed: Budget Used shows `No estimate set` when total estimated minutes is zero
- [ ] Fixed: Monthly time log renders below category table
- [ ] Fixed: Monthly time log totals reconcile with top-level Actual time
- [ ] T&M: 4 metric sections show real values
- [ ] T&M: Non-billable metric shows total non-billable hours
- [ ] T&M: Unbilled banner appears when uninvoiced > 0
- [ ] T&M: Create Invoice button is disabled
- [ ] T&M: Monthly breakdown shows separate Billable Work and Non-billable Work sections
- [ ] T&M: Billable section shows $ amounts; Non-billable section shows time only
- [ ] T&M: Last 3 months chart renders billable bars from `projectOverview.last3BillableMonths`
- [ ] Invoices are not shown in Overview; project tabs expose a dedicated `Invoices` tab
- [ ] Fixed top metrics use all logged time
- [ ] T&M top metrics show billable contract numbers plus non-billable visibility
- [ ] Retainer top metrics preserve billable balance math and separately surface non-billable time
- [ ] No billable toggle is shown in v1
- [ ] Header: "Last activity" shows real date
- [ ] Loading skeletons render while queries load (content-aware, not generic boxes)
- [ ] Task row click opens task detail dialog overlay

### Phase E
- [ ] Retainer months show real workedMinutes (not 0)
- [ ] Balance chaining reflects real data
- [ ] Expanded month shows separate Billable Work and Non-billable Work sections when relevant
- [ ] Retainer month footer separates Billable and Non-billable totals clearly
- [ ] Task row click opens task detail dialog
- [ ] Cycle overview metrics (Hours Used, Over Budget, Overage Due) use real numbers
- [ ] Overage banner shows correct amount

---

## MVP Validation Strategy

This section defines the **minimum reliable test layer** for shipping the Fixed, T&M, and Retainer overviews without overengineering. The goal is simple: use a small number of high-signal tests to ensure the production code matches the approved formulas and edge-case rules.

### Principle

- **Unit convention:** Fixtures in this section are written in **hours** for readability. Implementation fields remain **minutes** unless explicitly stated otherwise (`durationMinutes`, `overageMinutes`, `includedMinutesPerMonth`, etc.). When writing tests, multiply fixture hours by 60 to get the field values.
- Keep the math in small, testable calculation helpers or query-level aggregators.
- Do **not** rely on visual inspection of the UI to validate formulas.
- Test the calculation output first, then add a thin UI integration layer on top.
- Reuse the same simple fixtures used in the HTML playground so expected outputs stay easy to verify by hand.

### Recommended test layers

#### 1. Calculation-level tests

These should be the primary truth source for overview math.

- Create small pure calculation helpers or query-shape mappers for:
  - Fixed overview metrics
  - T&M overview metrics
  - Retainer cycle metrics
- Test returned values directly, not rendered text first.
- Use simple round-number fixtures so failures are obvious.

#### 2. Query aggregation tests

These verify backend totals before the UI consumes them.

- `timeEntries.projectOverview`
- `timeEntries.projectMonthlyBreakdown`
- `projects.getRetainerData`

The purpose here is to prove that task/query aggregation matches the intended formulas and inclusion rules.

#### 3. Thin UI integration tests

Only a few are needed for MVP.

- Verify the correct numbers render in each overview.
- Verify setup validation errors appear when billable time cannot be logged due to missing rate configuration.
- Verify Fixed monthly breakdown shows all time and reconciles with top-level Actual.
- Verify T&M monthly breakdown separates billable and non-billable work within each month.

### Required fixed fixtures

#### Fixed — happy path

Use a simple fixture such as:

- `fixedPrice = 10000`
- Entries:
  - `10h @ 50 cost` (Design, billable)
  - `20h @ 40 cost` (Dev, billable)
  - `5h @ 40 cost` (Dev, non-billable)
- Estimates:
  - Design: `20h`
  - Dev: `40h`

Expected:

- `totalActualHours = 35` (10 + 20 + 5, includes non-billable)
- `totalActualCost = 1500` (10×50 + 20×40 + 5×40)
- `profit = 8500` (10000 - 1500)
- `effectiveRate = 285.71/h` (10000 / 35)
- `budgetUsed = 58.333...%` raw (35 / 60 × 100). Tests assert the raw value. Display formatting is owned by the UI formatter — do not test specific rounding here.
- Design: actual 10h / est 20h = 50%
- Dev: actual 25h / est 40h = 62.5%

#### Fixed — edge cases

- Missing `fixedPrice`
- No estimate rows
- Category estimate minutes = `0`
- Logged time under category with no estimate row
- Billable entry creation should reject when required rate snapshots cannot be resolved
- Archived task entry must still count
- Non-billable time must still count in Fixed totals

### Required T&M fixtures

#### T&M — happy path

Use a simple fixture such as:

- Billable entries:
  - `10h @ 100`
  - `20h @ 100`
  - `30h @ 100`
- Non-billable entry:
  - `5h`
- Current month = month of the `30h` entry

Expected:

- `billableLogged = 60h`
- `nonBillable = 5h`
- `uninvoiced = 6000`
- `thisMonthMinutes = 30h`
- `last3BillableMonths = [10h, 20h, 30h]`

#### T&M — edge cases

- Billable entry creation should reject when `appliedRate` cannot be resolved
- Only non-billable entries exist
- Current month has no billable entries
- One of the last 3 months has zero billable hours
- Archived task entry must still count
- T&M month with mixed work shows both `Billable Work` and `Non-billable Work` sections

### Required Retainer fixtures

#### Retainer — happy path with rollover on

Use a simple fixture such as:

- Included hours per month = `20h`
- Overage rate = `100/h`
- January billable = `10h`
- February billable = `15h`
- March billable = `30h`
- March non-billable = `5h`
- Rollover = ON

Expected chain:

- January:
  - `startBalance = 0`
  - `available = 20`
  - `endBalance = 10`
- February:
  - `startBalance = 10`
  - `available = 30`
  - `endBalance = 15`
- March:
  - `startBalance = 15`
  - `available = 35`
  - `billableUsed = 30`
  - `overBudget = 0`
  - `endBalance = 5`

#### Retainer — cycle-end settlement (rollover ON, cycle=3, closed)

Same setup but with overage — the critical settlement path:

- Included = `10h/mo`, overage rate = `100/h`, cycle = 3, rollover = ON
- January billable = `10h`, February = `15h`, March = `10h`
- Simulated today = `2026-04-01` (cycle is closed)

Expected chain:

- January: start=0, avail=10, worked=10, end=0
- February: start=0, avail=10, worked=15, end=-5 → **deficit** (mid-cycle, not due yet)
- March: start=-5, avail=5, worked=10, end=-5 → **due** (cycle-end, closed)
- Cycle total: budget=30h (1800min), worked=35h (2100min), balance=-5h (-300min)
- `overageMinutes = 300` (only because cycle is closed)
- `overageDue = 300 / 60 × 100 = 500`

Key assertions:
- February is "deficit" NOT "due" (mid-cycle with rollover)
- March is "due" (last month of closed cycle)
- If today = `2026-03-15`, same data → overageMinutes = 0 (cycle not closed, settlement not yet actionable — but endBalance and deficit status are still tracked)

#### Retainer — rollover OFF (per-month settlement)

- Same data as above but rollover = OFF

Expected chain:

- January: start=0, avail=10, worked=10, end=0 → on_track
- February: start=0, avail=10, worked=15, end=-5 → **due** (closed month, immediate settlement)
- March: start=0, avail=10, worked=10, end=0 → on_track
- `overageMinutes = 300` (from February only: |-300min| = 300)
- `overageDue = 300 / 60 × 100 = 500`

Key difference: February is immediately "due" — no waiting for cycle-end.

#### Retainer — other edge cases

- Only non-billable time exists → balance untouched, overage = 0
- Included hours = `0` → every billable hour is overage
- Archived task entry must still count in balance
- Active month has no time entries → workedMinutes = 0, balance = included
- Cycle not yet closed → **invoiceable** overage (`overageMinutes` in top metrics) = 0, but `endBalance` can still be negative and months can still show "deficit" status. Only the settlement amount is suppressed, not the balance tracking.

### Must-have invariants

These are small but valuable assertion rules that should exist in tests wherever relevant.

#### Fixed invariants

- `profit = fixedPrice - totalActualCost`
- `effectiveRate = fixedPrice / actualHours` when `actualHours > 0`
- `budgetUsed = null` or equivalent empty state when no estimate exists
- Fixed monthly breakdown totals reconcile with Fixed top-level Actual time

#### T&M invariants

- `uninvoiced = SUM(billable hours × appliedRate)`
- `thisMonthMinutes` only includes the current calendar month
- `last3BillableMonths` is always billable-only
- if top-level non-billable time exists for a month, that month's expanded T&M view must show the underlying non-billable tasks

#### Retainer invariants

- `available = includedPerMonth + startBalance`
- `endBalance = available - billableWorked` (can be negative — deficit carries in rollover mode)
- `startBalance = rolloverOn ? previousMonth.endBalance : 0` (at cycle start always 0)
- Rollover ON: `overageMinutes = isCycleClosed && cycleBudget - cycleWorked < 0 ? |cycleBudget - cycleWorked| : 0`
- Rollover OFF: `overageMinutes = SUM(|endBalance|) for each closed month where endBalance < 0`
- `overageDue = overageMinutes / 60 * overageRate` (field is minutes, divide by 60 to get hours for the rate calc)
- non-billable time does not consume retainer balance
- if top-level non-billable time exists for a month, that month's expanded view must show the underlying non-billable tasks
- "due" badge only appears when settlement is actionable (cycle-end when rollover ON, month-end when rollover OFF)
- "deficit" means negative balance but not yet settleable (mid-cycle with rollover ON)

### Critical distinction: "due" vs "deficit"

This is the most common source of bugs in retainer logic. The badge difference:

| Scenario | Rollover ON | Rollover OFF |
|----------|-------------|--------------|
| Negative balance, mid-cycle, month closed | **deficit** | **due** |
| Negative balance, cycle-end, cycle closed | **due** | **due** |
| Negative balance, month/cycle not closed | **deficit** | **deficit** |

"due" = actionable, can invoice. "deficit" = informational, balance may recover in later months.

Tests must assert badge status, not just numeric values.

### Minimum UI checks for MVP

Only a few UI tests are necessary:

- Fixed overview renders profit, effective rate, and budget used correctly from known data
- Billable time logging surfaces a clear setup error when required rate configuration is missing
- T&M overview renders billable, non-billable, uninvoiced, and 3-month trend correctly
- T&M monthly breakdown renders separate billable and non-billable rows in the same month
- Retainer overview renders current cycle values, month chaining, and separate billable/non-billable month sections correctly
- Archived-task historical time still appears in all overview outputs

### Implementation note

For MVP, prefer this structure:

- 1 small test file for calculation/query logic per billing type
- 1 small UI integration test file per overview component
- shared fixtures with simple round numbers

That is enough to give high confidence without building a large testing framework.

---

## Files Modified/Created Summary

### New files
- `components/projects/monthly-time-breakdown.tsx` — Shared monthly log component
- `components/projects/task-time-row.tsx` — Shared task row component
- `components/projects/category-group-header.tsx` — Shared category header component

### Modified files
- `convex/schema.ts` — Add `fixedPrice` to projects schema
- `convex/projects.ts` — Require `fixedPrice` for Fixed projects, prefill project-level setup where needed, and wire real retainer data into `getRetainerData`
- `convex/timeEntries.ts` — Add `projectOverview` and `projectMonthlyBreakdown` queries
- `convex/timer.ts` — Enforce billable rate resolution in timer-derived entry finalization
- `components/tasks/*` or task create/edit flow — Support category assignment and block billable logging until category is set
- `components/projects/fixed-overview.tsx` — Full rewrite with real data + metrics
- `components/projects/tm-overview.tsx` — Full rewrite with real data + metrics + chart
- `components/projects/retainer-overview.tsx` — Inject task rows into accordion
- `app/(dashboard)/projects/[id]/page.tsx` — Last logged, task dialog, pass props

### Deleted files
- `components/projects/time-log-placeholder.tsx` — Replaced by real components

---

## Notes for Implementor

1. **No external charting library.** The T&M 3-month bar chart is simple enough to build with `div` elements and dynamic heights. Max bar height ~60px, width ~40px, labeled with month abbreviation.

2. **Convex query limits.** The `projectMonthlyBreakdown` query fetches all tasks + all entries for the project. For large projects this could be slow. Acceptable for v1 — optimize with pagination (load more months) in v2 if needed.

3. **invoicedInReportId doesn't exist in schema yet.** When computing `uninvoicedMinutes`, treat ALL billable entries as uninvoiced. No defensive guard needed — the field doesn't exist, so just sum all billable entries directly. Add a code comment marking this as temporary until invoice linkage ships.

4. **Task dialog.** The existing `TaskDetailModal` (`components/tasks/task-detail-modal.tsx`) is route-driven via `?detail=<taskId>` (parsed by `parseDetailParam` from `lib/task-detail`). Import and render it on the project page. Pass `taskIds` (for J/K navigation) and `isAdmin`. Click handler: `router.push(\`\${pathname}?detail=\${taskId}\`, { scroll: false })`. No React state needed for selected task.

5. **No billable toggle in v1.**
   - Fixed top metrics and monthly breakdown use all logged time.
   - T&M top metrics use billable values as the primary commercial numbers and also expose non-billable totals separately.
   - T&M monthly breakdown must separate `Billable Work` and `Non-billable Work` within each month.
   - T&M 3-month trend is sourced from `projectOverview.last3BillableMonths`.
   - Retainer top metrics use billable values for balance/overage math and also expose non-billable totals separately.

6. **Category requirement for billable logging + reporting fallback.**
   - Tasks may still exist without a `workCategoryId`.
   - Tasks without a `workCategoryId` should still group under a "No category" label with a gray dot in reporting as a fallback.
   - Billable time logging should be blocked until the task has a category.

7. **Date formatting for ranges.** If `firstDate === lastDate`, format as `"Mar 15"`. If different months, format as `"Feb 28 – Mar 5"`. If same month, format as `"Mar 8–15"` (abbreviated). Use `formatShortDate` from `lib/format.ts`.

8. **TypeScript types.** Define return types for the new queries in a shared types file or inline. Ensure the frontend components correctly type the query results.

9. **Retainer query contract.** `getRetainerData` is gaining a richer `months[]` shape with `categoryCount`, `billableCategoryGroups[]`, and `nonBillableCategoryGroups[]`. Update the frontend and tests against the new explicit contract above rather than relying on the old placeholder `months[].entries` field.

10. **Fixed project economics.**
   - Fixed projects need an explicit `fixedPrice` on the project model to compute true profitability.
   - `fixedPrice` should be mandatory for Fixed projects, not optional.
   - `Profit = fixedPrice - totalActualCost`
   - `Effective Rate = fixedPrice / actualHours`
   - `totalActualCost` must be computed from `timeEntries.appliedCostRate`, not from estimate-row `internalCostRate`.
   - Category estimate rows are still used for planning and burn control, not as the source of realized cost or top-level revenue.

11. **Time logging UX defaults and guardrails.**
   - Maintain org-level default category rate settings so new projects can prefill rate configuration automatically.
   - Prefill project-level rate setup on project creation instead of making users configure every category from scratch.
   - Block billable time logging when required setup is missing, with a direct resolver error telling the user what to fix.
   - If the task itself is missing a category, show a blocking prompt that routes the user to set the category before billable logging can continue.
   - Non-billable time logging should remain fast and should not depend on commercial rate setup.
