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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    // Member access check — non-admin can only see comments on assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(500);

    // Build user cache + comment-to-userName map for parentUserName lookup
    const userCache = new Map<string, { name: string; imageUrl?: string }>();
    for (const c of comments) {
      if (!userCache.has(c.userId)) {
        const user = await ctx.db.get(c.userId);
        userCache.set(c.userId, { name: user?.name ?? "Unknown", imageUrl: user?.imageUrl });
      }
    }

    // Build maps for parent comment lookups
    const commentUserMap = new Map<string, string>();
    const commentPreviewMap = new Map<string, string>();
    for (const c of comments) {
      commentUserMap.set(c._id, userCache.get(c.userId)?.name ?? "Unknown");
      commentPreviewMap.set(c._id, extractContentPreview(c.content));
    }

    const enriched = comments.map((comment) => {
      const user = userCache.get(comment.userId) ?? { name: "Unknown" };
      return {
        _id: comment._id,
        content: comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        userId: comment.userId,
        userName: user.name,
        userImageUrl: user.imageUrl,
        parentCommentId: comment.parentCommentId,
        parentUserName: comment.parentCommentId
          ? commentUserMap.get(comment.parentCommentId)
          : undefined,
        parentPreview: comment.parentCommentId
          ? commentPreviewMap.get(comment.parentCommentId)
          : undefined,
      };
    });

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
    parentCommentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    // Validate parent comment if replying
    if (args.parentCommentId) {
      const parent = await ctx.db.get(args.parentCommentId);
      if (!parent || parent.taskId !== args.taskId) {
        throw new ConvexError("Parent comment not found");
      }
    }

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
      parentCommentId: args.parentCommentId,
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

    // Validate Tiptap JSON structure (same as create)
    if (
      !args.content ||
      typeof args.content !== "object" ||
      (args.content as Record<string, unknown>).type !== "doc"
    ) {
      throw new ConvexError("Invalid comment content");
    }
    if (JSON.stringify(args.content).length > 100_000) {
      throw new ConvexError("Comment content too large");
    }

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

    // Cascade delete: reactions
    const reactions = await ctx.db
      .query("commentReactions")
      .withIndex("by_comment", (q) => q.eq("commentId", args.id))
      .collect();
    for (const r of reactions) {
      await ctx.db.delete(r._id);
    }

    // Cascade delete: attachments (+ storage cleanup)
    const attachments = await ctx.db
      .query("commentAttachments")
      .withIndex("by_comment", (q) => q.eq("commentId", args.id))
      .collect();
    for (const att of attachments) {
      await ctx.storage.delete(att.fileId);
      await ctx.db.delete(att._id);
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
 * Get read receipts for a task — who has seen up to which point.
 * Returns array of { userId, userName, userImageUrl, lastSeenAt }.
 * Excludes the current user (you don't need to see your own "seen" status).
 */
export const readReceipts = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];

    const receipts = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task")
      .filter((q) => q.eq(q.field("taskId"), taskId))
      .collect();

    const results: Array<{
      userId: string;
      userName: string;
      userImageUrl?: string;
      lastSeenAt: number;
    }> = [];

    for (const receipt of receipts) {
      if (receipt.userId === userId) continue;
      const user = await ctx.db.get(receipt.userId);
      if (!user) continue;
      results.push({
        userId: receipt.userId,
        userName: user.name,
        userImageUrl: user.imageUrl,
        lastSeenAt: receipt.lastSeenAt,
      });
    }

    return results;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Extract a short plain-text preview from Tiptap JSON content (max ~40 chars). */
function extractContentPreview(content: unknown, maxLen = 40): string {
  const text = extractPlain(content)
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + "…"
}

function extractPlain(content: unknown): string {
  if (!content || typeof content !== "object") return ""
  const node = content as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }
  if (node.type === "text" && node.text) return node.text
  if (node.type === "mention") return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`
  if (node.type === "hardBreak") return " "
  if (!node.content) return ""
  return node.content.map(extractPlain).join("")
}
