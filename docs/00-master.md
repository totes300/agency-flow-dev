# Agency Flow — Implementation Master Plan


## What is this app?

**Agency Flow** is a multi-tenant B2B SaaS for web agencies. It helps agencies:

1. **Track work** — who's working on what (tasks, statuses, assignments)
2. **Track time** — how much time the team spends on client work (timer + manual entry)
3. Create internal / client reports - turn tracked time into reports (3 billing models)
3. **Invoice clients** — generate invoices from reports ( via szamlazz.hu api)


### Who is it for?

Digital agencies, design studios, and development teams that bill clients on hourly, retainer, or fixed-price basis. Competitors: Toggle track, Click Up, Notion. 


### Two user roles

| Role | Sees | Can do |
|------|------|--------|
| **Admin** | Everything (clients, projects, rates, invoices) | Full control — manages clients, generates invoices, configures settings |
| **Member** | Only their assigned tasks | Tracks time, comments, changes status (except done) |

### The 3 billing models (the heart of the app)

Every project is created with exactly one billing type, and **it cannot be changed after creation**. The type determines how you bill.

#### Fixed (fixed-price project)

You agree on a price upfront with the client. You estimate hours per category (Design, Dev, PM) and set an internal cost rate (what it costs you) and a client billing rate (what the client pays).

The app tracks budget utilization: actual hours worked vs estimated. A health badge shows the status: on_track (<80%), at_risk (80-100%), over_budget (>100%).

**Invoices are never generated** from Fixed projects — this is purely internal budget tracking. The client was already billed the fixed price upfront; the app only shows whether the team stays within budget.

#### Retainer (monthly hour allowance)

The client pays a fixed monthly fee in exchange for a set number of hours per month (e.g., 10 hours/month). If the team works more than the allowance, the overage is billed separately at a specified hourly rate.

Two modes:
- **Rollover ON** (rolling budget): Hours roll within 1-12 month cycles. Unused hours carry forward within the cycle. At cycle end: overage → invoice, unused hours → forfeited (lost).
- **Rollover OFF** (monthly settlement): Each month is independent, no carry-forward. Overage is billable monthly.

Only the **overage is billable**, and only for **closed** months/cycles (the current month is never billable).

#### T&M (Time & Materials)

The simplest model: every billable hour worked is invoicable. No budget, no limit, no allowance.

Two pricing modes (chosen at creation, immutable after):
- **Flat rate**: One hourly rate for the entire project (e.g., $120/h)
- **Per-category**: Different hourly rates per work category (e.g., Design $80/h, Dev $120/h)

The app tracks which time entries are invoiced (via stamp) and which aren't — the billing queue shows how much money is waiting to be billed.

### Data chain

```
Agency (Clerk Organization = tenant)
 └── Client
      └── Project (Fixed / Retainer / T&M)
           └── Task
                └── Time Entry
                     └── Invoice (Report)
```

No orphaned time — every entry belongs to a task, which belongs to a project, which belongs to a client.

---

## Phases overview

| # | Phase | File | Status | Depends on |
|---|-------|------|--------|------------|
| 0 | Foundation | `phase-0-foundation.md` | ⬜ Not started | Starter |
| 1 | Work Categories | `phase-1-work-categories.md` | ⬜ Not started | Phase 0 |
| 2 | Clients | `phase-2-clients.md` | ⬜ Not started | Phase 0 |
| 3 | Projects Core (Fixed + T&M) | `phase-3-projects-core.md` | ⬜ Not started | Phase 1 + 2 |
| 4 | Projects Retainer | `phase-4-projects-retainer.md` | ⬜ Not started | Phase 3 |
| 5 | Tasks Core | `phase-5-tasks-core.md` | ⬜ Not started | Phase 3 |
| 6 | Tasks Detail + Subtasks | `phase-6-tasks-detail.md` | ⬜ Not started | Phase 5 |
| 7 | Time Tracking | `phase-7-time-tracking.md` | ⬜ Not started | Phase 5 |

---

## Dependency chain

```
Phase 0 (Foundation)
  ├── Phase 1 (Work Categories)
  ├── Phase 2 (Clients)
  │    └── Phase 3 (Projects Core: Fixed + T&M)
  │         ├── Phase 4 (Projects Retainer)
  │         └── Phase 5 (Tasks Core)
  │              ├── Phase 6 (Tasks Detail + Subtasks)
  │              └── Phase 7 (Time Tracking)
```

Phase 1 and 2 can run in parallel. Phase 5-6-7 are also partially parallelizable.

---

## Architecture (applies to all phases)

### Key decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Multi-tenant | Clerk Organization = tenant, orgId filtering on every query | Data isolation |
| Roles | Clerk org roles: `admin` + `member` | From JWT, not custom field |
| Timezone | Org-level IANA timezone setting | Timer, entry dates, reports all align to this |
| Base fields | `createdAt`, `updatedAt`, `createdBy` on every table | Audit, sorting, debugging — can't backfill later |
| Soft delete | `archivedAt: timestamp \| undefined` | More info than boolean, same filter |
| Billing source of truth | `invoicedInReportId` FK on time entry | 1 field = billed? + which invoice? + lock |
| Work vs money axis | Task status (team) separated from billing stamp (admin) | No mixing: running tasks can be invoiced monthly |
| "Fully invoiced" | Computed: `status.type = done` + no unstamped entries | No stored flag that can lie |
| Rate snapshot | Rate stored on time entry at creation | No retroactive rate change problems |
| Rounding | Org setting: 1/5/6/15 min, always ceil | Favors the agency |
| Statuses | Custom `statuses` table + 5 system types | Configurable, but system logic uses the type |
| Currency | Org → Client → Project chain, ~15 ISO 4217 | Modifiable at each level, locked if invoiced |
| Multi-currency reporting | Separate totals per currency | No conversion |

### Status type system (5 types)

The system uses `type`, not the status name:

| Type | Meaning | Tab |
|------|---------|-----|
| `backlog` | Unprioritized pile | Backlog (+ Today special) |
| `in_progress` | Someone actively working on it | Active |
| `review` | Waiting on someone (admin, client) | Review |
| `blocked` | Cannot proceed | Blocked |
| `done` | Complete | Done |

Members cannot switch to `type: done` statuses. Custom statuses can be assigned to any type.

### Currency chain
```
Org (default currency) → Client (default: org's) → Project (default: client's) → Invoice
```
- ~15 ISO 4217 subset: EUR, USD, GBP, HUF, CHF, CZK, PLN, SEK, NOK, DKK, RON, CAD, AUD, JPY, BRL
- Project currency lock: if invoiced/paid report exists → locked
- Client currency: always modifiable (doesn't affect existing projects)
- Rate inheritance: number carries over, currency adjusts to the project's (€80/h → $80/h)

### Cascade rules
```
Archive: cascades down (Client → Projects → Tasks → Timers stop)
Restore: does NOT cascade (must restore individually)
Hard delete: blocked if time entries exist anywhere → "archive instead"
```

