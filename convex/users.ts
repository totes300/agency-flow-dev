import { query, mutation, internalMutation, QueryCtx } from "./_generated/server";
import { v, type Validator } from "convex/values";
import type { UserJSON } from "@clerk/backend";

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

// ─── Webhook-driven sync (called by Convex HTTP action, not public) ──────────

export const upsertFromClerk = internalMutation({
  args: { data: v.any() as Validator<UserJSON> },
  async handler(ctx, { data }) {
    const userAttributes = {
      name: [data.first_name, data.last_name].filter(Boolean).join(" ") || data.email_addresses?.[0]?.email_address || "Anonymous",
      externalId: data.id,
    };

    const existing = await userByExternalId(ctx, data.id);
    if (existing) {
      await ctx.db.patch(existing._id, userAttributes);
    } else {
      await ctx.db.insert("users", userAttributes);
    }
  },
});

export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    const user = await userByExternalId(ctx, clerkUserId);
    if (user !== null) {
      await ctx.db.delete(user._id);
    }
  },
});
