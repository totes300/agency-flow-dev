import { internalQuery } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";

/**
 * `getMcpAuthContext` for MCP actions (docs/prd-mcp.md §5.2): an action has
 * no `ctx.db`, so it runs the checks here, as the action's caller (Convex
 * passes the identity on to functions an action calls). Internal only.
 */
export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const auth = await getMcpAuthContext(ctx);
    return auth;
  },
});
