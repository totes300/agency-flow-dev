# Phase 8 — Time Entry Settlement

> **Goal**: Fix the reporting/stats bug where time entries on within-budget retainer periods and Fixed projects stay forever in an "open / not invoiced" state, by introducing a lightweight settlement model that cleanly separates *invoice linkage* from *client-facing work closure*.
> **Depends on**: Phase 3 (Projects Core), Phase 4 (Projects Retainer), Phase 7 (Time Tracking)
> **Scope**: Schema additions + settlement/guard/UI wiring — no new tables. Backward-compatible with the existing `invoiceId`-based lock.

---

## Revision Pass (v2) — Required Before Implementation

> Two independent reviews (verified against the live codebase) found this PRD is **directionally correct but not yet implementable as written**. The core `settledAt`/`settledReason` split is the right fix and should ship. The 8 items below must be folded in first — they are the difference between "implements smoothly" and "implementer hits a wall on day one." Items 1, 7, 8 are load-bearing; the rest are correctness/consistency.

### 1. Rename the existing `isMonthClosed` — it already means something else (HIGHEST PRIORITY)

`getRetainerData` already exposes `isMonthClosed`, derived **purely from the calendar**:

```
convex/projects.ts:695   const isMonthClosed = m.endDate < todayStr;   // "calendar month has ended"
```

This PRD redefines "Closed" as **"an admin explicitly closed/settled the period"** (`closedAt` set) and introduces a new middle state **`Open`** (ended-but-not-closed). The two meanings collide. The existing `isMonthClosed` is load-bearing in **5 places** — all must be reconciled, not silently overloaded:

| Location | Current use | After rename |
|---|---|---|
| `convex/projects.ts:695,744` | derived flag on each month | split into **`periodEnded`** (calendar) + **`closedAt`/`isClosed`** (admin action, from `retainerPeriods`) |
| `convex/projects.ts:713,719,782` | `balanceStatus` due/unused gating | keep keyed on **`periodEnded`** (financial due-ness is calendar-driven, unchanged) |
| `components/projects/monthly-breakdown-card.tsx:44` | `billingStateOf` → `in_progress` | `!periodEnded → in_progress`; add `periodEnded && !isClosed → open`; `isClosed → closed` (3-state pill) |
| `components/projects/monthly-breakdown-card.tsx:144` | `closedCount` "N/N months closed" | becomes "N/N **ended**" or "N **closed**" — pick one meaning explicitly |
| `lib/retainer-row-action.ts:17,42` | overage-bill gate (`if (!isMonthClosed) return "report"`) | gate on **`periodEnded`**, NOT admin-close — billing overage must not require an admin close first |

**Rule:** `periodEnded` = calendar; `isClosed`/`closedAt` = admin settlement. Never reuse one name for both. This is the single biggest source of silent bugs in this phase.

### 2. Drop the "statement send/download history" language — that artifact doesn't exist

There is **no `statements` table, no statement number, no `downloadedAt`/downloaded-by tracking**. `getRetainerStatement` (`convex/statements.ts`) is a live read-through query; the report page renders on demand. So the UI copy "**Send & close**" and the Reopen line "*the statement (downloaded {date} by {user})*" promise a persisted, tracked, delivered artifact that this app does not have (and which this phase explicitly defers to the big PRD).

**Simplify the close flow to what exists:**
> `Close` → report **preview** + confirm ("Review & close" / "Close period") → after close, primary artifact is **Download report**, overflow has **Reopen**.

Keep reversibility reassurance; drop delivery/download audit wording.

### 3. The backdated guard must cover ALL write paths — and be scoped to retainer only

Two corrections to the § "backdated-entry guard on create":

**(a) There is a third write path the PRD misses.** Entries are inserted from `timeEntries.create` AND `timer.commitEntry` (`convex/timer.ts:312`). A guard on `create` alone is bypassed by the timer. Extract a shared helper and call it from **all three** mutation paths (`create`, `timer.commitEntry`, and `update` when date/task changes):

```typescript
// convex/lib/settleGuards.ts
export async function assertEntryDateOpen(
  ctx: MutationCtx, project: Doc<"projects">, date: string,
): Promise<void> { /* closed-retainer-period check only — see (b) */ }
```

**(b) Keep ONLY the closed-retainer-period arm. Delete the T&M/Fixed "covered by finalized invoice" arm.** Its stated justification — "a backdated entry silently breaks the invoice total" — is **false under this codebase's own snapshot model**: an invoice total is a frozen line-item snapshot; a new entry does not retro-add to it. For T&M/Fixed a backdated entry is simply open and rolls onto the next invoice — blocking the log is heavier than needed and contradicts how T&M billing works (entry-selection based). The real bug is logging into a *closed retainer period*; guard that, nothing else.

### 4. Audit EVERY `invoiceId` billing predicate, not just `projectOverview`

The `settledAt` split changes the meaning of "billed/closed" everywhere `invoiceId` is used as a proxy. This is broader than the rename touch-list. **Add an acceptance criterion:** review each predicate and classify it as `!invoiceId && !settledAt` (open), `invoiceId || settledAt` (locked), or invoice-only (unchanged). Known sites beyond `projectOverview`:

- `convex/lib/readyToInvoice.ts:213` (`!e.isBillable || e.invoiceId` → must add `|| e.settledAt`)
- `convex/lib/projectSummary.ts:192`
- `convex/timeEntries.ts:708,710` (`listProjectEntries` filter)
- `components/projects/project-time-stats.tsx`, `project-time-selection-toolbar.tsx`, `time-entry-modal.tsx`

### 5. Fix the non-billable `entryStatus` contradiction

The code sample (§ Derived Status) returns `"closed"` for a settled non-billable entry, but the prose says it should still display `non_billable`. Make the code match the prose — billability is the more informative axis for that row:

```typescript
function entryStatus(e: Doc<"timeEntries">) {
  if (!e.isBillable)               return "non_billable"; // settled or not — badge stays non_billable
  if (e.invoiceId && !e.settledAt) return "draft";
  if (e.settledAt)                 return "closed";
  return "open";
}
```

The lock still applies (guard keys on `settledAt`/`invoiceId`, independent of the badge).

### 6. Two trivial doc fixes (apply inline)

