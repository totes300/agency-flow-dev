import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { roundMinutes } from "./lib/rounding";
import { getDateInTimezone } from "./lib/timer";
import { getOrgSettings, resolveRateSnapshot } from "./lib/orgHelpers";
import { validateAssignees } from "./lib/task_helpers";
import { logActivity } from "./activityLog";

// ─── Queries ────────────────────────────────────────────────────────────────────

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) return [];

    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();

    // Member sees only own entries
    const filtered = isAdmin
      ? entries
      : entries.filter((e) => e.userId === userId);

    // Enrich with user info
    const userIds = [...new Set(filtered.map((e) => e.userId.toString()))];
    const users = await Promise.all(
      userIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    const userMap = new Map(
      users.filter(Boolean).map((u) => [u!._id.toString(), u!]),
    );

    return filtered
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .map((e) => {
        const user = userMap.get(e.userId.toString());
        return {
          ...e,
          userName: user?.name ?? "Unknown",
          userImageUrl: user?.imageUrl,
        };
      });
  },
});

export const listToday = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_userId_date", (q) =>
        q.eq("userId", userId).eq("date", todayStr),
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    // Enrich with task name
    const taskIds = [...new Set(entries.map((e) => e.taskId.toString()))];
    const tasks = await Promise.all(
      taskIds.map((id) => ctx.db.get(id as Id<"tasks">)),
    );
    const taskMap = new Map(
      tasks.filter(Boolean).map((t) => [t!._id.toString(), t!]),
    );

    return entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => {
        const task = taskMap.get(e.taskId.toString());
        return {
          ...e,
          taskName: task?.title ?? "Unknown",
        };
      });
  },
});

export const sumByTasks = query({
  args: { taskIds: v.array(v.id("tasks")) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    if (args.taskIds.length === 0) return {};
    if (args.taskIds.length > 100) {
      throw new ConvexError("Cannot query more than 100 tasks at once");
    }

    const results: Record<string, number> = {};

    await Promise.all(
      args.taskIds.map(async (taskId) => {
        const task = await ctx.db.get(taskId);
        if (!task || task.orgId !== orgId) return;

        const entries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
          .collect();
        const total = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
        results[taskId.toString()] = total;
      }),
    );

    return results;
  },
});

export const sumMyToday = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_userId_date", (q) =>
        q.eq("userId", userId).eq("date", todayStr),
      )
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    return entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  },
});

