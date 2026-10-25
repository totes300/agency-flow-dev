import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { stampConnection } from "../lib/mcpConnections";

/**
 * Stamps the caller's connection for Settings → Connected apps
 * (docs/prd-mcp.md D17, §11): called by the /mcp route, as the user with the
 * same OAuth token, after a request it verified. Writes at most once an hour
 * per connection. `clientName` is display text only (D15); the client comes
 * from the token.
 */
export const touch = mutation({
  args: { clientName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The one caller allowed without a connection row: it creates the row.
    const auth = await getMcpAuthContext(ctx, { registering: true });
    await stampConnection(ctx, auth, args.clientName, Date.now());
    return null;
  },
});
