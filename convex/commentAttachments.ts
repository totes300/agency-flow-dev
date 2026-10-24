import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
import { loadTaskForReadOrNull } from "./tasks/access";
import { isMimeTypeBlocked } from "./lib/content_validation";

const MAX_FILES_PER_COMMENT = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_NAME_LENGTH = 255;

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * A task's comment attachments for an already-authorized caller, with file
 * URLs. Null when the caller cannot read the task (tasks/access.ts, T1).
 * Shared by `byTask` below and the MCP `fetch` tool. Without `cap` every row
 * is read (the UI groups them per comment); with `cap`, `truncated` says
 * whether more exist.
 */
export async function listCommentAttachmentsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  taskId: Id<"tasks">,
  cap?: number,
) {
  if (!(await loadTaskForReadOrNull(ctx, taskId, auth))) return null;

  const query = ctx.db.query("commentAttachments").withIndex("by_task", (q) => q.eq("taskId", taskId));
  const rows = cap === undefined ? await query.collect() : await query.take(cap + 1);
  const attachments = cap === undefined ? rows : rows.slice(0, cap);

  // Fetch all storage URLs in parallel
  const urls = await Promise.all(attachments.map((att) => ctx.storage.getUrl(att.fileId)));
  return {
    attachments: attachments.map((att, i) => ({
      _id: att._id,
      commentId: att.commentId,
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      url: urls[i],
    })),
    truncated: cap !== undefined && rows.length > cap,
  };
}

/**
 * Get all comment attachments for a task, grouped by commentId.
 * Returns a record keyed by commentId → array of attachments with URLs.
 */
export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const auth = await getAuthContext(ctx);
    const result = await listCommentAttachmentsForAuth(ctx, auth, taskId);
    if (!result) return {};

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

    for (const { commentId, ...att } of result.attachments) {
      if (!grouped[commentId]) grouped[commentId] = [];
      grouped[commentId].push(att);
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
    const auth = await getAuthContext(ctx);
    const { orgId, userId } = auth;

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

    // Task access guard (tasks/access.ts)
    if (!(await loadTaskForReadOrNull(ctx, comment.taskId, auth))) {
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
