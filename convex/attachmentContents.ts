import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BACKFILL_STAGGER_MS,
  EXTRACT_ATTEMPT_TIMEOUT_MS,
  decideStatus,
  initialDecision,
  isStuck,
} from "../lib/attachments/contents";

/**
 * Attachment contents (docs/prd-mcp.md §10: MCP `fetch` include
 * `attachment_text`; ported from the closed email-triage branch, c3972ab).
 *
 * `requestExtraction` is THE entry point for every source of stored files:
 * the task and comment attachment save paths (attachments.ts,
 * commentAttachments.ts — used by the app and by MCP `attach_file`) call it
 * on save. It is idempotent per (orgId, storageId) — one
 * `attachmentContents` row per file per org — and schedules the node
 * extraction action (`attachmentExtraction.extract`) only for formats it can
 * read.
 *
 * The row has no FK to whatever references the file: readers authorize
 * through the referencing record (task / comment attachment) and then look
 * the content up by the caller's org + storageId (`loadContent`), so a
 * second org referencing the same blob never reads the first org's row.
 *
 * Whoever deletes a referenced blob (`ctx.storage.delete`) also calls
 * `deleteContentForStorage` for the referencing record's org, so extracted
 * text never outlives its file.
 */

type ExtractionRequest = {
  orgId: string;
  storageId: Id<"_storage">;
  mimeType: string;
  /** File name — the extension routes files with a generic mime type. */
  name: string;
};

export async function loadContent(
  ctx: QueryCtx,
  orgId: string,
  storageId: Id<"_storage">,
): Promise<Doc<"attachmentContents"> | null> {
  return await ctx.db
    .query("attachmentContents")
    .withIndex("by_orgId_storageId", (q) => q.eq("orgId", orgId).eq("storageId", storageId))
    .unique();
}

/**
 * Schedule attempt `attempt` after `delayMs` together with its watchdog, in
 * the caller's transaction: if the action never reports back — crashed
 * before or after `beginAttempt`, or timed out — the watchdog's report
 * counts as a transient failure, so the row can't stay `pending` forever.
 * The watchdog is a no-op once the attempt reported (attempt numbers move on).
 */
async function scheduleAttempt(
  ctx: MutationCtx,
  args: { orgId: string; storageId: Id<"_storage">; name: string; attempt: number; delayMs: number },
): Promise<void> {
  const { delayMs, ...ref } = args;
  await ctx.scheduler.runAfter(delayMs, internal.attachmentExtraction.extract, ref);
  await ctx.scheduler.runAfter(delayMs + EXTRACT_ATTEMPT_TIMEOUT_MS, internal.attachmentContents.recordOutcome, {
    ...ref,
    outcome: { kind: "error", reason: "Reading the file timed out", permanent: false },
  });
}

/**
 * Insert (or reuse) the content row for a stored file and queue extraction.
 * Unreadable types and files over 25 MB are recorded as `unsupported` at
 * once, a missing blob as `failed`; nothing is scheduled for them. A row
 * that has been `pending` past its watchdog window (its scheduled work was
 * lost) is re-queued as the next attempt.
 */
export async function requestExtraction(
  ctx: MutationCtx,
  req: ExtractionRequest,
  opts: { delayMs?: number } = {},
): Promise<Id<"attachmentContents">> {
  const delayMs = opts.delayMs ?? 0;
  const now = Date.now();
  const existing = await loadContent(ctx, req.orgId, req.storageId);
  if (existing) {
    if (existing.status === "pending" && isStuck(existing.queuedAt ?? existing.createdAt, now)) {
      const attempt = existing.attempts + 1;
      await ctx.db.patch(existing._id, { attempts: attempt, queuedAt: now + delayMs });
      await scheduleAttempt(ctx, { orgId: req.orgId, storageId: req.storageId, name: req.name, attempt, delayMs });
    }
    return existing._id;
  }

  const meta = await ctx.db.system.get("_storage", req.storageId);
  const decision = initialDecision({ mimeType: req.mimeType, name: req.name, size: meta?.size ?? null });
  const pending = decision.status === "pending";
  const id = await ctx.db.insert("attachmentContents", {
    orgId: req.orgId,
    storageId: req.storageId,
    mimeType: req.mimeType,
    status: decision.status,
    // Attempt 1 is scheduled now; nothing is ever attempted otherwise.
    attempts: pending ? 1 : 0,
    createdAt: now,
    ...(pending ? { queuedAt: now + delayMs } : { error: decision.error, extractedAt: now }),
  });
  if (pending) {
    await scheduleAttempt(ctx, { orgId: req.orgId, storageId: req.storageId, name: req.name, attempt: 1, delayMs });
  }
  return id;
}

/**
 * Drop the extracted content of a file being deleted — call it next to every
 * `ctx.storage.delete` of a referenced file, with the org of the record that
 * referenced it. Only that org's row is removed: a write in one org never
 * touches another org's data. (Attaching refuses a blob that is already
 * referenced anywhere — `assertBlobUnattached` in attachments.ts — so no
 * other org can hold a row for it.)
 */
