import { internalMutation } from "./_generated/server";

/**
 * Monthly cron job: runs on the 1st of each month at 06:00 UTC.
 * Creates retainer periods for the previous month for all active retainer projects.
 * Phase 2 (Reports): will also generate auto-reports here.
 */
export const generateMonthlyPeriods = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Previous month
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const periodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(prevYear, prevMonth, 0).getDate();
    const periodEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Find all active retainer projects across all orgs
    const allRetainers = await ctx.db
      .query("projects")
      .withIndex("by_billingType_retainerStatus", (q) =>
        q.eq("billingType", "retainer").eq("retainerStatus", "active")
      )
      .collect();
    const retainers = allRetainers.filter((p) => !p.archivedAt);

    for (const project of retainers) {
      // Check if period already exists
      const found = await ctx.db
        .query("retainerPeriods")
        .withIndex("by_projectId_periodStart", (q) =>
          q.eq("projectId", project._id).eq("periodStart", periodStart)
        )
        .first();
      if (!found) {
        await ctx.db.insert("retainerPeriods", {
          orgId: project.orgId,
          projectId: project._id,
          periodStart,
          periodEnd,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: project.createdBy,
        });
      }
    }

    // TODO Phase 2 (Reports): generate auto-reports for each active retainer
    // For each project above, create a report with status: "report" (no statement number)
  },
});