export const sumByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Get all tasks for this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    const taskIds = new Set(tasks.map((t) => t._id.toString()));

    // Get all entries for these tasks
    let totalMinutes = 0;
    const minutesByDate: Record<string, number> = {};

    await Promise.all(
      tasks.map(async (task) => {
        const entries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
          .collect();
        for (const e of entries) {
          totalMinutes += e.durationMinutes;
          minutesByDate[e.date] = (minutesByDate[e.date] ?? 0) + e.durationMinutes;
        }
      }),
    );

    return { totalMinutes, minutesByDate, taskCount: taskIds.size };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    durationMinutes: v.number(),
    note: v.optional(v.string()),
    isBillable: v.optional(v.boolean()),
    date: v.optional(v.string()),
    userId: v.optional(v.id("users")), // admin can create on behalf
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);

    // Determine the user this entry belongs to
    let entryUserId = auth.userId;
    if (args.userId && args.userId !== auth.userId) {
      if (!auth.isAdmin) {
        throw new ConvexError("Only admins can log time for other users");
      }
      await validateAssignees(ctx, auth.orgId, [args.userId]);
      entryUserId = args.userId;
    }

    if (args.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || isNaN(new Date(args.date).getTime())) {
        throw new ConvexError("Invalid date format — expected YYYY-MM-DD");
      }
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== auth.orgId) throw new ConvexError("Task not found");
    if (task.archivedAt) throw new ConvexError("Cannot log time on an archived task");
    if (!task.projectId) throw new ConvexError("Assign a project first");

    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");

    // Get org settings
    const orgSettings = await getOrgSettings(ctx, auth.orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const roundingMinutes = orgSettings?.roundingMinutes ?? 1;

    // Round duration
    const rounded = roundMinutes(args.durationMinutes, roundingMinutes);
    if (rounded <= 0) throw new ConvexError("Duration must be greater than 0");

    // Resolve date
    const date = args.date ?? getDateInTimezone(Date.now(), timezone);

    // Determine billable before rate resolution — non-billable entries skip rate enforcement
    const isBillable = args.isBillable ?? task.billable;

    // Rate snapshot (new model)
    const rateSnapshot = await resolveRateSnapshot(ctx, {
      userId: entryUserId,
      orgId: auth.orgId,
      task,
      project,
      isBillable,
    });

    const now = Date.now();
    const entryId = await ctx.db.insert("timeEntries", {
      orgId: auth.orgId,
      taskId: args.taskId,
      userId: entryUserId,
      date,
      durationMinutes: rounded,
      note: args.note?.trim() || undefined,
      isBillable,
      method: "manual",
      costRate: rateSnapshot.costRate,
      billableRate: rateSnapshot.billableRate,
      rateCurrency: rateSnapshot.rateCurrency,
      snapshotCategoryId: task.workCategoryId,
      createdAt: now,
      updatedAt: now,
      createdBy: auth.userId,
    });

    // Activity log
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    const durStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    await logActivity(ctx, {
      taskId: args.taskId,
      orgId: auth.orgId,
      userId: auth.userId,
      type: "time_entry_logged",
      metadata: { entryId, duration: durStr, note: args.note?.trim() || null },
    });

    return entryId;
  },
});

export const update = mutation({
  args: {
    id: v.id("timeEntries"),
    durationMinutes: v.optional(v.number()),
    note: v.optional(v.union(v.string(), v.null())),
    date: v.optional(v.string()),
    isBillable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId, isAdmin } = await getAuthContext(ctx);

    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== orgId) throw new ConvexError("Time entry not found");

    // Permission check
    if (!isAdmin && entry.userId !== userId) {
      throw new ConvexError("You can only edit your own time entries");
    }

    // Invoiced check — `invoicedInReportId` will be added to the schema in a
    // future invoicing phase. We guard here proactively so entries are protected
    // as soon as the field ships.
    if ("invoicedInReportId" in entry && entry.invoicedInReportId) {
      throw new ConvexError("Cannot edit an invoiced time entry");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.durationMinutes !== undefined) {
      const orgSettings = await getOrgSettings(ctx, orgId);
      const roundingMinutes = orgSettings?.roundingMinutes ?? 1;
      const rounded = roundMinutes(args.durationMinutes, roundingMinutes);
      if (rounded <= 0) throw new ConvexError("Duration must be greater than 0");
      updates.durationMinutes = rounded;
    }

    if (args.note !== undefined) {
      updates.note = args.note === null ? undefined : args.note.trim() || undefined;
    }

    if (args.date !== undefined) {
      updates.date = args.date;
    }

    if (args.isBillable !== undefined) {
      // When billable status changes, re-resolve rate snapshot
      if (args.isBillable !== entry.isBillable) {
        const task = await ctx.db.get(entry.taskId);
        if (!task) throw new ConvexError("Task not found");
        if (!task.projectId) throw new ConvexError("Task has no project");
        const project = await ctx.db.get(task.projectId);
        if (!project) throw new ConvexError("Project not found");

        const snapshot = await resolveRateSnapshot(ctx, {
          userId: entry.userId,
          orgId,
          task,
          project,
          isBillable: args.isBillable,
        });
        updates.costRate = snapshot.costRate;
        updates.billableRate = snapshot.billableRate;
        updates.rateCurrency = snapshot.rateCurrency;
        updates.snapshotCategoryId = task.workCategoryId ?? undefined;
      }
      updates.isBillable = args.isBillable;
    }

    await ctx.db.patch(args.id, updates);

    // Activity log if duration changed
    if (args.durationMinutes !== undefined && updates.durationMinutes !== entry.durationMinutes) {
      const fmtDur = (mins: number) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      };
      await logActivity(ctx, {
        taskId: entry.taskId,
        orgId,
        userId,
        type: "time_entry_edited",
        metadata: {
          entryId: args.id,
          oldDuration: fmtDur(entry.durationMinutes),
          newDuration: fmtDur(updates.durationMinutes as number),
        },
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("timeEntries") },
  handler: async (ctx, args) => {
    const { userId, orgId, isAdmin } = await getAuthContext(ctx);

    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== orgId) throw new ConvexError("Time entry not found");

    if (!isAdmin && entry.userId !== userId) {
      throw new ConvexError("You can only delete your own time entries");
    }

    // Invoiced check — `invoicedInReportId` will be added to the schema in a
    // future invoicing phase. We guard here proactively so entries are protected
    // as soon as the field ships.
    if ("invoicedInReportId" in entry && entry.invoicedInReportId) {
      throw new ConvexError("Cannot delete an invoiced time entry");
    }

    // Activity log before deleting
    const h = Math.floor(entry.durationMinutes / 60);
    const m = entry.durationMinutes % 60;
    const durStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    await logActivity(ctx, {
      taskId: entry.taskId,
      orgId,
      userId,
      type: "time_entry_deleted",
      metadata: { entryId: args.id, duration: durStr },
    });

    await ctx.db.delete(args.id);
  },
});

