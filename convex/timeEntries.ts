import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { roundMinutes } from "./lib/rounding";
import { getDateInTimezone } from "./lib/timer";
import { resolveRate } from "./lib/rates";
import { getOrgSettings, buildRateContext } from "./lib/orgHelpers";
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

    // Rate snapshot
    const rateCtx = await buildRateContext(ctx, task, project);
    const rateResult = resolveRate(rateCtx);
    if (!rateResult.ok) {
      throw new ConvexError(rateResult.error);
    }

    // Billable default from task
    const isBillable = args.isBillable ?? task.billable;

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
      ...rateResult.snapshot,
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
      updates.isBillable = args.isBillable;
    }

    // Rate snapshot does NOT update on edit (stays from creation time)

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
