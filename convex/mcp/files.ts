import { v } from "convex/values";
import { action, internalMutation, mutation, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { recordIdempotent, replayIdempotent, requestFingerprint } from "../lib/mcpWrites";
import { attachFile, createUpload as createUploadCore, prepareInlineText } from "../lib/mcpFiles";
import type { AttachFileResult } from "../lib/mcpWriteResults";

/**
 * MCP file tools (docs/prd-mcp.md D18, §10): `create_upload` and
 * `attach_file` (convex/lib/mcpFiles.ts). Each function calls
 * `getMcpAuthContext` first (I1) and takes no org, user or role argument
 * (I2); `idempotencyKey` (D23) is checked and recorded in the mutation that
 * writes. Attachments record no activity in the app, so no `clientName`
 * (via, D15) is taken.
 */

/** `create_upload`: a Convex upload URL for one announced file. */
export const createUpload = mutation({
  args: {
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    const now = Date.now();
    const request = { filename: args.filename, contentType: args.contentType, sizeBytes: args.sizeBytes };
    const fingerprint = requestFingerprint("create_upload", request);
    const replay = await replayIdempotent(ctx, auth, "create_upload", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await createUploadCore(
      ctx,
      auth,
      { fileName: args.filename, contentType: args.contentType, sizeBytes: args.sizeBytes },
      now,
    );
    await recordIdempotent(ctx, auth, "create_upload", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** `attach_file` with the uploadId of a create_upload whose bytes were POSTed. */
export const attach = mutation({
  args: {
    ref: v.string(),
    uploadId: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    const now = Date.now();
    const fingerprint = requestFingerprint("attach_file", { ref: args.ref, uploadId: args.uploadId });
    const replay = await replayIdempotent(ctx, auth, "attach_file", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await attachFile(ctx, auth, args.ref, { kind: "upload", uploadId: args.uploadId }, now);
    await recordIdempotent(ctx, auth, "attach_file", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/**
 * `attach_file` with inline text: stored here as a UTF-8 text file (only
 * actions can store blobs), then attached by `attachStoredText` in one
 * mutation. Store and attach are one flow: if the attach fails for any
 * reason, or is an idempotent replay, the blob this call stored is deleted
 * before the call returns. Residual risk (accepted): if the action itself
 * dies between `storage.store` and that cleanup (a crash or timeout in a
 * window of milliseconds), one unreferenced text blob of at most 200 KiB
 * stays in storage; nothing references or reveals its ID.
 */
export const attachText = action({
  args: {
    ref: v.string(),
    inlineText: v.string(),
    filename: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await getMcpAuthContext(ctx);
    const file = prepareInlineText(args.inlineText, args.filename);
    const fingerprint = requestFingerprint("attach_file", { ref: args.ref, inlineText: args.inlineText, filename: args.filename });
    const storageId = await ctx.storage.store(new Blob([args.inlineText], { type: file.blobType }));
    let result: AttachFileResult & { replayed: boolean };
    try {
      result = await ctx.runMutation(internal.mcp.files.attachStoredText, {
        ref: args.ref,
        storageId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fingerprint,
        idempotencyKey: args.idempotencyKey,
      });
    } catch (error) {
      await discardBlob(ctx, storageId);
      throw error;
    }
    if (result.replayed) await discardBlob(ctx, storageId);
    return result;
  },
});

/** Deletes a blob this call stored; a failed delete is logged, never hides the call's own result or error. */
async function discardBlob(ctx: ActionCtx, storageId: Id<"_storage">): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    console.error("[mcp] attach_file could not delete an unattached inline blob");
  }
}

/** The attach half of `attachText`, as the action's caller (internal: the blob is the action's own). */
export const attachStoredText = internalMutation({
  args: {
    ref: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    fingerprint: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    const now = Date.now();
    const replay = await replayIdempotent(ctx, auth, "attach_file", args.idempotencyKey, args.fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await attachFile(
      ctx,
      auth,
      args.ref,
      { kind: "inline", storageId: args.storageId, fileName: args.fileName, mimeType: args.mimeType },
      now,
    );
    await recordIdempotent(ctx, auth, "attach_file", args.idempotencyKey, args.fingerprint, result, now);
    return { ...result, replayed: false };
  },
});
