/**
 * Shared retainer usage row builders. Used by both
 * `convex/statements.ts` (raw, ledger-truth, for Reports) and
 * `convex/invoices.ts` (snapshot-aligned, for Invoice documents).
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

/**
 * "00:00" / "-01:30" minute formatter. Display-only — stays in lib because
 * the same string ships from both queries (subtitle "300 monthly budget").
 */
export function formatMinutesLabel(minutes: number): string {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const formatted = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  return minutes < 0 ? `-${formatted}` : formatted;
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

/**
 * Distribute a target total across per-month buckets so the buckets sum to
 * exactly `totalUsedMinutes`. Used by the invoice path: the invoice's
 * snapshot total is the source of truth (it's what the client was billed),
 * and the per-month breakdown must reconcile to it (decision 2026-05-03 Q1).
 *
 * Strategy: scale each bucket proportionally and round; correct any drift
 * onto the largest bucket so no per-month value gets visibly distorted.
 * If `rawByMonth` sums to 0 (no time entries in any month), drops the full
 * total on the last month so the invariant holds.
 */
export function reconcileUsedMinutesToTotal(input: {
  months: YearMonth[];
  rawByMonth: Map<string, number>;
  totalUsedMinutes: number;
}): Map<string, number> {
  const { months, rawByMonth, totalUsedMinutes } = input;
  const out = new Map<string, number>();
  if (months.length === 0) return out;

  const rawSum = months.reduce(
    (s, m) => s + (rawByMonth.get(monthKey(m)) ?? 0),
    0,
  );

  if (rawSum === 0) {
    for (const m of months) out.set(monthKey(m), 0);
    const last = monthKey(months[months.length - 1]);
    out.set(last, totalUsedMinutes);
    return out;
  }

  // Proportional scale, then fix drift on the largest bucket so rounding
  // error never visibly distorts a small month.
  const scaled = months.map((m) => {
    const raw = rawByMonth.get(monthKey(m)) ?? 0;
    return Math.round((raw / rawSum) * totalUsedMinutes);
  });
  const drift = totalUsedMinutes - scaled.reduce((s, v) => s + v, 0);
  if (drift !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i] > scaled[largestIdx]) largestIdx = i;
    }
    scaled[largestIdx] += drift;
  }
  for (let i = 0; i < months.length; i++) {
    out.set(monthKey(months[i]), scaled[i]);
  }
  return out;
}
