/**
 * Shared retainer cycle math — single source of truth for "what months are
 * in this cycle?" and "is this period/cycle in overage?" across the read
 * path (`getRetainerData`) and the write path (Phase 8 `closePeriod` /
 * `closeRetainerCycle`).
 *
 * Why this exists: prior to Phase 8 the cycle boundary math was inlined in
 * two places (`getRetainerData` and `resolveRetainerCycleContext`) and the
 * overage rule lived inside `computeRetainerBalance` (invoice side) with a
 * duplicated read-side aggregator. Three implementations meant three places
 * for the rollover-vs-non-rollover predicate to drift. The PRD revision pass
 * (#7) called this out as load-bearing — the period-close mutations cannot
 * land safely until both sides agree on a single definition.
 *
 * Boundary contract:
 *   - `getCyclePeriods` is PURE. It takes calendar config and returns the N
 *     monthly periods that make up the requested cycle. No DB access, no
 *     entries, no project doc beyond the fields it needs.
 *   - `computePeriodOverageContext` / `computeCycleOverageContext` are async
 *     wrappers that fetch billable entries and apply the SAME isOverageDue
 *     rule encoded in `computeRetainerBalance`. They do NOT gate on
 *     `periodEnded` — that's the caller's job (the read path aggregates
 *     calendar-driven overage for display; the write path uses these
 *     helpers verbatim because rollover monthly close is intentionally
 *     allowed mid-cycle).
 */

import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import { isOverageDueForScope } from "./retainerBalance";

// ─── Cycle boundary (pure) ──────────────────────────────────────────────────

/**
 * One monthly period inside a cycle. Calendar shape only — no entries, no
 * balance. Strings are ISO date format (`YYYY-MM-DD`); `month` is 1-indexed
 * (1=Jan…12=Dec), matching the rest of the codebase.
 */
export type MonthPeriod = {
  year: number;
  month: number;
  label: string;       // e.g. "March 2026"
  periodStart: string; // "YYYY-MM-01"
  periodEnd: string;   // "YYYY-MM-DD" — last day of month
};

export type GetCyclePeriodsInput = {
  /** Project start date (`YYYY-MM-DD`). Cycle 0 begins here. */
  startDate: string;
  /** Months per cycle (1 = monthly, 3 = quarterly, …). */
  cycleLength: number;
  /** Today in the org timezone, as `YYYY-MM-DD`. Caller resolves timezone. */
  todayStr: string;
  /** 0 = current cycle, -1 = previous, +1 = next. Defaults to 0. */
  cycleOffset?: number;
};

export type GetCyclePeriodsResult = {
  periods: MonthPeriod[];
  /** Index of the cycle returned (0 = first cycle since project start). */
  cycleIndex: number;
  /** Index of the cycle that contains `todayStr`. */
  currentCycleIndex: number;
  /** True when the target cycle's last day has already passed. */
  isCycleClosed: boolean;
  /** True iff `cycleIndex === currentCycleIndex`. */
  isCurrentCycle: boolean;
  /** Convenience: `periods[0].periodStart`. */
  cycleStart: string;
  /** Convenience: `periods[periods.length - 1].periodEnd`. */
  cycleEnd: string;
};

/**
 * Build the N monthly periods that make up the requested cycle.
 *
 * Returns `null` when the requested cycle is before the project's first
 * cycle (negative `targetCycleIndex` — caller treats this as "no data").
 */
