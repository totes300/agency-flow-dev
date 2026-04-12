import { internalMutation } from "../_generated/server";

/**
 * One-time migration: delete all legacy time entries that don't have the
 * new rate snapshot fields (costRate, billableRate, rateCurrency).
 *
 * Run with: npx convex run migrations/deleteLegacyTimeEntries
 */
export default internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("timeEntries").take(500);
    let deleted = 0;

    for (const entry of entries) {
      // Delete entries missing the new rate fields (legacy entries)
      if (entry.costRate === undefined || entry.billableRate === undefined) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
    }

    // If we deleted entries and there might be more, schedule a follow-up
    const hasMore = deleted > 0 && entries.length === 500;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, "migrations/deleteLegacyTimeEntries" as any);
    }

    return { deleted, hasMore };
  },
});
