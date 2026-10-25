import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { assertBatch, mcpActor, recordIdempotent, replayIdempotent, requestFingerprint } from "../lib/mcpWrites";
import { inviteCheck as checkInvites } from "../lib/mcpMembers";

/**
 * MCP `invite_members`, the Convex half (docs/prd-mcp.md §6, D-INVITE). Calls
 * `getMcpAuthContext` first (I1) and takes no org, user or role argument of
 * the caller (I2): `role` below is the invitee's. Admin only; the result
 * tells the Next.js route which emails to invite through Clerk and carries
 * the verified org and inviter. The idempotency key is recorded here with
 * the verdicts (D23), so a replay returns them and the route sends nothing
 * to Clerk again.
 */
export const inviteCheck = mutation({
  args: {
    items: v.array(
      v.object({
        email: v.string(),
        role: v.union(v.literal("admin"), v.literal("member")),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    const now = Date.now();
    const fingerprint = requestFingerprint("invite_members", { items: args.items });
    const replay = await replayIdempotent(ctx, auth, "invite_members", args.idempotencyKey, fingerprint, now);
    if (replay) return { ...replay, replayed: true };
    assertBatch(args.items.length, "item");
    const result = await checkInvites(ctx, auth, args.items);
    await recordIdempotent(ctx, auth, "invite_members", args.idempotencyKey, fingerprint, result, now);
    return { ...result, replayed: false };
  },
});
