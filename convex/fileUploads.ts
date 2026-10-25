import { v, ConvexError } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { findOrgMembership, getAuthContext, type AuthContext } from "./lib/auth";
import { newUploadId } from "./lib/mcpFiles";
import { readCapped } from "./mcpFileUploads";
import { MAX_FILE_SIZE } from "../lib/attachment";

/**
 * App file uploads (task and comment attachments), bound to the uploader the
 * way MCP uploads are (convex/mcpFileUploads.ts):
 *
 * - `generateUploadUrl` (an action: the uploadId is a capability, and
 *   randomness in queries and mutations is seeded and deterministic) records
 *   an upload row for the caller's org and user under a 192-bit uploadId and
 *   returns `POST /upload?u=<uploadId>` (convex/http.ts).
 * - The endpoint stores the body (at most 10 MB) once, within the hour, the
 *   uploader still a member of the org, and writes the storageId onto the
 *   row. It answers `{ storageId }`, the shape of a Convex upload URL.
 * - `attachments.save` / `commentAttachments.save` call `claimUploadedFile`:
 *   the storageId must be the caller's own upload in this org, within 24 h,
 *   so a storage id learned any other way can never be linked (or later
 *   deleted through the attachment).
 *
 * Editor images keep `attachments.generateUploadUrl`: they are embedded by
 * URL and never attached, so they must not be swept by the cleanup below.
 */

/** An upload URL works for 1 hour after generateUploadUrl. */
export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;
/** An upload must be attached within 24 hours. */
export const UPLOAD_ATTACH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Rows are kept 25 hours (past the attach window), then cleaned up with any unattached blob. */
export const UPLOAD_ROW_TTL_MS = 25 * 60 * 60 * 1000;

/** The save paths' refusal for a storageId that is not the caller's own upload. */
export const UPLOAD_NOT_FOUND = "Upload not found. Upload the file again.";

function uploadUrlFor(uploadId: string): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL is not set");
  return `${site}/upload?u=${encodeURIComponent(uploadId)}`;
}

export const generateUploadUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const uploadId = newUploadId();
    await ctx.runMutation(internal.fileUploads.recordUpload, { uploadId });
    return uploadUrlFor(uploadId);
  },
});

/** The write half of `generateUploadUrl`, as the action's caller (internal: the uploadId is the action's). */
export const recordUpload = internalMutation({
  args: { uploadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { uploadId }) => {
    const { orgId, userId } = await getAuthContext(ctx);
    await ctx.db.insert("fileUploads", { uploadId, orgId, userId, createdAt: Date.now() });
    return null;
  },
});

/**
 * Checks a storageId is the caller's own upload in their org (within 24 h)
 * whose blob still exists, and marks it attached. Run by both app save paths
 * before they link the file; anything else is "not found" (nothing leaks
 * about other users' uploads). One attachment per blob stays
 * `assertBlobUnattached`'s job (attachments.ts).
 */
export async function claimUploadedFile(ctx: MutationCtx, auth: AuthContext, fileId: Id<"_storage">): Promise<void> {
  const now = Date.now();
  const upload = await ctx.db
    .query("fileUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", fileId))
    .unique();
  if (
    !upload ||
    upload.orgId !== auth.orgId ||
    upload.userId !== auth.userId ||
    upload.createdAt <= now - UPLOAD_ATTACH_WINDOW_MS ||
    !(await ctx.db.system.get("_storage", fileId))
  ) {
    throw new ConvexError(UPLOAD_NOT_FOUND);
  }
  if (upload.attachedAt === undefined) await ctx.db.patch(upload._id, { attachedAt: now });
}

// ─── Upload endpoint ──────────────────────────────────────────────────────────

type Slot = { ok: true } | { ok: false; status: number; error: string };

/** The upload row a URL may still fill. */
export const uploadSlot = internalQuery({
  args: { uploadId: v.string(), now: v.number() },
  handler: async (ctx, { uploadId, now }): Promise<Slot> => {
    const row = uploadId
      ? await ctx.db.query("fileUploads").withIndex("by_uploadId", (q) => q.eq("uploadId", uploadId)).unique()
      : null;
    if (!row) return { ok: false, status: 404, error: "Unknown upload URL." };
    // The uploader must still be a member of the org. No details either way.
    const user = await ctx.db.get(row.userId);
    const membership = user && !user.deletedAt ? await findOrgMembership(ctx, row.orgId, user.externalId) : null;
    if (!membership || (membership.userId !== undefined && membership.userId !== row.userId)) {
      return { ok: false, status: 403, error: "Forbidden." };
    }
    if (row.storageId !== undefined) return { ok: false, status: 409, error: "This upload URL was already used." };
    if (row.createdAt + UPLOAD_URL_TTL_MS < now) return { ok: false, status: 410, error: "This upload URL expired." };
    return { ok: true };
  },
});

/** Writes the stored blob onto its row; false when another POST got there first (or it expired meanwhile). */
export const markStored = internalMutation({
  args: { uploadId: v.string(), storageId: v.id("_storage"), now: v.number() },
  handler: async (ctx, { uploadId, storageId, now }): Promise<boolean> => {
    const row = await ctx.db.query("fileUploads").withIndex("by_uploadId", (q) => q.eq("uploadId", uploadId)).unique();
    if (!row || row.storageId !== undefined || row.createdAt + UPLOAD_URL_TTL_MS < now) return false;
    await ctx.db.patch(row._id, { storageId });
    return true;
  },
});

// The browser POSTs from the app's origin. The uploadId in the URL is the
// capability (no cookies or credentials are read), so any origin may call.
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const upload = httpAction(async (ctx, request) => {
  const uploadId = new URL(request.url).searchParams.get("u") ?? "";
  const slot: Slot = await ctx.runQuery(internal.fileUploads.uploadSlot, { uploadId, now: Date.now() });
  if (!slot.ok) return reply(slot.status, { error: slot.error });

  const tooLarge = "File exceeds 10MB limit";
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_FILE_SIZE) return reply(413, { error: tooLarge });
  const chunks = await readCapped(request, MAX_FILE_SIZE);
  if (chunks === null) return reply(413, { error: tooLarge });

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const storageId: Id<"_storage"> = await ctx.storage.store(new Blob(chunks as BlobPart[], { type: contentType }));
  const stored: boolean = await ctx.runMutation(internal.fileUploads.markStored, { uploadId, storageId, now: Date.now() });
  if (!stored) {
    await ctx.storage.delete(storageId);
    return reply(409, { error: "This upload URL was already used." });
  }
  return reply(200, { storageId });
});

/** CORS preflight for `upload` (a typed Content-Type is not a simple request). */
export const uploadPreflight = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/** Rows deleted per run; a full batch schedules the next one right away. */
const CLEANUP_BATCH = 200;

/**
 * Deletes upload rows older than 25 h, oldest first through `by_createdAt` —
 * and the blob of any that was stored but never attached (an attached blob
 * belongs to its attachment row). Runs hourly (crons.ts). The save paths
 * refuse rows past 24 h, so a late cleanup never changes a result.
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - UPLOAD_ROW_TTL_MS;
    const expired = await ctx.db
      .query("fileUploads")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) {
      if (row.storageId !== undefined && row.attachedAt === undefined) {
        if (await ctx.db.system.get("_storage", row.storageId)) await ctx.storage.delete(row.storageId);
      }
      await ctx.db.delete(row._id);
    }
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.fileUploads.cleanupExpired, {});
    }
    return null;
  },
});
