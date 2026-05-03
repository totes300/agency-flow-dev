/**
 * Resolves the URL segment under `/invoices/<segment>` to an invoice row.
 *
 * Two accepted forms (decision 2026-05-03 — friendly invoice URLs):
 *   1. Friendly form, e.g. "INV-035" — primary, produced by every internal
 *      link via `formatInvoiceNumber(prefix, number)` in `lib/format.ts`.
 *   2. Convex doc ID — backwards-compat fallback for bookmarks / pasted
 *      links saved before the URL refactor.
 *
 * Always tenant-guarded — never returns a row from another org.
 */

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Inverse of `formatInvoiceNumber` in `lib/format.ts`. Splits a friendly
 * identifier into `(prefix, number)`. Accepts any prefix shape that ends
 * with digits, so "INV-035", "ACME-2026-12", and "C7" all parse. Returns
 * null when the input is not in the friendly form (e.g. a Convex doc ID),
 * letting the caller fall back to ID lookup.
 */
export function parseInvoiceIdentifier(
  identifier: string,
): { prefix: string; number: number } | null {
  const match = /^(.*?)(\d+)$/.exec(identifier);
  if (!match) return null;
  const prefix = match[1];
  const number = Number(match[2]);
  if (!prefix || !Number.isFinite(number)) return null;
  return { prefix, number };
}

export async function resolveInvoiceByIdentifier(
  ctx: QueryCtx,
  orgId: string,
  identifier: string,
): Promise<Doc<"invoices"> | null> {
  // Friendly form first — the common case for new URLs.
  const friendly = parseInvoiceIdentifier(identifier);
  if (friendly) {
    const byNumber = await ctx.db
      .query("invoices")
      .withIndex("by_orgId_prefix_number", (q) =>
        q
          .eq("orgId", orgId)
          .eq("prefix", friendly.prefix)
          .eq("number", friendly.number),
      )
      .unique();
    if (byNumber) return byNumber;
  }

  // Backwards compat: try the segment as a raw Convex doc ID. `ctx.db.get`
  // will throw if `identifier` isn't a syntactically valid ID for the
  // table, so we guard with try/catch — a malformed segment is a 404, not
  // a server error.
  try {
    const byId = await ctx.db.get(identifier as Id<"invoices">);
    if (byId && byId.orgId === orgId) return byId;
  } catch {
    /* malformed identifier — fall through to null */
  }
  return null;
}
