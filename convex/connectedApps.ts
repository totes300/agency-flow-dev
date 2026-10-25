import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { listConnectionsForAuth } from "./lib/mcpConnections";

/**
 * Settings → Connected apps (docs/prd-mcp.md D17): the signed-in user's own
 * MCP connections in their active org, from the stamps the /mcp route
 * writes (convex/lib/mcpConnections.ts). App session tokens only.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("mcpConnections"),
      clientName: v.string(),
      connectedAt: v.number(),
      lastUsedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    return await listConnectionsForAuth(ctx, auth);
  },
});
