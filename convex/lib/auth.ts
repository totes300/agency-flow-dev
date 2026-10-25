import { ConvexError } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";
import { internalQuery, QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import type { ActivityVia } from "../tasks/model";

export type AuthContext = {
  userId: Id<"users">;
  orgId: string;
  orgRole: "admin" | "member";
  isAdmin: boolean;
  user: Doc<"users">;
  /**
   * Set only for writes through an external agent (MCP, docs/prd-mcp.md
   * D15): stamped on the activity rows and comments the write paths create.
   * Attribution only — never consulted for authorization.
   */
  via?: ActivityVia;
};

/**
 * Validates that a string does not exceed a maximum length.
 * Throws if the string is too long.
 */
export function validateStringLength(
  value: string,
  maxLength: number,
  fieldName: string
): void {
  if (value.length > maxLength) {
    throw new ConvexError(`${fieldName} must be ${maxLength} characters or fewer`);
  }
}

/**
 * The OAuth client an identity was issued to, or null for an app session.
 *
 * Token-surface discriminator (docs/prd-mcp.md §5.2, I4): Clerk OAuth access
 * tokens (RFC 9068, `typ: at+jwt`) always carry a `client_id` claim and are
 * accepted by the `customJwt` provider in auth.config.ts (aud = MCP resource
 * URL). The app's session tokens (Clerk "convex" JWT template, aud "convex")
 * carry no `client_id`. Both share the Clerk issuer, so the issuer alone
 * cannot tell them apart.
 */
export function oauthClientIdOf(identity: UserIdentity): string | null {
  const clientId = identity.client_id;
  return typeof clientId === "string" && clientId.length > 0 ? clientId : null;
}

/**
 * The caller's identity when it is an app session token; null when there is
 * none or when it is an OAuth access token (I4: OAuth tokens may only call
 * `convex/mcp/*`). Fails closed: any `client_id` claim, even a malformed one,
 * keeps the identity off the UI surface. Every UI-side identity read goes
 * through here; `getMcpAuthContext` is the only other reader.
 */
export async function getSessionIdentity(ctx: { auth: Auth }): Promise<UserIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.client_id !== undefined) return null;
  return identity;
}

/**
 * The caller's membership row in `orgId`, keyed by Clerk user id. The role
 * source for `getMcpAuthContext` (D12); session tokens carry their own role.
 */
export async function findOrgMembership(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  clerkUserId: string,
): Promise<Doc<"orgMembers"> | null> {
  return await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
    .unique();
}

/** Extract orgId and orgRole from a Clerk JWT identity. */
function parseOrgFromIdentity(identity: Record<string, unknown>): {
  orgId: string | undefined;
  orgRole: "admin" | "member";
} {
  const rawOrgId = identity.orgId ?? identity.org_id;
  const orgId = typeof rawOrgId === "string" ? rawOrgId : undefined;
  const rawOrgRole = identity.orgRole ?? identity.org_role;
  const orgRoleStr = typeof rawOrgRole === "string" ? rawOrgRole : undefined;
  const orgRole = orgRoleStr === "org:admin" ? ("admin" as const) : ("member" as const);
  return { orgId, orgRole };
}

/**
 * Call at the start of every protected query/mutation.
 * Extracts userId, orgId, orgRole from the Clerk JWT + Convex users table.
 * Throws if not authenticated, no org selected, or user not synced.
 * OAuth access tokens are refused (I4); MCP functions use getMcpAuthContext.
 */
export async function getAuthContext(
  ctx: QueryCtx | MutationCtx
): Promise<AuthContext> {
  const identity = await getSessionIdentity(ctx);
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }

  const { orgId, orgRole } = parseOrgFromIdentity(identity as Record<string, unknown>);

  if (!orgId) {
    throw new ConvexError("No organization selected");
  }

  // Look up the Convex user record
  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (!user) {
    throw new ConvexError("User not found in database");
  }

  return {
    userId: user._id,
    orgId,
    orgRole,
    isAdmin: orgRole === "admin",
    user,
  };
}

/**
 * Like getAuthContext but returns null instead of throwing.
 * Use for queries that need graceful degradation (e.g. optional org context).
 * OAuth access tokens get null (I4).
 */
export async function getAuthContextOptional(
  ctx: QueryCtx | MutationCtx
): Promise<{ orgId: string; user: Doc<"users"> } | null> {
  const identity = await getSessionIdentity(ctx);
  if (!identity) return null;

  const { orgId } = parseOrgFromIdentity(identity as Record<string, unknown>);
  if (!orgId) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (!user) return null;

  return { orgId, user };
}

/**
 * Throws unless an already-built auth context is an admin's — the gate for
 * `*ForAuth` cores, which take a context from either builder
 * (`getAuthContext` or `getMcpAuthContext`). Same message as `requireAdmin`.
 */
export function assertAdmin(auth: Pick<AuthContext, "isAdmin">, message = "Admin access required"): void {
  if (!auth.isAdmin) {
    throw new ConvexError(message);
  }
}

/**
 * Same as getAuthContext but throws if the user is not an admin.
 */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<AuthContext> {
  const authCtx = await getAuthContext(ctx);
  if (!authCtx.isAdmin) {
    throw new ConvexError("Admin access required");
  }
  return authCtx;
}

/**
 * Admin-or-self guard for plan segment mutations: admins manage every row;
 * members only their own (`targetUserId` must be the caller). Enforced
 * server-side regardless of what the UI shows — a member may neither touch
 * another user's segment nor reassign one to another user.
 */
export function assertCanManagePlanFor(
  auth: AuthContext,
  targetUserId: Id<"users">,
): void {
  if (auth.isAdmin) return;
  if (auth.userId === targetUserId) return;
  throw new ConvexError("You can only manage your own plan");
}

/**
 * Auth bridge for Convex actions.
 *
 * Actions cannot call `requireAdmin` directly because it needs DB access
 * (which only QueryCtx / MutationCtx provide). They can, however, invoke
 * this internal query via `ctx.runQuery(internal.lib.auth.requireAdminForAction, {})`
 * and receive a slim, serializable subset of the auth context.
 *
 * Why a slim return: `AuthContext` includes `Doc<"users">`, which carries
 * Convex `_id`/`_creationTime` fields; those round-trip fine but the
 * function is called frequently and we don't want to bloat the action's
 * argument list. Add fields as new callers need them.
 */
export const requireAdminForAction = internalQuery({
  args: {},
  handler: async (ctx) => {
    const authCtx = await requireAdmin(ctx);
    return {
      userId: authCtx.userId,
      orgId: authCtx.orgId,
    };
  },
});
