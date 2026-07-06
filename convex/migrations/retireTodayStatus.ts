import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * DEV-ONLY cleanup for the Today × Planner rollout (slice 05): the "Today"
 * STATUS is retired — "today" is a derived per-user plan from planSegments
 * (docs/today-planner-prd.md), and new orgs are seeded without it.
 *
 * This is NOT a production migration (the PRD explicitly decides against
 * one — pre-launch, demo-only data). It automates the documented manual
 * step for existing dev orgs: re-status every task on "Today" to the org's
 * first "Next up"-style in_progress status, then delete the "Today" status
 * (clearing orgSettings references, mirroring statuses.remove).
 *
 * Run with: npx convex run migrations/retireTodayStatus '{}'
 * Idempotent: a no-op for orgs without a "Today" status.
 */
export default internalMutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const anyMember = args.orgId ? null : await ctx.db.query("orgMembers").first();
    const orgId = args.orgId ?? anyMember?.orgId;
    if (!orgId) throw new Error("No orgMembers found — pass { orgId }");

    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const todayStatus = statuses.find((s) => s.name === "Today");
    if (!todayStatus) return { orgId, retired: false, restatused: 0 };

    const target = statuses
      .filter((s) => s.type === "in_progress" && !s.archivedAt && s._id !== todayStatus._id)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (!target) throw new Error(`Org ${orgId} has no in_progress status to move tasks to`);

    const now = Date.now();
    let restatused = 0;
    for (;;) {
      const batch = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_statusId", (q) =>
          q.eq("orgId", orgId).eq("statusId", todayStatus._id),
        )
        .take(200);
      if (batch.length === 0) break;
      for (const task of batch) {
        await ctx.db.patch(task._id, {
          statusId: target._id,
          statusType: target.type,
          updatedAt: now,
        });
        restatused++;
      }
    }

    // Clear orgSettings references (same fields statuses.remove clears)
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (settings) {
      const patch: Record<string, unknown> = {};
      if (settings.defaultStatusId === todayStatus._id) patch.defaultStatusId = undefined;
      if (settings.completionDefaultAdminStatusId === todayStatus._id)
        patch.completionDefaultAdminStatusId = undefined;
      if (settings.completionDefaultMemberStatusId === todayStatus._id)
        patch.completionDefaultMemberStatusId = undefined;
      if (settings.defaultMyTasksStatusIds?.some((id) => id === todayStatus._id)) {
        patch.defaultMyTasksStatusIds = settings.defaultMyTasksStatusIds.filter(
          (id) => id !== todayStatus._id,
        );
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(settings._id, { ...patch, updatedAt: now });
      }
    }

    await ctx.db.delete(todayStatus._id);
    return { orgId, retired: true, restatused, movedTo: target.name };
  },
});
