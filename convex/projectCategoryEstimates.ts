import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin } from "./lib/auth";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    const estimates = await ctx.db
      .query("projectCategoryEstimates")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Enrich with category name + color
    const enriched = await Promise.all(
      estimates.map(async (est) => {
        const category = await ctx.db.get(est.workCategoryId);
        return {
          ...est,
          categoryName: category?.name ?? "Unknown",
          categoryColor: category?.color ?? "default",
        };
      })
    );

    return enriched;
  },
});

export const upsert = mutation({
  args: {
    projectId: v.id("projects"),
    workCategoryId: v.id("workCategories"),
    estimatedMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    if (args.estimatedMinutes < 0) throw new ConvexError("Estimated minutes cannot be negative");

    // Find existing estimate for this project + category
    const estimates = await ctx.db
      .query("projectCategoryEstimates")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const existing = estimates.find(
      (e) => e.workCategoryId.toString() === args.workCategoryId.toString()
    );

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        estimatedMinutes: args.estimatedMinutes,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("projectCategoryEstimates", {
      orgId,
      projectId: args.projectId,
      workCategoryId: args.workCategoryId,
      estimatedMinutes: args.estimatedMinutes,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("projectCategoryEstimates") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const estimate = await ctx.db.get(args.id);
    if (!estimate || estimate.orgId !== orgId) throw new ConvexError("Estimate not found");

    await ctx.db.delete(args.id);
  },
});
