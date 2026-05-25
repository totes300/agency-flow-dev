import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { roundMinutes } from "./lib/rounding";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { getOrgSettings, resolveRateSnapshot } from "./lib/orgHelpers";
import { validateAssignees } from "./lib/task_helpers";
import { assertValidDateString } from "./lib/dateValidation";
import { assertEntryDateOpen } from "./lib/settleGuards";
import type { EntrySettlementSnapshot } from "./lib/types";
import { billableOverviewBucket } from "./lib/settleEntries";
import { logActivity } from "./activityLog";

function formatDurationHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

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
      .filter((q) => q.eq(q.field("orgId"), orgId))
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
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
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
          .filter((q) => q.eq(q.field("orgId"), orgId))
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
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
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
          .filter((q) => q.eq(q.field("orgId"), orgId))
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
    startedAt: v.number(),                    // wall-clock start, epoch ms
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

    if (args.date) assertValidDateString(args.date);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== auth.orgId) throw new ConvexError("Task not found");
    if (task.archivedAt) throw new ConvexError("Cannot log time on an archived task");
    if (!task.projectId) throw new ConvexError("Assign a project first");

    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");

    // Get org settings
    const orgSettings = await getOrgSettings(ctx, auth.orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const roundingMinutes = orgSettings?.roundingMinutes ?? 1;

    // Round duration
    const rounded = roundMinutes(args.durationMinutes, roundingMinutes);
    if (rounded <= 0) throw new ConvexError("Duration must be greater than 0");

    // Invariant: date === getDateInTimezone(startedAt, orgTz). startedAt wins.
    const date = getDateInTimezone(args.startedAt, timezone);
    if (args.date !== undefined && args.date !== date) {
      throw new ConvexError(
        `date (${args.date}) does not match startedAt's day (${date}).`,
      );
    }

    // Phase 8 — closed-retainer-period guard (Slice 3). No-op for non-retainer
    // projects. Runs after the date is resolved so it sees the actual day the
    // entry will file under (not the user-supplied `args.date`, which may
    // disagree with `startedAt` and is rejected above).
    await assertEntryDateOpen(ctx, project, date);

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
      startedAt: args.startedAt,
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

    await logActivity(ctx, {
      taskId: args.taskId,
      orgId: auth.orgId,
      userId: auth.userId,
      type: "time_entry_logged",
      metadata: {
        entryId,
        duration: formatDurationHHMM(rounded),
        note: args.note?.trim() || null,
      },
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
    startedAt: v.optional(v.number()),
    isBillable: v.optional(v.boolean()),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const { userId, orgId, isAdmin } = await getAuthContext(ctx);

    const entry = await ctx.db.get(args.id);
    if (!entry || entry.orgId !== orgId) throw new ConvexError("Time entry not found");

    // Permission check
    if (!isAdmin && entry.userId !== userId) {
      throw new ConvexError("You can only edit your own time entries");
    }

    // Phase 8 — settlement guard. `invoiceId` covers T&M / Fixed / retainer
    // overage; `settledAt` covers retainer within-budget close (Slice 3,
    // populates without an invoice). Distinct messages so the unblock path
    // is obvious to the user.
    if (entry.invoiceId !== undefined) {
      throw new ConvexError(
        "Cannot edit a time entry linked to an invoice — delete or void the invoice first",
      );
    }
    if (entry.settledAt !== undefined) {
      throw new ConvexError(
        "Cannot edit a settled time entry — reopen the period first",
      );
    }

    if (args.date !== undefined) assertValidDateString(args.date);

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

    // Invariant (see create): date === getDateInTimezone(startedAt, orgTz).
    // Server doesn't re-anchor; clients call reanchorStartedAt and send both.
    let nextDate = entry.date;
    if (args.date !== undefined || args.startedAt !== undefined) {
      const orgSettings = await getOrgSettings(ctx, orgId);
      const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
      const nextStartedAt = args.startedAt ?? entry.startedAt;
      nextDate = args.date ?? entry.date;
      const derivedDate = getDateInTimezone(nextStartedAt, timezone);
      if (nextDate !== derivedDate) {
        throw new ConvexError(
          `date (${nextDate}) does not match startedAt's day (${derivedDate}). When changing date, also send a re-anchored startedAt.`,
        );
      }
      if (args.startedAt !== undefined) updates.startedAt = nextStartedAt;
      if (args.date !== undefined) updates.date = nextDate;
    }

    // Resolve target task if a change was requested. All downstream rate
    // re-resolution (billable toggle OR task swap) must point at the SAME
    // task doc, so fetch once.
    const targetTaskId = args.taskId ?? entry.taskId;
    const taskChanged = args.taskId !== undefined && args.taskId !== entry.taskId;

    let targetTask: Doc<"tasks"> | null = null;
    async function loadTargetTask(): Promise<Doc<"tasks">> {
      if (targetTask) return targetTask;
      const fetched = await ctx.db.get(targetTaskId);
      if (!fetched || fetched.orgId !== orgId) {
        throw new ConvexError("Task not found");
      }
      targetTask = fetched;
      return fetched;
    }

    if (taskChanged) {
      const task = await loadTargetTask();
      if (task.archivedAt) {
        throw new ConvexError("Cannot move time to an archived task");
      }
      if (!task.projectId) {
        throw new ConvexError("Target task must belong to a project");
      }
      // Preserve the "same project" invariant: moving a time entry across
      // projects would break project-level reporting and rate cascades.
      const oldTask = await ctx.db.get(entry.taskId);
      if (!oldTask || oldTask.projectId !== task.projectId) {
        throw new ConvexError("Target task must belong to the same project");
      }
      updates.taskId = task._id;
      updates.snapshotCategoryId = task.workCategoryId;
    }

    // Phase 8 — closed-retainer-period guard on date OR task changes
    // (Slice 3 / Revision Pass #3a). The same-project invariant above
    // means the target project is always the entry's existing project, so
    // we resolve the project once from the entry's task. The guard is a
    // no-op for non-retainer projects.
    //
    // We run AFTER the same-project check so a task swap that would have
    // been rejected for other reasons fails first with its own clearer
    // error. Date-only changes also run through here so a backdated edit
    // into a closed month is rejected with the same hint message as a
    // backdated create.
    const dateChanged = nextDate !== entry.date;
    if (dateChanged || taskChanged) {
      const sourceTask = taskChanged
        ? await loadTargetTask()
        : await ctx.db.get(entry.taskId);
      if (sourceTask?.projectId) {
        const guardProject = await ctx.db.get(sourceTask.projectId);
        if (guardProject) {
          await assertEntryDateOpen(ctx, guardProject, nextDate);
        }
      }
    }

    if (args.isBillable !== undefined) {
      updates.isBillable = args.isBillable;
    }

    // Re-resolve rate snapshot when anything that feeds into rate resolution
    // changed: billable flag, or task (category/project cascade). The snapshot
    // walks category → project → user overrides, so all cases must re-snapshot.
    const billableChanged =
      args.isBillable !== undefined && args.isBillable !== entry.isBillable;
    const effectiveIsBillable = args.isBillable ?? entry.isBillable;

    if (billableChanged || taskChanged) {
      const task = await loadTargetTask();
      if (!task.projectId) throw new ConvexError("Task has no project");
      const project = await ctx.db.get(task.projectId);
      if (!project) throw new ConvexError("Project not found");

      const snapshot = await resolveRateSnapshot(ctx, {
        userId: entry.userId,
        orgId,
        task,
        project,
        isBillable: effectiveIsBillable,
      });
      updates.costRate = snapshot.costRate;
      updates.billableRate = snapshot.billableRate;
      updates.rateCurrency = snapshot.rateCurrency;
      updates.snapshotCategoryId = task.workCategoryId;
    }

    await ctx.db.patch(args.id, updates);

    if (args.durationMinutes !== undefined && updates.durationMinutes !== entry.durationMinutes) {
      await logActivity(ctx, {
        taskId: entry.taskId,
        orgId,
        userId,
        type: "time_entry_edited",
        metadata: {
          entryId: args.id,
          oldDuration: formatDurationHHMM(entry.durationMinutes),
          newDuration: formatDurationHHMM(updates.durationMinutes as number),
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

    // Phase 8 — settlement guard (same rule as `update`).
    if (entry.invoiceId !== undefined) {
      throw new ConvexError(
        "Cannot delete a time entry linked to an invoice — delete or void the invoice first",
      );
    }
    if (entry.settledAt !== undefined) {
      throw new ConvexError(
        "Cannot delete a settled time entry — reopen the period first",
      );
    }

    await logActivity(ctx, {
      taskId: entry.taskId,
      orgId,
      userId,
      type: "time_entry_deleted",
      metadata: { entryId: args.id, duration: formatDurationHHMM(entry.durationMinutes) },
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
      .filter((q) => q.eq(q.field("orgId"), orgId))
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
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();

    const now = Date.now();
    let updated = 0;
    for (const entry of entries) {
      if (entry.isBillable === args.isBillable) continue;
      // Skip locked entries — changing billable status would break the
      // invoice snapshot OR the settled-period report. Both axes apply.
      if (entry.invoiceId !== undefined) continue;
      if (entry.settledAt !== undefined) continue;

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
        snapshotCategoryId: task.workCategoryId,
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
 * Per-entry list for the project Time tab. Flattens across tasks and returns
 * a display-ready row for each entry with task, category, user, and invoice context.
 *
 * Filters (all optional, applied in-memory after org+project tenancy):
 *   - memberId: narrow to entries by a specific user
 *   - billingStatus: "all" | "billable_uninvoiced" | "invoiced" | "non_billable"
 *   - search: case-insensitive match against task title OR entry note
 *
 * Returns `availableMembers`: the dynamic set of users who have logged time on
 * this project (used to populate the member filter dropdown — not just current
 * project.teamMembers, so ex-team-members with billable history still surface).
 */
export const listProjectEntries = query({
  args: {
    projectId: v.id("projects"),
    memberId: v.optional(v.id("users")),
    // Phase 8 vocabulary — collapsed UI states (matches `entryStatus()`):
    //   open         billable && !invoiceId && !settledAt
    //   draft        invoiceId set, settledAt unset (on a draft invoice)
    //   closed       settledAt set (any reason — invoiced/retainer/fixed)
    //   non_billable !isBillable (settled or not — billability is the row axis)
    //   all          no filter
    billingStatus: v.optional(
      v.union(
        v.literal("all"),
        v.literal("open"),
        v.literal("draft"),
        v.literal("closed"),
        v.literal("non_billable"),
      ),
    ),
    search: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.fromDate !== undefined) assertValidDateString(args.fromDate, "fromDate");
    if (args.toDate !== undefined) assertValidDateString(args.toDate, "toDate");
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) {
      return { entries: [], availableMembers: [] };
    }

    // Fetch tasks for this project (orgId-indexed).
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();
    const taskMap = new Map(tasks.map((t) => [t._id.toString(), t]));

    // Fetch all entries for the project's tasks.
    // Tenancy: `by_taskId` doesn't narrow by orgId; filter explicitly (CLAUDE.md).
    const rawEntries = (
      await Promise.all(
        tasks.map((task) =>
          ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect(),
        ),
      )
    ).flat();

    // Members see only their own entries (matches listByTask).
    const visible = isAdmin
      ? rawEntries
      : rawEntries.filter((e) => e.userId === userId);

    // Denormalize: user, category, invoice (tenancy-guarded).
    const userIds = [...new Set(visible.map((e) => e.userId.toString()))];
    const users = await Promise.all(
      userIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    const userMap = new Map(
      users.filter(Boolean).map((u) => [u!._id.toString(), u!]),
    );

    const categoryIds = new Set<string>();
    for (const e of visible) {
      if (e.snapshotCategoryId) categoryIds.add(e.snapshotCategoryId.toString());
    }
    const categories = await Promise.all(
      [...categoryIds].map((id) => ctx.db.get(id as Id<"workCategories">)),
    );
    const categoryMap = new Map(
      categories.filter(Boolean).map((c) => [c!._id.toString(), c!]),
    );

    const invoiceIds = new Set<string>();
    for (const e of visible) {
      if (e.invoiceId) invoiceIds.add(e.invoiceId.toString());
    }
    const invoices = await Promise.all(
      [...invoiceIds].map((id) => ctx.db.get(id as Id<"invoices">)),
    );
    const invoiceMap = new Map(
      invoices
        .filter((inv): inv is NonNullable<typeof inv> => Boolean(inv) && inv!.orgId === orgId)
        .map((inv) => [inv._id.toString(), inv]),
    );

    // Build rows. Settlement fields ride along via the shared
    // `EntrySettlementSnapshot` type so the row, the component-side
    // TimeEntryRow type, and the schema validator all evolve together.
    type Row = EntrySettlementSnapshot & {
      _id: Id<"timeEntries">;
      taskId: Id<"tasks">;
      taskTitle: string;
      userId: Id<"users">;
      userName: string;
      userImageUrl: string | undefined;
      date: string;
      // Wall-clock start in epoch ms — required by the edit form so a date
      // change can re-anchor `startedAt` and keep date/startedAt consistent.
      startedAt: number;
      durationMinutes: number;
      note: string | undefined;
      isBillable: boolean;
      billableRate: number;
      costRate: number;
      workCategoryId: Id<"workCategories"> | undefined;
      workCategoryName: string | undefined;
      workCategoryColor: string | undefined;
      invoiceId: Id<"invoices"> | undefined;
      invoicePrefix: string | undefined;
      invoiceNumber: number | undefined;
      invoiceStatus: "draft" | "invoiced" | "paid" | "void" | undefined;
      invoiceDueDate: string | undefined;
    };

    let rows: Row[] = visible.map((e) => {
      const task = taskMap.get(e.taskId.toString());
      const user = userMap.get(e.userId.toString());
      const catId = e.snapshotCategoryId;
      const cat = catId ? categoryMap.get(catId.toString()) : undefined;
      const inv = e.invoiceId ? invoiceMap.get(e.invoiceId.toString()) : undefined;
      return {
        _id: e._id,
        taskId: e.taskId,
        taskTitle: task?.title ?? "Unknown task",
        userId: e.userId,
        userName: user?.name ?? "Unknown",
        userImageUrl: user?.imageUrl,
        date: e.date,
        startedAt: e.startedAt,
        durationMinutes: e.durationMinutes,
        note: e.note,
        isBillable: e.isBillable,
        billableRate: e.billableRate,
        costRate: e.costRate,
        workCategoryId: catId,
        workCategoryName: cat?.name,
        workCategoryColor: cat?.color,
        invoiceId: inv?._id,
        invoicePrefix: inv?.prefix,
        invoiceNumber: inv?.number,
        invoiceStatus: inv?.status,
        invoiceDueDate: inv?.dueDate,
        settledAt: e.settledAt,
        settledReason: e.settledReason,
        settledPeriodStart: e.settledPeriodStart,
        settledPeriodEnd: e.settledPeriodEnd,
      };
    });

    // Apply filters.
    if (args.fromDate) {
      rows = rows.filter((r) => r.date >= args.fromDate!);
    }
    if (args.toDate) {
      rows = rows.filter((r) => r.date <= args.toDate!);
    }
    if (args.memberId) {
      rows = rows.filter((r) => r.userId === args.memberId);
    }
    if (args.billingStatus && args.billingStatus !== "all") {
      // Phase 8 — collapsed UI vocabulary; mirrors `entryStatus()` in
      // `convex/lib/settleEntries.ts`. The "non_billable" row always wins
      // its axis (settled or not) — billability is the more informative
      // axis for that row per Revision Pass #5.
      rows = rows.filter((r) => {
        if (args.billingStatus === "non_billable") return !r.isBillable;
        if (!r.isBillable) return false;
        if (args.billingStatus === "open") {
          return r.invoiceId === undefined && r.settledAt === undefined;
        }
        if (args.billingStatus === "draft") {
          return r.invoiceId !== undefined && r.settledAt === undefined;
        }
        // closed
        return r.settledAt !== undefined;
      });
    }
    const searchTerm = args.search?.trim().toLowerCase();
    if (searchTerm) {
      rows = rows.filter(
        (r) =>
          r.taskTitle.toLowerCase().includes(searchTerm) ||
          (r.note?.toLowerCase().includes(searchTerm) ?? false),
      );
    }

    // Stable sort: newest date first, then newest creation first.
    const createdAtMap = new Map(visible.map((e) => [e._id.toString(), e.createdAt]));
    rows.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      const aCreated = createdAtMap.get(a._id.toString()) ?? 0;
      const bCreated = createdAtMap.get(b._id.toString()) ?? 0;
      return bCreated - aCreated;
    });

    // Dynamic member list: every user who has an entry on this project
    // (visible to the caller, respecting member-only visibility).
    const availableMembers = [...userMap.values()]
      .map((u) => ({
        id: u._id,
        name: u.name,
        imageUrl: u.imageUrl,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { entries: rows, availableMembers };
  },
});

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
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries.map((e) => ({
            ...e,
            workCategoryId: e.snapshotCategoryId,
          }));
        }),
      )
    ).flat();

    // Get org timezone for "this month" computation
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const nowDate = getDateInTimezone(Date.now(), timezone);
    const currentMonth = nowDate.slice(0, 7); // "YYYY-MM"

    // Compute aggregates
    let totalMinutes = 0;
    let totalBillableMinutes = 0;
    let totalNonBillableMinutes = 0;
    let thisMonthBillableMinutes = 0;
    let totalActualCost = 0;
    // Phase 8 — FOUR buckets over billable entries, in lock-step with
    // `entryStatus()` so the data shape matches the row display:
    //   open      → !invoiceId && !settledAt (needs billing or closure)
    //   draft     → invoiceId && !settledAt  (reserved by a draft invoice;
    //                                          revenue not yet realized)
    //   invoiced  → settledReason === "invoiced" (billed hourly — revenue)
    //   settled   → settledReason ∈ {retainer_included, fixed_included}
    //                                          (covered, no extra revenue)
    //
    // The draft bucket is deliberate: a draft invoice has reserved hours
    // but no finalized revenue. Lumping draft into invoiced would inflate
    // T&M "billed" totals before the invoice is sent; lumping into open
    // would falsely surface those hours in the Ready feed. Distinct bucket
    // keeps reports honest and matches what the row badge already shows.
    let openMinutes = 0;
    let openAmount = 0;
    let draftMinutes = 0;
    let draftAmount = 0;
    let invoicedMinutes = 0;
    let invoicedAmount = 0;
    let settledMinutes = 0;
    let settledAmount = 0;
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

      // Phase 8 — four-way split over billable entries via the shared
      // `billableOverviewBucket` classifier. Pure helper so the rule is
      // testable without convex-test and stays in lock-step with the row
      // badge (`entryStatus()`).
      //
      // Retainer entries within budget have billableRate=0 today — they
      // contribute to the bucket's minutes but $0 to its amount, which is
      // correct (retainer revenue lives in `getRetainerData`'s cycle math).
      if (e.isBillable) {
        const amount = (e.durationMinutes / 60) * (e.billableRate ?? 0);
        switch (billableOverviewBucket(e)) {
          case "invoiced":
            invoicedMinutes += e.durationMinutes;
            invoicedAmount += amount;
            break;
          case "settled":
            settledMinutes += e.durationMinutes;
            settledAmount += amount;
            break;
          case "draft":
            draftMinutes += e.durationMinutes;
            draftAmount += amount;
            break;
          case "open":
            openMinutes += e.durationMinutes;
            openAmount += amount;
            break;
        }
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

    // Invoice count (for all billing types) + Fixed-specific revenue from
    // `fixed`-type line items. Renamed `invoicedAmount` → `fixedLineItemsAmount`
    // in Phase 8 to dodge the collision with the new entry-derived
    // `invoicedAmount` bucket above (T&M / retainer overage time billed
    // hourly via a finalized invoice).
    let fixedLineItemsAmount = 0;
    let invoiceCount = 0;
    if (project.billingType === "fixed" || project.billingType === "t_and_m") {
      const projectInvoices = await ctx.db
        .query("invoices")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("orgId"), orgId))
        .collect();
      invoiceCount = projectInvoices.length;

      if (project.billingType === "fixed") {
        for (const inv of projectInvoices) {
          const lineItems = await ctx.db
            .query("invoiceLineItems")
            .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          for (const li of lineItems) {
            if (li.lineType === "fixed") fixedLineItemsAmount += li.amount;
          }
        }
      }
    }

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
      // ─── Phase 8 — entry-derived billing buckets ────────────────────────
      // Time-based figures from the entry ledger (hours × billableRate
      // snapshot). Four buckets, lock-step with `entryStatus()`.
      // For the Invoices tab "Total Invoiced" money figure (which includes
      // manual/overage lines), use api.invoices.getProjectInvoiceMetrics
      // instead — that one is invoice-derived, not entry-derived.
      openMinutes,     // was `uninvoicedMinutes`     — !invoiceId && !settledAt
      openAmount,      // was `uninvoicedAmount`
      draftMinutes,    // NEW — invoiceId && !settledAt (reserved by draft)
      draftAmount,     // NEW
      invoicedMinutes, // was `invoicedBillableMinutes` — settledReason === "invoiced"
      invoicedAmount,  // was `invoicedBillableAmount`
      settledMinutes,  // NEW — settledReason ∈ {retainer_included, fixed_included}
      settledAmount,   // NEW
      invoiceCount,
      // Fixed-specific — sum of `fixed`-type line items across invoices.
      // Distinct from `invoicedAmount` above (entry-derived).
      fixedLineItemsAmount,
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
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect();
          return entries.map((e) => ({
            ...e,
            taskId: task._id.toString(),
            taskTitle: task.title,
            workCategoryId: e.snapshotCategoryId?.toString() ?? null,
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
