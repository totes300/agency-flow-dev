import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { mcpActor, recordIdempotent, replayIdempotent, requestFingerprint } from "../lib/mcpWrites";
import { startTimer, stopTimer, timerState } from "../lib/mcpTimer";
import { orgClock } from "../lib/mcpRecords";

/**
 * MCP `timer` (docs/prd-mcp.md §6): start, stop and status of the caller's
 * own timer. Each function calls `getMcpAuthContext` first (I1) and takes no
 * org, user or role argument (I2). Start and stop take an `idempotencyKey`
 * (D23) checked and recorded in the same mutation, and `clientName` for
 * "via <client>" (D15; display text only, see convex/mcp/write.ts).
 */

export const start = mutation({
  args: {
    task: v.string(),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("timer", { action: "start", task: args.task });
    const replay = await replayIdempotent(ctx, auth, "timer", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await startTimer(ctx, auth, args.task);
    await recordIdempotent(ctx, auth, "timer", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

export const stop = mutation({
  args: {
    note: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("timer", { action: "stop", note: args.note ?? null });
    const replay = await replayIdempotent(ctx, auth, "timer", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    const result = await stopTimer(ctx, auth, args.note);
    await recordIdempotent(ctx, auth, "timer", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});

/** `now` comes from the route: queries take the clock as an argument. */
export const status = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    const { timezone } = await orgClock(ctx, auth.orgId, args.now);
    return { timer: await timerState(ctx, auth, args.now), timezone };
  },
});