/** Count time entries for a task where isBillable differs from a target value. */
export const countMismatchedBillable = query({
  args: {
    taskId: v.id("tasks"),
    targetBillable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) return 0;

    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();

    return entries.filter((e) => e.isBillable !== args.targetBillable).length;
  },
});

/** Bulk-update isBillable on all time entries for a task. */
export const bulkUpdateBillable = mutation({
  args: {
    taskId: v.id("tasks"),
    isBillable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin) throw new ConvexError("Only admins can bulk-update billability");

    if (!task.projectId) throw new ConvexError("Task has no project");
    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");

    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();

    const now = Date.now();
    let updated = 0;
    for (const entry of entries) {
      if (entry.isBillable === args.isBillable) continue;
      // Skip invoiced entries (future-proofing)
      if ("invoicedInReportId" in entry && entry.invoicedInReportId) continue;

      // Re-resolve per entry (each entry may belong to a different user)
      const snapshot = await resolveRateSnapshot(ctx, {
        userId: entry.userId,
        orgId,
        task,
        project,
        isBillable: args.isBillable,
      });

      await ctx.db.patch(entry._id, {
        isBillable: args.isBillable,
        costRate: snapshot.costRate,
        billableRate: snapshot.billableRate,
        rateCurrency: snapshot.rateCurrency,
        snapshotCategoryId: task.workCategoryId ?? undefined,
        updatedAt: now,
      });
      updated++;
    }

    return { updated };
  },
});

// Legacy countMissingCostRates and backfillMissingCostRates removed —
// the new rate model requires costRate on every entry at creation time.

// ─── Project Reporting Queries ──────────────────────────────────────────────────

/**
 * Aggregate overview metrics for a project — used by Fixed and T&M overviews
 * and the project header "Last activity" date.
 */
