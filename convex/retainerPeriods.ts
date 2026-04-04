import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin } from "./lib/auth";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    const periods = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    return periods.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  },
});

export const ensure = mutation({
  args: {
    projectId: v.id("projects"),
    year: v.number(),
    month: v.number(), // 1-indexed (January = 1)
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
    if (project.billingType !== "retainer") throw new ConvexError("Not a retainer project");

    if (!Number.isInteger(args.year) || args.year < 2000) {
      throw new ConvexError("Year must be an integer >= 2000");
    }
    if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12) {
      throw new ConvexError("Month must be an integer between 1 and 12");
    }

    const periodStart = `${args.year}-${String(args.month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(args.year, args.month, 0)).getUTCDate();
    const periodEnd = `${args.year}-${String(args.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Check if period already exists
    const found = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId_periodStart", (q) =>
        q.eq("projectId", args.projectId).eq("periodStart", periodStart)
      )
      .first();
    if (found) return found._id;

    const now = Date.now();
    return await ctx.db.insert("retainerPeriods", {
      orgId,
      projectId: args.projectId,
      periodStart,
      periodEnd,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});
