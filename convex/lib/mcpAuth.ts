import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { findOrgMembership, oauthClientIdOf, type AuthContext } from "./auth";

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
 * The only MCP entry point (docs/prd-mcp.md §5.2). Every `convex/mcp/*`
 * function calls it first (I1) and takes no org, user or role arguments (I2).
 *
 * 1. The identity must be a Clerk OAuth access token (`client_id` claim, see
 *    `oauthClientIdOf`); app session tokens are refused (I4).
 * 2. `orgId` is the verified `org_id` claim, present when the user picked an
 *    organization on the consent screen (`user:org:read`).
 * 3. The user comes from `users` by Clerk subject. The role comes ONLY from
 *    `orgMembers` (D12): OAuth tokens carry no org role, so the session-token
 *    parsing in `getAuthContext` must not be reused here. No membership, or
 *    one linked to another user, fails closed.
 *
 * Queries cannot write, so last-used stamping for Connected apps happens
 * elsewhere (slice 8).
 */
export async function getMcpAuthContext(
  ctx: QueryCtx | MutationCtx,
): Promise<McpAuthContext> {
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

  return {
    userId: user._id,
    orgId,
    orgRole: membership.role,
    isAdmin: membership.role === "admin",
    user,
    clientId,
  };
}
