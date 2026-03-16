import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext, requireAdmin } from "./lib/auth";
import { currencyValidator, categoryColorValidator } from "./lib/validators";
import { DEFAULT_CATEGORIES } from "./lib/constants";

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const categories = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = args.includeArchived
      ? categories
      : categories.filter((c) => !c.archivedAt);

    return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const get = query({
  args: { id: v.id("workCategories") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const category = await ctx.db.get(args.id);
    if (!category || category.orgId !== orgId) return null;
    return category;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    color: categoryColorValidator,
    defaultCostRate: v.optional(v.number()),
    defaultBillRate: v.optional(v.number()),
    currency: currencyValidator,
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new Error("Name is required");
    }

    // Enforce unique name per org
    const existing = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (existing.some((c) => c.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error(`A category named "${trimmedName}" already exists`);
    }

    // sortOrder = max + 1
    const maxSort = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1);

    const now = Date.now();
    return await ctx.db.insert("workCategories", {
      orgId,
      name: trimmedName,
      color: args.color,
      defaultCostRate: args.defaultCostRate,
      defaultBillRate: args.defaultBillRate,
      currency: args.currency,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("workCategories"),
    name: v.optional(v.string()),
    color: v.optional(categoryColorValidator),
    defaultCostRate: v.optional(v.number()),
    defaultBillRate: v.optional(v.number()),
    currency: v.optional(currencyValidator),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const category = await ctx.db.get(args.id);
    if (!category || category.orgId !== orgId) {
      throw new Error("Category not found");
    }

    // If renaming, enforce uniqueness
    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new Error("Name is required");
      }

      const siblings = await ctx.db
        .query("workCategories")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();

      if (
        siblings.some(
          (c) =>
            c._id !== args.id &&
            c.name.toLowerCase() === trimmedName.toLowerCase()
        )
      ) {
        throw new Error(`A category named "${trimmedName}" already exists`);
      }
    }

    const patch: Partial<{
      name: string;
      color: string;
      defaultCostRate: number;
      defaultBillRate: number;
      currency: string;
      updatedAt: number;
    }> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.color !== undefined) patch.color = args.color;
    if (args.defaultCostRate !== undefined) patch.defaultCostRate = args.defaultCostRate;
    if (args.defaultBillRate !== undefined) patch.defaultBillRate = args.defaultBillRate;
    if (args.currency !== undefined) patch.currency = args.currency;

    await ctx.db.patch(args.id, patch);
  },
});

export const archive = mutation({
  args: { id: v.id("workCategories") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const category = await ctx.db.get(args.id);
    if (!category || category.orgId !== orgId) {
      throw new Error("Category not found");
    }
    await ctx.db.patch(args.id, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const restore = mutation({
  args: { id: v.id("workCategories") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const category = await ctx.db.get(args.id);
    if (!category || category.orgId !== orgId) {
      throw new Error("Category not found");
    }
    await ctx.db.patch(args.id, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("workCategories") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const category = await ctx.db.get(args.id);
    if (!category || category.orgId !== orgId) {
      throw new Error("Category not found");
    }
    // TODO(Phase 5): Check for task references before allowing hard delete
    await ctx.db.delete(args.id);
  },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("workCategories")) },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    for (let i = 0; i < args.ids.length; i++) {
      const category = await ctx.db.get(args.ids[i]);
      if (!category || category.orgId !== orgId) {
        throw new Error("Category not found");
      }
      await ctx.db.patch(args.ids[i], {
        sortOrder: i,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Seeds the default set of work categories for a newly created organization.
 * Called internally during org setup — not exposed as a public mutation.
 * No-ops if categories already exist for the org.
 */
export const seed = internalMutation({
  args: {
    orgId: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Only seed if org has 0 categories
    const existing = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (existing.length > 0) return;

    // Read org default currency
    const orgSettings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();

    const currency = orgSettings?.defaultCurrency ?? "USD";
    const now = Date.now();

    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const cat = DEFAULT_CATEGORIES[i];
      await ctx.db.insert("workCategories", {
        orgId: args.orgId,
        name: cat.name,
        color: cat.color,
        currency,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        createdBy: args.createdBy,
      });
    }
  },
});