export const projectOverview = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;

    // Fetch all tasks for this project (including archived — historical reporting)
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    // Fetch all time entries per task in parallel
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .collect();
          return entries.map((e) => ({
            ...e,
            workCategoryId: e.snapshotCategoryId ?? task.workCategoryId,
          }));
        }),
      )
    ).flat();

    // Get org timezone for "this month" computation
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const nowDate = getDateInTimezone(Date.now(), timezone);
    const currentMonth = nowDate.slice(0, 7); // "YYYY-MM"

    // Compute aggregates
    let totalMinutes = 0;
    let totalBillableMinutes = 0;
    let totalNonBillableMinutes = 0;
    let thisMonthBillableMinutes = 0;
    let totalActualCost = 0;
    let uninvoicedMinutes = 0;
    let uninvoicedAmount = 0;
    let lastLoggedDate: string | null = null;
    const minutesByCategory: Record<string, number> = {};
    const billableMinutesByCategory: Record<string, number> = {};
    const billableByMonth: Record<string, number> = {};

    for (const e of allEntries) {
      totalMinutes += e.durationMinutes;

      if (e.isBillable) {
        totalBillableMinutes += e.durationMinutes;
      } else {
        totalNonBillableMinutes += e.durationMinutes;
      }

      // This month — billable only (displayed under T&M "Billable Time" card)
      if (e.isBillable && e.date.startsWith(currentMonth)) {
        thisMonthBillableMinutes += e.durationMinutes;
      }

      // Category breakdowns
      const catKey = e.workCategoryId?.toString() ?? "uncategorized";
      minutesByCategory[catKey] = (minutesByCategory[catKey] ?? 0) + e.durationMinutes;
      if (e.isBillable) {
        billableMinutesByCategory[catKey] =
          (billableMinutesByCategory[catKey] ?? 0) + e.durationMinutes;
      }

      // Labor cost from costRate (all project types)
      totalActualCost += (e.durationMinutes / 60) * (e.costRate ?? 0);

      // Uninvoiced from billable entries using billableRate (T&M / Fixed only).
      // Retainer entries have billableRate=0 — retainer revenue is cycle-level
      // (monthlyFee + overageDue), computed in getRetainerData, not here.
      // NOTE: Pre-invoicing phase — all billable entries treated as uninvoiced.
      // Replace with invoice-aware filtering when invoicedInReportId ships.
      if (e.isBillable) {
        uninvoicedMinutes += e.durationMinutes;
        uninvoicedAmount += (e.durationMinutes / 60) * (e.billableRate ?? 0);
      }

      // Last logged date
      if (!lastLoggedDate || e.date > lastLoggedDate) {
        lastLoggedDate = e.date;
      }

      // Billable by month (for 3-month trend)
      if (e.isBillable) {
        const monthKey = e.date.slice(0, 7);
        billableByMonth[monthKey] = (billableByMonth[monthKey] ?? 0) + e.durationMinutes;
      }
    }

    // Last 3 billable months: compute the 3 calendar months ending with current month
    const last3BillableMonths = computeLast3Months(currentMonth).map((month) => ({
      month,
      minutes: billableByMonth[month] ?? 0,
    }));

    return {
      totalMinutes,
      totalBillableMinutes,
      totalNonBillableMinutes,
      lastLoggedDate,
      thisMonthBillableMinutes,
      last3BillableMonths,
      minutesByCategory,
      billableMinutesByCategory,
      totalActualCost,
      uninvoicedMinutes,
      uninvoicedAmount,
    };
  },
});

/**
 * Monthly breakdown of time entries for a project — grouped by month, then
 * billable/non-billable, then category, then task. Used by Fixed and T&M overviews.
 */
