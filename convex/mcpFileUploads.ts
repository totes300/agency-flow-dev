import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { baseMimeType } from "./lib/mcpFiles";
import { UPLOAD_ROW_TTL_MS, UPLOAD_URL_TTL_MS } from "../lib/mcp/limits";

/**
 * The MCP upload endpoint (docs/prd-mcp.md D18, §10): `POST
 * /mcp-upload?u=<uploadId>` (convex/http.ts). `create_upload` announced the
 * file (name, type, size) under an unguessable uploadId; this endpoint
 * stores exactly those bytes, once:
 *
 * - the uploadId must name an announcement that is not yet stored and not
 *   older than the URL's hour;
 * - the request's Content-Type must be the announced type;
 * - the body is read with a cap and must be exactly the announced size
 *   (larger bodies are cut off as soon as they pass it; the app limit is
 *   10 MB, Convex HTTP actions accept 20 MB);
 * - the blob is stored and its storageId written onto the announcement
 *   (`markStored`); a racing second POST loses and its blob is deleted.
 *
 * The response carries nothing secret (no storageId): the client attaches
 * with attach_file(uploadId). Errors only ever describe the caller's own
 * announcement. The URL itself is the capability (no bearer token: a shell
 * POST from Claude Code or Codex has none), so it is single-use and expires.
 */

type Slot =
  | { ok: true; contentType: string; sizeBytes: number }
  | { ok: false; status: number; error: string };

const UNKNOWN = "Unknown upload URL. Call create_upload to get a new one.";

/** The announcement an upload URL may still fill. */
export const uploadSlot = internalQuery({
  args: { uploadId: v.string(), now: v.number() },
  handler: async (ctx, { uploadId, now }): Promise<Slot> => {
    const row = uploadId
      ? await ctx.db.query("mcpFileUploads").withIndex("by_uploadId", (q) => q.eq("uploadId", uploadId)).unique()
      : null;
    if (!row) return { ok: false, status: 404, error: UNKNOWN };
    if (row.storageId !== undefined) return { ok: false, status: 409, error: "This upload URL was already used. Call create_upload for a new one." };
    if (row.createdAt + UPLOAD_URL_TTL_MS < now) {
      return { ok: false, status: 410, error: "This upload URL expired (they work for 1 hour). Call create_upload again." };
    }
    return { ok: true, contentType: row.contentType, sizeBytes: row.sizeBytes };
  },
});

/** Writes the stored blob onto its announcement; false when another POST got there first (or it expired meanwhile). */
export const markStored = internalMutation({
  args: { uploadId: v.string(), storageId: v.id("_storage"), now: v.number() },
  handler: async (ctx, { uploadId, storageId, now }): Promise<boolean> => {
    const row = await ctx.db.query("mcpFileUploads").withIndex("by_uploadId", (q) => q.eq("uploadId", uploadId)).unique();
    if (!row || row.storageId !== undefined || row.createdAt + UPLOAD_URL_TTL_MS < now) return false;
    await ctx.db.patch(row._id, { storageId, storedAt: now });
    return true;
  },
});

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Reads at most `max` bytes of the body; null when it is longer. */
async function readCapped(request: Request, max: number): Promise<Uint8Array[] | null> {
  const chunks: Uint8Array[] = [];
  if (!request.body) return chunks;
  const reader = request.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

export const upload = httpAction(async (ctx, request) => {
  const uploadId = new URL(request.url).searchParams.get("u") ?? "";
  const slot: Slot = await ctx.runQuery(internal.mcpFileUploads.uploadSlot, { uploadId, now: Date.now() });
  if (!slot.ok) return reply(slot.status, { error: slot.error });

  const sent = baseMimeType(request.headers.get("content-type") ?? "");
  if (sent !== slot.contentType) {
    return reply(415, { error: `Send the header Content-Type: ${slot.contentType} (the type given to create_upload).` });
  }
  const sizeError = `The body must be exactly ${slot.sizeBytes} bytes (the size given to create_upload).`;
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) !== slot.sizeBytes) return reply(413, { error: sizeError });
  const chunks = await readCapped(request, slot.sizeBytes);
  const received = chunks?.reduce((sum, c) => sum + c.byteLength, 0) ?? null;
  if (chunks === null || received !== slot.sizeBytes) return reply(chunks === null ? 413 : 400, { error: sizeError });

  const storageId: Id<"_storage"> = await ctx.storage.store(new Blob(chunks as BlobPart[], { type: slot.contentType }));
  const stored: boolean = await ctx.runMutation(internal.mcpFileUploads.markStored, { uploadId, storageId, now: Date.now() });
  if (!stored) {
    await ctx.storage.delete(storageId);
    return reply(409, { error: "This upload URL was already used. Call create_upload for a new one." });
  }
  return reply(200, { uploaded: true, sizeBytes: slot.sizeBytes, next: "Call attach_file with this upload's uploadId." });
});

/** Rows deleted per run; a full batch schedules the next one right away. */
const CLEANUP_BATCH = 200;

/**
 * Deletes upload announcements older than 25 h (docs/prd-mcp.md §10),
 * oldest first through `by_createdAt` — and the blob of any that was stored
 * but never attached (an attached blob belongs to its attachment row). Runs
 * hourly (crons.ts). attach_file refuses rows past 24 h, so a late cleanup
 * never changes a result.
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - UPLOAD_ROW_TTL_MS;
    const expired = await ctx.db
      .query("mcpFileUploads")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) {
      if (row.storageId !== undefined && row.attachedAt === undefined) {
        if (await ctx.db.system.get("_storage", row.storageId)) await ctx.storage.delete(row.storageId);
      }
      await ctx.db.delete(row._id);
    }
    if (expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.mcpFileUploads.cleanupExpired, {});
    }
    return null;
  },
});
