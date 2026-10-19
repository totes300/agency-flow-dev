/** Human labels for billing periods and invoice numbers (en-US, timezone-free). */

/** "March 2026" for a YYYY-MM(-DD) string. */
export function monthLabel(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthShortLabel(dateStr: string): string {
  const [, month] = dateStr.split("-");
  const date = new Date(2000, Number(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short" });
}

/** "March 2026", "Jan-Mar 2026" or "Nov 2025-Jan 2026". */
export function periodSubjectLabel(periodStart: string, periodEnd: string): string {
  if (periodStart.slice(0, 7) === periodEnd.slice(0, 7)) {
    return monthLabel(periodStart);
  }
  const startYear = periodStart.slice(0, 4);
  const endYear = periodEnd.slice(0, 4);
  const startMonth = monthShortLabel(periodStart);
  const endMonth = monthShortLabel(periodEnd);
  if (startYear === endYear) return `${startMonth}-${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}-${endMonth} ${endYear}`;
}

/** "INV-007" — matches lib/format.ts:formatInvoiceNumber on the client. */
export function formatInvoiceNumber(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(3, "0")}`;
}
