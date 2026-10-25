import type { MutationCtx } from "../../_generated/server";

/**
 * MCP tests call `convex/mcp/*` directly, without the /mcp route that
 * registers a connection before a client's first call. getMcpAuthContext
 * fails closed without one, so test setups connect every org member with
 * the OAuth client IDs the file uses (as the route's first touch would).
 */
export async function connectMembers(ctx: MutationCtx, clientIds: readonly string[]): Promise<void> {
  for (const member of await ctx.db.query("orgMembers").collect()) {
    if (!member.userId) continue;
    const userId = member.userId;
    for (const clientId of clientIds) {
      const existing = await ctx.db
        .query("mcpConnections")
        .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", member.orgId).eq("userId", userId).eq("clientId", clientId))
        .unique();
      if (existing) continue;
      await ctx.db.insert("mcpConnections", {
        orgId: member.orgId,
        userId,
        clientId,
        clientName: "Test client",
        firstUsedAt: 0,
        lastUsedAt: 0,
      });
    }
  }
}
