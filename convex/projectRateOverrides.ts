import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./lib/auth";

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    // Verify project belongs to org
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    return await ctx.db
      .query("projectRateOverrides")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    workCategoryId: v.id("workCategories"),
    billableRate: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    if (args.billableRate < 0) {
      throw new ConvexError("Billable rate cannot be negative");
    }

    // Verify project belongs to org
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) {
      throw new ConvexError("Project not found");
    }

    // Verify category belongs to org
    const category = await ctx.db.get(args.workCategoryId);
    if (!category || category.orgId !== orgId) {
      throw new ConvexError("Category not found");
    }

    const existing = await ctx.db
      .query("projectRateOverrides")
      .withIndex("by_projectId_workCategoryId", (q) =>
        q.eq("projectId", args.projectId).eq("workCategoryId", args.workCategoryId)
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        billableRate: args.billableRate,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("projectRateOverrides", {
      orgId,
      projectId: args.projectId,
      workCategoryId: args.workCategoryId,
      billableRate: args.billableRate,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("projectRateOverrides") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const override = await ctx.db.get(args.id);
    if (!override || override.orgId !== orgId) {
      throw new ConvexError("Override not found");
    }
    await ctx.db.delete(args.id);
  },
});
