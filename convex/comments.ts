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
      // Pre-cache resolver users (may not be comment authors)
      if (c.resolvedBy && !userCache.has(c.resolvedBy)) {
        const resolver = await ctx.db.get(c.resolvedBy);
        userCache.set(c.resolvedBy, { name: resolver?.name ?? "Former member" });
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
      const resolvedByName = comment.resolvedBy
        ? userCache.get(comment.resolvedBy)?.name ?? "Former member"
        : undefined;

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
        resolvedAt: comment.resolvedAt,
        resolvedBy: comment.resolvedBy,
        resolvedByName,
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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Task not found");
    }

    // Validate parent comment if replying
    if (args.parentCommentId) {
      const parent = await ctx.db.get(args.parentCommentId);
      if (!parent || parent.taskId !== args.taskId) {
        throw new ConvexError("Parent comment not found");
      }

      // Auto re-open: find root comment and unresolve if resolved
      let root = parent;
      while (root.parentCommentId) {
        const ancestor = await ctx.db.get(root.parentCommentId);
        if (!ancestor) break;
        root = ancestor;
      }
      if (root.resolvedAt) {
        await ctx.db.patch(root._id, { resolvedAt: undefined, resolvedBy: undefined });
      }
    }

    validateTiptapContent(args.content);

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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const comment = await ctx.db.get(args.id);
    if (!comment || comment.orgId !== orgId) throw new ConvexError("Comment not found");
    if (comment.userId !== userId) throw new ConvexError("You can only edit your own comments");

    // Task-assignment guard
    const task = await ctx.db.get(comment.taskId);
    if (!task || (!isAdmin && !task.assigneeIds.includes(userId))) {
      throw new ConvexError("Comment not found");
    }

    validateTiptapContent(args.content);

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

    // Task-assignment guard
    const task = await ctx.db.get(comment.taskId);
    if (!task || (!isAdmin && !task.assigneeIds.includes(userId))) {
      throw new ConvexError("Comment not found");
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

// ─── Resolve / Unresolve ────────────────────────────────────────────────────────

/**
 * Resolve a top-level comment thread.
 */
export const resolve = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const comment = await ctx.db.get(args.id);
    if (!comment || comment.orgId !== orgId) throw new ConvexError("Comment not found");
    if (comment.parentCommentId) throw new ConvexError("Only top-level comments can be resolved");

    const task = await ctx.db.get(comment.taskId);
    if (!task || (!isAdmin && !task.assigneeIds.includes(userId))) {
      throw new ConvexError("Comment not found");
    }

    // Idempotent: already resolved → no-op
    if (comment.resolvedAt) return;

    await ctx.db.patch(args.id, {
      resolvedAt: Date.now(),
      resolvedBy: userId,
    });

    await logActivity(ctx, {
      taskId: comment.taskId,
      orgId,
      userId,
      type: "comment_resolved",
      metadata: { commentId: args.id },
    });
  },
});

/**
 * Re-open a resolved comment thread.
 */
export const unresolve = mutation({
  args: { id: v.id("comments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const comment = await ctx.db.get(args.id);
    if (!comment || comment.orgId !== orgId) throw new ConvexError("Comment not found");
    if (comment.parentCommentId) throw new ConvexError("Only top-level comments can be re-opened");

    const task = await ctx.db.get(comment.taskId);
    if (!task || (!isAdmin && !task.assigneeIds.includes(userId))) {
      throw new ConvexError("Comment not found");
    }

    // Idempotent: already open → no-op
    if (!comment.resolvedAt) return;

    await ctx.db.patch(args.id, {
      resolvedAt: undefined,
      resolvedBy: undefined,
    });

    await logActivity(ctx, {
      taskId: comment.taskId,
      orgId,
      userId,
      type: "comment_reopened",
      metadata: { commentId: args.id },
    });
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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return { total: 0, unread: 0 };
    if (!isAdmin && !task.assigneeIds.includes(userId)) return { total: 0, unread: 0 };

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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const receipts = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
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
 * Return the current user's lastSeenAt timestamp for a task.
 * Used client-side to render the "New" divider on initial load.
 */
export const myLastSeen = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return 0;
    if (!isAdmin && !task.assigneeIds.includes(userId)) return 0;

    const receipt = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .first();

    return receipt?.lastSeenAt ?? 0;
  },
});

/**
 * Mark all comments on a task as seen by the current user.
 * Called when user opens the Comments tab.
 */
export const markSeen = mutation({
  args: { taskId: v.id("tasks"), seenAt: v.number() },
  handler: async (ctx, { taskId, seenAt }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    // Verify task belongs to caller's org + assignment guard
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("Task not found");
    }

    const existing = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .first();

    if (existing) {
      // Only advance forward — never regress the watermark
      if (seenAt > existing.lastSeenAt) {
        await ctx.db.patch(existing._id, { lastSeenAt: seenAt, orgId });
      }
    } else {
      await ctx.db.insert("commentReadReceipts", {
        taskId,
        orgId,
        userId,
        lastSeenAt: seenAt,
      });
    }
  },
});

// ─── Hover Popover Query ────────────────────────────────────────────────────────

/**
 * Last 5 comments for a single task — used by comment hover popover.
 * Returns author info and plain-text preview. Access-controlled.
 */
export const latestPreview = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(5);

    // Get user's last seen timestamp for unread highlighting
    const receipt = await ctx.db
      .query("commentReadReceipts")
      .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
      .unique();
    const lastSeenAt = receipt?.lastSeenAt ?? 0;

    const userCache = new Map<string, { name: string; imageUrl?: string }>();
    for (const c of comments) {
      if (!userCache.has(c.userId)) {
        const user = await ctx.db.get(c.userId);
        userCache.set(c.userId, { name: user?.name ?? "Unknown", imageUrl: user?.imageUrl });
      }
    }

    return comments.map((c) => {
      const user = userCache.get(c.userId) ?? { name: "Unknown" };
      return {
        _id: c._id,
        userName: user.name,
        userImageUrl: user.imageUrl,
        preview: extractContentPreview(c.content, 100),
        createdAt: c.createdAt,
        isUnread: c.createdAt > lastSeenAt && c.userId !== userId,
      };
    });
  },
});

// ─── Validators ──────────────────────────────────────────────────────────────────

import { validateTiptapContent as _validateTiptap } from "./lib/content_validation";

/**
 * Validate Tiptap JSON and throw ConvexError on failure.
 * Must be called by EVERY mutation that writes to the `content` field.
 */
function validateTiptapContent(content: unknown): void {
  const result = _validateTiptap(content);
  if (!result.valid) {
    throw new ConvexError(result.reason);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

import { extractPlainText } from "../lib/tiptap-utils";

/** Extract a short plain-text preview from Tiptap JSON content (max ~40 chars). */
function extractContentPreview(content: unknown, maxLen = 40): string {
  const text = extractPlainText(content)
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + "…"
}
