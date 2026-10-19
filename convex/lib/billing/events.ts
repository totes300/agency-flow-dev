/**
 * Append-only billing audit trail (docs/prd-billing-refactor.md N10). Every
 * close and invoice state change writes exactly one row, in the same
 * transaction as the change itself. Rows are never patched or deleted.
 */

import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export type BillingEventType = Doc<"billingEvents">["type"];

export async function appendBillingEvent(
  ctx: MutationCtx,
  event: {
    orgId: string;
    projectId: Id<"projects">;
    type: BillingEventType;
    actorId: Id<"users">;
    closeId?: Id<"billingCloses">;
    invoiceId?: Id<"invoices">;
    data?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  await ctx.db.insert("billingEvents", { ...event, at: Date.now() });
}
