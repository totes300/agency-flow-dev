import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { loadTaskForReadOrNull } from "./tasks/access";
import type { ActivityEvent } from "./tasks/model";
import { onActivity } from "./tasks/derived";

// ─── Helper (called from other mutations) ───────────────────────────────────────

/**
 * Append a typed activity event (tasks/model.ts activityLogValidator) and
 * move the task's `lastActivity` forward + fan out the unseen-change flag
 * (§5.5, §4.3). Called from tasks/write.ts,
 * comments.ts and timeEntries.ts. `at` defaults to now (seeds pass history).
 */
export async function logActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    orgId: string;
    userId: Id<"users">;
    at?: number;
  } & ActivityEvent,
) {
  const { at, ...event } = args;
  const createdAt = at ?? Date.now();
  await ctx.db.insert("activityLog", { ...event, createdAt });
  await onActivity(ctx, args.taskId, { kind: args.type, actorId: args.userId, at: createdAt });
}

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * Get activity log for a task, sorted chronologically.
 * Returns events with user name joined.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    // Access via tasks/access.ts (T1, incl. sub-tasks of an assigned parent).
    if (!(await loadTaskForReadOrNull(ctx, taskId))) return [];

    const events = (await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(500))
      .filter((event) => event.type !== "description_changed");

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
    if (!(await loadTaskForReadOrNull(ctx, taskId))) return [];

    const events = (await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(20))
      .filter((event) => event.type !== "description_changed")
      .slice(0, 5);

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
