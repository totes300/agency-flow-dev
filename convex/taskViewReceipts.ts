import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { markTaskNotificationsRead } from "./notifications";

/**
 * Upsert lastViewedAt for current user + task.
 * Called when user opens task detail modal and stays >= 500ms.
 */
export const markViewed = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Not authorized");
    }

    const existing = await ctx.db
      .query("taskViewReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastViewedAt: Date.now() });
    } else {
      await ctx.db.insert("taskViewReceipts", {
        taskId,
        orgId,
        userId,
        lastViewedAt: Date.now(),
      });
    }

    // Honest badge: opening a task via ANY path clears its unread
    // notifications for the viewer — every task-open surface funnels here.
    await markTaskNotificationsRead(ctx, { userId, orgId, taskId });
  },
});
