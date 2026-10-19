import { mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";

/**
 * Composer file uploads (slice 07, US 15/17). The client uploads an accepted
 * txt/csv straight to Convex storage and passes the resulting storageId to
 * `startRun`, which reads the blob and extracts its text server-side at run
 * time. There is no persisted attachment record — the file is ephemeral run
 * input, not a stored artifact (deferral noted in the backlog).
 *
 * File-type gating happens on the client BEFORE upload (nothing unsupported
 * ever reaches storage) and again in the runner defensively; this only mints
 * the authed upload URL.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Auth-gate the URL: only a signed-in org member can upload.
    await getAuthContext(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
