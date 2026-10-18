import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { markTaskNotificationsRead } from "./notifications";
import { loadTaskForRead } from "./tasks/access";
import { markTaskViewed } from "./tasks/userState";

/**
 * Upsert lastViewedAt for current user + task.
 * Called when user opens task detail modal and stays >= 500ms.
 */
export const markViewed = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const access = await loadTaskForRead(ctx, taskId);
    const { orgId, userId } = access.auth;
    const now = Date.now();

    const existing = await ctx.db
      .query("taskViewReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastViewedAt: now });
    } else {
      await ctx.db.insert("taskViewReceipts", {
        taskId,
        orgId,
        userId,
        lastViewedAt: now,
      });
    }

    // Per-user state reset on open (§4.3) — the new list rows read this.
    await markTaskViewed(ctx, access, now);

    // Honest badge: opening a task via ANY path clears its unread
    // notifications for the viewer — every task-open surface funnels here.
    await markTaskNotificationsRead(ctx, { userId, orgId, taskId });
  },
});
