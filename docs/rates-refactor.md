# Rates Refactor — Validated Brief

> Last updated: 2026-04-11
> Status: Approved, ready for implementation planning

---

## What This Is About

Agency Flow is a project management and time tracking tool for digital agencies. Every tracked hour has two financial dimensions:

1. **What does this hour cost us?** (the employee's/freelancer's hourly rate — internal cost)
2. **What does the client pay for this hour?** (the rate we charge them)

From these two numbers, everything else follows: labor cost, revenue, profit, margins. This refactor makes these two numbers explicit, consistent, and universally available on every time entry — regardless of project type.

### The Three Project Types (+ Non-billable)

**Time & Material (T&M)** — We track hours and bill the client per hour. Revenue = hours × hourly rate.

**Fixed Fee** — The client pays a fixed amount. We estimate hours per category and track actuals for profitability analysis. Revenue is known upfront.

**Retainer** — Monthly fee for included hours. Over-budget hours are billed at the category's billable rate. Revenue = monthly fee + overage billing.

**Non-billable** — Internal projects (R&D, training). No client revenue. Time still costs the agency money, so cost rate is tracked.

In all types, individual time entries can be **billable** or **non-billable** (via `isBillable` flag).

---

## Three Problems We're Solving

### Problem 1: Overcomplicated Rate Fields on Time Entries

The current schema uses 3 rate fields split by project type:

- `appliedRate` — used ONLY for T&M (client billing rate)
- `appliedCostRate` — used ONLY for Fixed/Retainer (internal cost per hour)
- `appliedBillRate` — used ONLY for Fixed/Retainer (client billing rate)

**What's broken:**

1. Two fields for the same concept — `appliedRate` (T&M) and `appliedBillRate` (Fixed/Retainer) both mean "what we charge the client per hour".
2. T&M has no cost rate — can't calculate profitability for T&M projects.
3. Retainer profit is always zero — current code sets `overageRate` as BOTH cost and bill rate. Bug.
4. Every calculation requires billing-type branching — fragile and error-prone.
5. Naming is confusing — even experienced developers need to look up which field to use.

### Problem 2: Cost Rate Sourced From Category, Not Person

The current `workCategories` table has `defaultCostRate`. This is conceptually wrong — two people (senior vs. junior developer) doing the same "Development" category work have completely different costs to the agency.

Industry standard (Toggl Track, Harvest, Timely, Everhour): cost rate belongs to the **user**, billable rate belongs to the **category/skill**.

### Problem 3: Currency Handling Is Fragile

Currency currently lives on clients, projects, AND categories separately with no enforcement. Potential for mismatches and no rules about when currency can change.

---

## The New Model

### Time Entry Snapshot Fields

Replace all three old fields with two universal fields + currency (all `v.number()` / `v.string()`, always populated):

```
costRate      — internal cost per hour (what the agency pays for this work)
billableRate  — client-facing rate per hour (0 for non-billable entries)
currency      — snapshotted from the project's client
```

Plus the existing `isBillable: v.boolean()` flag, which determines whether `billableRate` counts toward revenue.

### New Rate Tables

| Table | Fields | Purpose |
|---|---|---|
| `userRates` | userId, orgId, currency, costRate | Per-user, per-currency cost rate |
| `categoryRates` | workCategoryId, orgId, currency, defaultBillRate | Per-category, per-currency default billable rate |
| `projectRateOverrides` | projectId, orgId, workCategoryId, billableRate | Per-project category billable rate override |

### Rate Resolution

**Cost rate resolution:**
```
userRates (matching userId + project currency)
→ No fallback. Block entry creation if missing.
```

**Billable rate resolution (for billable entries):**
```
projectRateOverrides (matching projectId + workCategoryId)
→ categoryRates (matching workCategoryId + project currency)
→ No fallback. Block entry creation if missing.
```

**By project type:**

| Type | costRate | billableRate |
|---|---|---|
| T&M | From userRates | From resolution chain above |
| Fixed | From userRates | From resolution chain above |
| Retainer (within budget) | From userRates | From resolution chain above |
| Retainer (overage) | From userRates | From resolution chain above |
| Non-billable project | From userRates | Always 0 |
| Non-billable entry on billable project | From userRates | Always 0 |

**Snapshot principle:** Rate values are written into the time entry at creation. They never change due to rate table updates — only when the entry itself is edited (and the change is relevant: task/category/billable toggle triggers re-resolution; duration/note/date edits keep existing snapshot).

**Most-specific-wins principle:** Project-level override > workspace-level category default.

### Universal Calculations

Same formula everywhere, no billing-type branching:

```
Labor Cost = Σ (durationMinutes/60 × costRate)      — ALL entries
Revenue    = Σ (durationMinutes/60 × billableRate)   — WHERE isBillable = true
Profit     = Revenue − Labor Cost
```

