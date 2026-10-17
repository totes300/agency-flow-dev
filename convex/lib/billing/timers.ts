import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { getDateInTimezone } from "../timer";

/**
 * All active (running / paused) timers in the org, resolved to {task, date}
 * once. The close queue filters this list per period+project in memory rather
 * than re-scanning `orgMembers` for every row (`loadRunningTimers` is the
 * single-period workspace variant).
 */
export type ActiveTimer = { userId: Id<"users">; taskIdStr: string; dateStr: string };
export async function loadActiveTimers(
  ctx: QueryCtx,
  orgId: string,
  timezone: string,
): Promise<ActiveTimer[]> {
  const memberships = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const out: ActiveTimer[] = [];
  for (const m of memberships) {
    if (!m.userId) continue;
    const user = await ctx.db.get(m.userId);
    if (!user || user.deletedAt) continue;
    if (user.timerStatus !== "running" && user.timerStatus !== "paused") continue;
    if (!user.timerTaskId || user.timerStartedAt === undefined) continue;
    out.push({
      userId: user._id,
      taskIdStr: user.timerTaskId.toString(),
      dateStr: getDateInTimezone(user.timerStartedAt, timezone),
    });
  }
  return out;
}
