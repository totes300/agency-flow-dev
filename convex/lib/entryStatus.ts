/**
 * Per-entry display status derivation. Pure, framework-free — safe to
 * import from BOTH Convex functions and React client components.
 *
 * The close model (docs/prd-billing-refactor.md §5) is the only source: an
 * entry is open until a live close settles it (`closeId`), and the close's
 * status says whether its invoice is still a draft.
 *
 * Vocabulary contract:
 *   - `non_billable` is the row's display axis even when the entry is
 *     closed — billability beats settlement at the row level. The edit/delete
 *     guard keys on `closeId` independently, so a closed non-billable row is
 *     still locked.
 *   - `draft`  = settled by a close whose invoice is still a draft.
 *   - `closed` = settled by a final close (invoiced, or within budget).
 *   - `open`   = billable and not settled.
 */

export type EntryDisplayStatus =
  | "open"
  | "draft"
  | "closed"
  | "non_billable";

/**
 * The live close an entry settles in: `draft` while its invoice is a draft,
 * `final` once committed for good. Unset = open.
 */
export type EntryCloseStatus = "draft" | "final";

export type EntryShape = {
  isBillable: boolean;
  closeStatus?: EntryCloseStatus;
};

export function entryStatus(e: EntryShape): EntryDisplayStatus {
  if (!e.isBillable) return "non_billable";
  if (e.closeStatus === "draft") return "draft";
  if (e.closeStatus === "final") return "closed";
  return "open";
}

/**
 * Overview money buckets — `entryStatus` with the `closed` state split by what
 * paid for the hour:
 *   open      not closed
 *   draft     on a draft invoice
 *   invoiced  billed hourly (a final T&M close)
 *   settled   covered without hourly revenue (a final retainer close)
 */
export type OverviewBucket = "open" | "draft" | "invoiced" | "settled";

export function billableOverviewBucket(e: {
  closeStatus?: EntryCloseStatus;
  closeKind?: "retainer" | "t_and_m";
}): OverviewBucket {
  if (e.closeStatus === "draft") return "draft";
  if (e.closeStatus === "final") return e.closeKind === "t_and_m" ? "invoiced" : "settled";
  return "open";
}
