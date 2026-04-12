import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./lib/auth";
import { currencyValidator } from "./lib/validators";
import { validateAssignees } from "./lib/task_helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db
      .query("userRates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db
      .query("userRates")
      .withIndex("by_orgId_userId_currency", (q) =>
        q.eq("orgId", orgId).eq("userId", args.userId)
      )
      .collect();
  },
});

export const upsert = mutation({
  args: {
    userId: v.id("users"),
    currency: currencyValidator,
    costRate: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    if (args.costRate < 0) {
      throw new ConvexError("Cost rate cannot be negative");
    }

    // Validate user belongs to this org
    await validateAssignees(ctx, orgId, [args.userId]);

    const existing = await ctx.db
      .query("userRates")
      .withIndex("by_orgId_userId_currency", (q) =>
        q.eq("orgId", orgId).eq("userId", args.userId).eq("currency", args.currency)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        costRate: args.costRate,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("userRates", {
      orgId,
      userId: args.userId,
      currency: args.currency,
      costRate: args.costRate,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("userRates") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const rate = await ctx.db.get(args.id);
    if (!rate || rate.orgId !== orgId) {
      throw new ConvexError("Rate not found");
    }
    await ctx.db.delete(args.id);
  },
});
