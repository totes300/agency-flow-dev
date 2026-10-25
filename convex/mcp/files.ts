import { v } from "convex/values";
import { action, internalMutation, mutation } from "../_generated/server";
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

/** `attach_file` with a storageId from create_upload's upload. */
export const attach = mutation({
  args: {
    ref: v.string(),
    storageId: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    const now = Date.now();
    const fingerprint = requestFingerprint("attach_file", { ref: args.ref, storageId: args.storageId });
    const replay = await replayIdempotent(ctx, auth, "attach_file", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await attachFile(ctx, auth, args.ref, { kind: "upload", storageId: args.storageId }, now);
    await recordIdempotent(ctx, auth, "attach_file", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/**
 * `attach_file` with inline text: stored here as a UTF-8 text file (only
 * actions can store blobs), then attached by `attachStoredText` in one
 * mutation. A failed attach or an idempotent replay deletes the blob this
 * call stored, so nothing is left behind.
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
    try {
      const result: AttachFileResult & { replayed: boolean } = await ctx.runMutation(internal.mcp.files.attachStoredText, {
        ref: args.ref,
        storageId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fingerprint,
        idempotencyKey: args.idempotencyKey,
      });
      if (result.replayed) await ctx.storage.delete(storageId);
      return result;
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

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
