import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { PREVIEW_KEEP_MS } from "./lib/mcpBilling";

/** Rows deleted per run; a full batch schedules the next one right away. */
const CLEANUP_BATCH = 500;

/**
 * Deletes MCP billing previews older than 24 h (docs/prd-mcp.md §9), oldest
 * first through `by_createdAt`. Runs hourly (crons.ts). Tokens stop
 * committing after 10 minutes anyway; committed ones replay their result
 * until this removes them.
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - PREVIEW_KEEP_MS;
    const expired = await ctx.db
      .query("mcpBillingPreviews")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.mcpBillingPreviews.cleanupExpired, {});
    }
    return null;
  },
});
