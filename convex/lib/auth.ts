import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

export type AuthContext = {
  userId: Id<"users">;
  orgId: string;
  orgRole: "admin" | "member";
  isAdmin: boolean;
  user: Doc<"users">;
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
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }
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
 */
export async function getAuthContext(
  ctx: QueryCtx | MutationCtx
): Promise<AuthContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const { orgId, orgRole } = parseOrgFromIdentity(identity as Record<string, unknown>);

  if (!orgId) {
    throw new Error("No organization selected");
  }

  // Look up the Convex user record
  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (!user) {
    throw new Error("User not found in database");
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
 */
export async function getAuthContextOptional(
  ctx: QueryCtx | MutationCtx
): Promise<{ orgId: string; user: Doc<"users"> } | null> {
  const identity = await ctx.auth.getUserIdentity();
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
 * Same as getAuthContext but throws if the user is not an admin.
 */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<AuthContext> {
  const authCtx = await getAuthContext(ctx);
  if (!authCtx.isAdmin) {
    throw new Error("Admin access required");
  }
  return authCtx;
}
