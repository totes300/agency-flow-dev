import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver } from "./mcpRefs";
import { isMimeTypeBlocked } from "./content_validation";
import { loadTaskForWrite } from "../tasks/access";
import { saveTaskAttachmentForAuth, type AttachmentFileInput } from "../attachments";
import { MAX_FILE_NAME_LENGTH, saveCommentAttachmentForAuth } from "../commentAttachments";
import { loadContent } from "../attachmentContents";
import type { AttachFileResult, CreateUploadResult } from "./mcpWriteResults";
import { MAX_FILE_SIZE } from "../../lib/attachment";
import { INLINE_TEXT_MAX_BYTES, UPLOAD_ATTACH_WINDOW_MS, UPLOAD_URL_TTL_MS } from "../../lib/mcp/limits";
import { parseRef } from "../../lib/mcp/refs";

/**
 * MCP files (docs/prd-mcp.md D18, §10), on Convex storage like the app:
 *
 * - `create_upload` checks the file against the app's limits (10 MB, the
 *   blocked types), records the announcement (`mcpUploads`) and returns a
 *   Convex upload URL; the client POSTs the bytes and gets a `storageId`.
 * - `attach_file` attaches a storageId — only one this user announced with
 *   create_upload in this org (same size and type, uploaded within the URL's
 *   hour, used once), so no other storage object can be attached (I3) — or
 *   inline text (≤ 200 KiB, stored by the `mcp/files:attachText` action as a
 *   text file). Both go through the app's attachment write paths
 *   (attachments.ts / commentAttachments.ts `save*ForAuth`): the same
 *   limits, rows and text extraction as an upload in the app.
 * - Who may attach: a task — whoever may write it (admins; members on tasks
 *   assigned to them or their parent), as the app; a comment — only its
 *   author: in the app files are added to a comment while writing it.
 *
 * The server never downloads a URL (§10). The app writes no activity row for
 * attachments, so nothing here carries `via` (D15).
 */

const NO_UPLOAD =
  "This storageId does not match a file you announced with create_upload in the last 24 hours. Call create_upload, POST the bytes to its uploadUrl (within the hour), then attach the storageId it returns.";

/** A file name the app can show: trimmed, 1–255 characters, no control characters. */
export function checkFileName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new ConvexError("filename is empty.");
  if (name.length > MAX_FILE_NAME_LENGTH) throw new ConvexError(`filename is longer than ${MAX_FILE_NAME_LENGTH} characters.`);
  if (/\p{Cc}/u.test(name)) throw new ConvexError("filename contains control characters.");
  return name;
}