export const projectMonthlyBreakdown = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    // Fetch all tasks (including archived)
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    const taskMap = new Map(tasks.map((t) => [t._id.toString(), t]));

    // Fetch work categories for enrichment
    const categories = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const catMap = new Map(categories.map((c) => [c._id.toString(), c]));

    // Fetch all time entries per task
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .collect();
          return entries.map((e) => ({
            ...e,
            taskId: task._id.toString(),
            taskTitle: task.title,
            workCategoryId: (e.snapshotCategoryId ?? task.workCategoryId)?.toString() ?? null,
          }));
        }),
      )
    ).flat();

    // Group entries by month
    const entriesByMonth: Record<string, typeof allEntries> = {};
    for (const e of allEntries) {
      const monthKey = e.date.slice(0, 7);
      (entriesByMonth[monthKey] ??= []).push(e);
    }

    // Build month data
    const months = Object.keys(entriesByMonth)
      .sort((a, b) => b.localeCompare(a)) // descending
      .map((monthKey) => {
        const monthEntries = entriesByMonth[monthKey];
        const billableEntries = monthEntries.filter((e) => e.isBillable);
        const nonBillableEntries = monthEntries.filter((e) => !e.isBillable);

        const totalMinutes = monthEntries.reduce((s, e) => s + e.durationMinutes, 0);
        // totalAmount: billable revenue from billableRate (T&M / Fixed only).
        // Retainer entries have billableRate=0; retainer revenue is cycle-level.
        const totalAmount = billableEntries.reduce(
          (s, e) => s + (e.durationMinutes / 60) * (e.billableRate ?? 0),
          0,
        );

        const billableCategoryGroups = buildCategoryGroups(
          billableEntries,
          catMap,
          true, // billable entries always show amounts
        );
        const nonBillableCategoryGroups = buildCategoryGroups(
          nonBillableEntries,
          catMap,
          false, // non-billable never shows amounts
        );

        // Unique tasks and categories
        const uniqueTaskIds = new Set(monthEntries.map((e) => e.taskId));
        const uniqueCatIds = new Set(monthEntries.map((e) => e.workCategoryId ?? "uncategorized"));

        // Month label: "March 2026"
        const [y, m] = monthKey.split("-").map(Number);
        const monthLabel = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

        return {
          month: monthKey,
          monthLabel,
          totalMinutes,
          totalAmount,
          entryCount: monthEntries.length,
          billableCategoryGroups,
          nonBillableCategoryGroups,
          taskCount: uniqueTaskIds.size,
          categoryCount: uniqueCatIds.size,
        };
      });

    return months;
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Compute the last 3 calendar months ending with the given month. */
export function computeLast3Months(currentMonth: string): string[] {
  const [y, m] = currentMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  return months;
}

type EntryWithTask = {
  durationMinutes: number;
  date: string;
  taskId: string;
  taskTitle: string;
  workCategoryId: string | null;
  billableRate?: number;
};

type CategoryDoc = { _id: { toString(): string }; name: string; color: string };

/** Group entries by category then task. Used by both Fixed/T&M monthly breakdown. */
function buildCategoryGroups(
  entries: EntryWithTask[],
  catMap: Map<string, CategoryDoc>,
  includeAmounts: boolean,
) {
  // Group by category
  const byCat: Record<
    string,
    { catId: string | null; entries: EntryWithTask[] }
  > = {};
  for (const e of entries) {
    const key = e.workCategoryId ?? "uncategorized";
    if (!byCat[key]) byCat[key] = { catId: e.workCategoryId, entries: [] };
    byCat[key].entries.push(e);
  }

  // Build category groups sorted by name
  return Object.values(byCat)
    .map(({ catId, entries: catEntries }) => {
      const cat = catId ? catMap.get(catId) : null;
      const categoryName = cat?.name ?? "No category";
      const categoryColor = cat?.color ?? "gray";

      // Group by task
      const byTask: Record<string, EntryWithTask[]> = {};
      for (const e of catEntries) {
        (byTask[e.taskId] ??= []).push(e);
      }

      const tasks = Object.entries(byTask)
        .map(([taskId, taskEntries]) => {
          const totalMinutes = taskEntries.reduce(
            (s, e) => s + e.durationMinutes,
            0,
          );
          const dates = taskEntries.map((e) => e.date).sort();
          return {
            taskId,
            taskTitle: taskEntries[0].taskTitle,
            totalMinutes,
            firstDate: dates[0],
            lastDate: dates[dates.length - 1],
            entryCount: taskEntries.length,
          };
        })
        // Sort by lastDate descending
        .sort((a, b) => b.lastDate.localeCompare(a.lastDate));

      const totalMinutes = catEntries.reduce(
        (s, e) => s + e.durationMinutes,
        0,
      );
      const totalAmount = includeAmounts
        ? catEntries.reduce(
            (s, e) => s + (e.durationMinutes / 60) * (e.billableRate ?? 0),
            0,
          )
        : 0;

      return {
        workCategoryId: catId,
        categoryName,
        categoryColor,
        totalMinutes,
        totalAmount,
        tasks,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}
