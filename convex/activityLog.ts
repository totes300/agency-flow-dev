import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";

// ─── Helper (called from other mutations) ───────────────────────────────────────

/**
 * Log an activity event for a task.
 * Called from tasks.ts, timeEntries.ts, comments.ts mutations.
 */
export async function logActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    orgId: string;
    userId: Id<"users">;
    type: string;
    metadata: Record<string, unknown>;
  }
) {
  await ctx.db.insert("activityLog", {
    taskId: args.taskId,
    orgId: args.orgId,
    userId: args.userId,
    type: args.type,
    metadata: args.metadata,
    createdAt: Date.now(),
  });
}

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * Get activity log for a task, sorted chronologically.
 * Returns events with user name joined.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    // Member access check — non-admin can only see activity on assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const events = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(500);

    // Join user names with dedup cache
    const userCache = new Map<string, string>();
    for (const event of events) {
      if (!userCache.has(event.userId)) {
        const user = await ctx.db.get(event.userId);
        userCache.set(event.userId, user?.name ?? "Unknown");
      }
    }

    return events.map((event) => ({
      _id: event._id,
      type: event.type,
      metadata: event.metadata,
      createdAt: event.createdAt,
      userId: event.userId,
      userName: userCache.get(event.userId) ?? "Unknown",
    }));
  },
});

/**
 * Last 5 activity events for a single task — used by hover popover.
 * Access-controlled: returns empty for unauthorized users.
 */
export const latestForTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const events = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(5);

    const userCache = new Map<string, string>();
    for (const event of events) {
      if (!userCache.has(event.userId)) {
        const user = await ctx.db.get(event.userId);
        userCache.set(event.userId, user?.name ?? "Unknown");
      }
    }

    return events.map((e) => ({
      type: e.type,
      userName: userCache.get(e.userId) ?? "Unknown",
      metadata: e.metadata as Record<string, unknown>,
      createdAt: e.createdAt,
    }));
  },
});
