/**
 * Pure helpers for resolving a retainer invoice's relationship to a calendar
 * month. Single source of truth so every consumer (project page, Monthly
 * Report, Ready feed) agrees on which row a cycle invoice attaches to and
 * which months it covers.
 *
 * Why this exists: after `docs/invoicing-refactor.md` Issue #01, a rollover
 * retainer invoice spans the entire cycle (`periodStart = cycleStart`,
 * `periodEnd = cycleEnd`) — multi-month. Pre-refactor consumers assumed
 * month-shaped invoices and broke silently in three places. Centralising the
 * relationship logic kills that bug class.
 */

type InvoiceLike = {
  periodStart?: string;
  periodEnd?: string;
};

/**
 * Anchor month for an invoice = the YYYY-MM of its `periodEnd`.
 *
 * Rollover OFF: periodStart and periodEnd are the same month → anchor =
 * that month.
 * Rollover ON: periodStart = cycleStart, periodEnd = cycleEnd → anchor =
 * the cycle-end month. The cycle invoice "lives at" the cycle-end row.
 *
 * Used by:
 *  - `getRetainerData` to attach the invoice to a single Monthly Breakdown
 *    row (the cycle-end one for rollover, the only one for monthly).
 *  - Ready-feed dedup so a billed cycle disappears from `/invoices` Ready.
 */
export function getInvoiceAnchorMonthKey(
  inv: InvoiceLike,
): string | null {
  if (!inv.periodEnd) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(inv.periodEnd);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * True if the invoice's period covers (fully or as the only invoice) the
 * given calendar month. For monthly invoices: matches the same month. For
 * cycle invoices: matches every month in the cycle range.
 *
 * Used by `getRetainerStatement` so the Monthly Report's "Billed via INV-X"
 * pointer renders on every month covered by a billed cycle, not just the
 * cycle-start month.
 */
export function invoiceCoversMonth(
  inv: InvoiceLike,
  year: number,
  month: number, // 1-12
): boolean {
  if (!inv.periodStart || !inv.periodEnd) return false;
  const mm = String(month).padStart(2, "0");
  const monthStart = `${year}-${mm}-01`;
  const monthEndDay = new Date(year, month, 0).getDate(); // (m, 0) = last day of m
  const monthEnd = `${year}-${mm}-${String(monthEndDay).padStart(2, "0")}`;
  return inv.periodStart <= monthStart && inv.periodEnd >= monthEnd;
}
