import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { logActivity } from "./activityLog";

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * Get comments for a task, sorted chronologically.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(500);

    const enriched = await Promise.all(
      comments.map(async (comment) => {
        const user = await ctx.db.get(comment.userId);
        return {
          _id: comment._id,
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          userId: comment.userId,
          userName: user?.name ?? "Unknown",
          userImageUrl: user?.imageUrl,
        };
      })
    );

    return enriched;
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

/**
 * Create a comment on a task.
 */
export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    // Validate Tiptap JSON structure
    if (
      !args.content ||
      typeof args.content !== "object" ||
      (args.content as Record<string, unknown>).type !== "doc"
    ) {
      throw new ConvexError("Invalid comment content");
    }
    // Guard against excessively large content (100KB)
    if (JSON.stringify(args.content).length > 100_000) {
      throw new ConvexError("Comment content too large");
    }

    const now = Date.now();
    const commentId = await ctx.db.insert("comments", {
      taskId: args.taskId,
      orgId,
      userId,
      content: args.content,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(ctx, {
      taskId: args.taskId,
      orgId,
      userId,
      type: "comment_added",
      metadata: { commentId },
    });

    return commentId;
  },
});

/**
 * Update own comment.
 */
export const update = mutation({
  args: {
    id: v.id("comments"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const comment = await ctx.db.get(args.id);
    if (!comment || comment.orgId !== orgId) throw new ConvexError("Comment not found");
    if (comment.userId !== userId) throw new ConvexError("You can only edit your own comments");

    await ctx.db.patch(args.id, {
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a comment. Admins can delete any, members only their own.
 */
export const remove = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const comment = await ctx.db.get(args.id);
    if (!comment || comment.orgId !== orgId) throw new ConvexError("Comment not found");
    if (!isAdmin && comment.userId !== userId) {
      throw new ConvexError("You can only delete your own comments");
    }

    await ctx.db.delete(args.id);
  },
});

// ─── Read receipts ──────────────────────────────────────────────────────────────

/**
 * Get the unread comment count for a task.
 * Compares lastSeenAt timestamp against comment createdAt timestamps.
 * Excludes the current user's own comments from unread count.
 */
export const unreadCount = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return { total: 0, unread: 0 };

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(500);

    const receipt = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .first();

    const lastSeenAt = receipt?.lastSeenAt ?? 0;

    // Unread = comments by OTHER users that arrived after lastSeenAt
    const unread = comments.filter(
      (c) => c.userId !== userId && c.createdAt > lastSeenAt
    ).length;

    return { total: comments.length, unread };
  },
});

/**
 * Mark all comments on a task as seen by the current user.
 * Called when user opens the Comments tab.
 */
export const markSeen = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Verify task belongs to caller's org
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    const existing = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("commentReadReceipts", {
        taskId,
        userId,
        lastSeenAt: now,
      });
    }
  },
});