export async function deleteContentForStorage(ctx: MutationCtx, orgId: string, storageId: Id<"_storage">): Promise<void> {
  const row = await loadContent(ctx, orgId, storageId);
  if (row) await ctx.db.delete(row._id);
}

// ─── Extraction lifecycle (called by the node action) ────────────────────────

const attemptRef = {
  orgId: v.string(),
  storageId: v.id("_storage"),
  name: v.string(),
  attempt: v.number(),
};

/**
 * `attempts` counts attempts SCHEDULED: the row's current attempt number.
 * The action carries the number it runs as, and every step below only acts
 * when it still matches — so a stray duplicate schedule, a late report or
 * the watchdog of an attempt that already reported is a no-op.
 *
 * Begin attempt `attempt`: hand the action what it needs, or null when there
 * is nothing to do (row gone, already final, or a different attempt).
 */
export const beginAttempt = internalMutation({
  args: attemptRef,
  handler: async (
    ctx,
    { orgId, storageId, attempt },
  ): Promise<{ mimeType: string; size: number | null } | null> => {
    const row = await loadContent(ctx, orgId, storageId);
    if (!row || row.status !== "pending" || row.attempts !== attempt) return null;
    const meta = await ctx.db.system.get("_storage", storageId);
    return { mimeType: row.mimeType, size: meta?.size ?? null };
  },
});

export const extractionOutcomeValidator = v.union(
  v.object({
    kind: v.literal("done"),
    text: v.optional(v.string()),
    truncated: v.optional(v.boolean()),
    pageCount: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  }),
  v.object({ kind: v.literal("unsupported"), reason: v.string() }),
  v.object({ kind: v.literal("error"), reason: v.string(), permanent: v.boolean() }),
);

/**
 * Apply an attempt's outcome (`decideStatus`): final statuses are written
 * with `extractedAt`; a transient error under the attempt cap stays
 * `pending`, moves to the next attempt number and schedules it (with its
 * watchdog) after the backoff. Stale reports (the row moved on to a later
 * attempt or a final status) are ignored.
 */
export const recordOutcome = internalMutation({
  args: { ...attemptRef, outcome: extractionOutcomeValidator },
  handler: async (ctx, { orgId, storageId, name, attempt, outcome }): Promise<null> => {
    const row = await loadContent(ctx, orgId, storageId);
    if (!row || row.status !== "pending" || row.attempts !== attempt) return null;
    const decision = decideStatus(outcome, attempt);
    const now = Date.now();
    if (decision.status === "pending") {
      const next = attempt + 1;
      await ctx.db.patch(row._id, { attempts: next, error: decision.error, queuedAt: now + decision.retryInMs });
      await scheduleAttempt(ctx, { orgId, storageId, name, attempt: next, delayMs: decision.retryInMs });
      return null;
    }
    if (decision.status === "done") {
      await ctx.db.patch(row._id, {
        status: "done",
        text: decision.text,
        truncated: decision.truncated,
        pageCount: decision.pageCount,
        width: decision.width,
        height: decision.height,
        error: undefined,
        extractedAt: now,
      });
      return null;
    }
    await ctx.db.patch(row._id, { status: decision.status, error: decision.error, extractedAt: now });
    return null;
  },
});

// ─── Backfill ────────────────────────────────────────────────────────────────

const BACKFILL_BATCH = 50;
const backfillTable = v.union(v.literal("attachments"), v.literal("commentAttachments"));

/**
 * Request extraction for every existing task and comment attachment, one
 * page per transaction, continuing itself via the scheduler (task
 * attachments first, then comment attachments). Extractions are staggered
 * BACKFILL_STAGGER_MS apart, and the next page starts after this page's
 * stagger window, so the backfill never fires a burst of node actions.
 * Idempotent: files that already have a row are skipped by
 * `requestExtraction`.
 *
 * Run: npx convex run attachmentContents:backfillExtractions '{}'
 */
export const backfillExtractions = internalMutation({
  args: {
    table: v.optional(backfillTable),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args): Promise<{ table: string; requested: number; isDone: boolean }> => {
    const table = args.table ?? "attachments";
    const paginationOpts = args.paginationOpts ?? { numItems: BACKFILL_BATCH, cursor: null };
    const page =
      table === "attachments"
        ? await ctx.db.query("attachments").paginate(paginationOpts)
        : await ctx.db.query("commentAttachments").paginate(paginationOpts);
    for (const [i, row] of page.page.entries()) {
      await requestExtraction(
        ctx,
        { orgId: row.orgId, storageId: row.fileId, mimeType: row.mimeType, name: row.fileName },
        { delayMs: i * BACKFILL_STAGGER_MS },
      );
    }
    const nextPageAfter = page.page.length * BACKFILL_STAGGER_MS;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(nextPageAfter, internal.attachmentContents.backfillExtractions, {
        table,
        paginationOpts: { numItems: paginationOpts.numItems, cursor: page.continueCursor },
      });
    } else if (table === "attachments") {
      await ctx.scheduler.runAfter(nextPageAfter, internal.attachmentContents.backfillExtractions, {
        table: "commentAttachments",
        paginationOpts: { numItems: paginationOpts.numItems, cursor: null },
      });
    }
    return { table, requested: page.page.length, isDone: page.isDone && table === "commentAttachments" };
  },
});
