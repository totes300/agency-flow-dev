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
  monthBucket,
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

export type PricedMember = {
  entry: PricedEntry;
  carried?: CarriedReason;
  /** The stored report month of a snapshot row (§8.3); scope members derive it. */
  monthKey?: string;
};

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

/**
 * One month of a retainer period's balance ladder (§8.3). Every surface that
 * shows a per-month retainer balance — project Monthly Breakdown, summary
 * card, monthly report, invoice usage block, worksheets, agent reports, the
 * Close workspace — reads these rows instead of chaining its own.
 */
export type MonthlyBalanceRow = {
  monthKey: string; // YYYY-MM
  includedMinutes: number;
  /** Billable minutes carried in from earlier periods (bucketed on the first month). */
  carriedInMinutes: number;
  /** Billable minutes dated in this month (carried-in work excluded). */
  loggedMinutes: number;
  /** Billable minutes reported on this month: logged + carried in. */
  usedMinutes: number;
  /** Balance entering the month: the previous row's balance, 0 on the first. */
  startBalanceMinutes: number;
  /** startBalance + included. */
  availableMinutes: number;
  /** Running balance after this month (projected for pending months). */
  balanceMinutes: number;
  /** Running balance after this month; null while the month is pending. */
  endingBalanceMinutes: number | null;
  /** What a negative balance here would bill: max(0, −balance) and its price. */
  overageMinutes: number;
  overageAmountMinor: number;
  /** Σ included / Σ used over the period's months up to and including this one. */
  includedToDateMinutes: number;
  usedToDateMinutes: number;
  /** The period's whole allowance minus usage to date (cycle-to-date view). */
  remainingMinutes: number;
  /** Trailing future months with nothing logged — their allowance is not in play yet. */
  pending: boolean;
  /** Last month of the period — where the period's overage settles. */
  isLast: boolean;
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
  const ladder = monthlyBalances(project, period, members, rateMinor, input.todayStr);

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
 * The retainer balance ladder, read like a bank statement: each month adds
 * `included − used`, where carried-in billable minutes count on the first
 * month (their §8.3 bucket). Trailing future months with nothing logged are
 * pending (their allowance is not in play), so the last non-pending row is
 * the honest balance to date. The last row's balance is always
 * `included − usage`, so its overage is the period's overage.
 */
function monthlyBalances(
  project: PricingProject,
  period: Period,
  members: PricedMember[],
  rateMinor: number,
  todayStr: string,
): Pick<PriceResult, "monthlyBalances" | "carriedInMinutes" | "balanceToDateMinutes"> {
  let carriedInMinutes = 0;
  const usedByMonth = new Map<string, number>();
  const carriedByMonth = new Map<string, number>();
  for (const { entry, carried, monthKey } of members) {
    if (!entry.isBillable) continue;
    const key = monthKey ?? monthBucket(entry.date, period);
    usedByMonth.set(key, (usedByMonth.get(key) ?? 0) + entry.minutes);
    if (carried) {
      carriedInMinutes += entry.minutes;
      carriedByMonth.set(key, (carriedByMonth.get(key) ?? 0) + entry.minutes);
    }
  }

  const perMonth = project.includedMinutesPerMonth ?? 0;
  const months = periodMonths(project);
  const periodIncluded = perMonth * months;
  const firstAbs = absMonthOf(period.start);
  const todayKey = monthKeyOf(todayStr);
  const keys = Array.from({ length: months }, (_, i) => monthKeyFromAbs(firstAbs + i));

  // Pending = a trailing run of future months with nothing logged.
  const pending = keys.map(() => false);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= todayKey || (usedByMonth.get(keys[i]) ?? 0) > 0) break;
    pending[i] = true;
  }

  const rows: MonthlyBalanceRow[] = [];
  let balance = 0;
  let includedToDate = 0;
  let usedToDate = 0;
  let balanceToDateMinutes = -carriedInMinutes;
  keys.forEach((monthKey, i) => {
    const usedMinutes = usedByMonth.get(monthKey) ?? 0;
    const carriedIn = carriedByMonth.get(monthKey) ?? 0;
    const startBalanceMinutes = balance;
    const availableMinutes = startBalanceMinutes + perMonth;
    balance = availableMinutes - usedMinutes;
    includedToDate += perMonth;
    usedToDate += usedMinutes;
    if (!pending[i]) balanceToDateMinutes = balance;
    const overageMinutes = Math.max(0, -balance);
    rows.push({
      monthKey,
      includedMinutes: perMonth,
      carriedInMinutes: carriedIn,
      loggedMinutes: usedMinutes - carriedIn,
      usedMinutes,
      startBalanceMinutes,
      availableMinutes,
      balanceMinutes: balance,
      endingBalanceMinutes: pending[i] ? null : balance,
      overageMinutes,
      overageAmountMinor: priceMinutesMinor(overageMinutes, rateMinor),
      includedToDateMinutes: includedToDate,
      usedToDateMinutes: usedToDate,
      remainingMinutes: periodIncluded - usedToDate,
      pending: pending[i],
      isLast: i === keys.length - 1,
    });
  });
  return { monthlyBalances: rows, carriedInMinutes, balanceToDateMinutes };
}
