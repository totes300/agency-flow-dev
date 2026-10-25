import { query, mutation, type MutationCtx } from "./_generated/server";
import { v, ConvexError, type ObjectType } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, getAuthContext, requireAdmin, type AuthContext } from "./lib/auth";

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

const upsertOverrideArgs = {
  projectId: v.id("projects"),
  workCategoryId: v.id("workCategories"),
  billableRate: v.number(),
};

export type UpsertProjectRateOverrideInput = ObjectType<typeof upsertOverrideArgs>;

/** Sets a project's billable rate for one work category (admins only): the Rates settings and MCP `save_projects`. */
export async function upsertProjectRateOverrideForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: UpsertProjectRateOverrideInput,
): Promise<Id<"projectRateOverrides">> {
  assertAdmin(auth);
  const { orgId } = auth;

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
}

export const upsert = mutation({
  args: upsertOverrideArgs,
  handler: async (ctx, args) => {
    return await upsertProjectRateOverrideForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const removeOverrideArgs = { id: v.id("projectRateOverrides") };

export type RemoveProjectRateOverrideInput = ObjectType<typeof removeOverrideArgs>;

/** Removes a rate override, back to the category's default rate (admins only). */
export async function removeProjectRateOverrideForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: RemoveProjectRateOverrideInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;
  const override = await ctx.db.get(args.id);
  if (!override || override.orgId !== orgId) {
    throw new ConvexError("Override not found");
  }
  await ctx.db.delete(args.id);
}

export const remove = mutation({
  args: removeOverrideArgs,
  handler: async (ctx, args) => {
    return await removeProjectRateOverrideForAuth(ctx, await getAuthContext(ctx), args);
  },
});
