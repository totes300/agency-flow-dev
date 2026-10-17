import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";

/** What a reader needs to know about the live close an entry settles in. */
export type EntryCloseInfo = {
  closeStatus: "draft" | "final";
  closeKind: "retainer" | "t_and_m";
  /** The close's invoice — the entry's invoice for display joins. */
  closeInvoiceId?: Id<"invoices">;
};

/**
 * Close info for a batch of entries, keyed by `closeId`. Org-checked; a
 * released close never appears (release clears `closeId` on its entries).
 */
export async function loadEntryCloseInfo(
  ctx: { db: GenericDatabaseReader<DataModel> },
  orgId: string,
  entries: Pick<Doc<"timeEntries">, "closeId">[],
): Promise<Map<string, EntryCloseInfo>> {
  const ids = new Set<Id<"billingCloses">>();
  for (const e of entries) if (e.closeId) ids.add(e.closeId);
  const out = new Map<string, EntryCloseInfo>();
  for (const id of ids) {
    const close = await ctx.db.get(id);
    if (!close || close.orgId !== orgId || close.status === "released") continue;
    out.set(id, {
      closeStatus: close.status,
      closeKind: close.kind,
      ...(close.invoiceId ? { closeInvoiceId: close.invoiceId } : {}),
    });
  }
  return out;
}
