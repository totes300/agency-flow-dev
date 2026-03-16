# Phase 3 — Projects Core (Fixed + T&M)

> **Goal**: Project CRUD + the two simpler billing types (Fixed and T&M). Retainer comes in Phase 4.
> **Depends on**: Phase 1 (Work Categories) + Phase 2 (Clients)
> **Access**: Admin only (member only sees project name on tasks)

---

## Decisions

| Question | Decision |
|----------|----------|
| How many project types in v1? | All 3 (Fixed + T&M + Retainer) — Retainer in Phase 4 |
| Type modifiable? | ❌ billingType immutable after creation |
| Project code? | ✅ Auto-generated (PRJ-042), editable, unique within org |
| Currency? | Default: client's, overridable. Locked if invoiced/paid report exists. |
| Fixed estimates? | Per-category grid (hours + cost rate + bill rate per work category) |
| Fixed invoices? | ❌ Never — budget tracking only (informational) |
| T&M pricing? | Flat OR per-category (chosen at creation, tmRateMode immutable) |
| T&M uninvoiced time? | Time entries where `invoicedInReportId` is empty (no lastInvoicedAt field!) |
| Rate snapshot? | ✅ Rate stored on time entry at creation (appliedRate fields) |
| Rate fallback? | None — if no rate exists, time entry is blocked ("Set a rate first") |
| Rate inheritance? | Category default rate → number carries over, currency adjusts to project's |
| Default assignees? | Per-category default person on project → suggestion at task creation |
| List view? | Table (not card grid) |
| Creation? | Modal form |
| Detail page? | Single-page scroll + separate Settings tab |
| Monthly breakdown? | Collapsible months → task rows grouped by category |
| Last logged? | ✅ Shown on all three types' overview |
| Non-billable? | Billable shown by default, toggle to reveal non-billable |
| T&M metrics? | Uninvoiced (hours+amount) · Last invoiced (date) · This month (hours) |
| "Create invoice"? | Creates report + navigates to Reports detail (functional in Phase 2) |
| Older months? | T&M/Fixed: load more on scroll |
| Monthly breakdown default? | Current month open, others collapsed |
| Task row click? | Link → navigates to task detail |
| Copy icon? | Plain text summary to clipboard |
| Empty state? | "No time logged yet" + guidance |

---

## Schema

```typescript
projects: defineTable({
  orgId: v.string(),
  clientId: v.id("clients"),
  name: v.string(),
  code: v.string(),                        // Auto-generated "PRJ-042", editable
  billingType: v.union(
    v.literal("fixed"),
    v.literal("retainer"),
    v.literal("t_and_m")
  ),
  currency: v.string(),                    // Default: client currency, overridable

  // Retainer only — defined in schema now, implemented in Phase 4
  retainerStatus: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  includedHoursPerMonth: v.optional(v.number()),
  overageRate: v.optional(v.number()),
  startDate: v.optional(v.string()),
  rolloverEnabled: v.optional(v.boolean()),
  cycleLength: v.optional(v.number()),

  // T&M only
  hourlyRate: v.optional(v.number()),
  tmCategoryRates: v.optional(v.array(v.object({
    workCategoryId: v.id("workCategories"),
    rate: v.number(),
  }))),
  tmRateMode: v.optional(v.union(v.literal("flat"), v.literal("per_category"))),

  // Shared
  defaultAssignees: v.optional(v.array(v.object({
    workCategoryId: v.id("workCategories"),
    userId: v.id("users"),
  }))),

  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_clientId", ["clientId"])

projectCategoryEstimates: defineTable({
  orgId: v.string(),
  projectId: v.id("projects"),
  workCategoryId: v.id("workCategories"),
  estimatedMinutes: v.number(),
  internalCostRate: v.optional(v.number()),
  clientBillingRate: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_projectId", ["projectId"])
```

## Project code generation

- Format: `PRJ-{sequential number}` (e.g., PRJ-001, PRJ-042)
- Sequence: org-level, monotonically increasing
- **Editable** — admin can override to anything
- Uniqueness: unique within org (validated on save)

## Billing type — immutable

At creation the user chooses: Fixed / Retainer / T&M. **This cannot be changed after.**
- UI: Confirmation in create modal: "The billing type cannot be changed after creation."
- The Retainer option is disabled or hidden until Phase 4.

## Currency

- Default: the selected client's currency
- Overridable at creation and after
- **Lock rule**: If an invoiced/paid report exists (Phase 2) → currency not modifiable, "Currency locked (has invoices)" message

## Fixed project

### Concept
You agree upfront with the client on the price. You estimate hours per category and set rates. The app tracks budget utilization. **No invoices are ever generated** — budget tracking only.