- Transition table passed a phantom `userId` arg to `settleInvoiceEntries`; the helper signature has none. **(Fixed below in § Mutations.)**
- Acceptance criterion said `billingStatus` adds `settled`; the enum value is `closed`. **(Fixed below in § Acceptance.)**
- Touch-list claimed "5 files, 30 references"; actual is **7 files, 33 references** — add `components/invoices/project-invoices.tsx` and `components/invoices/project-invoices-payment-cards.tsx`.

### 7. Build the overage-context helpers — they do NOT exist yet (load-bearing)

`closePeriod` calls `computePeriodOverageContext`, and `closeRetainerCycle` calls `computeCycleOverageContext` + `getCyclePeriods`. **None of these exist.** What exists: `assertRetainerInvoiceable({ isOverageDue })` (pure, `convex/lib/invoiceCreation.ts`), `computeRetainerBalance` / `getRetainerCyclePosition` (`convex/lib/retainerBalance.ts`), and the full rollover-aware cycle math **inlined inside the `getRetainerData` query** (`convex/projects.ts:485+`).

**This extraction is the real engineering work of this phase** — not the schema fields. Plan:

1. Extract `getRetainerData`'s cycle/month math into `convex/lib/retainerCycle.ts` as pure-ish helpers: `getCyclePeriods(project, cycleStart)`, `computePeriodOverageContext(entries, project, period) → { isOverageDue, overageMinutes }`, `computeCycleOverageContext(...)`.
2. Refactor `getRetainerData` to consume the extracted helpers (no behavior change — guard with existing tests).
3. `closePeriod` / `closeRetainerCycle` then reuse the same helpers → `assertRetainerInvoiceable` stays the single source of truth, as the PRD intends.

### 8. Back the Monthly Breakdown rows with real `retainerPeriods` rows (load-bearing)

`closePeriod(periodId)` assumes a row exists per displayed month. But the breakdown is **computed from date math** in `getRetainerData` and never reads the `retainerPeriods` table; rows are created only lazily (prev-month cron in `convex/retainerCron.ts`, or explicit `ensure`). So for most visible months **there is no `periodId` to pass.**

