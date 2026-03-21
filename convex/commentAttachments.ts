import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { isMimeTypeBlocked } from "./lib/content_validation";

const MAX_FILES_PER_COMMENT = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_NAME_LENGTH = 255;

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * Get all comment attachments for a task, grouped by commentId.
 * Returns a record keyed by commentId → array of attachments with URLs.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return {};
    if (!isAdmin && !task.assigneeIds.includes(userId)) return {};

    const attachments = await ctx.db
      .query("commentAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    const grouped: Record<
      string,
      Array<{
        _id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        url: string | null;
      }>
    > = {};

    for (const att of attachments) {
      if (!grouped[att.commentId]) grouped[att.commentId] = [];
      const url = await ctx.storage.getUrl(att.fileId);
      grouped[att.commentId].push({
        _id: att._id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        url,
      });
    }

    return grouped;
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    commentId: v.id("comments"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    // Validate file name length
    if (args.fileName.length > MAX_FILE_NAME_LENGTH) {
      throw new ConvexError("File name too long");
    }

    // Block dangerous MIME types (XSS prevention)
    if (isMimeTypeBlocked(args.mimeType)) {
      throw new ConvexError("This file type is not allowed");
    }

    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.orgId !== orgId) {
      throw new ConvexError("Comment not found");
    }

    // Task-assignment guard — non-admins can only attach to tasks they're assigned to
    const task = await ctx.db.get(comment.taskId);
    if (!task || (!isAdmin && !task.assigneeIds.includes(userId))) {
      throw new ConvexError("Comment not found");
    }

    // Check file count limit per comment
    const existing = await ctx.db
      .query("commentAttachments")
      .withIndex("by_comment", (q) => q.eq("commentId", args.commentId))
      .take(MAX_FILES_PER_COMMENT + 1);
    if (existing.length >= MAX_FILES_PER_COMMENT) {
      throw new ConvexError(`Maximum ${MAX_FILES_PER_COMMENT} files per comment`);
    }

    if (args.fileSize > MAX_FILE_SIZE) {
      throw new ConvexError("File exceeds 10MB limit");
    }

    return await ctx.db.insert("commentAttachments", {
      commentId: args.commentId,
      taskId: comment.taskId,
      orgId,
      userId,
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("commentAttachments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const att = await ctx.db.get(args.id);
    if (!att || att.orgId !== orgId) {
      throw new ConvexError("Attachment not found");
    }

    if (!isAdmin && att.userId !== userId) {
      throw new ConvexError("You can only delete your own attachments");
    }

    await ctx.storage.delete(att.fileId);
    await ctx.db.delete(args.id);
  },
});