### Per-category estimate grid (`projectCategoryEstimates`)
Each row:
- **Work category** (dropdown, org's active categories)
- **Estimated hours** (number, stored in minutes)
- **Internal cost rate** ($/h) — default: work category's defaultCostRate
- **Client billing rate** ($/h) — default: work category's defaultBillRate

If the project is in a different currency than the category: **number carries over**, currency adjusts to project's.

### Budget tracking (computed, not stored)
- **Actual hours**: sum of all time entries on the project's tasks, per category
- **Budget %**: actual / estimated × 100
- **Health badge**:
  - `on_track` — <80% utilization (green)
  - `at_risk` — 80-100% (amber)
  - `over_budget` — >100% (red)

## T&M project

### Concept
Every billable hour worked is invoicable. The simplest model.

### Pricing — chosen at creation (immutable after)
- **Flat rate**: One hourlyRate for the entire project
- **Per-category**: Different rate per work category (`tmCategoryRates` array)

`tmRateMode`: `"flat"` or `"per_category"` — immutable like billingType.

### Uninvoiced time (computed)
- Time entries where `invoicedInReportId` is empty AND the task is billable
- Amount = Σ(entry durationMinutes / 60 × entry appliedRate)

## Rate snapshot — how the rate gets on the time entry

Phase 7 (Time Tracking) implements this, but the logic is defined here.

**T&M flat rate**: `appliedRate = project.hourlyRate`
**T&M per-category**: `appliedRate = tmCategoryRates.find(r => r.workCategoryId === task.workCategoryId)?.rate`
**Fixed**: `appliedCostRate = estimate.internalCostRate`, `appliedBillRate = estimate.clientBillingRate`

**Fallback**: If no rate exists (e.g., task has no category, or category not in rate list):
- **Blocks** — does not allow time entry creation
- UI: "Set a rate for this category on the project first"

## Default assignees

Per-category default person on the project:
```
defaultAssignees: [
  { workCategoryId: "design_id", userId: "peti_id" },
  { workCategoryId: "dev_id", userId: "anna_id" }
]
```
- At task creation: **suggestion** (not auto-assign): if the task has a category → "Assign to Peti?"
- Overrides the global work category default (which doesn't exist in v1, but the logic should be ready)

## Operations

### Create
- **Modal form**: Client (dropdown) → Name → Billing type (radio: Fixed / T&M, Retainer disabled) → Currency (default: client's)
- Project code auto-generated, shown and editable
- "The billing type cannot be changed after creation" warning
- After save → navigates to project detail page

### Edit
- **Settings tab** on detail page (see UI section)
- Name, currency (if not locked), code, default assignees modifiable
- Fixed: estimate grid editable
- T&M: rates editable (but tmRateMode is not)
- billingType NOT modifiable

### Archive
- Cascades to the project's tasks
- Running timers stop, time entry created
- 5s undo toast (same as clients)

### Hard delete
- Only if no time entries exist anywhere
- Cascade: tasks, category estimates, everything

## Queries / Mutations

```
projects.list          — all org projects, filters: clientId, billingType, archived toggle
                        Returns: name, code, type, client name, currency, last activity, health (fixed)
projects.get           — one project by ID (detailed)
projects.create        — admin only
projects.update        — admin only (billingType and tmRateMode immutable)
projects.archive       — admin only (cascade)
projects.restore       — admin only
projects.remove        — admin only (if no time)
projects.nextCode      — next PRJ-XXX code generation

projectCategoryEstimates.list   — a project's estimates
projectCategoryEstimates.upsert — create/update estimate row
projectCategoryEstimates.remove — delete estimate row
```

## UI

### List view (`/projects`)
- **Table**: Name, code, type badge, client name, currency, last activity, health badge (fixed)
- **Filters**: Client dropdown, Billing type dropdown, "Show archived" toggle
- **"+ New project" button** → modal
- Click → project detail

### Detail view (`/projects/[id]`)

**Two tabs: Overview + Settings**

#### Overview tab

**Header**:
- Name + type badge (Fixed/T&M) + client · currency · type-specific info
- **Last logged**: date (top right)
- Edit (→ Settings tab) and Archive/Delete in ⋮ menu

**Fixed Overview**:
- Budget overview card: Hours used / Estimated (donut or progress) + Health badge
- Per-category grid table: Category · Estimated · Actual · Remaining · Progress bar
- Monthly breakdown (collapsible, current month open):
  - Task rows grouped by category
  - Category header: badge + task count + subtotal
  - Task rows: date · title · aggregated hours (clickable → task detail)
  - Footer: "{N} entries · {M} tasks · {K} categories · Total"
- Load more on scroll for older months
- **No "Create invoice" button** (Fixed never generates invoices)
- Info banner: "Fixed projects are for budget tracking only — no invoices are generated."

**T&M Overview**:
- Metric cards (3 + last logged):
  - **Uninvoiced**: hours + amount (action driver)
  - **Last invoiced**: date or "Never" (urgency signal)
  - **This month**: hours (velocity info)
- Unbilled banner + "Create invoice" button (if unbilled exists) — functional in Phase 2, disabled for now
- Monthly breakdown (same pattern as Fixed):
  - Per month: "Invoiced" ✓ / "Unbilled" label
  - Task rows grouped by category
- Load more on scroll
- Non-billable toggle: only billable shown by default, toggle to reveal

#### Settings tab

**Fixed Settings**:
- Project name (text input)
- Project code (text input)
- Currency (dropdown, locked if invoiced)
- Default assignees grid: Category dropdown + User dropdown per row, + Add row
- Estimate grid: Work category · Estimated hours · Cost rate · Bill rate — per-row editing

**T&M Settings**:
- Project name
- Project code
- Currency
- Rate mode display (not editable): "Flat rate" or "Per-category rates"
- If flat: hourlyRate input
- If per-category: Category · Rate table, per-row editing
- Default assignees grid

### Empty state
- New project, 0 time entries: "No time logged yet — assign tasks and start tracking"
- Empty estimate grid (Fixed): "Add budget estimates per category"

## Acceptance criteria

- [ ] Admin creates Fixed project from modal
- [ ] Admin creates T&M project (flat rate OR per-category)
- [ ] Project code auto-generated and editable
- [ ] billingType and tmRateMode not modifiable after creation
- [ ] Currency defaults to client's, overridable
- [ ] Fixed: estimate grid editable, budget health badge calculates
- [ ] T&M: rates editable on Settings tab
- [ ] Default assignees configurable per category
- [ ] Detail view: Overview + Settings tab, monthly breakdown works
- [ ] Category grouping in monthly breakdown
- [ ] Archive cascades to tasks + timers stop
- [ ] Hard delete blocked if time entries exist
- [ ] List view: filters, search, "Show archived"
- [ ] Member cannot manage, only sees name
- [ ] All data filtered by orgId
