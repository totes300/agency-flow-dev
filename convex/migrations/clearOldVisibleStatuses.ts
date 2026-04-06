/**
 * One-off migration: clear old todayVisibleStatuses (type-key strings) from users.
 * After migration, users fall back to orgSettings.defaultMyTasksStatusIds.
 * Run via: npx convex run migrations/clearOldVisibleStatuses:run
 * Safe to run multiple times (idempotent).
 */
import { mutation } from "../_generated/server";

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let migrated = 0;

    for (const user of users) {
      if (!user.todayVisibleStatuses || user.todayVisibleStatuses.length === 0) continue;

      // Detect old format: old values are type keys like "in_progress", "backlog"
      // New format values are Convex IDs (long alphanumeric strings)
      const isOldFormat = user.todayVisibleStatuses.some(
        (v) => ["in_progress", "backlog", "blocked", "done", "review"].includes(v),
      );

      if (isOldFormat) {
        await ctx.db.patch(user._id, {
          todayVisibleStatuses: undefined,
        });
        migrated++;
      }
    }

    return { total: users.length, migrated };
  },
});
