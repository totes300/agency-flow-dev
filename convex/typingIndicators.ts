import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthContext } from "./lib/auth";

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Set typing indicator for current user on a task.
 * Upserts the record and cleans up stale indicators.
 */
export const setTyping = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { userId, orgId } = await getAuthContext(ctx);

    // Verify task exists and belongs to org
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) {
      throw new ConvexError("Task not found");
    }

    const now = Date.now();

    // Upsert: find existing record for this task+user
    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_task_user", (q) => q.eq("taskId", taskId).eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastTypedAt: now });
    } else {
      await ctx.db.insert("typingIndicators", {
        taskId,
        orgId,
        userId,
        lastTypedAt: now,
      });
    }

    // Piggyback cleanup: remove stale records for this task (older than 60s)
    const allForTask = await ctx.db
      .query("typingIndicators")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    const staleThreshold = now - 60_000;
    for (const record of allForTask) {
      if (record.lastTypedAt < staleThreshold) {
        await ctx.db.delete(record._id);
      }
    }

    // Schedule auto-clear after 6s (1s buffer over 5s client threshold)
    await ctx.scheduler.runAfter(
      6_000,
      internal.typingIndicators.autoClear,
      { taskId, userId }
    );
  },
});

/**
 * Clear typing indicator for current user on a task.
 */
export const clearTyping = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { userId } = await getAuthContext(ctx);

    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_task_user", (q) => q.eq("taskId", taskId).eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Auto-clear a typing indicator if it hasn't been refreshed recently.
 * Called by scheduler 10s after setTyping.
 */
export const autoClear = internalMutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
  },
  handler: async (ctx, { taskId, userId }) => {
    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_task_user", (q) => q.eq("taskId", taskId).eq("userId", userId))
      .first();

    // Delete if not refreshed in last 5s
    if (existing && existing.lastTypedAt < Date.now() - 5_000) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Get typing indicators for a task, excluding the current user.
 * Returns user names for display.
 */
export const getTyping = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Verify task belongs to org
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    const records = await ctx.db
      .query("typingIndicators")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    // Resolve user names with cache
    const userCache = new Map<string, string>();
    const results: Array<{ userId: string; userName: string; lastTypedAt: number }> = [];

    for (const record of records) {
      // Exclude current user
      if (record.userId === userId) continue;

      let userName = userCache.get(record.userId);
      if (userName === undefined) {
        const user = await ctx.db.get(record.userId);
        userName = user?.name ?? "Unknown";
        userCache.set(record.userId, userName);
      }

      results.push({
        userId: record.userId,
        userName,
        lastTypedAt: record.lastTypedAt,
      });
    }

    return results;
  },
});
