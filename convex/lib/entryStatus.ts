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

export type EntryShape = {
  isBillable: boolean;
  invoiceId?: Id<"invoices">;
  settledAt?: number;
};

export function entryStatus(e: EntryShape): EntryDisplayStatus {
  if (!e.isBillable) return "non_billable";
  if (e.invoiceId && e.settledAt === undefined) return "draft";
  if (e.settledAt !== undefined) return "closed";
  return "open";
}
