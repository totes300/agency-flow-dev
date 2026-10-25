import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * The delete guard shared by `projects.remove` and `clients.remove` (and so
 * by MCP `delete`; owner decision D-DELETEGUARD, 2026-10-25). A project is
 * only deleted when nothing hangs off it: no time entries, no running timer
 * on its tasks, no tasks at all (archived ones included), no invoices and no
 * billing closes. Anything else is archived instead — deleting would leave
 * tasks pointing at a missing project and orphan financial records.
 */

export type ProjectDeleteBlocker =
  | { kind: "time entries" | "tasks" | "invoices" | "closed billing periods" }
  | { kind: "timer"; userName: string };

/** What stops `project` from being deleted, or null when it may go. */
export async function projectDeleteBlocker(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  project: Doc<"projects">,
): Promise<ProjectDeleteBlocker | null> {
  const projectId = project._id;
  const hasEntries = await ctx.db
    .query("timeEntries")
    .withIndex("by_orgId_projectId_closeId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .first();
  if (hasEntries) return { kind: "time entries" };

  // A running timer on one of its tasks: named first, it is what the owner
  // must act on (stop or discard it) before archiving.
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .collect();
  if (tasks.length > 0) {
    const taskIds = new Set<Id<"tasks">>(tasks.map((t) => t._id));
    const members = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const member of members) {
      if (!member.userId) continue;
      const user = await ctx.db.get(member.userId);
      if (user?.timerTaskId && taskIds.has(user.timerTaskId)) return { kind: "timer", userName: user.name };
    }
    return { kind: "tasks" };
  }

  const invoice = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .first();
  if (invoice) return { kind: "invoices" };

  const close = await ctx.db
    .query("billingCloses")
    .withIndex("by_orgId_projectId_periodStart", (q) => q.eq("orgId", orgId).eq("projectId", projectId))
    .first();
  if (close) return { kind: "closed billing periods" };
  return null;
}

/** Deletes a project that passed the guard, with its estimates and rate overrides. */
export async function deleteProjectRows(ctx: MutationCtx, projectId: Id<"projects">): Promise<void> {
  const [estimates, rateOverrides] = await Promise.all([
    ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);
  for (const est of estimates) await ctx.db.delete(est._id);
  for (const override of rateOverrides) await ctx.db.delete(override._id);
  await ctx.db.delete(projectId);
}
