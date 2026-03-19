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

    // Join user names
    const enriched = await Promise.all(
      events.map(async (event) => {
        const user = await ctx.db.get(event.userId);
        return {
          _id: event._id,
          type: event.type,
          metadata: event.metadata,
          createdAt: event.createdAt,
          userId: event.userId,
          userName: user?.name ?? "Unknown",
        };
      })
    );

    return enriched;
  },
});
