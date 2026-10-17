/**
 * Pricing — the ONE function that turns a close's scope into money.
 *
 * docs/prd-billing-refactor.md §7. Pure. Every surface that shows an amount
 * for a period (queue row, workspace summary, commit, invoice lines, report)
 * calls `priceScope` on the same members, so they cannot disagree (N11).
 * Amounts are integer minor units; minutes are never rounded through hours.
 *
 *   T&M       group billable minutes by (category, task, rate);
 *             billed = ceilToIncrement(minutes, roundingMinutes);
 *             amount = priceMinutesMinor(billed, rate) per line; total = Σ lines.
 *   Retainer  raw minutes, never rounded. included = perMonth × months(period);
 *             overage = max(0, usage − included);
 *             amount = priceMinutesMinor(overage, overageRate).
 *             Time lines are the $0 work report (billable entries only).
 */

import { ceilToIncrement, priceMinutesMinor } from "./money";
import {
  absMonthOf,
  monthKeyFromAbs,
  monthKeyOf,
  periodMonths,
  type Period,
  type PeriodGridProject,
} from "./periods";
import type { CarriedReason } from "./scope";

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type PricingProject = PeriodGridProject & {
  billingType: "retainer" | "t_and_m";
  includedMinutesPerMonth?: number;
  /** Retainer overage rate, minor units per hour. */
  overageRateMinor?: number;
};

export type PricedEntry = {
  _id: string;
  date: string;
  minutes: number;
  isBillable: boolean;
  taskId: string;
  categoryId?: string | null;
  /** Snapshot billable rate, minor units per hour (0 on retainer entries). */
  billableRateMinor: number;
};

export type PricedMember = { entry: PricedEntry; carried?: CarriedReason };

// ─── Output ──────────────────────────────────────────────────────────────────

export type TimeLine = {
  /** `category::task::rate` (T&M) or `category::task` (retainer). */
  groupKey: string;
  taskId: string;
  categoryId: string | null;
  rateMinor: number;
  /** Raw summed minutes — the line's source of truth. */
  minutes: number;
  /** Minutes after line rounding (T&M); equals `minutes` for retainer. */
  billedMinutes: number;
  amountMinor: number;
  entryIds: string[];
};

export type OverageLine = { minutes: number; rateMinor: number; amountMinor: number };

export type MonthlyBalanceRow = {
  monthKey: string; // YYYY-MM
  includedMinutes: number;
  /** Billable minutes dated in this month (carried-in work seeds the ladder instead). */
  loggedMinutes: number;
  /** Running balance after this month; null while the month is pending. */
  endingBalanceMinutes: number | null;
  /** A future month with nothing logged — its allowance is not in play yet. */
  pending: boolean;
};

export type PricingIssue = "missing-overage-rate";

export type PriceResult = {
  lines: TimeLine[];
  overage: OverageLine | null;
  /** Billable minutes in scope (raw). Non-billable time never counts. */
  usageMinutes: number;
  includedMinutes: number;
  overageMinutes: number;
  /** What the close bills, minor units. 0 = nothing to invoice. */
  amountMinor: number;
  withinBudget: boolean;
  issues: PricingIssue[];
  /** Retainer only ([] for T&M): the period's month-by-month balance ladder. */
  monthlyBalances: MonthlyBalanceRow[];
  /** Billable minutes carried in from earlier periods (the ladder's opening row). */
  carriedInMinutes: number;
  /** Balance over the months that have started; equals included − usage once elapsed. */
  balanceToDateMinutes: number;
};

// ─── Pricing ─────────────────────────────────────────────────────────────────

function groupLines(
  members: PricedMember[],
  keyOf: (e: PricedEntry) => string,
  rateOf: (e: PricedEntry) => number,
  roundingMinutes: number,
): TimeLine[] {
  const groups = new Map<string, TimeLine>();
  for (const { entry } of members) {
    if (!entry.isBillable) continue;
    const key = keyOf(entry);
    const line = groups.get(key) ?? {
      groupKey: key,
      taskId: entry.taskId,
      categoryId: entry.categoryId ?? null,
      rateMinor: rateOf(entry),
      minutes: 0,
      billedMinutes: 0,
      amountMinor: 0,
      entryIds: [],
    };
    line.minutes += entry.minutes;
    line.entryIds.push(entry._id);
    groups.set(key, line);
  }
  return [...groups.values()].map((line) => {
    const billedMinutes = ceilToIncrement(line.minutes, roundingMinutes);
    return { ...line, billedMinutes, amountMinor: priceMinutesMinor(billedMinutes, line.rateMinor) };
  });
}

