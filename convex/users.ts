import { query, mutation, QueryCtx } from "./_generated/server";

async function userByExternalId(ctx: QueryCtx, externalId: string) {
  return await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", externalId))
    .unique();
}

export async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await userByExternalId(ctx, identity.subject);
}

export async function getCurrentUserOrThrow(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("User not found");
  return user;
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

// Example: authenticated-only query pattern.
// Use getCurrentUserOrThrow to reject unauthenticated requests.
// Copy this pattern for any query that requires a logged-in user.
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    return user;
  },
});

export const syncUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await userByExternalId(ctx, identity.subject);
    const name = identity.name ?? identity.email ?? "Anonymous";

    if (existing) {
      if (existing.name !== name) {
        await ctx.db.patch(existing._id, { name });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      name,
      externalId: identity.subject,
    });
  },
});
