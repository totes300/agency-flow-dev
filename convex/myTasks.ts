import { query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { createTaskEnricher } from "./lib/task_helpers";
import { getOrgSettings } from "./lib/orgHelpers";
import { getDateInTimezone } from "./lib/timer";
import {
  filterMyTasks,
  groupByStatus,
  sortWithinGroup,
  countHiddenTasks,
} from "./lib/myTaskHelpers";
import type { Doc } from "./_generated/dataModel";

// ─── listMyTasks ──────────────────────────────────────────────────────────────

export const listMyTasks = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);
    const user = await ctx.db.get(userId);

    // Get today's date in org timezone
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const todayDateStr = getDateInTimezone(Date.now(), timezone);

    // 1. Load all org statuses (active only)
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const activeStatuses = statuses.filter((s) => !s.archivedAt);

    // 2. Load all org tasks and filter to mine
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const myTasks = filterMyTasks(allTasks, userId);

    // 3. Batch-load related entities for enrichment
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

    // 4. Group and sort
    const visibleStatuses = user?.todayVisibleStatuses;
    const groups = groupByStatus(enrichedTasks, activeStatuses, visibleStatuses, todayDateStr);

    for (const group of groups) {
      group.tasks = sortWithinGroup(group.tasks);
    }

    const hiddenCount = countHiddenTasks(myTasks, activeStatuses, visibleStatuses, todayDateStr);

    return { groups, hiddenCount };
  },
});

// ─── myTasksCount ─────────────────────────────────────────────────────────────

export const myTasksCount = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);

    // Find "Today" named status
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const todayStatus = statuses.find((s) => s.name === "Today" && !s.archivedAt);
    if (!todayStatus) return 0;

    // Count tasks with that statusId assigned to me
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_statusId", (q) =>
        q.eq("orgId", orgId).eq("statusId", todayStatus._id),
      )
      .collect();

    return tasks.filter(
      (t) => !t.archivedAt && !t.parentTaskId && t.assigneeIds.includes(userId),
    ).length;
  },
});