**Fix:** make `closePeriod` accept `{ projectId, periodStart }` and **ensure-then-close** (upsert the `retainerPeriods` row inside the mutation, reusing `ensure`'s logic), OR have the UI call `retainerPeriods.ensure` immediately before `closePeriod`. Same for `reopenPeriod`. Specify which; do not assume the row is already there.

---

## Relationship to `billing-periods-monthly-close-prd.md`

There is a separate, larger PRD (`docs/billing-periods-monthly-close-prd.md`) that proposes a full architectural rebuild of billing: a new `billingPeriods` ledger table, unified `billingDocuments` for statements + invoices, period audit events, and a `billingPeriodId` anchor on every time entry to replace `invoiceId` as the lock.

**This phase is deliberately NOT that rebuild.** It is a lightweight, forward-compatible step that solves the immediate reporting bug without taking on a 2–4 week billing rewrite.

Compatibility contract:

- The lock predicate this phase introduces (`entry.invoiceId !== undefined || entry.settledAt !== undefined`) is exactly the "legacy" predicate the big PRD already commits to supporting during its migration ("*A time entry is locked if it has a `billingPeriodId` pointing to a non-void billing period, **or it has a legacy `invoiceId` pointing to a non-void invoice during migration**.*")
- If the big PRD is later implemented, the fields added here either (a) stay as redundant safety alongside `billingPeriodId`, or (b) get migrated to `billingPeriodId` via a ~50-line backfill mutation. Either way, **no work done here is wasted**.

Triggers that would warrant escalating to the full PRD (none currently met):

| Trigger | Why it warrants the rebuild |
|---|---|
| First paying customer requests audit log / compliance reports | `billingPeriodEvents` table earns its keep |
| Owner repeatedly edits statement/invoice line item text and it's painful | Unified document editor pays off |
| 3rd parallel bug hits the duplicated invoice vs statement code paths | The duplication is no longer cheap |
| Backdated edits silently mutate already-issued statements | Period-scoped immutability is required |

Until any of these fire, this phase is the correct stopping point.

---

## Problem Statement

Today, `timeEntries.invoiceId` is the only marker of "closed" state. This breaks down across project types:

| Project type | Current behavior | Bug |
|---|---|---|
| **T&M** invoice finalize | Entries stamped with `invoiceId` at draft creation | ✅ Works |
| **Fixed** invoice | Entries stamped with `invoiceId`, but revenue comes from the `lineType: "fixed"` line, not from time-line rates | ⚠️ Semantically misleading: stamp ≠ "this hour was billed" |
| **Retainer + overage** invoice | All cycle entries (overage + within-budget) stamped with `invoiceId` | ⚠️ Works but conflates two reasons in one field |
| **Retainer within-budget** month | `assertRetainerInvoiceable()` blocks invoice creation → no `invoiceId` is ever set → entries appear "open forever" in stats and filters | ❌ The main reported bug |
| **Void** (not delete) invoice | `changeInvoiceStatus` patches only the invoice status; entries retain their `invoiceId` | ❌ Secondary bug |

Two concepts are conflated into one field:

1. **"Invoiced"** — money is being requested for this hour on a specific invoice (T&M direct billing, retainer overage line)
2. **"Settled / closed"** — this hour will no longer move, has been accounted for in a client-facing communication (invoice OR retainer report close; future project-close flow deferred), and should be excluded from "needs attention" reports

The fix: split them.

---

## Conceptual Model (the 5-line mental model)

```
invoiceId                       = invoice document linkage
settledAt                       = client-facing work closure (event timestamp)
settledReason                   = closure classification (3 values)
settledPeriodStart/End          = closure context snapshot (which window)
retainerPeriods.closedAt + By   = period-level process marker (who/when closed)
```

Per-entry truth lives on the entry. Per-period process state lives on the period. They answer different questions:

| Question | Truth source |
|---|---|
| "Is **this entry** closed?" | `entry.settledAt` |
| "Was **this period** ever closed by an admin?" | `retainerPeriods.closedAt` |
| "Who/when settled this entry?" — `retainer_included` | `period.closedBy + closedAt` (find period by `settledPeriodStart/End`) |
| "Who/when settled this entry?" — `invoiced` / `fixed_included` | `invoice.createdBy + issueDate` (via `entry.invoiceId`) |

---

## Decisions

| Question | Decision |
|---|---|
| Add a new `settlements` or `billingPeriods` table? | ❌ No — denormalized fields on `timeEntries`, matching the existing rate-snapshot pattern (`costRate`, `billableRate`, `rateCurrency`, `snapshotCategoryId`) |
| Retainer within-budget close trigger? | Manual admin button on Monthly Breakdown row |
| Fixed close trigger? | Each Fixed invoice closes entries up through `invoice.periodEnd`. Project-completion auto-close is deferred (no project status field exists yet). |
| Auto-close on `totalInvoiced >= fixedPrice`? | ❌ No — too aggressive (warranty, scope creep, post-launch tweaks) |
| Re-open settled entries directly? | ❌ No — guard blocks edit; user must reopen the period or delete the invoice first (regen, no void needed) |
| Cascade re-open via cycle-level entity? | ❌ No — cycle close = bulk-close N monthly `retainerPeriods` with the same `closedAt`. No new entity. |
| `paid → void` transition? | ❌ Out of scope — currently disallowed by existing validation (refund/credit territory) |
| Backdated entry into a closed period? | ❌ Reject on create — explicit error: "Reopen the period to log entries in this date range." |
| Non-billable entries on period close? | ✅ Also locked — they're part of the client-facing report |
| New index on `timeEntries.invoiceId`? | ❌ Not needed — settle helpers walk via `invoiceLineItems.by_invoiceId` (existing index). **Invariant:** the canonical set of "entries settled by invoice X" is the union of `invoiceLineItems(invoiceId=X).timeEntryIds` arrays — **not** every entry that happens to carry `invoiceId === X`. Any entry whose `invoiceId` matches but is not referenced by a line item is data drift and should be treated as a bug. |
| `projectId` denormalization on `timeEntries`? | ❌ Not in this phase — see "Future migration path" below |

---

## Schema Changes

### `timeEntries` — 4 new optional fields (no migration required at MVP)

```typescript
timeEntries: defineTable({
  // ... existing fields, including invoiceId (unchanged)
  invoiceId: v.optional(v.id("invoices")),                  // existing

  // NEW
  settledAt: v.optional(v.number()),                        // event timestamp (ms)
  settledReason: v.optional(v.union(
    v.literal("invoiced"),           // billed hourly on an invoice (T&M direct OR retainer overage line)
    v.literal("retainer_included"),  // covered by the retainer monthly fee (within-budget period closed via report)
    v.literal("fixed_included"),     // covered by the fixed project price (Fixed invoice closed period)
  )),
  settledPeriodStart: v.optional(v.string()),               // "YYYY-MM-DD"
  settledPeriodEnd: v.optional(v.string()),                 // "YYYY-MM-DD"
})
// No new indexes — settle helpers walk via existing invoiceLineItems.by_invoiceId
```

**4 new fields, not 5.** Two deliberate omissions:

- **`"manual_close"` enum value omitted** — the project-completion auto-close is DEFERRED out of this phase (see below). Enum extension is trivially additive in Convex; YAGNI says add the value when the first callsite needs it, not before.
- **`settledByUserId` field omitted** — period-level `retainerPeriods.closedBy` covers accountability for `retainer_included` settlements; invoice-anchored settlements derive "who" from `invoice.createdBy` / status transition events. Entry-level duplication adds no information and contradicts the "no audit log" decision the user explicitly made.

### `retainerPeriods` — 2 new optional fields

```typescript
retainerPeriods: defineTable({
  // ... existing fields
  closedAt: v.optional(v.number()),     // NEW — event timestamp (ms)
  closedBy: v.optional(v.id("users")),  // NEW — matches existing `createdBy` convention
})
// No new indexes — lookups always by _id or the existing by_projectId_periodStart
```

**Naming convention:** the codebase uses `createdBy: v.id("users")` (no `UserId` suffix) across **11 tables**. `closedBy` matches this; `closedByUserId` would be the only outlier.

---

## Derived Status

The per-entry **display** status is a pure derivation over the stored fields. It collapses to the row-level vocabulary the UI shows — `open / draft / closed / non_billable` — and discards nothing: the granular reason stays in `settledReason` for reports (see Reporting Changes).

```typescript
// Display status for the row badge — UI vocabulary only.
function entryStatus(e: Doc<"timeEntries">) {
  if (!e.isBillable)               return "non_billable"; // settled or not — billability is the row axis (see Revision Pass #5)
  if (e.invoiceId && !e.settledAt) return "draft";        // on a draft invoice
  if (e.settledAt)                 return "closed";       // invoiced / retainer_included / fixed_included all collapse here
  return "open";
}
```

`invoiced` and `settled` do **not** appear as row-level statuses — they collapse to `closed`. To recover the financial meaning (for reports, the period drill-down, or stats) read `settledReason` directly:

```typescript
// settledReason is the durable truth — never collapsed:
//   "invoiced"          → billed hourly (T&M direct or retainer overage), revenue
//   "retainer_included" → covered by the retainer monthly fee, no extra revenue
//   "fixed_included"    → covered by the fixed project price, no extra revenue
```

**Invariant:** `settledReason === "invoiced"` ⇔ this entry was a billable line item on a finalized invoice whose revenue was rate-driven (T&M time line or retainer overage line). Settlement via Fixed invoice or period-close must never produce `settledReason === "invoiced"`. This invariant is what lets the row badge safely collapse to `closed` while reports stay precise.

A non-billable entry that has been settled (locked by a period close) still displays as `non_billable` — billability is the more informative axis for that row — but its `settledAt` is set, so the edit/delete guard applies.

---

## Mutations

### `convex/lib/settleEntries.ts` (new helper module)

```typescript
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

async function getEntriesForInvoice(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
): Promise<Doc<"timeEntries">[]> {
  const lineItems = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
    .collect();

  const entries: Doc<"timeEntries">[] = [];
  for (const li of lineItems) {
    for (const entryId of li.timeEntryIds ?? []) {
      const e = await ctx.db.get(entryId);
      if (e && e.orgId === orgId && e.invoiceId === invoiceId) {
        entries.push(e);
      }
    }
  }
  return entries;
}

type SettledReason = "invoiced" | "retainer_included" | "fixed_included";

export async function settleInvoiceEntries(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
  periodStart?: string,
  periodEnd?: string,
  reason: SettledReason = "invoiced",
): Promise<number> {
  const entries = await getEntriesForInvoice(ctx, invoiceId, orgId);
  const now = Date.now();
  for (const e of entries) {
    await ctx.db.patch(e._id, {
      settledAt: now,
      settledReason: reason,
      settledPeriodStart: periodStart,
      settledPeriodEnd: periodEnd,
      updatedAt: now,
    });
  }
  return entries.length;
}

export async function unsettleInvoiceEntries(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
  options: { clearInvoiceId?: boolean } = {},
): Promise<number> {
  const entries = await getEntriesForInvoice(ctx, invoiceId, orgId);
  const now = Date.now();
  for (const e of entries) {
    await ctx.db.patch(e._id, {
      settledAt: undefined,
      settledReason: undefined,
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      ...(options.clearInvoiceId ? { invoiceId: undefined } : {}),
      updatedAt: now,
    });
  }
  return entries.length;
}
```

### Invoice status transition wiring

Update `applyStatusTransition` in `convex/invoices.ts` to call the helpers. Only valid transitions are listed (matches the existing `VALID_TRANSITIONS` map — `paid → void` remains disallowed):

| Transition | Settlement action | Other |
|---|---|---|
| `draft → invoiced` | `settleInvoiceEntries(invoiceId, orgId, invoice.periodStart, invoice.periodEnd, reason)` | sets `issueDate` |
| `draft → void` | `unsettleInvoiceEntries({ clearInvoiceId: true })` | — |
| `invoiced → draft` | `unsettleInvoiceEntries({ clearInvoiceId: false })` → entries become `draft` | — |
| `invoiced → paid` | no settlement change | sets `paidAt = now` |
| `invoiced → void` | `unsettleInvoiceEntries({ clearInvoiceId: true })` | — |
| `paid → invoiced` | no settlement change | clears `paidAt` |
| `paid → draft` | `unsettleInvoiceEntries({ clearInvoiceId: false })` | clears `paidAt` |
| `deleteInvoice` | replace existing inline unlink with `unsettleInvoiceEntries({ clearInvoiceId: true })` | full delete |

For **Fixed** invoices specifically, the helper takes a `reason` parameter so settled entries get `settledReason: "fixed_included"` (not `"invoiced"`). Caller resolves the project type from `invoice.projectId → project.billingType` (the invoice schema has no `billingType` field of its own; see `convex/schema.ts:235-282` and `:176-208`):

```typescript
// In applyStatusTransition, draft → invoiced branch:
const project = await ctx.db.get(invoice.projectId);
const isFixed = project?.billingType === "fixed";
await settleInvoiceEntries(
  ctx,
  invoice._id,
  invoice.orgId,
  invoice.periodStart,
  invoice.periodEnd,
  isFixed ? "fixed_included" : "invoiced",
);
```

The helper signature accepts `reason: SettledReason = "invoiced"` as its last parameter.

### `convex/retainerPeriods.ts` — new `closePeriod` mutation

The Monthly Breakdown is computed from project/date math, so a displayed month may not have a `retainerPeriods` row yet. The mutation therefore accepts the natural UI key (`projectId + periodStart`) and **ensure-then-closes** the row internally. Do not require the UI to pass a `periodId`.

```typescript
export const closePeriod = mutation({
  args: {
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-01
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) throw new ConvexError("Project not found.");
    if (project.billingType !== "retainer") throw new ConvexError("Not a retainer project.");

    const period = await ensureRetainerPeriodInternal(ctx, authCtx, project, args.periodStart);
    if (period.closedAt !== undefined) {
      throw new ConvexError("Period is already closed.");
    }

    // BACKEND GUARD: no-revenue close is only valid when this period is not invoiceable.
    // A stale browser tab or a direct mutation call must NOT be able to silently
    // mark overage entries as `retainer_included` (no revenue) when they should be
    // on an overage invoice. Reuse the same predicate as `assertRetainerInvoiceable`.
    //
    // IMPORTANT — rollover vs non-rollover semantics:
    //   - NON-rollover: monthly overage IS invoiceable → block close if isOverageDue.
    //   - ROLLOVER: monthly is NEVER directly invoiceable (overage settles at cycle end).
    //     `closePeriod` on a rollover monthly should succeed regardless of monthly overage;
    //     the cycle-level check lives in `closeRetainerCycle`.
    // `assertRetainerInvoiceable` (existing function in convex/lib/invoiceCreation.ts) already encodes
    // this distinction — reuse it as the single source of truth, do not re-derive here.
    const overageContext = await computePeriodOverageContext(ctx, project, period);
    if (overageContext.isOverageDue) {
      throw new ConvexError(
        "This period has overage that must be invoiced before it can be closed. " +
          "Create the overage invoice first.",
      );
    }
    // Belt-and-suspenders: also block close if the date range has any draft/issued invoice
    // linked to entries in this period. A draft for this period means an invoice flow is
    // in progress and a no-revenue close would orphan that draft.
    // (Implementation: query invoices by project+periodStart/End; reject if any non-void exists.)

    // Task fan-out (N+1 acknowledged — see "Future migration path")
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", authCtx.orgId).eq("projectId", period.projectId),
      )
      .collect();

    const now = Date.now();
    let settledCount = 0;
    for (const task of tasks) {
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .collect();
      for (const e of entries) {
        if (
          e.date >= period.periodStart &&
          e.date <= period.periodEnd &&
          e.settledAt === undefined &&
          e.invoiceId === undefined
        ) {
          await ctx.db.patch(e._id, {
            settledAt: now,
            settledReason: "retainer_included",
            settledPeriodStart: period.periodStart,
            settledPeriodEnd: period.periodEnd,
            updatedAt: now,
          });
          settledCount++;
        }
      }
    }

    await ctx.db.patch(period._id, {
      closedAt: now,
      closedBy: authCtx.userId,
      updatedAt: now,
    });

    return { settledCount };
  },
});

export const reopenPeriod = mutation({
  args: {
    projectId: v.id("projects"),
    periodStart: v.string(), // YYYY-MM-01
  },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) throw new ConvexError("Project not found.");
    if (project.billingType !== "retainer") throw new ConvexError("Not a retainer project.");

    const period = await ensureRetainerPeriodInternal(ctx, authCtx, project, args.periodStart);
    if (period.closedAt === undefined) {
      throw new ConvexError("Period is not closed.");
    }

    // Reverse the same fan-out, only for entries that were settled by THIS period close
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", authCtx.orgId).eq("projectId", period.projectId),
      )
      .collect();

    const now = Date.now();
    let reopenedCount = 0;
    for (const task of tasks) {
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .collect();
      for (const e of entries) {
        if (
          e.settledReason === "retainer_included" &&
          e.settledPeriodStart === period.periodStart &&
          e.settledPeriodEnd === period.periodEnd
        ) {
          await ctx.db.patch(e._id, {
            settledAt: undefined,
            settledReason: undefined,
            settledPeriodStart: undefined,
            settledPeriodEnd: undefined,
            updatedAt: now,
          });
          reopenedCount++;
        }
      }
    }

    await ctx.db.patch(period._id, {
      closedAt: undefined,
      closedBy: undefined,
      updatedAt: now,
    });

    return { reopenedCount };
  },
});
```

### Rollover cycle close — thin wrapper, monthly boundary preserved

Per the decision table: cycle close = bulk-close N monthly `retainerPeriods` with the same `closedAt`. We deliberately keep the **monthly** boundary on each entry's `settledPeriodStart/End` (not the cycle boundary), because:

1. Per-month reopen stays unambiguous — `reopenPeriod({ projectId, periodStart: marchStart })` reverses exactly the entries it settled, identified by `(settledReason="retainer_included", settledPeriodStart=marchStart, settledPeriodEnd=marchEnd)`.
2. Cycle-level reports are cheap (cycle length ≤ 12), and walk the N monthly periods.
3. The `retainerPeriods.closedAt` value being identical across the N month rows is the cycle-close fingerprint — UI can show "Q1 2026 cycle closed Apr 1 by Adam" by grouping on equal `closedAt`.

```typescript
export const closeRetainerCycle = mutation({
  args: { projectId: v.id("projects"), cycleStart: v.string() },
  handler: async (ctx, args) => {
    const authCtx = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== authCtx.orgId) throw new ConvexError("Project not found.");
    if (project.billingType !== "retainer" || !project.rolloverEnabled) {
      throw new ConvexError("closeRetainerCycle only applies to rollover retainer projects.");
    }
    // Resolve the N monthly periods that belong to this cycle (cycleStart + cycleLength months).
    const periods = await getCyclePeriods(ctx, project, args.cycleStart);
    // Aggregate overage at cycle level — rollover overage is cycle-end, not monthly.
    const cycleOverage = await computeCycleOverageContext(ctx, project, periods);
    if (cycleOverage.isOverageDue) {
      throw new ConvexError(
        "This cycle has overage that must be invoiced before it can be closed.",
      );
    }
    // Close each monthly period in this cycle with the same timestamp.
    // Each call writes its own monthly boundary on entries (precise, per-month reopen-able).
    const results = await Promise.all(
      periods.map((p) => closePeriodInternal(ctx, p, authCtx)),
    );
    return { closedPeriods: periods.length, settledCount: results.reduce((s, r) => s + r.settledCount, 0) };
  },
});
```

`ensureRetainerPeriodInternal` is the shared upsert logic from the existing `ensure` mutation, extracted so UI rows never need a pre-existing period row. `closePeriodInternal` is the shared body of `closePeriod`, extracted so both the single-month and cycle paths use the same close logic.

### Project-completion auto-close — DEFERRED out of this phase

The original draft proposed bulk-closing remaining open entries when a project moves to a "Completed" status. **This is not implementable in the current schema**: `projects` has no general status field, only `archivedAt` and `retainerStatus` (`convex/schema.ts:202, 187`). Three options were considered:

1. ❌ **Add a project status field as part of this phase** — scope creep, drags project lifecycle work into a settlement phase.
2. ❌ **Tie `manual_close` to the existing `archive` action** — archive is conceptually different (soft delete / hide); coupling settlement to it would make archive irreversible without a chain reopen.
3. ✅ **Defer entirely.** The `"manual_close"` value is **not** added to the `settledReason` enum in this phase (YAGNI — adding a literal to a Convex `v.union` is trivially additive). A follow-up phase that introduces explicit project lifecycle (or a separate "Close project work" admin action) adds the enum value and wires it up in one PR.

The settlement model is still complete without this: every entry has a settlement path through invoice or retainer period close. Fixed projects with trailing entries that never get invoiced will sit as `open` until either (a) a later Fixed invoice covers their date range and closes them with `fixed_included`, or (b) the future project-completion flow adds the `manual_close` enum value and uses it.

### `convex/timeEntries.ts` — guard updates

```typescript
// In update():
if (entry.invoiceId !== undefined || entry.settledAt !== undefined) {
  throw new ConvexError(
    entry.invoiceId
      ? "Cannot edit a time entry linked to an invoice — delete or void the invoice first."
      : "Cannot edit a settled time entry — reopen the period first.",
  );
}

// Same guard in remove(), and in any bulk billable-flag update.
```

### `convex/lib/settleGuards.ts` — closed-retainer-period write guard

The guard must cover **all time-entry write paths**, but it should only block entries inside a closed retainer period. Do **not** block T&M or Fixed entries just because the date overlaps a finalized invoice: invoice totals are frozen line-item snapshots in this codebase, so a later backdated entry remains open and rolls onto the next invoice.

```typescript
// Shared helper. Call from:
//   - convex/timeEntries.ts:create
//   - convex/timer.ts:commitEntry
//   - convex/timeEntries.ts:update when date or task changes

export async function assertEntryDateOpen(
  ctx: MutationCtx,
  project: Doc<"projects">,
  date: string,
): Promise<void> {
  if (project.billingType !== "retainer") return;

  const closedPeriod = await ctx.db
    .query("retainerPeriods")
    .withIndex("by_projectId_periodStart", (q) => q.eq("projectId", project._id))
    .filter((q) =>
      q.and(
        q.lte(q.field("periodStart"), date),
        q.gte(q.field("periodEnd"), date),
        q.neq(q.field("closedAt"), undefined),
      ),
    )
    .first();
  if (closedPeriod) {
    throw new ConvexError(
      "Cannot log time in a closed retainer period. Reopen the period first.",
    );
  }
}
```

On `update`, run this helper against the **target project/date** after resolving any requested task/date changes. This blocks moving an existing entry into a closed retainer period without blocking ordinary edits that keep the entry in an open period.

---

## Reporting Changes

### The UI collapse is display-only — the schema is the durable reporting truth

This is the load-bearing principle behind the whole UI simplification: the row badge collapses to `Open / Draft / Closed`, but the **database keeps full fidelity**. `entryStatus()` is a pure derivation over the stored fields — it discards nothing.

The three financial reasons are always directly queryable, with no schema change, ever:

```typescript
// Work covered within the retainer monthly fee
entries.filter(e => e.settledReason === "retainer_included")
// Work billed hourly as revenue (T&M direct or retainer overage)
entries.filter(e => e.settledReason === "invoiced")
// Work covered by a fixed project price
entries.filter(e => e.settledReason === "fixed_included")
```

**Overage is a period-level aggregate, not an entry property.** In an overage month every entry is stamped `settledReason: "invoiced"` (invoice-anchored), so "which specific hours were the overage" is NOT an entry-level question. The overage minutes/amount live on the **invoice snapshot** (`retainerUsedMinutes − retainerIncludedMinutes`, and the `lineType: "overage"` line items). These snapshots are frozen at invoice creation, so historical overage never drifts when project budgets/rates change later.

**Consequence — future per-client / per-interval reports need no schema change.** A "total overage per client this year" report is a pure aggregation over overage invoices (indexed by `clientId`, filtered by `periodStart/periodEnd`, summing `lineType: "overage"` items). Documented here so it's known to be feasible; not built in this phase. (When `invoiceType` lands with the Stripe work, identifying overage invoices becomes a single filter instead of a project-type join.)

### `convex/timeEntries.ts → listProjectEntries`

The user-facing filter mirrors the collapsed UI vocabulary — `open / draft / closed / non_billable`. Reports that need the invoiced-vs-covered split query `settledReason` directly (above), not through this param.

```typescript
billingStatus: v.optional(v.union(
  v.literal("open"),         // billable && !invoiceId && !settledAt
  v.literal("draft"),        // invoiceId defined, settledAt undefined (on a draft invoice)
  v.literal("closed"),       // settledAt defined — any reason (invoiced / retainer_included / fixed_included)
  v.literal("non_billable"),
))
```

### `convex/timeEntries.ts → projectOverview` — breaking field rename

Today's shape: `{ uninvoicedMinutes/Amount, invoicedBillableMinutes/Amount, nonBillableMinutes }` (`convex/timeEntries.ts:794-902`).

Under the new model, the old name `uninvoicedMinutes` becomes **semantically wrong**: today it means "billable && !invoiceId", but going forward, some of those entries are settled-no-revenue (not "uninvoiced — needs attention"). Keeping the name with shifted semantics would silently break callsites that use it for "ready to invoice" feeds — notably `lib/invoice-banner-view.ts`.

**Decision: rename now, update all 30 callsites in the same PR.**

```typescript
// NEW shape:
{
  openMinutes,        openAmount,        // was uninvoicedMinutes/Amount — billable && !invoiceId && !settledAt
  invoicedMinutes,    invoicedAmount,    // was invoicedBillableMinutes/Amount — invoiceId && settledReason === "invoiced"
  settledMinutes,     settledAmount,     // NEW — settledReason ∈ {retainer_included, fixed_included}
  nonBillableMinutes,
}
```

Touch list (7 files, 33 references; re-verified via grep — the original "5 files / 30 refs" undercounted):

- `convex/timeEntries.ts` — the projectOverview function itself
- `convex/lib/__tests__/projectOverview.test.ts` — update test expectations
- `components/projects/tm-overview.tsx` — rename `uninvoicedMinutes` → `openMinutes`; T&M label "Uninvoiced" → "Open"
- `lib/invoice-banner-view.ts` — "ready to invoice" feed logic; must use `openMinutes` now
- `lib/invoice-banner-view.test.ts` — update assertions
- `components/invoices/project-invoices.tsx` — **(was missing)** consumes the renamed fields
- `components/invoices/project-invoices-payment-cards.tsx` — **(was missing)** consumes the renamed fields

**Where the `settledMinutes/Amount` bucket is consumed — NOT the Overview card.** Per the UI decision (Project Finances card keeps the clean donut, no stacked breakdown), this new bucket feeds the **period drill-down** (the covered-vs-invoiced detail view) and **reports**, not the retainer Overview donut. The `projectOverview` data shape gains the bucket; the Overview card UI does not render a third "Settled" row.

**Rejected alternative:** keeping `uninvoicedMinutes` as an alias. Two-name aliases drift; pick one, update everything once.

---

## UI Changes

Visual reference: `docs/time-entry-settlement-prototype.html`.

### Status vocabulary — collapsed for the row, precise for reports

The row-level badge is **lifecycle only**, one word each. The financial reason (`settledReason`) is NOT a row badge — it surfaces in the Amount column, period drill-down, and reports.

| Surface | Vocabulary |
|---|---|
| **Time entry row** | `Open` / `Draft` / `Closed` (invoiced + settled collapse to `Closed`) |
| **Period (month) row** | `In progress` (current, passive) / `Open` (ended, needs action) / `Closed` |
| **Invoice document** (Invoices tab) | keeps native `Draft → Invoiced → Paid → Void` |

**Principle #2 — status reflects whether the user must act.** The current month is `In progress` (hollow/faint pill — the eye skips it). An ended-unclosed month is `Open` (blue, paired with the dark action button). This avoids the original "Uninvoiced" ambiguity where one label meant both "still running" and "needs action."

**Principle #3 — one lexicon, no collisions.** `Open`/`Closed` mean the same thing on every surface. A closed period whose overage sits on a paid invoice reads consistently: period `Closed`, invoice `Paid`, hours `Closed`. Audit the Invoices tab labels against this map before shipping.

### Project → Monthly Breakdown row

- **One primary CTA per row + a `⋯` overflow.** Every row ends with exactly one button and one overflow menu (clean vertical rhythm). The primary button is whatever matters most for that state:
  - `In progress` (current) → **Preview** (view live report) + `⋯`
  - `Open`, within budget → **Close** (primary) + `⋯`
  - `Open`, overage → **Bill overage** (primary) + `⋯`
  - `Closed`, report → **↓ Report** (direct artifact) + `⋯`
  - `Closed`, invoiced → **↗ INV-038** (direct invoice link) + `⋯`
- Everything secondary (Preview on closable rows, Reopen on closed rows, View entries) lives in `⋯`. The artifact on closed rows is **never** buried in `⋯` — Stripe invoice-list pattern: primary artifact always visible.

**Principle #1 — "Close" opens a review, then confirms (not raw one-click).** Closing locks hours after the admin reviews the live Monthly Report, so it follows the Stripe "Finalize" pattern without pretending there is a sent/tracked statement entity:

> `Close` → report preview modal → **"Review & close"** / **"Close period"** confirm

This means **Preview is the first step of Close** on closable rows, not a separate `⋯` item. Standalone Preview stays only on the current (`In progress`) month, where there's nothing to finalize yet.

**Principle #4 — reversibility reassurance in the Close confirm.** The confirm modal carries a calm line: *"↺ You can reopen this month anytime if you need to make changes."* Lowering anxiety increases willingness to act (the inverse of a scary confirm).

- **Reopen** (admin-only, on closed rows via `⋯`): confirm dialog states the consequence — *"The N closed hours become editable again. Download a fresh report if you change anything."*

**Principle #6 — the amount column is labeled `Billed here`, not `Amount`.** It shows only overage billed through this tool; the retainer monthly fee is charged separately (currently via Stripe), so the column never implies it double-counts the fee. A tooltip on the header states this.

### Period detail (drill-down) — Principle #5

The Monthly Breakdown row is clickable → opens a period detail view (also reachable from `⋯ → View entries`). **This is where the collapsed `Closed` splits back out:** the detail shows `Covered by retainer` (e.g. 20h, included in the fee) vs `Invoiced overage` (e.g. 5h, $1,000 · INV-038). Progressive disclosure — the summary stays clean, the detail is complete. This is where `settledReason` earns its keep.

### Time entry list (all surfaces)

- Each entry shows its derived status badge: `Open` / `Draft` / `Closed` — three words, no row-level invoiced/settled split.
- The **day-group header** carries the reference, not the row: a closed day shows `Closed · Mar 1–31`; an invoiced day shows `Closed · INV-038`. The row badge isn't repeated per row.
- `Closed` / `Draft` rows render at ~72% opacity with a 🔒 marker; their `⋯` offers *View invoice / report* or *Reopen*, not Edit / Delete.
- Tooltip on a closed entry: *"Closed {settledAt} · included in retainer / fixed price / invoiced · {settledPeriodStart}–{settledPeriodEnd}"*.

### Top summary (Time tab)

Keep the original `Total / Billable / Non-billable`, plus **one** extra figure — `Open` (hours still needing billing/closing). No further micro-breakdown on the tab; the open/invoiced/settled split lives in reports and the period drill-down.

### Project Finances card (Overview)

Keep the existing donut (hours used / budget) and `Billable / Non-billable hours` rows **unchanged**. Do NOT add a stacked open/settled/invoiced micro-breakdown to the overview — that detail belongs in the period drill-down and reports (progressive disclosure).

---

## Data Migration

Per [[project_mvp_dummy_data]] — dummy data, no production backfill obligation.

For consistency, run one `internalMutation` after schema deploy to backfill existing invoice-linked entries:

```typescript
export const backfillSettledFromInvoiceId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("timeEntries").collect();

    // Cache project billingType lookups (invoices have no billingType field;
    // it lives on the project — convex/schema.ts:181).
    const projectTypeCache = new Map<string, "fixed" | "retainer" | "t_and_m" | "non_billable">();

    let count = 0;
    for (const e of all) {
      if (e.invoiceId !== undefined && e.settledAt === undefined) {
        const invoice = await ctx.db.get(e.invoiceId);
        if (
          invoice &&
          (invoice.status === "invoiced" || invoice.status === "paid")
        ) {
          let billingType = projectTypeCache.get(invoice.projectId);
          if (!billingType) {
            const project = await ctx.db.get(invoice.projectId);
            if (!project) continue;
            billingType = project.billingType;
            projectTypeCache.set(invoice.projectId, billingType);
          }
          await ctx.db.patch(e._id, {
            settledAt: invoice.issueDate
              ? new Date(invoice.issueDate).getTime()
              : now,
            settledReason: billingType === "fixed" ? "fixed_included" : "invoiced",
            settledPeriodStart: invoice.periodStart,
            settledPeriodEnd: invoice.periodEnd,
            updatedAt: now,
          });
          count++;
        }
      }
    }
    console.log(`Backfilled ${count} settled entries`);
  },
});
```

Run once via `npx convex run internal:settleEntries:backfillSettledFromInvoiceId`.

**Note on retainer overage backfill.** The above backfill marks all invoice-anchored entries on a retainer overage invoice as `"invoiced"`. This is slightly imprecise — under the new model, within-budget hours that happen to be on an overage invoice should arguably be `"invoiced"` (they're invoice-anchored) but a future report might want to distinguish them from the actual overage hours. The invoice's line items already carry this distinction (`lineType: "overage"` vs `"time"`), so no additional entry-level field is needed. If a report needs it later, derive from line items.

---

## Future Migration Path (not in this phase)

### `projectId` denormalization on `timeEntries`

When the `closePeriod` task-fan-out N+1 becomes a measurable issue (target: 10K+ entries/org or visible latency in production):

1. Add `projectId: v.id("projects")` to `timeEntries` schema
2. Backfill via `internalMutation` from `task.projectId`
3. Add indexes:
   - `.index("by_projectId_date", ["projectId", "date"])` — period bulk close, project-level reports
   - `.index("by_projectId_settledAt", ["projectId", "settledAt"])` — settled entry reports
4. Refactor `closePeriod` and `reopenPeriod` from task fan-out → direct `projectId + date` query
5. Refactor the future project-completion hook similarly if/when project lifecycle ships
6. Stability invariant: `task.projectId` is already immutable, so the denormalization stays consistent

### Escalation to `billing-periods-monthly-close-prd.md`

Triggers listed at the top of this doc. Migration path from this phase to the big PRD:

1. Implement `billingPeriods` and `billingDocuments` tables
2. For each existing settled entry, create a backfill `billingPeriods` row from `(settledReason, settledPeriodStart, settledPeriodEnd)` — derive `closedBy` from the linked invoice or retainer period
3. Add `billingPeriodId` to `timeEntries`, link backfilled entries
4. Settlement guard becomes `invoiceId || billingPeriodId || settledAt` (additive, no break)
5. Optionally drop the `settledAt`/`settledReason`/`settledPeriodStart/End` fields once `billingPeriodId` covers all cases — but they can stay as redundant safety with no harm

---

## Acceptance Criteria

- [ ] `timeEntries` schema includes the **4** new optional fields (`settledAt`, `settledReason` 3-value enum, `settledPeriodStart`, `settledPeriodEnd` — no `settledByUserId`), `retainerPeriods` includes the 2 new optional fields (`closedAt`, `closedBy` — matching `createdBy` naming convention). `npx tsc --noEmit` clean.
- [ ] `convex/lib/settleEntries.ts` exists with `settleInvoiceEntries` and `unsettleInvoiceEntries` helpers.
- [ ] `applyStatusTransition` in `invoices.ts` correctly settles/unsettles entries per the transition table above. `paid → void` remains disallowed.
- [ ] `deleteInvoice` uses `unsettleInvoiceEntries({ clearInvoiceId: true })` instead of inline unlink.
- [ ] `retainerPeriods.closePeriod` and `reopenPeriod` mutations work end-to-end via `requireAdmin(ctx)`.
- [ ] `closePeriod` rejects with a clear error when the period has overage that must be invoiced — verified by a Convex test that creates an over-budget period and attempts close.
- [ ] `retainerPeriods.closeRetainerCycle` works end-to-end for rollover projects, closes N monthly periods with identical `closedAt`, and writes monthly boundaries on entries.
- [ ] Fixed invoice finalization settles entries with `settledReason: "fixed_included"`, `settledPeriodEnd = invoice.periodEnd`. Caller resolves `billingType` from `invoice.projectId → project.billingType`.
- [ ] Derived `entryStatus` returns `"closed"` for billable entries with `settledReason: "fixed_included"`, `"retainer_included"`, AND `"invoiced"`; settled non-billable entries still display `"non_billable"` while remaining locked by `settledAt`. Verified by a unit test over the three reasons plus a settled non-billable case.
- [ ] `timeEntries.update` and `timeEntries.remove` reject when `invoiceId || settledAt` is set, with specific error messages for each case.
- [ ] `listProjectEntries` accepts the extended `billingStatus` enum (`closed`, `draft` added — collapsed UI vocabulary, not `settled`).
- [ ] `projectOverview` renames `uninvoicedMinutes/Amount` → `openMinutes/Amount` and `invoicedBillableMinutes/Amount` → `invoicedMinutes/Amount`, plus adds `settledMinutes/Amount`. All 7 consumer files in the touch list above are updated.
- [ ] Backdated-entry guard (shared `assertEntryDateOpen` helper, per Revision Pass #3) rejects logging into a **closed retainer period** from **all three write paths** (`timeEntries.create`, `timer.commitEntry`, `timeEntries.update` on date/task change). The T&M/Fixed "covered by finalized invoice" arm is intentionally NOT built (false premise — invoice totals are frozen snapshots).
- [ ] **(Revision Pass #1)** Existing `isMonthClosed` is split into `periodEnded` (calendar) and `closedAt`/`isClosed` (admin settlement); `balanceStatus` and the overage-bill gate (`lib/retainer-row-action.ts`) key on `periodEnded`, the 3-state pill keys on the new pair. No callsite silently overloads one name for both meanings.
- [ ] **(Revision Pass #4)** Every `invoiceId` billing predicate audited and reclassified; `readyToInvoice.ts` and `projectSummary.ts` exclude `settledAt` entries from "ready/open".
- [ ] **(Revision Pass #7)** `getRetainerData` cycle math extracted to `convex/lib/retainerCycle.ts`; `getCyclePeriods` / `computePeriodOverageContext` / `computeCycleOverageContext` exist and are reused by both `getRetainerData` and the close mutations. Existing retainer tests still green.
- [ ] **(Revision Pass #8)** `closePeriod` / `reopenPeriod` ensure-then-close (no assumption that a `retainerPeriods` row already exists for the displayed month).
- [ ] Monthly Breakdown row has `Close period` / `Reopen period` admin buttons.
- [ ] Time entry list shows the derived status badge (Open / Draft / Closed) with tooltips; day-group header carries the period/invoice reference.
- [ ] Monthly Breakdown rows use one primary CTA + `⋯` overflow; current month = `In progress`, ended-unclosed = `Open`, done = `Closed`.
- [ ] `Close` opens a live report preview → confirm modal (with reversibility line), not a one-click close; no send/download history is implied.
- [ ] Period drill-down reveals the covered-vs-invoiced split; the row badge stays collapsed to `Closed`.
- [ ] Amount column is labeled `Billed here` with a tooltip clarifying the retainer fee is charged separately.
- [ ] Backfill mutation has been run once on the dummy dataset.
- [ ] `docs/backlog.md` updated with this phase + TODOs deferred (the future migration path items).

---

## TODOs Deferred to Later Phases

| Item | Deferred to |
|---|---|
| `projectId` denormalization on `timeEntries` + new indexes | A perf-driven follow-up phase, no PRD yet |
| Auto-close on project completion (`settledReason: "manual_close"`) | Requires a project status / completion field that does not exist yet — a separate project lifecycle phase |
| Period-scoped audit event log | `billing-periods-monthly-close-prd.md` |
| Unified statement + invoice document editor | `billing-periods-monthly-close-prd.md` |
| Document line item edits decoupled from time entries | `billing-periods-monthly-close-prd.md` |
| `billingPeriods` ledger table replacing `invoiceId` as the canonical lock | `billing-periods-monthly-close-prd.md` |
| `reopenPeriod` requiring a written reason for audit trail | `billing-periods-monthly-close-prd.md` |
| Convex cron auto-suggesting periods ready to close | Out of scope — Monthly Close queue lives in the big PRD |
