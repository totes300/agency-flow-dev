import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { IDEMPOTENCY_TTL_MS } from "./lib/mcpWrites";

/** Rows deleted per run; a full batch schedules the next one right away. */
const CLEANUP_BATCH = 500;

/**
 * Deletes MCP idempotency keys older than 24 h (docs/prd-mcp.md D23), oldest
 * first through `by_createdAt`. Runs hourly (crons.ts). Replays already
 * ignore expired rows, so a late cleanup never changes a result.
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    const expired = await ctx.db
      .query("mcpIdempotency")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.mcpIdempotency.cleanupExpired, {});
    }
    return null;
  },
});
