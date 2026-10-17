/**
 * The retainer usage block client documents render — the monthly report
 * (`billingReports.getMonthlyReport`) and the invoice document
 * (`invoices.getDocument` via `closeRetainerUsage`). Both are views of the
 * balance ladder (`pricing.ts` `monthlyBalances`, §8.3); nothing here chains
 * a balance of its own. Copy strings (subtitle, total label, balance label)
 * live on the frontend (`lib/retainerLabels.ts`).
 */

import type { Doc } from "../../_generated/dataModel";
import { priceClose } from "./periodView";
import type { MonthlyBalanceRow } from "./pricing";

type Reader = Parameters<typeof priceClose>[0];

export type RetainerUsageRow = {
  /** Display label e.g. "March". */
  label: string;
  year: number;
  month: number;
  /** Allowance in play this month: the balance carried in + this month's included. */
  availableMinutes: number;
  usedMinutes: number;
  /** Running balance after this month. */
  balanceMinutes: number;
};

/** Ladder rows as document usage rows. */
export function usageRows(rows: MonthlyBalanceRow[]): RetainerUsageRow[] {
  return rows.map((row) => {
    const year = Number(row.monthKey.slice(0, 4));
    const month = Number(row.monthKey.slice(5, 7));
    return {
      label: new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long" }),
      year,
      month,
      availableMinutes: row.availableMinutes,
      usedMinutes: row.usedMinutes,
      balanceMinutes: row.balanceMinutes,
    };
  });
}

/** The block's total, read off the last ladder row shown. */
export function usageTotal(rows: MonthlyBalanceRow[]) {
  const last = rows[rows.length - 1];
  return {
    availableMinutes: last?.includedToDateMinutes ?? 0,
    usedMinutes: last?.usedToDateMinutes ?? 0,
    balanceMinutes: last?.balanceMinutes ?? 0,
  };
}

/**
 * The usage block of the invoice a close produced: its snapshot re-priced
 * with the inputs it froze. Same shape as the monthly report's block.
 */
export async function closeRetainerUsage(
  ctx: Reader,
  close: Doc<"billingCloses">,
  amountDue: number,
) {
  const { price } = await priceClose(ctx, close);
  const rows = price.monthlyBalances;
  return {
    kind: rows.length > 1 ? ("cycle" as const) : ("month" as const),
    closed: true,
    monthlyIncludedMinutes: rows[0]?.includedMinutes ?? 0,
    rows: usageRows(rows),
    total: { ...usageTotal(rows), amountDue },
  };
}
