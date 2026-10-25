import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { UPLOAD_ATTACH_WINDOW_MS } from "../lib/mcp/limits";

/** Rows deleted per run; a full batch schedules the next one right away. */
const CLEANUP_BATCH = 500;

/**
 * Deletes MCP upload announcements older than 24 h (docs/prd-mcp.md §10),
 * oldest first through `by_createdAt`. Runs hourly (crons.ts). attach_file
 * already ignores older rows, so a late cleanup never changes a result. The
 * attached files themselves live on in `attachments` / `commentAttachments`.
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - UPLOAD_ATTACH_WINDOW_MS;
    const expired = await ctx.db
      .query("mcpUploads")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.mcpUploads.cleanupExpired, {});
    }
    return null;
  },
});
