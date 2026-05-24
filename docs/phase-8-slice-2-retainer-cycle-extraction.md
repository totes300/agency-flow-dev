# Phase 8 — Slice 2: Retainer cycle extraction + `isMonthClosed` rename

> **Type:** AFK
> **Blocked by:** None — can start immediately (parallelizable with Slice 1)
> **Blocks:** Slice 3, Slice 4

## Parent PRD

[`docs/phase-8-time-entry-settlement.md`](./phase-8-time-entry-settlement.md)

## What to build

A **behavior-preserving refactor** that does two things:

1. Extracts the rollover-aware cycle math currently inlined inside `getRetainerData` (`convex/projects.ts:485+`) into a new pure-ish module `convex/lib/retainerCycle.ts`, so the period-close mutations in Slice 3 and the cycle-close mutation in Slice 4 can reuse the same helpers as the read path.
2. Splits the overloaded `isMonthClosed` flag into two clearly-named fields — `periodEnded` (calendar) and `isClosed` (admin settlement) — across all 5 callsites in the codebase, and reflects the split in the Monthly Breakdown row's 3-state pill (`In progress` / `Open` / `Closed`).

No entries are settled by this slice; no new client-facing behavior. The retainer UI looks slightly different (3-state pill) and reads from the same data, by design. After this lands, Slice 3 can drop in `closePeriod`/`reopenPeriod` without re-deriving cycle math or fighting the name collision.

Reference: parent PRD § Revision Pass items 1 and 7; the table in Revision Pass #1 lists the exact 5 callsites with their before/after gating field.

## Acceptance criteria

### Schema
- [ ] `retainerPeriods` adds 2 new optional fields: `closedAt: v.optional(v.number())` (event timestamp, ms) and `closedBy: v.optional(v.id("users"))` (matches the existing `createdBy` naming convention — no `UserId` suffix). No new indexes; existing `by_projectId_periodStart` is sufficient.
- [ ] `npx tsc --noEmit` clean.

### Helper extraction (`convex/lib/retainerCycle.ts`)
- [ ] New module exports `getCyclePeriods(ctx, project, cycleStart)`, `computePeriodOverageContext(ctx, project, period) → { isOverageDue, overageMinutes }`, and `computeCycleOverageContext(ctx, project, periods) → { isOverageDue, overageMinutes }`.
- [ ] Helpers reuse `assertRetainerInvoiceable`'s rollover-vs-non-rollover predicate as the single source of truth — they do not re-derive it. (Non-rollover: monthly overage IS invoiceable. Rollover: monthly is NEVER directly invoiceable; overage settles at cycle end.)
- [ ] Helpers are pure-ish — they take the project doc and read entries via the existing `by_taskId` index; no global state, no side effects.

### `getRetainerData` refactor
- [ ] `getRetainerData` in `convex/projects.ts` consumes the new helpers in place of the inlined math. The returned shape changes per the rename below; aside from those two field names, output is byte-identical for the same inputs.
- [ ] Existing retainer tests (whatever they cover today — `convex/lib/__tests__/projectOverview.test.ts`, any retainer-balance tests, the e2e retainer flow if one exists) stay green with at most a mechanical field-name swap.

### `isMonthClosed` rename — all 5 callsites
Per Revision Pass #1 of the parent PRD. The rule: `periodEnded` is calendar-derived (`m.endDate < todayStr`); `isClosed` / `closedAt` is admin-derived (from the `retainerPeriods` row). Never reuse one name for both.

- [ ] `convex/projects.ts:695,744` — each month emits `periodEnded` (calendar) AND `isClosed`/`closedAt` (resolved from the `retainerPeriods` row if one exists; both `undefined`/`false` otherwise).
- [ ] `convex/projects.ts:713,719,782` — `balanceStatus` due/unused gating continues to key on **`periodEnded`** (financial due-ness is calendar-driven; this is unchanged behavior, just renamed).
- [ ] `lib/retainer-row-action.ts:17,42` — the overage-bill gate (`if (!isMonthClosed) return "report"`) is rewritten to gate on **`periodEnded`**. Critical: billing overage must NOT require an admin close first.
- [ ] `components/projects/monthly-breakdown-card.tsx:44` — `billingStateOf` becomes a 3-state pill: `!periodEnded → in_progress` (hollow/faint), `periodEnded && !isClosed → open` (blue, action-pairing), `isClosed → closed`.
- [ ] `components/projects/monthly-breakdown-card.tsx:144` — `closedCount` "N/N months closed" is rewritten to one explicit meaning. Pick "N **ended**" (calendar) so the number doesn't change just because no admin has clicked Close yet; the closed/open distinction is visible per-row via the pill.

### 3-state pill UI
- [ ] Current month renders `In progress` (hollow / muted — the eye skips it).
- [ ] Ended-but-not-closed month renders `Open` (blue, paired with whatever primary action the row carries; Slice 3 wires the action button, Slice 2 just makes the pill render correctly).
- [ ] Admin-closed month renders `Closed`.
- [ ] Existing per-row CTAs (Preview, Bill overage, View report) stay in place — Slice 2 does not touch row actions, only the pill and underlying flags.

### Tests / verification
- [ ] If retainer-cycle unit tests don't exist yet, add at least one for each helper: a non-rollover monthly with overage (`isOverageDue: true`), a rollover monthly mid-cycle (`isOverageDue: false`), a rollover cycle end with cycle-level overage (cycle helper returns `true`).
- [ ] Visual smoke: pull up an existing retainer project in dev, confirm the Monthly Breakdown pills render correctly across in-progress / ended / closed rows. (No admin has clicked Close yet on dummy data, so the "closed" state is exercised by manually patching a `retainerPeriods` row's `closedAt` in `npx convex dashboard` or via a one-off internal mutation.)

### Hygiene
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `docs/backlog.md` updated with the Slice 2 entry; note that `closedAt`/`closedBy` are populated by Slice 3, not this slice.

## Blocked by

None — can start immediately. Runs in parallel with Slice 1.

## User stories addressed

From [parent PRD](./phase-8-time-entry-settlement.md):

- Revision Pass #1 (load-bearing): rename `isMonthClosed`, eliminate the silent-collision class of bug.
- Revision Pass #7 (load-bearing): extract `getRetainerData` cycle math; this is "the real engineering work of this phase."
- UI Principle #2 from § UI Changes: status reflects whether the user must act. The 3-state pill replaces the "Uninvoiced means both 'still running' and 'needs action'" ambiguity.
- UI Principle #3 from § UI Changes: one lexicon — `Open`/`Closed` mean the same thing everywhere; this slice establishes the lexicon on the Monthly Breakdown card before Slice 3 starts using it on action buttons.

This slice exists primarily so Slices 3 and 4 can be written cleanly. Without it, both later slices would re-derive cycle math and re-overload `isMonthClosed`, exactly the failure mode Revision Pass #1 flagged.
