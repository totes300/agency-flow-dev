/**
 * Per-entry display status derivation. Pure, framework-free — safe to
 * import from BOTH Convex functions and React client components.
 *
 * Phase 8 Slice 1 introduced this derivation alongside the `settledAt` /
 * `settledReason` split. Slice 4 promotes it to its own module so client
 * code (entry-row badges, period drill-down, top summary `Open` figure)
 * can import without pulling `convex/lib/settleEntries.ts`'s
 * server-runtime imports (`internalMutation`) into the browser bundle.
 *
 * Vocabulary contract (parent PRD § UI Changes):
 *   - `non_billable` is the row's display axis even when the entry is
 *     settled — billability beats settlement at the row level (Revision
 *     Pass #5). The edit/delete guard keys on `settledAt`/`invoiceId`
 *     independently, so a settled non-billable row is still locked.
 *   - `draft` = on a draft invoice (`invoiceId` set, `settledAt` unset).
 *   - `closed` = `settledAt` set for any reason (invoiced / retainer-
 *     included / fixed-included). The financial split lives in
 *     `settledReason` for reports and the drill-down — never at the row.
 *   - `open` = billable, no invoice, not settled.
 */

import type { Id } from "../_generated/dataModel";

export type EntryDisplayStatus =
  | "open"
  | "draft"
  | "closed"
  | "non_billable";

/**
 * The live close an entry settles in (billing refactor): `draft` while its
 * invoice is a draft, `final` once committed for good. Unset = not closed by
 * the close model (legacy fields may still apply until the contract phase).
 */
export type EntryCloseStatus = "draft" | "final";

export type EntryShape = {
  isBillable: boolean;
  invoiceId?: Id<"invoices">;
  settledAt?: number;
  closeStatus?: EntryCloseStatus;
};

export function entryStatus(e: EntryShape): EntryDisplayStatus {
  if (!e.isBillable) return "non_billable";
  if (e.closeStatus === "draft") return "draft";
  if (e.closeStatus === "final") return "closed";
  if (e.invoiceId && e.settledAt === undefined) return "draft";
  if (e.settledAt !== undefined) return "closed";
  return "open";
}

/**
 * Overview money buckets — `entryStatus` with the `closed` state split by what
 * paid for the hour:
 *   open      not closed
 *   draft     on a draft invoice
 *   invoiced  billed hourly (T&M close, or legacy settledReason "invoiced")
 *   settled   covered without hourly revenue (retainer / fixed)
 */
export type OverviewBucket = "open" | "draft" | "invoiced" | "settled";

export function billableOverviewBucket(e: {
  invoiceId?: Id<"invoices">;
  settledAt?: number;
  settledReason?: string;
  closeStatus?: EntryCloseStatus;
  closeKind?: "retainer" | "t_and_m";
}): OverviewBucket {
  if (e.closeStatus === "draft") return "draft";
  if (e.closeStatus === "final") return e.closeKind === "t_and_m" ? "invoiced" : "settled";
  if (e.settledReason === "invoiced") return "invoiced";
  if (e.settledReason !== undefined) return "settled";
  if (e.invoiceId !== undefined) return "draft";
  return "open";
}
