# Phase 8 — Slice 4: Cycle close + period drill-down + entry list polish

> **Type:** AFK
> **Blocked by:** Slice 3 (`closePeriodInternal` helper, period-row infrastructure, Monthly Breakdown row layout)
> **Blocks:** Nothing — this closes out Phase 8

## Parent PRD

[`docs/phase-8-time-entry-settlement.md`](./phase-8-time-entry-settlement.md)

## What to build

The remaining surface area: rollover cycle close (a thin wrapper over Slice 3's `closePeriodInternal`), the period drill-down view that's the only surface where the collapsed `Closed` badge splits back into "covered by retainer" vs "invoiced overage" via `settledReason`, and the time-entry list polish that makes the new settlement model visible to anyone browsing entries.

After this slice, Phase 8 is shippable end-to-end: every settlement path (T&M invoice, Fixed invoice, retainer within-budget close, rollover cycle close, void) has a working mutation, a visible UI, and a way to read it back out at any precision the user needs.

Reference: parent PRD § Mutations (`closeRetainerCycle`), § Reporting Changes, § UI Changes (Time entry list, Period drill-down — Principle #5, Top summary, Principles #2, #3).

## Acceptance criteria

### Cycle close mutation (`convex/retainerPeriods.ts`)
- [ ] `closeRetainerCycle({ projectId, cycleStart })` mutation exists. Uses `requireAdmin(ctx)`. Verifies project exists, is org-scoped, `billingType === "retainer"`, and `rolloverEnabled === true`. Throws clear `ConvexError`s.
- [ ] Resolves the N monthly periods in the cycle via `getCyclePeriods(ctx, project, cycleStart)` from Slice 2.
- [ ] **Cycle-level overage guard:** calls `computeCycleOverageContext(ctx, project, periods)` (from Slice 2) and rejects with `"This cycle has overage that must be invoiced before it can be closed."` if `isOverageDue` is true.
- [ ] **Bulk-closes the N monthly periods** by calling `closePeriodInternal(ctx, period, authCtx)` (the helper extracted in Slice 3) for each period in the cycle. All N periods receive identical `closedAt` (the cycle-close fingerprint).
- [ ] Each entry retains its **monthly** boundary on `settledPeriodStart/End` (NOT the cycle boundary), so per-month reopen via Slice 3's `reopenPeriod` stays unambiguous.
- [ ] Returns `{ closedPeriods: number, settledCount: number }`.

### Cycle close UI (rollover projects only)
- [ ] Rollover retainer projects gain a cycle-level close affordance. Concrete placement: on the cycle's last monthly row, the `Close` primary button (from Slice 3) is replaced/augmented with **`Close cycle`** when the cycle has just ended and is within budget; the confirm modal shows the cycle's aggregate report.
- [ ] Confirm modal copy mirrors Slice 3's pattern: live cycle report preview, reversibility line ("You can reopen any month in this cycle anytime"), no statement-delivery language.
- [ ] On success, all N monthly rows in the cycle re-render as `Closed` simultaneously.

### Period drill-down (Principle #5)
- [ ] Clicking a Monthly Breakdown row opens a period detail view (also reachable from `⋯ → View entries` on closed rows).
- [ ] **This is the only UI surface where the collapsed `Closed` splits back out.** The drill-down renders two distinct sections:
  - `Covered by retainer` — sums `settledMinutes` for entries with `settledReason === "retainer_included"` in the period.
  - `Invoiced overage` — sums `invoicedMinutes`/`Amount` for entries with `settledReason === "invoiced"` in the period, with the linked invoice number(s) as a click-through.
- [ ] The drill-down does NOT render a separate "Open" / "Draft" section unless those buckets are non-empty for the period (e.g. a reopened period mid-edit).
- [ ] Drill-down reads `settledReason` directly per § Reporting Changes — no new schema, no new query parameter.

### Time entry list polish (all surfaces — `/my-time`, project Time tab, task detail Time tab)
- [ ] Each entry row shows a derived badge from `entryStatus()`: `Open` / `Draft` / `Closed`. Three words, no row-level invoiced/settled split (the split lives in the drill-down).
- [ ] Settled non-billable entries continue to display `Non-billable` (per Revision Pass #5), not `Closed`.
- [ ] **Day-group header carries the reference, not the row.** A closed day shows `Closed · Mar 1–31` (period boundary). An invoiced day shows `Closed · INV-038` (invoice number). The row badge is not repeated per row in the header text — the header is the consolidated label.
- [ ] **Locked rows** (`Draft` or `Closed`) render at ~72% opacity with a 🔒 marker. Their `⋯` menu offers `View invoice` / `View report` and `Reopen` (admin-only, only on retainer `Closed`), not `Edit` / `Delete`.
- [ ] Hover tooltip on a closed entry: *"Closed {settledAt} · included in retainer / fixed price / invoiced · {settledPeriodStart}–{settledPeriodEnd}"* — the wording switches on `settledReason`.

### Top summary on Time tab
- [ ] Existing `Total / Billable / Non-billable` summary gains exactly one additional figure: **`Open`** (hours where `entryStatus() === "open"`). No further micro-breakdown — the open/invoiced/settled split lives in the drill-down and reports.

### Project Finances card (Overview) — explicit no-op
- [ ] The existing donut (hours used / budget) and `Billable / Non-billable hours` rows stay **unchanged**. Do NOT add a stacked Open/Settled/Invoiced breakdown to the Overview card — that detail belongs in the period drill-down and reports (progressive disclosure).

### Invoices tab lexicon audit (Principle #3)
- [ ] Audit the Invoices tab labels against the unified lexicon: `Open` / `Closed` on time-side surfaces; `Draft → Invoiced → Paid → Void` on invoice-side surfaces. A closed period whose overage sits on a paid invoice should read consistently: period `Closed`, invoice `Paid`, hours `Closed` — no surface uses `Open` to mean "paid invoice" or `Closed` to mean "void invoice".
- [ ] Any drift identified by the audit is fixed in the same PR (likely a handful of label string swaps).

### Tests
- [ ] Convex test: `closeRetainerCycle` on a rollover project with cycle overage rejects, no periods are closed.
- [ ] Convex test: `closeRetainerCycle` on a within-budget rollover cycle closes all N periods with identical `closedAt`, settles their entries with **monthly** boundaries.
- [ ] Convex test: after cycle close, `reopenPeriod` on a single month inside the closed cycle reverses exactly that month's entries; other months in the cycle stay closed.
- [ ] Component test (or visual smoke): a closed row's drill-down renders the covered-vs-invoiced split for a period that has both retainer-included entries and overage-invoiced entries.
- [ ] Component test: entry row at `Draft` and `Closed` states renders with `🔒` and ~72% opacity; `⋯` menu offers View / Reopen, not Edit / Delete.
- [ ] Component test: Time-tab top summary shows the `Open` figure and matches the count from `entryStatus()`.

### Hygiene
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] Every new mutation call has `.catch(toastError(...))`.
- [ ] `docs/backlog.md` updated: Phase 8 complete; the "TODOs Deferred to Later Phases" table from the parent PRD is mirrored verbatim into the backlog's deferred section.

## Blocked by

- Blocked by [Slice 3](./phase-8-slice-3-period-close-reopen.md) — needs `closePeriodInternal` to bulk-close N periods, needs the Monthly Breakdown row layout (primary CTA + `⋯`) as the foundation that cycle close augments, needs `reopenPeriod` so the per-month-inside-closed-cycle reopen test can exist.

Transitively also needs Slice 1 (drill-down reads `settledReason`, row badges call `entryStatus()`) and Slice 2 (`computeCycleOverageContext`, 3-state pill).

## User stories addressed

From [parent PRD](./phase-8-time-entry-settlement.md):

- Decision: "Cascade re-open via cycle-level entity? — No, cycle close = bulk-close N monthly `retainerPeriods` with the same `closedAt`" — the cycle-close mutation implements this exactly.
- § Reporting Changes — the drill-down is the proof-of-life that the schema preserves full fidelity behind a collapsed row badge. `settledReason` is queried for real here, not just declared queryable.
- § UI Changes → Period detail (drill-down) — Principle #5 (progressive disclosure: summary stays clean, detail is complete).
- § UI Changes → Time entry list (all surfaces) — the row badges, day-group headers, locked rows, and tooltips.
- § UI Changes → Top summary (Time tab) — the `Open` figure.
- § UI Changes → Project Finances card — the explicit "do not change" decision.
- UI Principles #2 (status reflects action), #3 (one lexicon, no collisions), #5 (progressive disclosure).
- Reporting Changes: future per-client / per-interval overage report is feasible without schema change — documented (not built) as the drill-down proves the read path works.
