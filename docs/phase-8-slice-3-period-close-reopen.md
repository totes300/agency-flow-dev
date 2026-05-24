# Phase 8 — Slice 3: Period close/reopen + backdated-entry guard

> **Type:** AFK
> **Blocked by:** Slice 1 (settled fields + `entryStatus`) AND Slice 2 (extracted cycle helpers + `isClosed` rename)
> **Blocks:** Slice 4

## Parent PRD

[`docs/phase-8-time-entry-settlement.md`](./phase-8-time-entry-settlement.md)

## What to build

The end-to-end **retainer within-budget** settlement path — the row of the Problem Statement table marked ❌ (the main reported bug). After this slice, an admin can review an ended within-budget month's report, confirm "Close period", and the month's entries become `Closed` with `settledReason: "retainer_included"`. They can also reopen the period, and any backdated write into a closed period is rejected from all three write paths.

Cycle-level close for rollover projects is **deferred to Slice 4** — this slice only handles single monthly periods (non-rollover and rollover-monthly alike, with the rollover-monthly close being unblocked because rollover overage is cycle-level, not monthly).

Reference: parent PRD § Mutations (`closePeriod`, `reopenPeriod`, `assertEntryDateOpen`), § UI Changes (Monthly Breakdown row, Close confirm modal, Principles #1, #4, #6), Revision Pass items 2, 3, 8.

## Acceptance criteria

### Mutations (`convex/retainerPeriods.ts`)
- [ ] `closePeriod({ projectId, periodStart })` mutation exists. Uses `requireAdmin(ctx)`. Verifies project exists, is org-scoped, and `billingType === "retainer"`. Throws `ConvexError` with clear messages for each failure.
- [ ] **Ensure-then-close (Revision Pass #8):** the mutation upserts the `retainerPeriods` row inside its handler (reusing `ensure`'s logic via an extracted `ensureRetainerPeriodInternal`), so the UI can call it for any month displayed in the Monthly Breakdown without pre-creating a row.
- [ ] **Backend overage guard:** calls `computePeriodOverageContext` (from Slice 2) and rejects with `"This period has overage that must be invoiced before it can be closed. Create the overage invoice first."` if `isOverageDue` is true. This is non-negotiable — a stale browser tab must not be able to silently zero out overage revenue.
- [ ] **Rollover-monthly behavior:** for a rollover project's monthly period, `isOverageDue` from `computePeriodOverageContext` returns `false` (overage is cycle-level), so monthly close succeeds. Cycle-level guard is Slice 4's job.
- [ ] **Belt-and-suspenders draft-invoice check:** rejects close if any non-void invoice on this project covers the period's date range. (Implementation: query `invoices` by `projectId` + `periodStart/periodEnd`; reject if any non-void exists.)
- [ ] **Settles entries** by walking tasks on the project (acknowledged N+1, documented in `docs/backlog.md` as a perf-driven follow-up). For each entry in the period date range with `settledAt === undefined && invoiceId === undefined`, patches `settledAt`, `settledReason: "retainer_included"`, `settledPeriodStart`, `settledPeriodEnd`, `updatedAt`.
- [ ] Patches the `retainerPeriods` row with `closedAt: now, closedBy: authCtx.userId, updatedAt: now`.
- [ ] Returns `{ settledCount }`.
- [ ] `reopenPeriod({ projectId, periodStart })` mutation exists. Same ensure-then-load. Rejects if `closedAt === undefined`. Reverses ONLY entries where `settledReason === "retainer_included" && settledPeriodStart === period.periodStart && settledPeriodEnd === period.periodEnd` (the per-month-boundary criterion that makes per-month reopen unambiguous even after cycle close in Slice 4). Clears `closedAt`/`closedBy` on the period row. Returns `{ reopenedCount }`.
- [ ] `closePeriodInternal(ctx, period, authCtx)` extracted as a private helper for Slice 4 to reuse.

### Backdated-entry write guard (`convex/lib/settleGuards.ts`)
- [ ] New module exports `assertEntryDateOpen(ctx, project, date)`. Implementation matches the PRD code sample exactly: returns immediately if `project.billingType !== "retainer"`; otherwise queries `retainerPeriods` for any row covering `date` with `closedAt !== undefined`; throws `ConvexError("Cannot log time in a closed retainer period. Reopen the period first.")` if found.
- [ ] **(Revision Pass #3a)** The guard is wired into all three write paths:
  - `convex/timeEntries.ts → create`
  - `convex/timer.ts → commitEntry` (the path the original PRD missed)
  - `convex/timeEntries.ts → update` when `date` or `task` changes (resolve target project from the post-change task, evaluate guard against target project + target date)
- [ ] **(Revision Pass #3b)** The T&M / Fixed "covered by finalized invoice" arm is intentionally NOT built. The only forbidden write is into a closed retainer period; T&M/Fixed backdated entries remain open and roll onto the next invoice.

### UI: Monthly Breakdown row
- [ ] `Open` (ended, within-budget) row shows **`Close`** as the single primary CTA + `⋯` overflow. Per Principle #1, `Close` does NOT one-click close — it opens the report preview modal.
- [ ] `Closed` row shows the direct artifact (**`↓ Report`**) as primary + `⋯` overflow containing `Reopen period` (admin-only) and `View entries`.
- [ ] `In progress` (current month) row keeps a standalone `Preview` + `⋯`. Preview is the first step of Close on closable rows, but stays standalone on the current month where there's nothing to finalize.

### UI: Close confirm modal (Principles #1, #2 of Revision Pass)
- [ ] Modal renders the **live Monthly Report preview** at the top (read-through from `getRetainerStatement` — no persisted statement entity, no statement number).
- [ ] Confirm button label: **"Close period"** (or "Review & close" — pick one and use it consistently).
- [ ] Modal body carries a calm reversibility line (Principle #4): *"↺ You can reopen this month anytime if you need to make changes."*
- [ ] Modal copy does **NOT** mention "send", "delivery", "downloaded by", or any persisted statement artifact (Revision Pass #2).
- [ ] On confirm, calls `closePeriod` mutation; on success, the row updates to `Closed` and shows the `↓ Report` primary + `⋯` overflow.

### UI: Reopen action
- [ ] `Reopen` lives in the `⋯` overflow on `Closed` rows (admin-only).
- [ ] Opens a confirm dialog stating the consequence: *"The N closed hours become editable again. Download a fresh report if you change anything."*
- [ ] On confirm, calls `reopenPeriod`; row reverts to `Open` (or `In progress` if somehow that period is the current month again).

### Amount column label (Principle #6)
- [ ] Monthly Breakdown's Amount column header reads **`Billed here`** with a header tooltip: *"Only overage billed through this tool. The retainer monthly fee is charged separately (currently via Stripe)."*

### Tests
- [ ] Convex test: `closePeriod` on a non-rollover period with overage rejects with the right message; no entries are settled.
- [ ] Convex test: `closePeriod` on a within-budget non-rollover period succeeds; all entries in range get `retainer_included` with the right monthly boundary; period row gets `closedAt` + `closedBy`.
- [ ] Convex test: `closePeriod` on a rollover-monthly mid-cycle succeeds even though the cycle has overage (cycle-level guard is Slice 4).
- [ ] Convex test: `closePeriod` on a month where no `retainerPeriods` row exists yet succeeds via ensure-then-close.
- [ ] Convex test: `reopenPeriod` reverses exactly the entries `closePeriod` settled, leaves unrelated entries untouched, clears period row's `closedAt`.
- [ ] Convex test: backdated write to a closed period is rejected from `create`, `timer.commitEntry`, AND `update` (date change). Non-retainer projects are unaffected.
- [ ] Convex test: belt-and-suspenders draft-invoice gate rejects close when a draft invoice covers the date range.

### Hygiene
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] Every mutation call from new UI code has `.catch(toastError(...))` per the repo convention.
- [ ] `docs/backlog.md` updated with Slice 3 entry; deferred items: `projectId` denormalization, cycle close (Slice 4).

## Blocked by

- Blocked by [Slice 1](./phase-8-slice-1-settlement-foundation.md) — needs `settledAt`/`settledReason`/`settledPeriodStart`/`settledPeriodEnd` fields, `entryStatus()` helper, and the `update`/`remove` guards (so `reopenPeriod` users can edit reopened entries cleanly).
- Blocked by [Slice 2](./phase-8-slice-2-retainer-cycle-extraction.md) — needs `computePeriodOverageContext` from `convex/lib/retainerCycle.ts` (the load-bearing extraction from Revision Pass #7), needs `retainerPeriods.closedAt`/`closedBy` schema fields, needs `isClosed`/`periodEnded` rename so the Monthly Breakdown row knows when to show `Close` vs `↓ Report`.

## User stories addressed

From [parent PRD](./phase-8-time-entry-settlement.md):

- **Retainer within-budget ❌** row of § Problem Statement — the headline bug ("entries appear open forever in stats and filters") is fixed by the close mutation.
- Decision: "Retainer within-budget close trigger? — Manual admin button on Monthly Breakdown row" — wired here.
- Decision: "Re-open settled entries directly? — guard blocks edit; user must reopen the period" — `reopenPeriod` is the unblock path.
- Decision: "Backdated entry into a closed period? — Reject on create" — extended to all three write paths per Revision Pass #3.
- Decision: "Non-billable entries on period close? — Also locked" — covered by the unconditional patch loop in `closePeriod`.
- Revision Pass #2 — drop statement send/download history language.
- Revision Pass #3 — guard covers all write paths, scoped to retainer-closed only.
- Revision Pass #8 — `closePeriod` ensure-then-close.
- UI Principles #1, #4, #6.
