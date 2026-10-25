import { v, ConvexError } from "convex/values";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
import { loadTaskForReadOrNull } from "./tasks/access";
import { isMimeTypeBlocked } from "./lib/content_validation";
import { deleteContentForStorage, requestExtraction } from "./attachmentContents";
import { ATTACHMENT_DELETE_OWN_ONLY, assertBlobUnattached, type AttachmentFileInput } from "./attachments";
import { MAX_FILE_SIZE } from "../lib/attachment";

export const MAX_FILES_PER_COMMENT = 5;
export const MAX_FILE_NAME_LENGTH = 255;

/**
 * Files are added to a comment while writing it, so only its author may
 * attach to it (owner decision D-COMMENTATTACH, 2026-10-25) — in the app and
 * through MCP.
 */
export const COMMENT_ATTACH_AUTHOR_ONLY =
  "You can attach files only to your own comments (files are added while writing a comment). Attach it to the task instead, or post a new comment and attach to that.";

// ─── Query ──────────────────────────────────────────────────────────────────────

/**
 * A task's comment attachments for an already-authorized caller, with file
 * URLs. Null when the caller cannot read the task (tasks/access.ts, T1).
 * Shared by `byTask` below and the MCP `fetch` tool (which also uses
 * `fileId` to look up the extracted text). Without `cap` every row
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
      fileId: att.fileId,
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

    // The UI's shape: no storage id (the URL is what the client needs).
    for (const att of result.attachments) {
      if (!grouped[att.commentId]) grouped[att.commentId] = [];
      grouped[att.commentId].push({
        _id: att._id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        url: att.url,
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

/**
 * The comment attachment write path for an authorized caller: name length,
 * blocked types, the comment in the caller's org on a task they can read and
 * written by the caller (D-COMMENTATTACH), the per-comment count, the size
 * limit and one attachment per blob, then the row, then text
 * extraction (attachmentContents.ts). Shared by `save` below and MCP
 * `attach_file` (which resolves the comment first).
 */
export async function saveCommentAttachmentForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  commentId: Id<"comments">,
  file: AttachmentFileInput,
): Promise<{ id: Id<"commentAttachments">; comment: Doc<"comments"> }> {
  const { orgId, userId } = auth;

  // Validate file name length
  if (file.fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new ConvexError("File name too long");
  }

  // Block dangerous MIME types (XSS prevention)
  if (isMimeTypeBlocked(file.mimeType)) {
    throw new ConvexError("This file type is not allowed");
  }

  const comment = await ctx.db.get(commentId);
  if (!comment || comment.orgId !== orgId) {
    throw new ConvexError("Comment not found");
  }

  // Task access guard (tasks/access.ts)
  if (!(await loadTaskForReadOrNull(ctx, comment.taskId, auth))) {
    throw new ConvexError("Comment not found");
  }

  if (comment.userId !== userId) {
    throw new ConvexError(COMMENT_ATTACH_AUTHOR_ONLY);
  }

  // Check file count limit per comment
  const existing = await ctx.db
    .query("commentAttachments")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .take(MAX_FILES_PER_COMMENT + 1);
  if (existing.length >= MAX_FILES_PER_COMMENT) {
    throw new ConvexError(`Maximum ${MAX_FILES_PER_COMMENT} files per comment`);
  }

  if (file.fileSize > MAX_FILE_SIZE) {
    throw new ConvexError("File exceeds 10MB limit");
  }

  await assertBlobUnattached(ctx, file.fileId);
  const id = await ctx.db.insert("commentAttachments", {
    commentId,
    taskId: comment.taskId,
    orgId,
    userId,
    fileId: file.fileId,
    fileName: file.fileName,
    fileSize: file.fileSize,
    mimeType: file.mimeType,
    createdAt: Date.now(),
  });
  // What an agent can read inside the file (MCP fetch attachment_text).
  await requestExtraction(ctx, { orgId, storageId: file.fileId, mimeType: file.mimeType, name: file.fileName });
  return { id, comment };
}

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
    const { id } = await saveCommentAttachmentForAuth(ctx, auth, args.commentId, {
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
    });
    return id;
  },
});

/**
 * Removes a comment attachment with the app's rules: in the caller's org,
 * the caller's own or any as an admin. The blob and its extracted text
 * (attachmentContents.ts) go with the row. Shared by `remove` below and MCP
 * `delete` (which resolves the file on a task the caller can read first).
 */
export async function removeCommentAttachmentForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  id: Id<"commentAttachments">,
): Promise<void> {
  const att = await ctx.db.get(id);
  if (!att || att.orgId !== auth.orgId) {
    throw new ConvexError("Attachment not found");
  }

  if (!auth.isAdmin && att.userId !== auth.userId) {
    throw new ConvexError(ATTACHMENT_DELETE_OWN_ONLY);
  }

  await ctx.storage.delete(att.fileId);
  await deleteContentForStorage(ctx, att.orgId, att.fileId);
  await ctx.db.delete(id);
}

export const remove = mutation({
  args: { id: v.id("commentAttachments") },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    await removeCommentAttachmentForAuth(ctx, auth, args.id);
  },
});
