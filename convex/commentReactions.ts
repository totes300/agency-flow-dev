import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * Get all reactions for comments on a task, grouped by commentId and emoji.
 * Returns a record keyed by commentId → array of { emoji, count, userNames, hasReacted }.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return {};

    const reactions = await ctx.db
      .query("commentReactions")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    // Batch-resolve user names
    const userCache = new Map<string, string>();
    for (const r of reactions) {
      if (!userCache.has(r.userId)) {
        const user = await ctx.db.get(r.userId);
        userCache.set(r.userId, user?.name ?? "Unknown");
      }
    }

    // Group by commentId → emoji
    const grouped: Record<
      string,
      Array<{ emoji: string; count: number; userNames: string[]; hasReacted: boolean }>
    > = {};

    for (const r of reactions) {
      if (!grouped[r.commentId]) grouped[r.commentId] = [];
      const group = grouped[r.commentId];
      const existing = group.find((g) => g.emoji === r.emoji);
      const userName = userCache.get(r.userId) ?? "Unknown";

      if (existing) {
        existing.count++;
        existing.userNames.push(userName);
        if (r.userId === userId) existing.hasReacted = true;
      } else {
        group.push({
          emoji: r.emoji,
          count: 1,
          userNames: [userName],
          hasReacted: r.userId === userId,
        });
      }
    }

    return grouped;
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

/**
 * Toggle a reaction on a comment. If the user already has this emoji → remove it.
 * If not → add it.
 */
export const toggle = mutation({
  args: {
    commentId: v.id("comments"),
    emoji: v.string(),
  },
  handler: async (ctx, { commentId, emoji }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Validate emoji length (covers flags, ZWJ sequences)
    if (!emoji || emoji.length > 16) {
      throw new ConvexError("Invalid emoji");
    }

    const comment = await ctx.db.get(commentId);
    if (!comment || comment.orgId !== orgId) {
      throw new ConvexError("Comment not found");
    }

    // Check if user already reacted with this emoji
    const existing = await ctx.db
      .query("commentReactions")
      .withIndex("by_comment_user_emoji", (q) =>
        q.eq("commentId", commentId).eq("userId", userId).eq("emoji", emoji),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("commentReactions", {
        commentId,
        taskId: comment.taskId,
        orgId,
        userId,
        emoji,
        createdAt: Date.now(),
      });
    }
  },
});
