"use node";

// Node runtime: `mammoth` (DOCX) needs Node's `Buffer`, and the unpdf / pdf.js
// build is only exercised on Node here. This file exports ONLY the action;
// the row lifecycle (queries/mutations) lives in `attachmentContents.ts`.

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  EXTRACT_MAX_BYTES,
  FILE_MISSING,
  TOO_LARGE,
  UNSUPPORTED_TYPE,
  describeExtractionError,
  routeFormat,
  type ExtractionOutcome,
} from "../lib/attachments/contents";
import { extractFileContent } from "../lib/attachments/extract";

/**
 * Read one stored file (docs/prd-mcp.md §10): PDF → text + page count (unpdf), DOCX → raw text
 * (mammoth), TXT / MD / CSV / text/* → UTF-8, images → width × height
 * (image-size). Scheduled by `requestExtraction` and by the retry path of
 * `attachmentContents.recordOutcome`; never throws on a bad file — every
 * failure becomes an outcome the status decision turns into retry / failed.
 */
export const extract = internalAction({
  args: { orgId: v.string(), storageId: v.id("_storage"), name: v.string(), attempt: v.number() },
  handler: async (ctx, ref): Promise<null> => {
    const claim = await ctx.runMutation(internal.attachmentContents.beginAttempt, ref);
    if (!claim) return null;

    const outcome = await readOutcome(ctx, ref.storageId, ref.name, claim);
    await ctx.runMutation(internal.attachmentContents.recordOutcome, { ...ref, outcome });
    return null;
  },
});

async function readOutcome(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  name: string,
  claim: { mimeType: string; size: number | null },
): Promise<ExtractionOutcome> {
  const format = routeFormat(claim.mimeType, name);
  if (format === "unsupported") return { kind: "unsupported", reason: UNSUPPORTED_TYPE };
  if (claim.size === null) return { kind: "error", reason: FILE_MISSING, permanent: true };
  if (claim.size > EXTRACT_MAX_BYTES) return { kind: "unsupported", reason: TOO_LARGE };
  try {
    const blob = await ctx.storage.get(storageId);
    if (!blob) return { kind: "error", reason: FILE_MISSING, permanent: true };
    return await extractFileContent(new Uint8Array(await blob.arrayBuffer()), format);
  } catch (err) {
    return { kind: "error", ...describeExtractionError(err) };
  }
}
