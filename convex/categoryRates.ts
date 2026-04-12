import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthContext, requireAdmin } from "./lib/auth";
import { currencyValidator } from "./lib/validators";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("categoryRates")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const listForCategory = query({
  args: { workCategoryId: v.id("workCategories") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("categoryRates")
      .withIndex("by_orgId_workCategoryId_currency", (q) =>
        q.eq("orgId", orgId).eq("workCategoryId", args.workCategoryId)
      )
      .collect();
  },
});

export const upsert = mutation({
  args: {
    workCategoryId: v.id("workCategories"),
    currency: currencyValidator,
    defaultBillRate: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    if (args.defaultBillRate < 0) {
      throw new ConvexError("Bill rate cannot be negative");
    }

    // Verify category belongs to org
    const category = await ctx.db.get(args.workCategoryId);
    if (!category || category.orgId !== orgId) {
      throw new ConvexError("Category not found");
    }

    const existing = await ctx.db
      .query("categoryRates")
      .withIndex("by_orgId_workCategoryId_currency", (q) =>
        q.eq("orgId", orgId).eq("workCategoryId", args.workCategoryId).eq("currency", args.currency)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        defaultBillRate: args.defaultBillRate,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("categoryRates", {
      orgId,
      workCategoryId: args.workCategoryId,
      currency: args.currency,
      defaultBillRate: args.defaultBillRate,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("categoryRates") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const rate = await ctx.db.get(args.id);
    if (!rate || rate.orgId !== orgId) {
      throw new ConvexError("Rate not found");
    }
    await ctx.db.delete(args.id);
  },
});
