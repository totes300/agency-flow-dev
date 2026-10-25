import { v, ConvexError, type ObjectType } from "convex/values";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, getAuthContext, type AuthContext } from "./lib/auth";

/**
 * A project's category estimates with category name and color (the Budget
 * settings and MCP `fetch`); empty for a project outside the caller's org.
 */
export async function listProjectCategoryEstimatesForAuth(
  ctx: QueryCtx,
  auth: Pick<AuthContext, "orgId">,
  projectId: Id<"projects">,
) {
  const { orgId } = auth;

  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== orgId) return [];

  const estimates = await ctx.db
    .query("projectCategoryEstimates")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();

  // Enrich with category name + color
  const enriched = await Promise.all(
    estimates.map(async (est) => {
      const category = await ctx.db.get(est.workCategoryId);
      const safeCategory = category && category.orgId === orgId ? category : null;
      return {
        ...est,
        categoryName: safeCategory?.name ?? "Unknown",
        categoryColor: safeCategory?.color ?? "default",
      };
    })
  );

  return enriched;
}

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await listProjectCategoryEstimatesForAuth(ctx, await getAuthContext(ctx), args.projectId);
  },
});

const upsertEstimateArgs = {
  projectId: v.id("projects"),
  workCategoryId: v.id("workCategories"),
  estimatedMinutes: v.number(),
};

export type UpsertProjectCategoryEstimateInput = ObjectType<typeof upsertEstimateArgs>;

/** Sets a project's estimate for one work category (admins only): the Budget settings and MCP `save_projects`. */
export async function upsertProjectCategoryEstimateForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: UpsertProjectCategoryEstimateInput,
): Promise<Id<"projectCategoryEstimates">> {
  assertAdmin(auth);
  const { orgId, userId } = auth;

  const project = await ctx.db.get(args.projectId);
  if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

  const category = await ctx.db.get(args.workCategoryId);
  if (!category || category.orgId !== orgId) throw new ConvexError("Category not found");

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
}

export const upsert = mutation({
  args: upsertEstimateArgs,
  handler: async (ctx, args) => {
    return await upsertProjectCategoryEstimateForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const removeEstimateArgs = { id: v.id("projectCategoryEstimates") };

export type RemoveProjectCategoryEstimateInput = ObjectType<typeof removeEstimateArgs>;

/** Removes one estimate row (admins only). */
export async function removeProjectCategoryEstimateForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: RemoveProjectCategoryEstimateInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;

  const estimate = await ctx.db.get(args.id);
  if (!estimate || estimate.orgId !== orgId) throw new ConvexError("Estimate not found");

  await ctx.db.delete(args.id);
}

export const remove = mutation({
  args: removeEstimateArgs,
  handler: async (ctx, args) => {
    return await removeProjectCategoryEstimateForAuth(ctx, await getAuthContext(ctx), args);
  },
});
