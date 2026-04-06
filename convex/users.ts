import { query, mutation, internalMutation, QueryCtx } from "./_generated/server";
import { v, ConvexError, type Validator } from "convex/values";
import { internal } from "./_generated/api";
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
  if (!user) throw new ConvexError("User not found");
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
    if (!identity) throw new ConvexError("Not authenticated");

    const existing = await userByExternalId(ctx, identity.subject);
    const now = Date.now();
    const name = identity.name ?? identity.email ?? "Anonymous";
    const email = identity.email ?? undefined;
    // Skip Clerk/Gravatar default avatars — only store real uploaded photos
    const rawImageUrl = identity.pictureUrl ?? undefined;
    const imageUrl = rawImageUrl && !rawImageUrl.includes("gravatar.com/avatar") ? rawImageUrl : undefined;

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
    // Only store imageUrl if the user uploaded a real profile photo
    const imageUrl = data.has_image ? (data.image_url ?? undefined) : undefined;

    const existing = await userByExternalId(ctx, data.id);
    let userId;
    if (existing) {
      userId = existing._id;
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
      userId = await ctx.db.insert("users", {
        name,
        email,
        imageUrl,
        externalId: data.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Resolve any unlinked org memberships for this user
    await ctx.scheduler.runAfter(0, internal.orgMembers.resolveUserMemberships, {
      clerkUserId: data.id,
      userId,
    });
  },
});

/** One-time migration: clear Clerk/Gravatar default avatar URLs from existing users. */
export const clearDefaultAvatars = internalMutation({
  args: {},
  async handler(ctx) {
    const users = await ctx.db.query("users").collect();
    let cleaned = 0;
    for (const user of users) {
      if (
        user.imageUrl &&
        (user.imageUrl.includes("gravatar.com/avatar") ||
         user.imageUrl.includes("img.clerk.com"))
      ) {
        await ctx.db.patch(user._id, { imageUrl: undefined });
        cleaned++;
      }
    }
    return { cleaned, total: users.length };
  },
});

export const updateTaskDetailView = mutation({
  args: { view: v.union(v.literal("modal"), v.literal("drawer")) },
  handler: async (ctx, { view }) => {
    const user = await getCurrentUserOrThrow(ctx);
    await ctx.db.patch(user._id, {
      taskDetailView: view,
      updatedAt: Date.now(),
    });
  },
});

export const updateMyTasksSettings = mutation({
  args: { todayVisibleStatuses: v.optional(v.array(v.string())) },
  handler: async (ctx, { todayVisibleStatuses }) => {
    const user = await getCurrentUserOrThrow(ctx);
    await ctx.db.patch(user._id, {
      todayVisibleStatuses,
      updatedAt: Date.now(),
    });
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