export function priceScope(input: {
  project: PricingProject;
  period: Period;
  members: PricedMember[];
  /** T&M line rounding increment, frozen at commit. Ignored for retainers. */
  roundingMinutes: number;
  /** Today in the org timezone — decides which ladder months are pending. */
  todayStr: string;
}): PriceResult {
  const { project, period, members } = input;
  const usageMinutes = members.reduce(
    (sum, { entry }) => sum + (entry.isBillable ? entry.minutes : 0),
    0,
  );

  if (project.billingType === "t_and_m") {
    const lines = groupLines(
      members,
      (e) => `${e.categoryId ?? "none"}::${e.taskId}::${e.billableRateMinor}`,
      (e) => e.billableRateMinor,
      input.roundingMinutes,
    );
    return {
      lines,
      overage: null,
      usageMinutes,
      includedMinutes: 0,
      overageMinutes: 0,
      amountMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0),
      withinBudget: true,
      issues: [],
      monthlyBalances: [],
      carriedInMinutes: 0,
      balanceToDateMinutes: 0,
    };
  }

  // Retainer — raw minutes; time lines are a $0 work report.
  const lines = groupLines(members, (e) => `${e.categoryId ?? "none"}::${e.taskId}`, () => 0, 1);
  const includedMinutes = (project.includedMinutesPerMonth ?? 0) * periodMonths(project);
  const overageMinutes = Math.max(0, usageMinutes - includedMinutes);
  const rateMinor = project.overageRateMinor ?? 0;
  const issues: PricingIssue[] = overageMinutes > 0 && rateMinor <= 0 ? ["missing-overage-rate"] : [];
  const amountMinor = priceMinutesMinor(overageMinutes, rateMinor);
  const ladder = monthlyBalances(project, period, members, input.todayStr);

  return {
    lines,
    overage: overageMinutes > 0 ? { minutes: overageMinutes, rateMinor, amountMinor } : null,
    usageMinutes,
    includedMinutes,
    overageMinutes,
    amountMinor,
    withinBudget: overageMinutes === 0,
    issues,
    ...ladder,
  };
}

/**
 * The retainer balance ladder, read like a bank statement: carried-in billable
 * minutes open the balance, then each month adds `included − logged`. A future
 * month with nothing logged is pending (its allowance is not in play), so the
 * last non-pending row is the honest balance to date.
 */
function monthlyBalances(
  project: PricingProject,
  period: Period,
  members: PricedMember[],
  todayStr: string,
): Pick<PriceResult, "monthlyBalances" | "carriedInMinutes" | "balanceToDateMinutes"> {
  let carriedInMinutes = 0;
  const loggedByMonth = new Map<string, number>();
  for (const { entry, carried } of members) {
    if (!entry.isBillable) continue;
    if (carried) {
      carriedInMinutes += entry.minutes;
    } else {
      const key = monthKeyOf(entry.date);
      loggedByMonth.set(key, (loggedByMonth.get(key) ?? 0) + entry.minutes);
    }
  }

  const perMonth = project.includedMinutesPerMonth ?? 0;
  const firstAbs = absMonthOf(period.start);
  const todayKey = monthKeyOf(todayStr);
  const rows: MonthlyBalanceRow[] = [];
  let running = -carriedInMinutes;
  let balanceToDateMinutes = running;
  for (let i = 0; i < periodMonths(project); i++) {
    const monthKey = monthKeyFromAbs(firstAbs + i);
    const loggedMinutes = loggedByMonth.get(monthKey) ?? 0;
    const pending = monthKey > todayKey && loggedMinutes === 0;
    if (!pending) {
      running += perMonth - loggedMinutes;
      balanceToDateMinutes = running;
    }
    rows.push({
      monthKey,
      includedMinutes: perMonth,
      loggedMinutes,
      endingBalanceMinutes: pending ? null : running,
      pending,
    });
  }
  return { monthlyBalances: rows, carriedInMinutes, balanceToDateMinutes };
}
