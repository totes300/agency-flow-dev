import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { getMcpAuthContext } from "../lib/mcpAuth";
import { mcpActor } from "../lib/mcpWrites";
import { commitBilling, previewBilling } from "../lib/mcpBilling";
import { billingActionValidator } from "../lib/mcpBillingResults";

/**
 * MCP `billing_preview` / `billing_commit` (docs/prd-mcp.md D5, §9). Each
 * function calls `getMcpAuthContext` first (I1) and takes no org, user or
 * role argument (I2); references resolve in the caller's org (I3). Admins
 * only, as every billing mutation in the app.
 *
 * - `preview` is a mutation only because it stores the preview row whose ID
 *   is the commit token; it writes no billing data (the tool is read-only).
 * - `commit` runs the previewed action through the app's write path in one
 *   transaction, or refuses when anything the preview read has changed.
 *   `clientName` is the OAuth client's display name for "via <client>"
 *   (D15; display text only, see convex/mcp/write.ts).
 */

export const preview = mutation({
  args: {
    action: billingActionValidator,
    project: v.optional(v.string()),
    period: v.optional(v.string()),
    invoice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getMcpAuthContext(ctx);
    return await previewBilling(ctx, auth, args);
  },
});

export const commit = mutation({
  args: {
    commitToken: v.string(),
    clientName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = mcpActor(await getMcpAuthContext(ctx), args.clientName);
    return await commitBilling(ctx, auth, args.commitToken);
  },
});
