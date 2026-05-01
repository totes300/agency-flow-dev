import { v, ConvexError } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { FunctionReference } from "convex/server";

/**
 * One-time migration. Phase 8 made `startedAt` required on `timeEntries`;
 * existing dummy rows lack the field, so we wipe before the schema deploy.
 *
 * Run:
 *   npx convex run migrations/wipeAllTimeEntries '{"confirm":"WIPE_ALL_TIME_ENTRIES"}'
 *
 * Each call deletes one 500-row batch and re-schedules itself if more rows
 * remain — keeps each transaction under Convex's write limit.
 */
export default internalMutation({
  args: {
    confirm: v.literal("WIPE_ALL_TIME_ENTRIES"),
  },
  handler: async (ctx) => {
    const batch = await ctx.db.query("timeEntries").take(500);
    for (const entry of batch) {
      await ctx.db.delete(entry._id);
    }
    const deleted = batch.length;
    const hasMore = deleted === 500;

    if (hasMore) {
      // Generated `internal` doesn't expose `migrations/` at runtime in this
      // repo (sibling deleteLegacyTimeEntries uses the same cast).
      const selfRef = "migrations/wipeAllTimeEntries:default" as unknown as FunctionReference<
        "mutation",
        "internal",
        { confirm: "WIPE_ALL_TIME_ENTRIES" },
        { deleted: number; hasMore: boolean }
      >;
      await ctx.scheduler.runAfter(0, selfRef, { confirm: "WIPE_ALL_TIME_ENTRIES" });
    } else if (deleted === 0) {
      throw new ConvexError("No time entries to wipe — safe to delete this file.");
    }

    return { deleted, hasMore };
  },
});
