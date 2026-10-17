/**
 * Close-model mutations (docs/prd-billing-refactor.md §8): commit a period,
 * reopen a within-budget close, skip entries to the next close. Admin-only;
 * organization and role come from server-side auth.
 */

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { loadCloseContext, toScopeProject } from "./lib/billing/closeData";
import { commitClose as commit, releaseClose } from "./lib/billing/closeLifecycle";
import { appendBillingEvent } from "./lib/billing/events";
import { skipStampFor } from "./lib/billing/scope";

/**
 * Settle the project's committable period. Over budget / T&M → a draft
 * invoice (returned so the UI can open it); within budget → a final close
 * and nothing else ("Close & report").
 */
export const commitClose = mutation({
  args: { projectId: v.id("projects"), periodStart: v.string() },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    return commit(ctx, { orgId, userId }, args);
  },
});

/** Reopen a final close that billed nothing (within-budget retainer). */
export const reopenClose = mutation({
  args: { closeId: v.id("billingCloses") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const close = await ctx.db.get(args.closeId);
    if (!close || close.orgId !== orgId) throw new ConvexError("Close not found.");
    if (close.status !== "final") throw new ConvexError("Only a closed period can be reopened.");
    if (close.invoiceId) {
      throw new ConvexError("This period is billed on an invoice. Void that invoice to reopen it.");
    }
    // Oldest-first in reverse: reopening an earlier period under a later live
    // close would make the later one cover work that now belongs before it.
    const later = await ctx.db
      .query("billingCloses")
      .withIndex("by_orgId_projectId_periodStart", (q) =>
        q.eq("orgId", orgId).eq("projectId", close.projectId).gt("periodStart", close.periodStart),
      )
      .collect();
    if (later.some((c) => c.status !== "released")) {
      throw new ConvexError("Reopen the later closed periods first.");
    }
    await releaseClose(ctx, { orgId, userId }, close, "reopened");
  },
});

/**
 * Skip entries to the next close, or undo the skip (`clear`). All-or-nothing:
 * every entry must be open and on the same project. The stamp is derived
 * server-side — the end of each entry's current effective period.
 */
export const skipEntries = mutation({
  args: { entryIds: v.array(v.id("timeEntries")), clear: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    if (args.entryIds.length === 0) return;

    const docs: Doc<"timeEntries">[] = [];
    for (const id of args.entryIds) {
      const e = await ctx.db.get(id);
      if (!e || e.orgId !== orgId) throw new ConvexError("Entry not found.");
      docs.push(e);
    }
    const projectId = docs[0].projectId;
    if (docs.some((e) => e.projectId !== projectId)) {
      throw new ConvexError("Skip entries of one project at a time.");
    }
    const c = await loadCloseContext(ctx, orgId, projectId);
    const byId = new Map(c.entries.map((e) => [e._id, e]));
    if (docs.some((e) => byId.get(e._id)?.locked !== false)) {
      throw new ConvexError("Only open entries can be skipped — this time is already closed or on an invoice.");
    }

    const now = Date.now();
    const project = toScopeProject(c.project);
    for (const e of docs) {
      // From the CURRENT effective period (an existing stamp included), so a
      // second skip moves the entry one more period forward.
      const skippedThrough = args.clear
        ? undefined
        : skipStampFor(project, byId.get(e._id)!, c.livePeriods);
      await ctx.db.patch(e._id, { skippedThrough, updatedAt: now });
    }
    await appendBillingEvent(ctx, {
      orgId,
      projectId,
      actorId: userId,
      type: args.clear ? "entries_unskipped" : "entries_skipped",
      data: { count: docs.length },
    });
  },
});
