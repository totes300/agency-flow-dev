import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "./lib/auth";

// ─── Public query ───────────────────────────────────────────────────────────

/** List all org members with their user profile data. Reactive subscription. */
export const listOrgMembers = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);

    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    // Batch-resolve user profiles (only for resolved memberships)
    const results = await Promise.all(
      memberships.map(async (m) => {
        if (!m.userId) return null;
        const user = await ctx.db.get(m.userId);
        if (!user || user.deletedAt) return null;
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          imageUrl: user.imageUrl,
          role: m.role,
        };
      })
    );

    return results.filter(Boolean) as Array<{
      _id: NonNullable<typeof memberships[0]["userId"]>;
      name: string;
      email: string | undefined;
      imageUrl: string | undefined;
      role: "admin" | "member";
    }>;
  },
});

// ─── Internal mutations (called by webhook handler) ─────────────────────────

/**
 * Upsert an org membership. Always saves the record — never skips.
 * If the Convex user exists, links via userId. If not, stores clerkUserId
 * for later resolution when the user record arrives.
 * Also creates/updates the user record from public_user_data if provided.
 */
export const upsertMembership = internalMutation({
  args: {
    orgId: v.string(),
    clerkUserId: v.string(),
    role: v.string(),
    // Optional user data from the membership event's public_user_data
    userData: v.optional(v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      identifier: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const role = args.role === "org:admin" ? "admin" as const : "member" as const;

    // Try to resolve the Convex user
    let user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", args.clerkUserId))
      .unique();

    // If user doesn't exist but we have public_user_data, create the user record
    if (!user && args.userData) {
      const name = [args.userData.firstName, args.userData.lastName]
        .filter(Boolean).join(" ") || args.userData.identifier || "Unknown";
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        externalId: args.clerkUserId,
        name,
        email: args.userData.identifier,
        imageUrl: args.userData.imageUrl,
        createdAt: now,
        updatedAt: now,
      });
      user = await ctx.db.get(userId);
    }

    // Upsert the membership record (keyed by orgId + clerkUserId)
    const existing = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId_clerkUserId", (q) =>
        q.eq("orgId", args.orgId).eq("clerkUserId", args.clerkUserId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role,
        userId: user?._id ?? existing.userId,
      });
    } else {
      await ctx.db.insert("orgMembers", {
        orgId: args.orgId,
        clerkUserId: args.clerkUserId,
        userId: user?._id,
        role,
        joinedAt: Date.now(),
      });
    }
  },
});

/** Remove an org membership. */
export const deleteMembership = internalMutation({
  args: {
    orgId: v.string(),
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId_clerkUserId", (q) =>
        q.eq("orgId", args.orgId).eq("clerkUserId", args.clerkUserId)
      )
      .unique();

    if (membership) {
      await ctx.db.delete(membership._id);
    }
  },
});

/**
 * Resolve unlinked org memberships for a user.
 * Called by the user sync flow after creating/updating a user record.
 * Finds any orgMembers with matching clerkUserId but no userId, and links them.
 */
export const resolveUserMemberships = internalMutation({
  args: {
    clerkUserId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const unlinked = await ctx.db
      .query("orgMembers")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .collect();

    for (const membership of unlinked) {
      if (!membership.userId) {
        await ctx.db.patch(membership._id, { userId: args.userId });
      }
    }
  },
});
