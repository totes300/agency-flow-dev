import { v, ConvexError } from "convex/values";
import { query, mutation, action, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext, getSessionIdentity, type AuthContext } from "./lib/auth";
import { loadTaskForReadOrNull, loadTaskForWrite, type TaskAccess } from "./tasks/access";
import { isMimeTypeBlocked } from "./lib/content_validation";
import { isSafeUrl } from "./lib/url";
import { deleteContentForStorage, requestExtraction } from "./attachmentContents";
import { MAX_FILE_SIZE, MAX_FILES_PER_TASK } from "../lib/attachment";

// ─── Query ──────────────────────────────────────────────────────────────────────

/** Attachments read per task. */
export const TASK_ATTACHMENT_CAP = 100;

/**
 * A task's attachments for an already-authorized caller, oldest first, with
 * uploader names and file URLs. Null when the caller cannot read the task
 * (tasks/access.ts, T1). Shared by `byTask` below and the MCP `fetch` tool
 * (which also uses `fileId` to look up the extracted text);
 * `truncated` = more than `cap` attachments exist.
 */
export async function listTaskAttachmentsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  taskId: Id<"tasks">,
  cap: number = TASK_ATTACHMENT_CAP,
) {
  if (!(await loadTaskForReadOrNull(ctx, taskId, auth))) return null;

  const rows = await ctx.db
    .query("attachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .take(cap + 1);
  const attachments = rows.slice(0, cap);

  // Build user cache to avoid N+1
  const userCache = new Map<string, string>();
  for (const att of attachments) {
    if (!userCache.has(att.userId)) {
      const user = await ctx.db.get(att.userId);
      userCache.set(att.userId, user?.name ?? "Unknown");
    }
  }

  // Generate URLs for all files in parallel
  const enriched = await Promise.all(
    attachments.map(async (att) => {
      const url = await ctx.storage.getUrl(att.fileId);
      return {
        _id: att._id,
        fileId: att.fileId,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        url,
        userId: att.userId,
        createdAt: att.createdAt,
        userName: userCache.get(att.userId) ?? "Unknown",
      };
    })
  );

  return { attachments: enriched, truncated: rows.length > cap };
}

export const byTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const auth = await getAuthContext(ctx);
    const result = await listTaskAttachmentsForAuth(ctx, auth, taskId);
    // The UI's shape: no storage id (the URL is what the client needs).
    return (result?.attachments ?? []).map((att) => ({
      _id: att._id,
      fileName: att.fileName,
      fileSize: att.fileSize,
      mimeType: att.mimeType,
      url: att.url,
      userId: att.userId,
      createdAt: att.createdAt,
      userName: att.userName,
    }));
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx); // Auth check
    return await ctx.storage.generateUploadUrl();
  },
});

const MAX_REUPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Fetch an image from an external URL and store it in Convex storage.
 * Used to re-host images pasted from Notion, Google Docs, etc.
 * Runs server-side to avoid CORS restrictions.
 */
export const reuploadFromUrl = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const identity = await getSessionIdentity(ctx);
    if (!identity) throw new ConvexError("Not authenticated");

    // SSRF protection: block private/internal network destinations
    if (!isSafeUrl(url)) {
      throw new ConvexError("URL is invalid or points to a private network");
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return null; // Network error, DNS failure, etc.
    }
    if (!response.ok) return null;

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_REUPLOAD_SIZE) {
      return null;
    }

    const blob = await response.blob();
    if (blob.size > MAX_REUPLOAD_SIZE) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const blobType = blob.type ?? "";
    if (!contentType.startsWith("image/") && !blobType.startsWith("image/")) {
      return null; // Not an image (auth wall, HTML page, etc.)
    }

    const storageId = await ctx.storage.store(blob);
    return storageId;
  },
});

export const BLOB_ALREADY_ATTACHED = "This file is already attached. Upload it again to attach another copy.";

/**
 * One blob, one attachment: a stored file already referenced by a task or
 * comment attachment (in any org), or already read for any org, is refused,
 * so deleting one attachment can never break or expose another record.
 */
export async function assertBlobUnattached(ctx: MutationCtx, fileId: Id<"_storage">): Promise<void> {
  const onTask = await ctx.db.query("attachments").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first();
  const onComment = onTask
    ? null
    : await ctx.db.query("commentAttachments").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).first();
  const read = onTask || onComment
    ? null
    : await ctx.db.query("attachmentContents").withIndex("by_storageId", (q) => q.eq("storageId", fileId)).first();
  if (onTask || onComment || read) throw new ConvexError(BLOB_ALREADY_ATTACHED);
}

export type AttachmentFileInput = {
  fileId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

/**
 * The task attachment write path for a caller who may write the task
 * (`loadTaskForWrite`): blocked types, the per-task count, the size limit
 * and one attachment per blob, then the row, then text extraction (attachmentContents.ts). Shared
 * by `save` below and MCP `attach_file`.
 */
export async function saveTaskAttachmentForAuth(
  ctx: MutationCtx,
  access: TaskAccess,
  file: AttachmentFileInput,
): Promise<Id<"attachments">> {
  const { orgId, userId } = access.auth;
  const taskId = access.task._id;

  // Block dangerous MIME types (XSS prevention)
  if (isMimeTypeBlocked(file.mimeType)) {
    throw new ConvexError("This file type is not allowed");
  }

  // Check file count limit
  const existing = await ctx.db
    .query("attachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .take(MAX_FILES_PER_TASK + 1); // one more than the limit, to check if over
  if (existing.length >= MAX_FILES_PER_TASK) {
    throw new ConvexError(`Maximum ${MAX_FILES_PER_TASK} files per task`);
  }

  // Validate file size (10MB)
  if (file.fileSize > MAX_FILE_SIZE) {
    throw new ConvexError("File exceeds 10MB limit");
  }

  await assertBlobUnattached(ctx, file.fileId);
  const id = await ctx.db.insert("attachments", {
    taskId,
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
  return id;
}

export const save = mutation({
  args: {
    taskId: v.id("tasks"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.taskId);
    return await saveTaskAttachmentForAuth(ctx, access, {
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("attachments") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const att = await ctx.db.get(args.id);
    if (!att || att.orgId !== orgId) throw new ConvexError("Attachment not found");

    if (!isAdmin && att.userId !== userId) {
      throw new ConvexError("You can only delete your own attachments");
    }

    await ctx.storage.delete(att.fileId);
    await deleteContentForStorage(ctx, att.orgId, att.fileId);
    await ctx.db.delete(args.id);
  },
});
