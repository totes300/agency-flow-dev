import { query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { createTaskEnricher } from "./lib/task_helpers";
import { getOrgSettings } from "./lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import {
  filterMyTasks,
  groupByStatus,
  sortWithinGroup,
  countHiddenTasks,
} from "./lib/myTaskHelpers";
import type { Doc, Id } from "./_generated/dataModel";

// ─── resolveVisibleStatusIds ─────────────────────────────────────────────────

/**
 * Resolve which status IDs to show in My Tasks.
 * Fallback chain: user preference → org default → first in_progress status.
 * Filters out archived/deleted statuses silently.
 */
function resolveVisibleStatusIds(
  user: Doc<"users"> | null,
  orgSettings: Doc<"orgSettings"> | null,
  activeStatuses: Doc<"statuses">[],
): Id<"statuses">[] {
  const activeIds = new Set(activeStatuses.map((s) => s._id as string));

  // 1. User preference (skip if it contains old type-key strings)
  const userPref = user?.todayVisibleStatuses;
  if (userPref && userPref.length > 0) {
    // Detect old format: type keys like "in_progress" are not valid Convex IDs
    const isNewFormat = userPref.every((id) => activeIds.has(id));
    if (isNewFormat) {
      return userPref.filter((id) => activeIds.has(id)) as Id<"statuses">[];
    }
    // Old format detected — fall through to org default
  }

  // 2. Org default
  const orgDefault = orgSettings?.defaultMyTasksStatusIds;
  if (orgDefault && orgDefault.length > 0) {
    return orgDefault.filter((id) => activeIds.has(id as string));
  }

  // 3. Final fallback: first in_progress status by sortOrder
  const firstInProgress = activeStatuses
    .filter((s) => s.type === "in_progress")
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (firstInProgress) {
    return [firstInProgress._id];
  }

  // No statuses at all — return empty
  return [];
}

// ─── listMyTasks ──────────────────────────────────────────────────────────────

export const listMyTasks = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);
    const user = await ctx.db.get(userId);

    // Get today's date in org timezone
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayDateStr = getDateInTimezone(Date.now(), timezone);

    // 1. Load all org statuses (active only)
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const activeStatuses = statuses.filter((s) => !s.archivedAt);

    // 2. Resolve which statuses to show
    const visibleStatusIds = resolveVisibleStatusIds(user, orgSettings, activeStatuses);

    // 3. Load all org tasks and filter to mine
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const myTasks = filterMyTasks(allTasks, userId);

    // 4. Batch-load related entities for enrichment
    const statusIds = new Set(myTasks.map((t) => t.statusId.toString()));
    const projectIds = new Set(
      myTasks.map((t) => t.projectId?.toString()).filter(Boolean) as string[],
    );
    const categoryIds = new Set(
      myTasks.map((t) => t.workCategoryId?.toString()).filter(Boolean) as string[],
    );
    const userIds = new Set(myTasks.flatMap((t) => t.assigneeIds.map((id) => id.toString())));

    const [statusDocs, projectDocs, categoryDocs, userDocs] = await Promise.all([
      Promise.all([...statusIds].map((id) => ctx.db.get(id as Doc<"statuses">["_id"]))),
      Promise.all([...projectIds].map((id) => ctx.db.get(id as Doc<"projects">["_id"]))),
      Promise.all([...categoryIds].map((id) => ctx.db.get(id as Doc<"workCategories">["_id"]))),
      Promise.all([...userIds].map((id) => ctx.db.get(id as Doc<"users">["_id"]))),
    ]);

    // Load clients for projects
    const clientIds = new Set(
      projectDocs.filter(Boolean).map((p) => p!.clientId.toString()),
    );
    const clientDocs = await Promise.all(
      [...clientIds].map((id) => ctx.db.get(id as Doc<"clients">["_id"])),
    );

    const statusMap = new Map(statusDocs.filter(Boolean).map((s) => [s!._id.toString(), s!]));
    const projectMap = new Map(projectDocs.filter(Boolean).map((p) => [p!._id.toString(), p!]));
    const clientMap = new Map(clientDocs.filter(Boolean).map((c) => [c!._id.toString(), c!]));
    const categoryMap = new Map(categoryDocs.filter(Boolean).map((c) => [c!._id.toString(), c!]));
    const userMap = new Map(userDocs.filter(Boolean).map((u) => [u!._id.toString(), u!]));

    const enrichTask = createTaskEnricher({ statusMap, projectMap, clientMap, categoryMap, userMap });
    const enrichedTasks = myTasks.map(enrichTask);

    // 5. Group and sort
    const groups = groupByStatus(enrichedTasks, activeStatuses, visibleStatusIds, todayDateStr, timezone);

    for (const group of groups) {
      group.tasks = sortWithinGroup(group.tasks);
    }

    const hiddenCount = countHiddenTasks(myTasks, visibleStatusIds, todayDateStr, timezone);

    return { groups, hiddenCount, visibleStatusIds: visibleStatusIds.map(String) };
  },
});

// ─── myTasksCount ─────────────────────────────────────────────────────────────

export const myTasksCount = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);
    const user = await ctx.db.get(userId);

    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const activeStatuses = statuses.filter((s) => !s.archivedAt);

    const orgSettings = await getOrgSettings(ctx, orgId);
    const visibleStatusIds = resolveVisibleStatusIds(user, orgSettings, activeStatuses);

    if (visibleStatusIds.length === 0) return 0;

    // Count tasks in visible statuses assigned to me
    let count = 0;
    for (const statusId of visibleStatusIds) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_statusId", (q) =>
          q.eq("orgId", orgId).eq("statusId", statusId),
        )
        .collect();

      count += tasks.filter(
        (t) => !t.archivedAt && !t.parentTaskId && t.assigneeIds.includes(userId),
      ).length;
    }

    return count;
  },
});
