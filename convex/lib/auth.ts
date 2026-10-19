import { ConvexError, v } from "convex/values";
import { internalQuery, QueryCtx, MutationCtx } from "../_generated/server";
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
    throw new ConvexError(`${fieldName} must be ${maxLength} characters or fewer`);
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

// ─── Agent actor (background-capable runs) ──────────────────────────────────

/**
 * Who an agent run acts as (docs/prd-email-triage-implementation-plan.md §3
 * P1). `via: "user"` = an interactive run started by the signed-in user;
 * `via: "background"` = a server-started run with no `ctx.auth`, acting as a
 * named org member. `isAdmin` is the `orgMembers` role resolved when the run
 * began (both modes — never the JWT role) and is used ONLY for tool-set
 * filtering; every actor-path read/write re-derives the role from
 * `orgMembers` via `loadAuthContextForActor`.
 */
export type AgentActor = {
  orgId: string;
  userId: Id<"users">;
  isAdmin: boolean;
  via: "user" | "background";
};

/**
 * What actor-path internal functions receive: identity only. The role is
 * deliberately NOT on the wire — it is re-read from the DB on every call, so a
 * demotion or removal mid-run takes effect (fail closed).
 */
export const agentActorRefValidator = v.object({
  orgId: v.string(),
  userId: v.id("users"),
});
export type AgentActorRef = { orgId: string; userId: Id<"users"> };

/** Strip an actor to the identity-only ref the internal functions accept. */
export function actorRef(actor: AgentActorRef): AgentActorRef {
  return { orgId: actor.orgId, userId: actor.userId };
}

/**
 * Build an `AuthContext` (same shape as `getAuthContext`) from DB records for
 * a run that has no `ctx.auth`. Membership + role come from `orgMembers`,
 * which the Clerk webhook (`organizationMembership.*`, convex/http.ts) keeps
 * in sync with the same `org:admin → admin` mapping the JWT path uses.
 *
 * Throws when the user is missing/deleted or is not a CURRENT member of the
 * org. Server-side only: callers are internal functions whose actor came from
 * a run row or an internal entry point — never from a client argument.
 */
export async function loadAuthContextForActor(
  ctx: QueryCtx | MutationCtx,
  actor: AgentActorRef,
): Promise<AuthContext> {
  const user = await ctx.db.get(actor.userId);
  if (!user || user.deletedAt) {
    throw new ConvexError("Acting user not found");
  }
  const membership = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId_clerkUserId", (q) =>
      q.eq("orgId", actor.orgId).eq("clerkUserId", user.externalId),
    )
    .unique();
  if (!membership || (membership.userId && membership.userId !== user._id)) {
    throw new ConvexError("Acting user is not a member of this organization");
  }
  return {
    userId: user._id,
    orgId: actor.orgId,
    orgRole: membership.role,
    isAdmin: membership.role === "admin",
    user,
  };
}
