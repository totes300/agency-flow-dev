/**
 * Retainer usage rows for documents — the monthly report
 * (`billingReports.getMonthlyReport`) and the invoice document
 * (`lib/billing/closeData.closeRetainerUsage`) render the same block.
 *
 * Owns: month list construction, per-month row building, month label
 * formatting, and minutes formatting. Does NOT own: copy strings (subtitle,
 * total label, balance label) — those live on the frontend per the
 * 2026-05-03 decision (`lib/retainerLabels.ts`).
 */

export type RetainerUsageRow = {
  /** Display label e.g. "March". */
  label: string;
  year: number;
  month: number;
  availableMinutes: number;
  usedMinutes: number;
  /** Running balance after this month (rollover-aware via the input map). */
  balanceMinutes: number;
};

export type YearMonth = { year: number; month: number };

/** Long month name for a (year, month=1-12) — used as the row label. */
export function monthName(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
  });
}

/** N consecutive months starting at `start` (inclusive). */
export function monthRangeFrom(start: YearMonth, count: number): YearMonth[] {
  const months: YearMonth[] = [];
  const startIndex = start.year * 12 + (start.month - 1);
  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    months.push({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }
  return months;
}

/** "Mar-May 2026" / "Dec 2025-Feb 2026" cycle range label. */
export function buildCycleRangeLabel(months: YearMonth[]): string {
  if (months.length === 0) return "";
  const first = months[0];
  const last = months[months.length - 1];
  const shortMonth = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
  if (first.year === last.year) {
    return `${shortMonth(first.month)}-${shortMonth(last.month)} ${first.year}`;
  }
  return `${shortMonth(first.month)} ${first.year}-${shortMonth(last.month)} ${last.year}`;
}

/** "YYYY-MM" key matching `entry.date.slice(0, 7)`. */
export function monthKey({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Build per-month rows with running cycle balance.
 *
 * Each row: `availableMinutes = monthlyIncluded + carryover from previous`,
 * `usedMinutes` from the input map, `balanceMinutes = available - used`
 * (which becomes the next month's carryover).
 *
 * Same algorithm for rollover (multi-month cycle) and no-rollover
 * (single-month list); the difference is just the `months` array length.
 *
 * Assumes integer `monthlyIncludedMinutes`. Project form enforces this in
 * practice — every supported retainer size (5h/8h/10h/15h/20h/30h/40h/50h)
 * resolves to a whole minute count; the code does not guard against
 * fractional input.
 */
export function buildRetainerUsageRows(input: {
  months: YearMonth[];
  monthlyIncludedMinutes: number;
  usedMinutesByMonth: Map<string, number>;
}): RetainerUsageRow[] {
  let runningBalance = 0;
  return input.months.map(({ year, month }) => {
    const key = monthKey({ year, month });
    const availableMinutes = input.monthlyIncludedMinutes + runningBalance;
    const usedMinutes = input.usedMinutesByMonth.get(key) ?? 0;
    runningBalance = availableMinutes - usedMinutes;
    return {
      label: monthName(year, month),
      year,
      month,
      availableMinutes,
      usedMinutes,
      balanceMinutes: runningBalance,
    };
  });
}
