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
  const user = await userByExternalId(ctx, identity.subject);
  if (user?.deletedAt) return null;
  return user;
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
    const now = Date.now();
    const name = identity.name ?? identity.email ?? "Anonymous";
    const email = identity.email ?? undefined;
    const imageUrl = identity.pictureUrl ?? undefined;

    if (existing) {
      // Compare before patching to avoid unnecessary writes
      if (
        existing.name !== name ||
        existing.email !== email ||
        existing.imageUrl !== imageUrl
      ) {
        await ctx.db.patch(existing._id, {
          name,
          email,
          imageUrl,
          updatedAt: now,
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      name,
      email,
      imageUrl,
      externalId: identity.subject,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Resolve Clerk external IDs to Convex users. Used by assignee pickers. */
export const listByExternalIds = query({
  args: { externalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const users = await Promise.all(
      args.externalIds.map((id) => userByExternalId(ctx, id))
    );
    return users.filter((u) => u !== null && !u.deletedAt);
  },
});

// ─── Webhook-driven sync (called by Convex HTTP action, not public) ──────────

export const upsertFromClerk = internalMutation({
  args: { data: v.any() as Validator<UserJSON> },
  async handler(ctx, { data }) {
    const now = Date.now();
    const primaryEmail =
      data.email_addresses?.find(
        (e) => e.id === data.primary_email_address_id
      )?.email_address ?? data.email_addresses?.[0]?.email_address;
    const name =
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      primaryEmail ||
      "Anonymous";
    const email = primaryEmail ?? undefined;
    const imageUrl = data.image_url ?? undefined;

    const existing = await userByExternalId(ctx, data.id);
    if (existing) {
      // Compare before patching to avoid unnecessary writes
      if (
        existing.name !== name ||
        existing.email !== email ||
        existing.imageUrl !== imageUrl
      ) {
        await ctx.db.patch(existing._id, {
          name,
          email,
          imageUrl,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("users", {
        name,
        email,
        imageUrl,
        externalId: data.id,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  async handler(ctx, { clerkUserId }) {
    const user = await userByExternalId(ctx, clerkUserId);
    if (user !== null) {
      await ctx.db.patch(user._id, { deletedAt: Date.now() });
    }
  },
});