export function getCyclePeriods(
  input: GetCyclePeriodsInput,
): GetCyclePeriodsResult | null {
  const [startYear, startMonth] = input.startDate.split("-").map(Number);
  const [todayYear, todayMonth] = input.todayStr.split("-").map(Number);

  const monthsDiff =
    (todayYear - startYear) * 12 + (todayMonth - startMonth);
  const currentCycleIndex = Math.max(
    0,
    Math.floor(monthsDiff / input.cycleLength),
  );

  const offset = input.cycleOffset ?? 0;
  const cycleIndex = currentCycleIndex + offset;
  if (cycleIndex < 0) return null;

  const firstMonthOffset = cycleIndex * input.cycleLength;
  const periods: MonthPeriod[] = [];

  for (let i = 0; i < input.cycleLength; i++) {
    const mOffset = firstMonthOffset + i;
    // Walk forward in absolute "months since year 0" space, then split back
    // to year + 1-indexed month. Matches the convention used everywhere else
    // in this codebase — only the `Date()` constructor uses 0-indexed
    // months, and we adjust at that boundary alone.
    const absoluteMonths = startYear * 12 + (startMonth - 1) + mOffset;
    const y = Math.floor(absoluteMonths / 12);
    const m = (absoluteMonths % 12) + 1;
    const lastDay = new Date(y, m, 0).getDate(); // (m, 0) → last day of m
    periods.push({
      year: y,
      month: m,
      label: new Date(y, m - 1, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
      periodStart: `${y}-${String(m).padStart(2, "0")}-01`,
      periodEnd: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    });
  }

  const cycleStart = periods[0].periodStart;
  const cycleEnd = periods[periods.length - 1].periodEnd;

  return {
    periods,
    cycleIndex,
    currentCycleIndex,
    isCycleClosed: cycleEnd < input.todayStr,
    isCurrentCycle: cycleIndex === currentCycleIndex,
    cycleStart,
    cycleEnd,
  };
}

// ─── Overage context (async, DB-backed) ─────────────────────────────────────

export type OverageContext = {
  /**
   * Whether this period/cycle has billable hours that the model says are
   * "due" right now. The rule mirrors `computeRetainerBalance`:
   *   - non-rollover: a single month is due when `endBalance < 0`.
   *   - rollover monthly: NEVER due (cycle handles overage at cycle end).
   *   - rollover cycle: due when `cycleBalance < 0`.
   *
   * Note: this does NOT factor in `periodEnded`. Callers that show a
   * calendar-driven "what's overdue today" view must gate on `periodEnded`
   * themselves; close mutations use this verbatim because rollover monthly
   * close is intentionally allowed mid-cycle.
   */
  isOverageDue: boolean;
  overageMinutes: number;
  overageAmount: number;
  workedMinutes: number;
  /** Included minutes the model would allocate to this period/cycle. */
  budgetMinutes: number;
  /** budgetMinutes − workedMinutes; negative ⇒ over. */
  endBalance: number;
};

type RetainerProjectFields = Pick<
  Doc<"projects">,
  | "_id"
  | "orgId"
  | "billingType"
  | "rolloverEnabled"
  | "cycleLength"
  | "includedMinutesPerMonth"
  | "overageRate"
  | "startDate"
>;

type AnyCtx =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>;

/**
 * Sum billable entry minutes for a project in `[periodStart, periodEnd]`.
 *
 * Walks tasks→entries fan-out (acknowledged N+1 — same pattern as
 * `getRetainerData`; documented for a future `projectId` denormalization in
 * the parent PRD's "Future migration path"). Filters by `orgId` defensively
 * even though `by_taskId` already narrows by task ownership.
 */
async function sumBillableMinutes(
  ctx: AnyCtx,
  project: RetainerProjectFields,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", project.orgId).eq("projectId", project._id),
    )
    .collect();

  let total = 0;
  for (const task of tasks) {
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .collect();
    for (const e of entries) {
      if (e.orgId !== project.orgId) continue;
      if (!e.isBillable) continue;
      if (e.date < periodStart || e.date > periodEnd) continue;
      total += e.durationMinutes;
    }
  }
  return total;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure overage rule. Maps the read-side `mode` enum onto the same shared
 * predicate (`isOverageDueForScope`) that the invoice-side
 * `computeRetainerBalance` consumes. Centralising the rule means the
 * read path and the write path cannot disagree about whether a given
 * scope owes overage.
 *
 * `mode` distinguishes the financial unit:
 *   - "monthly-isolated": one calendar month is its own billing unit
 *     (non-rollover). Negative balance ⇒ due.
 *   - "rollover-monthly": one month inside a rollover cycle. NEVER due at
 *     monthly level — overage settles at cycle end.
 *   - "rollover-cycle": the whole cycle as one unit. Negative balance ⇒ due.
 */
function applyOverageRule(input: {
  mode: "monthly-isolated" | "rollover-monthly" | "rollover-cycle";
  workedMinutes: number;
  budgetMinutes: number;
  overageRate: number;
}): OverageContext {
  const endBalance = input.budgetMinutes - input.workedMinutes;

  const isOverageDue = isOverageDueForScope({
    endBalance,
    rolloverEnabled: input.mode !== "monthly-isolated",
    // For rollover-monthly we're explicitly NOT the closing scope (the
    // cycle helper handles that); for rollover-cycle we ARE the closing
    // scope (we're looking at the cycle aggregate). For monthly-isolated
    // the flag is ignored by the predicate.
    isClosingScope: input.mode === "rollover-cycle",
  });

  const overageMinutes = isOverageDue ? Math.abs(endBalance) : 0;
  const overageAmount = isOverageDue
    ? round2((overageMinutes / 60) * input.overageRate)
    : 0;

  return {
    isOverageDue,
    overageMinutes,
    overageAmount,
    workedMinutes: input.workedMinutes,
    budgetMinutes: input.budgetMinutes,
    endBalance,
  };
}

/**
 * Overage context for one monthly period.
 *
 * For rollover projects this always returns `isOverageDue: false` — overage
 * settles at the cycle level via `computeCycleOverageContext`. The worked
 * minutes / endBalance fields are still populated so callers can show the
 * running balance regardless of billing status.
 *
 * The caller (write path: `closePeriod`) gets `isOverageDue` directly and
 * uses it as the no-revenue-close gate. The read path's per-month aggregate
 * (`getRetainerData`) does NOT consume this helper — its display total
 * additionally gates on `periodEnded` because "due as of today" is a
 * calendar question, not a billing-model one.
 */
export async function computePeriodOverageContext(
  ctx: AnyCtx,
  project: RetainerProjectFields,
  period: { periodStart: string; periodEnd: string },
): Promise<OverageContext> {
  const workedMinutes = await sumBillableMinutes(
    ctx,
    project,
    period.periodStart,
    period.periodEnd,
  );
  return applyOverageRule({
    mode: project.rolloverEnabled
      ? "rollover-monthly"
      : "monthly-isolated",
    workedMinutes,
    budgetMinutes: project.includedMinutesPerMonth ?? 0,
    overageRate: project.overageRate ?? 0,
  });
}

/**
 * Overage context for an entire cycle (the N monthly periods passed in).
 *
 * Intended for rollover projects (cycle close). For non-rollover projects
 * "the cycle" isn't a billing unit, but we still aggregate worked minutes
 * across the supplied periods so the helper is usable for read-side cycle
 * summaries; `isOverageDue` for non-rollover follows the same monthly-unit
 * rule (negative summed balance ⇒ due) and the caller can ignore it.
 */
export async function computeCycleOverageContext(
  ctx: AnyCtx,
  project: RetainerProjectFields,
  periods: { periodStart: string; periodEnd: string }[],
): Promise<OverageContext> {
  let workedMinutes = 0;
  for (const p of periods) {
    workedMinutes += await sumBillableMinutes(
      ctx,
      project,
      p.periodStart,
      p.periodEnd,
    );
  }
  const budgetMinutes =
    (project.includedMinutesPerMonth ?? 0) * periods.length;
  return applyOverageRule({
    mode: project.rolloverEnabled ? "rollover-cycle" : "monthly-isolated",
    workedMinutes,
    budgetMinutes,
    overageRate: project.overageRate ?? 0,
  });
}

// Exported for unit tests — keep `applyOverageRule` internal in production
// but expose under a clear name so the rollover-vs-non-rollover predicate
// can be exercised without a Convex runtime.
export const __test_applyOverageRule = applyOverageRule;
