/**
 * Billing period grid — calendar months and rollover cycles.
 *
 * docs/prd-billing-refactor.md §4 (Period) and §8.3 (month bucket). Pure,
 * timezone-free calendar math on YYYY-MM-DD strings: callers resolve "today"
 * in the org timezone before asking anything here.
 *
 * Grid rule: a rollover retainer with `cycleLength > 1` closes per N-month
 * cycle anchored at `startDate`; every other billable project closes per
 * calendar month.
 */

export type Period = { start: string; end: string };

/** The project fields the grid depends on. */
export type PeriodGridProject = {
  billingType: "fixed" | "retainer" | "t_and_m" | "non_billable";
  /** YYYY-MM-DD — anchors the cycle grid. */
  startDate?: string;
  rolloverEnabled?: boolean;
  cycleLength?: number;
};

// ─── Month arithmetic ────────────────────────────────────────────────────────

/** Absolute month index (year × 12 + month0) of a YYYY-MM(-DD) string. */
export function absMonthOf(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)); // 1-12
  return y * 12 + (m - 1);
}

/** YYYY-MM key of an absolute month index. */
export function monthKeyFromAbs(abs: number): string {
  const year = Math.floor(abs / 12);
  const month = (abs % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** YYYY-MM key of a date string. */
export function monthKeyOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** First day (YYYY-MM-01) of an absolute month. */
export function monthStartOfAbs(abs: number): string {
  return `${monthKeyFromAbs(abs)}-01`;
}

/** Last day (YYYY-MM-DD) of an absolute month. */
export function monthEndOfAbs(abs: number): string {
  const year = Math.floor(abs / 12);
  const month = (abs % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKeyFromAbs(abs)}-${String(lastDay).padStart(2, "0")}`;
}

/** The calendar month containing a date. */
export function monthPeriodOf(ymd: string): Period {
  const abs = absMonthOf(ymd);
  return { start: monthStartOfAbs(abs), end: monthEndOfAbs(abs) };
}

// ─── Project grid ────────────────────────────────────────────────────────────

/** Rollover retainer with a multi-month cycle → closes per cycle. */
export function isCycleGrid(project: PeriodGridProject): boolean {
  return (
    project.billingType === "retainer" &&
    project.rolloverEnabled === true &&
    (project.cycleLength ?? 1) > 1
  );
}

/** Months per period on this project's grid (1 = monthly, N = cycle length). */
export function periodMonths(project: PeriodGridProject): number {
  return isCycleGrid(project) ? Math.max(1, project.cycleLength ?? 1) : 1;
}

/**
 * The period an absolute month falls into on this project's grid. A month
 * before the project start clamps to the first cycle (defensive — entries
 * should not predate the project).
 */
export function periodOfAbs(project: PeriodGridProject, abs: number): Period {
  const step = periodMonths(project);
  if (step === 1) {
    return { start: monthStartOfAbs(abs), end: monthEndOfAbs(abs) };
  }
  const startAbs = absMonthOf(project.startDate ?? monthStartOfAbs(abs));
  const cycleIndex = Math.max(0, Math.floor((abs - startAbs) / step));
  const firstAbs = startAbs + cycleIndex * step;
  return { start: monthStartOfAbs(firstAbs), end: monthEndOfAbs(firstAbs + step - 1) };
}

/** The period containing a date on this project's grid. */
export function periodOfDate(project: PeriodGridProject, ymd: string): Period {
  return periodOfAbs(project, absMonthOf(ymd));
}

/** The period immediately after `period` on this project's grid. */
export function nextPeriod(project: PeriodGridProject, period: Period): Period {
  return periodOfAbs(project, absMonthOf(period.start) + periodMonths(project));
}

/** Chronologically later of two periods (by start). */
export function laterPeriod(a: Period, b: Period): Period {
  return a.start >= b.start ? a : b;
}

/**
 * The month (YYYY-MM) an entry is reported under when it settles into
 * `period`: its own month, clamped into the period. A carried-in entry (dated
 * before the period) lands in the period's first month; a date after the
 * period (defensive) lands in its last month.
 */
export function monthBucket(entryDate: string, period: Period): string {
  const clamped =
    entryDate < period.start ? period.start : entryDate > period.end ? period.end : entryDate;
  return monthKeyOf(clamped);
}
