import { ConvexError } from "convex/values";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { findOrgMembership, oauthClientIdOf, type AuthContext } from "./auth";
import { isConnectionRevoked } from "./mcpConnections";

/**
 * Auth context for `convex/mcp/*`: the same shape as `getAuthContext` plus the
 * OAuth client the token was issued to (attribution D15, Connected apps D17).
 */
export type McpAuthContext = AuthContext & { clientId: string };

export const NO_ORG_SELECTED =
  "No organization selected — reconnect and pick an organization";

/** The Clerk user has no synced `users` row yet (first browser sign-in creates it). */
export const USER_NOT_SYNCED =
  "Your Agency Flow account is not set up yet. Sign in to Agency Flow in the browser once, then retry.";

/**
 * The global MCP stop (docs/runbooks/mcp-deployment.md, Rollback): with the
 * Convex environment variable MCP_DISABLED set to "true", every MCP call is
 * refused before anything is read. App session functions are unaffected.
 */
export const MCP_SWITCHED_OFF =
  "The Agency Flow MCP server is switched off for now. Use the Agency Flow app, or try again later.";

export function isMcpDisabled(): boolean {
  return process.env.MCP_DISABLED === "true";
}

/** The user revoked this client in Connected apps (owner decision D-REVOKE). */
export const CONNECTION_REVOKED =
  "Access for this app was revoked in Agency Flow (Connected apps). To use it again, choose Allow again there.";

/**
 * The only MCP entry point (docs/prd-mcp.md §5.2). Every `convex/mcp/*`
 * function calls it first (I1) and takes no org, user or role arguments (I2).
 *
 * 0. MCP_DISABLED="true" (Convex env) refuses every call: the global stop.
 * 1. The identity must be a Clerk OAuth access token (`client_id` claim, see
 *    `oauthClientIdOf`); app session tokens are refused (I4).
 * 2. `orgId` is the verified `org_id` claim, present when the user picked an
 *    organization on the consent screen (`user:org:read`).
 * 3. The user comes from `users` by Clerk subject. The role comes ONLY from
 *    `orgMembers` (D12): OAuth tokens carry no org role, so the session-token
 *    parsing in `getAuthContext` must not be reused here. No membership, or
 *    one linked to another user, fails closed.
 * 4. The connection (org + user + client) must not be revoked in Connected
 *    apps (D-REVOKE): one indexed read. Clerk cannot revoke a grant without
 *    the client's token, so this is what stops a revoked client — its
 *    still-valid access token and every refreshed one — on the next call.
 *
 * Queries cannot write, so Connected apps "last used" is not stamped here:
 * the /mcp route calls `mcp/connections:touch` (convex/lib/mcpConnections.ts).
 *
 * Actions have no `ctx.db`: they run the same checks through the internal
 * query `mcp/auth:context`, which receives the action's identity (Convex
 * passes it on to functions an action calls).
 */
export async function getMcpAuthContext(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<McpAuthContext> {
  if (!("db" in ctx)) {
    return await ctx.runQuery(internal.mcp.auth.context, {});
  }
  if (isMcpDisabled()) {
    throw new ConvexError(MCP_SWITCHED_OFF);
  }
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }

  const clientId = oauthClientIdOf(identity);
  if (!clientId) {
    throw new ConvexError("MCP functions require an OAuth access token");
  }

  const orgId = identity.org_id;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new ConvexError(NO_ORG_SELECTED);
  }

  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();
  if (!user || user.deletedAt) {
    throw new ConvexError(USER_NOT_SYNCED);
  }

  const membership = await findOrgMembership(ctx, orgId, identity.subject);
  if (!membership || (membership.userId !== undefined && membership.userId !== user._id)) {
    throw new ConvexError("You are not a member of this organization");
  }

  if (await isConnectionRevoked(ctx, orgId, user._id, clientId)) {
    throw new ConvexError(CONNECTION_REVOKED);
  }

  return {
    userId: user._id,
    orgId,
    orgRole: membership.role,
    isAdmin: membership.role === "admin",
    user,
    clientId,
  };
}
