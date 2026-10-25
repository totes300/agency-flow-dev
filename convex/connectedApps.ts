import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { listConnectionsForAuth, setConnectionRevokedForAuth } from "./lib/mcpConnections";

/**
 * Connected apps (docs/prd-mcp.md D17; page /connected-apps, owner decision
 * D-PAGE): the signed-in user's own MCP connections in their active org,
 * from the stamps the /mcp route writes (convex/lib/mcpConnections.ts), with
 * Revoke / Allow again (D-REVOKE). App session tokens only; every member
 * manages only their own connections.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("mcpConnections"),
      clientName: v.string(),
      connectedAt: v.number(),
      lastUsedAt: v.number(),
      revokedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    return await listConnectionsForAuth(ctx, auth);
  },
});

/** Blocks this app from the client's next MCP call (getMcpAuthContext). */
export const revoke = mutation({
  args: { id: v.id("mcpConnections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    await setConnectionRevokedForAuth(ctx, auth, args.id, true, Date.now());
    return null;
  },
});

/** Lifts a revoke: the app's existing tokens work again. */
export const allowAgain = mutation({
  args: { id: v.id("mcpConnections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    await setConnectionRevokedForAuth(ctx, auth, args.id, false, Date.now());
    return null;
  },
});