/** `type/subtype` without parameters, lowercased. */
function baseMimeType(raw: string): string {
  return raw.split(";")[0].trim().toLowerCase();
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `create_upload`: checks the announced file, records it and returns the upload URL. */
export async function createUpload(
  ctx: MutationCtx,
  auth: McpAuthContext,
  input: { fileName: string; contentType: string; sizeBytes: number },
  now: number,
): Promise<CreateUploadResult> {
  const fileName = checkFileName(input.fileName);
  const contentType = baseMimeType(input.contentType);
  if (!MIME_TYPE.test(contentType)) {
    throw new ConvexError('contentType must be a MIME type such as "application/pdf" or "image/png".');
  }
  if (isMimeTypeBlocked(contentType)) {
    throw new ConvexError("This file type is not allowed (as in the app). Attach text content as inlineText instead.");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw new ConvexError("sizeBytes must be the file's size in bytes (at least 1: empty files are refused, as in the app).");
  }
  if (input.sizeBytes > MAX_FILE_SIZE) throw new ConvexError("File exceeds 10MB limit (as in the app).");

  const uploadUrl = await ctx.storage.generateUploadUrl();
  await ctx.db.insert("mcpUploads", {
    orgId: auth.orgId,
    userId: auth.userId,
    fileName,
    contentType,
    sizeBytes: input.sizeBytes,
    createdAt: now,
  });
  return {
    tool: "create_upload",
    uploadUrl,
    fileName,
    contentType,
    sizeBytes: input.sizeBytes,
    expiresAt: now + UPLOAD_URL_TTL_MS,
  };
}

/**
 * The announced upload a storageId belongs to, marked used. Only this user's
 * uploads in this org qualify: the blob must have the announced size (and
 * type, when the POST sent one) and have been uploaded after the
 * announcement, within the URL's hour. Anything else — another org's blob,
 * an app upload, a reused storageId — is refused without saying why it
 * does not match (nothing leaks about other records).
 */
async function claimUpload(ctx: MutationCtx, auth: McpAuthContext, raw: string, now: number): Promise<AttachmentFileInput> {
  const storageId = ctx.db.system.normalizeId("_storage", raw.trim());
  const meta = storageId ? await ctx.db.system.get("_storage", storageId) : null;
  if (!storageId || !meta) throw new ConvexError(NO_UPLOAD);
  const used = await ctx.db
    .query("mcpUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
  if (used) {
    throw new ConvexError(
      used.orgId === auth.orgId && used.userId === auth.userId
        ? "This upload is already attached; each upload attaches once. Call create_upload again to attach another copy."
        : NO_UPLOAD,
    );
  }
  const announced = await ctx.db
    .query("mcpUploads")
    .withIndex("by_orgId_userId_createdAt", (q) =>
      q.eq("orgId", auth.orgId).eq("userId", auth.userId).gte("createdAt", now - UPLOAD_ATTACH_WINDOW_MS),
    )
    .order("desc")
    .take(100);
  const inWindow = announced.filter(
    (u) => u.storageId === undefined && meta._creationTime >= u.createdAt && meta._creationTime <= u.createdAt + UPLOAD_URL_TTL_MS,
  );
  const upload = inWindow.find((u) => u.sizeBytes === meta.size);
  if (!upload) {
    const sizes = [...new Set(inWindow.map((u) => u.sizeBytes))];
    throw new ConvexError(
      sizes.length > 0
        ? `The uploaded file is ${meta.size} bytes, but create_upload announced ${sizes.join(" or ")}. Announce the exact size and upload again.`
        : NO_UPLOAD,
    );
  }
  if (meta.contentType !== undefined && baseMimeType(meta.contentType) !== upload.contentType) {
    throw new ConvexError(
      `The file was uploaded as ${baseMimeType(meta.contentType) || "an unknown type"}, but create_upload announced ${upload.contentType}. Upload again with the header Content-Type: ${upload.contentType}.`,
    );
  }
  await ctx.db.patch(upload._id, { storageId });
  return { fileId: storageId, fileName: upload.fileName, fileSize: meta.size, mimeType: upload.contentType };
}

/** Inline text as a file: what the action stores and the attach path saves. */
export type InlineTextFile = { sizeBytes: number; fileName: string; mimeType: string; blobType: string };

const TEXT_MIME_BY_EXTENSION: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", csv: "text/csv" };

/**
 * `attach_file` inline text, checked before it is stored: not empty, at most
 * 200 KiB of UTF-8, a valid file name. The type follows the extension
 * (.md → text/markdown, .csv → text/csv, otherwise text/plain); the blob is
 * served as UTF-8.
 */
export function prepareInlineText(text: string, rawFileName: string): InlineTextFile {
  const fileName = checkFileName(rawFileName);
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes === 0) throw new ConvexError("inlineText is empty (empty files are refused, as in the app).");
  if (sizeBytes > INLINE_TEXT_MAX_BYTES) {
    throw new ConvexError(
      `inlineText is ${sizeBytes} bytes; at most ${INLINE_TEXT_MAX_BYTES} (200 KiB) are accepted. Upload larger files with create_upload.`,
    );
  }
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const mimeType = TEXT_MIME_BY_EXTENSION[extension] ?? "text/plain";
  return { sizeBytes, fileName, mimeType, blobType: `${mimeType}; charset=utf-8` };
}

export type AttachSource =
  /** A storageId the client uploaded after create_upload (checked against mcpUploads). */
  | { kind: "upload"; storageId: string }
  /** Inline text the `attachText` action stored itself (trusted: internal callers only). */
  | { kind: "inline"; storageId: Id<"_storage">; fileName: string; mimeType: string };

/**
 * `attach_file`: resolves the target (a task by any task ref, incl. external
 * refs, or a comment by ID / link) in the caller's org (I3), then saves the
 * file through the app's attachment write path for that target.
 */
export async function attachFile(
  ctx: MutationCtx,
  auth: McpAuthContext,
  ref: string,
  source: AttachSource,
  now: number,
): Promise<AttachFileResult> {
  const resolver = createRefResolver(ctx, auth);
  const parsed = parseRef(ref);
  const isComment =
    parsed.ok &&
    parsed.ref.kind === "id" &&
    (parsed.ref.table === "comments" || (parsed.ref.table === undefined && ctx.db.normalizeId("comments", parsed.ref.id) !== null));
  const target = await resolver.require(ref, isComment ? "comment" : "task");

  async function file(): Promise<AttachmentFileInput> {
    if (source.kind === "upload") return await claimUpload(ctx, auth, source.storageId, now);
    const meta = await ctx.db.system.get("_storage", source.storageId);
    if (!meta) throw new Error("Inline text blob is missing");
    return { fileId: source.storageId, fileName: source.fileName, fileSize: meta.size, mimeType: source.mimeType };
  }

  let saved: { attachmentId: string; target: AttachFileResult["target"]; file: AttachmentFileInput };
  if (target.type === "task") {
    const access = await loadTaskForWrite(ctx, target.access.task._id, auth);
    const input = await file();
    const attachmentId = await saveTaskAttachmentForAuth(ctx, access, input);
    saved = {
      attachmentId,
      target: { type: "task", task: access.task.identifier ?? access.task._id, title: access.task.title },
      file: input,
    };
  } else if (target.type === "comment") {
    if (target.comment.userId !== auth.userId) {
      throw new ConvexError(
        "You can attach files only to your own comments (in the app, files are added while writing a comment). Attach it to the task instead, or post a new comment and attach to that.",
      );
    }
    const input = await file();
    const { id } = await saveCommentAttachmentForAuth(ctx, auth, target.comment._id, input);
    saved = {
      attachmentId: id,
      target: {
        type: "comment",
        task: target.access.task.identifier ?? target.access.task._id,
        title: target.access.task.title,
        commentId: target.comment._id,
      },
      file: input,
    };
  } else {
    throw new Error(`Expected a task or comment, resolved a ${target.type}`);
  }

  const content = await loadContent(ctx, auth.orgId, saved.file.fileId);
  return {
    tool: "attach_file",
    target: saved.target,
    file: { name: saved.file.fileName, sizeBytes: saved.file.fileSize, mimeType: saved.file.mimeType },
    attachmentId: saved.attachmentId,
    textStatus: content?.status ?? "pending",
  };
}
