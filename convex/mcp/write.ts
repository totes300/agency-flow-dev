import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { assertBatch, mcpActor, recordIdempotent, replayIdempotent, requestFingerprint } from "../lib/mcpWrites";
import { saveTasks as saveTaskItems } from "../lib/mcpSaveTasks";
import { saveComments as saveCommentItems } from "../lib/mcpSaveComments";
import { deleteRecords } from "../lib/mcpDelete";
import { saveTimeEntries as saveTimeEntryItems } from "../lib/mcpSaveTimeEntries";
import { saveClients as saveClientItems } from "../lib/mcpSaveClients";
import { saveProjects as saveProjectItems } from "../lib/mcpSaveProjects";
import { savePlan as savePlanItems } from "../lib/mcpSavePlan";
import { saveDailyNote } from "../lib/mcpSaveDailyNotes";
import { markRead as markReadRefs } from "../lib/mcpInbox";
import { billingTypeValidator } from "../lib/validators";

/**
 * MCP write tools (docs/prd-mcp.md §6). Each mutation calls
 * `getMcpAuthContext` first (I1) and takes no org, user or role argument
 * (I2). One tool call = one mutation = one transaction (I5). Writes run the
 * app's own write paths as the caller (D3, D16).
 *
 * - `idempotencyKey` (D23): checked and recorded in the same mutation; a
 *   replay of the same request returns the first result (`replayed: true`)
 *   and writes nothing; the same key with different arguments is refused.
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
        archived: v.optional(v.boolean()),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("save_tasks", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_tasks", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveTaskItems(ctx, auth, args.items, now);
    await recordIdempotent(ctx, auth, "save_tasks", args.idempotencyKey, fingerprint, result, now);
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
    const fingerprint = requestFingerprint("save_comments", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_comments", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveCommentItems(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "save_comments", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

export const saveTimeEntries = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        task: v.optional(v.string()),
        date: v.optional(v.string()),
        minutes: v.optional(v.number()),
        note: v.optional(v.union(v.string(), v.null())),
        category: v.optional(v.string()),
        billable: v.optional(v.boolean()),
        member: v.optional(v.string()),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("save_time_entries", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_time_entries", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveTimeEntryItems(ctx, auth, args.items, now);
    await recordIdempotent(ctx, auth, "save_time_entries", args.idempotencyKey, fingerprint, result, now);
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
    const fingerprint = requestFingerprint("delete", { refs: args.refs, deleteTimeEntries: args.deleteTimeEntries ?? false });
    const replay = await replayIdempotent(ctx, auth, "delete", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.refs.length, "ref");
    const result = await deleteRecords(ctx, auth, args.refs, { deleteTimeEntries: args.deleteTimeEntries ?? false });
    await recordIdempotent(ctx, auth, "delete", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

const nullableText = v.optional(v.union(v.string(), v.null()));

/** Clients (admins only, as in the app): convex/lib/mcpSaveClients.ts. */
export const saveClients = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        name: v.optional(v.string()),
        currency: v.optional(v.string()),
        prefix: v.optional(v.string()),
        usePrefix: v.optional(v.boolean()),
        billingName: nullableText,
        billingEmail: nullableText,
        billingCountry: nullableText,
        billingCity: nullableText,
        billingZip: nullableText,
        billingStreet: nullableText,
        billingStreet2: nullableText,
        taxId: nullableText,
        notes: nullableText,
        archived: v.optional(v.boolean()),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("save_clients", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_clients", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveClientItems(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "save_clients", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** Projects (admins only, as in the app): convex/lib/mcpSaveProjects.ts. */
export const saveProjects = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        name: v.optional(v.string()),
        client: v.optional(v.string()),
        code: v.optional(v.string()),
        billingType: v.optional(billingTypeValidator),
        fixedFee: v.optional(v.number()),
        includedMinutes: v.optional(v.number()),
        monthlyFee: v.optional(v.number()),
        overageRate: v.optional(v.number()),
        startDate: v.optional(v.string()),
        cycleLength: v.optional(v.number()),
        rollover: v.optional(v.boolean()),
        retainerActive: v.optional(v.boolean()),
        estimates: v.optional(v.array(v.object({ category: v.string(), minutes: v.number() }))),
        rates: v.optional(v.array(v.object({ category: v.string(), rate: v.union(v.number(), v.null()) }))),
        team: v.optional(v.array(v.string())),
        archived: v.optional(v.boolean()),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("save_projects", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_projects", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await saveProjectItems(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "save_projects", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** Planner bars: convex/lib/mcpSavePlan.ts. */
export const savePlan = mutation({
  args: {
    items: v.array(
      v.object({
        ref: v.optional(v.string()),
        task: v.optional(v.string()),
        member: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("save_plan", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "save_plan", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await savePlanItems(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "save_plan", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** The caller's own daily note for a date: convex/lib/mcpSaveDailyNotes.ts. */
export const saveDailyNotes = mutation({
  args: {
    date: v.optional(v.string()),
    content: v.string(),
    append: v.optional(v.boolean()),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    // Appending is the default: replacing a note's text needs append: false.
    const request = { date: args.date, content: args.content, append: args.append ?? true };
    const fingerprint = requestFingerprint("save_daily_notes", request);
    const replay = await replayIdempotent(ctx, auth, "save_daily_notes", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await saveDailyNote(ctx, auth, request, now);
    await recordIdempotent(ctx, auth, "save_daily_notes", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** Inbox items, tasks (their comments and changes) or the whole inbox read: convex/lib/mcpInbox.ts. */
export const markRead = mutation({
  args: {
    refs: v.array(v.string()),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("mark_read", { refs: args.refs });
    const replay = await replayIdempotent(ctx, auth, "mark_read", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.refs.length, "ref");
    const result = await markReadRefs(ctx, auth, args.refs, now);
    await recordIdempotent(ctx, auth, "mark_read", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});