**Exception — project-level revenue for fee-based types:**
- **Fixed:** Revenue = `project.fixedPrice` (not entry-level)
- **Retainer:** Revenue = `project.monthlyFee` + Σ(overage hours × billableRate)
- **T&M:** Revenue = Σ(billable hours × billableRate) (entry-level is authoritative)

**Effective Rate** (derived, NEVER stored):
```
Effective Rate = Actual Revenue / Actual Hours Logged
```

---

## Currency Model

### Core Principle

Per-client currency. No conversion, ever. Profit is only meaningful within a single currency.

### Rules

1. **Workspace default currency** (`orgSettings.defaultCurrency`): changeable at any time. Only affects new clients going forward.
2. **Client owns the currency**: every client has a `currency` field. Defaults to workspace default at creation. **Immutable after creation** — if a different currency is needed, create a new client.
3. **Project currency**: derived from client. No `currency` field on the projects table.
4. **Category currency**: no `currency` field on categories. Rates are stored per-currency in the `categoryRates` table.
5. **Time entry currency**: snapshotted from the project's client at creation. Self-contained for reporting.
6. **No conversion, ever**: the system never performs currency conversion — not even for display.
7. **Cost rate per user, per currency**: a user can have multiple cost rates in `userRates` — one per currency they work in. The system picks the right one based on project currency at time entry creation.
8. **Reports split by currency**: revenue/profit reports never aggregate across currencies. Either a currency selector or separate sections per currency.

### What NOT to do

- No currency conversion in any form
- No FX rate storage or fetching
- No way to change a client's currency after creation
- No separate currency field on projects or invoices (always from client)
- No single `currency` field on categories (rates are per-currency in `categoryRates`)

---

## Schema Changes

### Fields to REMOVE

**`timeEntries`:**
- `appliedRate`
- `appliedCostRate`
- `appliedBillRate`

**`projects`:**
- `currency` (derive from client)
- `tmRateMode` (no more flat/per-category distinction)
- `hourlyRate` (replaced by category-based rates)
- `tmCategoryRates` (replaced by `projectRateOverrides` table)
- `overageRate` (retainer overage uses category billable rate)

**`workCategories`:**
- `defaultCostRate` (cost rate now on users via `userRates`)
- `defaultBillRate` (moved to `categoryRates` table for per-currency support)
- `currency` (rates are per-currency in `categoryRates`)

**`projectCategoryEstimates`:**
- `internalCostRate` (cost rate from `userRates`)
- `clientBillingRate` (billable rate from `categoryRates` / `projectRateOverrides`)
- Keep `estimatedMinutes` for Fixed project budgeting

### Fields to ADD

**`timeEntries`:**
- `costRate: v.number()` — always populated
- `billableRate: v.number()` — always populated (0 for non-billable)
- `currency: v.string()` — snapshotted from client
- `workCategoryId: v.optional(v.id("workCategories"))` — snapshotted from task at creation (category may change on task later; entry keeps the original for historical reporting)

**`projects`:**
- `monthlyFee: v.optional(v.number())` — retainer monthly fee for revenue calculation

### New Tables

**`userRates`:**
```
orgId: v.string()
userId: v.id("users")
currency: v.string()
costRate: v.number()
createdAt: v.number()
updatedAt: v.number()
```

**`categoryRates`:**
```
orgId: v.string()
workCategoryId: v.id("workCategories")
currency: v.string()
defaultBillRate: v.number()
createdAt: v.number()
updatedAt: v.number()
```

**`projectRateOverrides`:**
```
orgId: v.string()
projectId: v.id("projects")
workCategoryId: v.id("workCategories")
billableRate: v.number()
createdAt: v.number()
updatedAt: v.number()
```

---

## Entry Creation / Edit Behavior

### Creation

1. Determine `isBillable` (from args or task default)
2. Look up project currency (from client)
3. Resolve `costRate` from `userRates` (userId + currency). **Block if missing.**
4. If billable: resolve `billableRate` from `projectRateOverrides` → `categoryRates`. **Block if missing.**
5. If non-billable: set `billableRate = 0`
6. Snapshot all three values (`costRate`, `billableRate`, `currency`) into the time entry

### Edit

- **Task, category, or billable toggle changes:** re-resolve rates from current rate tables
- **Duration, note, or date changes:** keep existing rate snapshot

---

## Migration

No data migration needed. Delete all existing time entries (demo data only). Start fresh with the new schema.

---

## Scope

All three problems (rate fields, rate sourcing, currency) are implemented together in a single refactor. They are deeply intertwined — rate tables need currency, currency determines which rate to pick, snapshot fields are the output.
