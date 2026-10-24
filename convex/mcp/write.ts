import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { assertBatch, mcpActor, recordIdempotent, replayIdempotent } from "../lib/mcpWrites";
import { saveTasks as saveTaskItems } from "../lib/mcpSaveTasks";
import { saveComments as saveCommentItems } from "../lib/mcpSaveComments";
import { deleteRecords } from "../lib/mcpDelete";

/**
 * MCP write tools (docs/prd-mcp.md §6). Each mutation calls
 * `getMcpAuthContext` first (I1) and takes no org, user or role argument
 * (I2). One tool call = one mutation = one transaction (I5). Writes run the
 * app's own write paths as the caller (D3, D16).
 *
 * - `idempotencyKey` (D23): checked and recorded in the same mutation; a
 *   replay returns the first result (`replayed: true`) and writes nothing.
 * - `clientName`: the OAuth client's display name for "via <client>" (D15),
 *   resolved by the Next.js route. Display text only — sanitized and capped
 *   (lib/mcp/client-name.ts), never used for authorization; the client's
 *   identity (`clientId`) comes from the verified token.
 */

// Args are spelled out per function (no spreads) so the I2 source check
// (convex/__tests__/mcpInvariants.test.ts) sees every argument name.

export const saveTasks = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        project: v.optional(v.union(v.string(), v.null())),
        parent: v.optional(v.string()),
        status: v.optional(v.string()),
        done: v.optional(v.boolean()),
        after: v.optional(v.string()),
        before: v.optional(v.string()),
        assignees: v.optional(v.array(v.string())),
        labels: v.optional(v.array(v.string())),
        priority: v.optional(
          v.union(v.literal("none"), v.literal("urgent"), v.literal("high"), v.literal("medium"), v.literal("low")),
        ),
        startDate: v.optional(v.union(v.string(), v.null())),
        dueDate: v.optional(v.union(v.string(), v.null())),
        estimateMinutes: v.optional(v.union(v.number(), v.null())),
        category: v.optional(v.union(v.string(), v.null())),
        externalRefs: v.optional(v.array(v.string())),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const replay = await replayIdempotent(ctx, auth, "save_tasks", args.idempotencyKey, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveTaskItems(ctx, auth, args.items, now);
    await recordIdempotent(ctx, auth, "save_tasks", args.idempotencyKey, result, now);
    return { ...result, replayed: false };
  },
});

export const saveComments = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        task: v.optional(v.string()),
        replyTo: v.optional(v.string()),
        body: v.string(),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const replay = await replayIdempotent(ctx, auth, "save_comments", args.idempotencyKey, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveCommentItems(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "save_comments", args.idempotencyKey, result, now);
    return { ...result, replayed: false };
  },
});

export const remove = mutation({
  args: {
    refs: v.array(v.string()),
    deleteTimeEntries: v.optional(v.boolean()),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const replay = await replayIdempotent(ctx, auth, "delete", args.idempotencyKey, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.refs.length, "ref");
    const result = await deleteRecords(ctx, auth, args.refs, { deleteTimeEntries: args.deleteTimeEntries ?? false });
    await recordIdempotent(ctx, auth, "delete", args.idempotencyKey, result, now);
    return { ...result, replayed: false };
  },
});
