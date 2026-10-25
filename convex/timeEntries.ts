import { v, ConvexError } from "convex/values";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import { assertAdmin, getAuthContext, requireAdmin, type AuthContext } from "./lib/auth";
import { roundMinutes } from "./lib/rounding";
import { formatDurationHHMM, getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { getOrgSettings, getProjectCurrency, resolveRateSnapshot, resolveEntryCategory } from "./lib/orgHelpers";
import { validateAssignees } from "./lib/task_helpers";
import { assertValidDateString } from "./lib/dateValidation";
import type { EntryCloseSnapshot } from "./lib/types";
import { billableOverviewBucket, entryStatus } from "./lib/entryStatus";
import { loadEntryCloseInfo } from "./lib/billing/entryCloseInfo";
import { ceilToIncrement, fromMinor, priceMinutesMinor, toMinor } from "./lib/billing/money";
import { logActivity } from "./activityLog";
import { onTimeEntryChange } from "./tasks/derived";
import { getProjectEntries } from "./lib/projectEntries";

/**
 * Validate that an explicit work category belongs to the caller's org before
 * it is used as an entry's billing category. Throws on cross-org / missing.
 */
async function assertCategoryInOrg(
  ctx: { db: { get: (id: Id<"workCategories">) => Promise<Doc<"workCategories"> | null> } },
  orgId: string,
  workCategoryId: Id<"workCategories">,
): Promise<void> {
  const cat = await ctx.db.get(workCategoryId);
  if (!cat || cat.orgId !== orgId) throw new ConvexError("Category not found");
}

/**
 * Lock message for an entry settled by a live close (billing refactor, N1).
 * The unblock path depends on whether the close is still a draft.
 */
async function closeLockMessage(
  ctx: { db: GenericDatabaseReader<DataModel> },
  closeId: Id<"billingCloses">,
  action: "edit" | "delete",
): Promise<string> {
  const close = await ctx.db.get(closeId);
  if (close?.status === "draft") {
    // A reverted draft keeps its number and can only be voided (N9).
    const invoice = close.invoiceId ? await ctx.db.get(close.invoiceId) : null;
    return invoice?.number != null
      ? `Cannot ${action} a time entry that's on a draft invoice — void the invoice first`
      : `Cannot ${action} a time entry that's on a draft invoice — delete the draft first`;
  }
  return close?.invoiceId
    ? `Cannot ${action} a time entry linked to an invoice — void the invoice first`
    : `Cannot ${action} a time entry in a closed period — reopen the period first`;
}

// ─── Queries ────────────────────────────────────────────────────────────────────

/**
 * Time-entry visibility, shared by every entry list (UI and MCP): admins see
 * every entry of the org, members only their own.
 */
export function visibleTimeEntries<E extends Pick<Doc<"timeEntries">, "userId">>(
  auth: Pick<AuthContext, "userId" | "isAdmin">,
  entries: readonly E[],
): E[] {
  return auth.isAdmin ? [...entries] : entries.filter((e) => e.userId === auth.userId);
}

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
    const filtered = visibleTimeEntries({ userId, isAdmin }, entries);

    // Enrich with user info
    const userIds = [...new Set(filtered.map((e) => e.userId.toString()))];
    const users = await Promise.all(
      userIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    const userMap = new Map(
      users.filter(Boolean).map((u) => [u!._id.toString(), u!]),
    );

    // Close state + its invoice number, so the row badge and lock tooltip
    // read the same as on the project Time tab.
    const closeInfo = await loadEntryCloseInfo(ctx, orgId, filtered);
    const invoiceById = new Map<string, Doc<"invoices">>();
    for (const info of closeInfo.values()) {
      if (!info.closeInvoiceId || invoiceById.has(info.closeInvoiceId)) continue;
      const inv = await ctx.db.get(info.closeInvoiceId);
      if (inv && inv.orgId === orgId) invoiceById.set(inv._id, inv);
    }

    return filtered
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .map((e) => {
        const user = userMap.get(e.userId.toString());
        const close = e.closeId ? closeInfo.get(e.closeId) : undefined;
        const inv = close?.closeInvoiceId ? invoiceById.get(close.closeInvoiceId) : undefined;
        const snapshot: EntryCloseSnapshot = close
          ? {
              closeStatus: close.closeStatus,
              closeKind: close.closeKind,
              closePeriodStart: close.closePeriodStart,
              closePeriodEnd: close.closePeriodEnd,
              closedAt: close.closedAt,
            }
          : {};
        return {
          ...e,
          ...snapshot,
          invoiceId: inv?._id,
          invoicePrefix: inv?.prefix,
          invoiceNumber: inv?.number,
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

    let totalMinutes = 0;
    const minutesByDate: Record<string, number> = {};
    for (const e of await getProjectEntries(ctx, orgId, args.projectId)) {
      totalMinutes += e.durationMinutes;
      minutesByDate[e.date] = (minutesByDate[e.date] ?? 0) + e.durationMinutes;
    }

    return { totalMinutes, minutesByDate, taskCount: taskIds.size };
  },
});

// ─── Write cores (shared by the mutations below and MCP save_time_entries) ───

export type CreateTimeEntryInput = {
  taskId: Id<"tasks">;
  durationMinutes: number;
  /** Wall-clock start, epoch ms. */
  startedAt: number;
  note?: string;
  isBillable?: boolean;
  date?: string;
  /** Admin logging on behalf of another member. */
  userId?: Id<"users">;
  /** Explicit category override. */
  workCategoryId?: Id<"workCategories">;
};

/**
 * Logs a manual time entry as `auth`: members for themselves, admins for any
 * member; the category via the member-default chain and the rate snapshot for
 * the entry's owner; the `time_entry_logged` activity row (with `auth.via`
 * for an agent write, docs/prd-mcp.md D15).
 */
export async function createTimeEntryForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: CreateTimeEntryInput,
): Promise<Id<"timeEntries">> {
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

  // RAW LEDGER (2026-07-05 rounding-policy decision): store the duration
  // as entered, whole-minute ceil only. The workspace rounding setting is
  // an invoice-time rule and never mutates the ledger.
  const rounded = roundMinutes(args.durationMinutes, 1);
  if (rounded <= 0) throw new ConvexError("Duration must be greater than 0");

  // Invariant: date === getDateInTimezone(startedAt, orgTz). startedAt wins.
  const date = getDateInTimezone(args.startedAt, timezone);
  if (args.date !== undefined && args.date !== date) {
    throw new ConvexError(
      `date (${args.date}) does not match startedAt's day (${date}).`,
    );
  }

  // No closed-period date guard (billing refactor, story 28): time logged
  // into an already-closed period is open and carries into the next close.

  // Determine billable before rate resolution — non-billable entries skip rate enforcement
  const isBillable = args.isBillable ?? task.billable;

  // Billing category (member-default chain). Owner is the entry's user, never
  // the acting admin. An explicit selection must be org-validated before use.
  if (args.workCategoryId) {
    await assertCategoryInOrg(ctx, auth.orgId, args.workCategoryId);
  }
  const snapshotCategoryId = await resolveEntryCategory(ctx, {
    ownerUserId: entryUserId,
    orgId: auth.orgId,
    task,
    explicit: args.workCategoryId,
  });

  // Rate snapshot (new model) — same category used for the row snapshot below.
  const rateSnapshot = await resolveRateSnapshot(ctx, {
    userId: entryUserId,
    orgId: auth.orgId,
    workCategoryId: snapshotCategoryId,
    project,
    isBillable,
  });

  const now = Date.now();
  const entryId = await ctx.db.insert("timeEntries", {
    orgId: auth.orgId,
    projectId: project._id,
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
    snapshotCategoryId,
    createdAt: now,
    updatedAt: now,
    createdBy: auth.userId,
  });

  await onTimeEntryChange(ctx, args.taskId, rounded);

  await logActivity(ctx, {
    taskId: args.taskId,
    orgId: auth.orgId,
    userId: auth.userId,
    via: auth.via,
    type: "time_entry_logged",
    metadata: {
      entryId,
      duration: formatDurationHHMM(rounded),
      note: args.note?.trim() || null,
    },
  });

  return entryId;
}

export type UpdateTimeEntryInput = {
  id: Id<"timeEntries">;
  durationMinutes?: number;
  note?: string | null;
  date?: string;
  startedAt?: number;
  isBillable?: boolean;
  taskId?: Id<"tasks">;
  /** Explicit category change. */
  workCategoryId?: Id<"workCategories">;
};

/**
 * Edits a time entry as `auth`: members their own, admins any in the org.
 * An entry settled by a live close (`closeId`: closed period, draft or final
 * invoice) is refused with the unblock path. A duration change logs
 * `time_entry_edited` (with `auth.via`, D15).
 */
export async function updateTimeEntryForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: UpdateTimeEntryInput,
): Promise<void> {
  const { userId, orgId, isAdmin } = auth;

  const entry = await ctx.db.get(args.id);
  if (!entry || entry.orgId !== orgId) throw new ConvexError("Time entry not found");

  // Permission check
  if (!isAdmin && entry.userId !== userId) {
    throw new ConvexError("You can only edit your own time entries");
  }

  // Close lock (N1): an entry settled by a live close is read-only.
  if (entry.closeId !== undefined) {
    throw new ConvexError(await closeLockMessage(ctx, entry.closeId, "edit"));
  }

  if (args.date !== undefined) assertValidDateString(args.date);

  // Explicit category change must be org-validated before it touches the row.
  if (args.workCategoryId !== undefined) {
    await assertCategoryInOrg(ctx, orgId, args.workCategoryId);
  }

  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (args.durationMinutes !== undefined) {
    // Raw ledger: whole-minute ceil only (see create above).
    const rounded = roundMinutes(args.durationMinutes, 1);
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
    // Sticky category (locked decision): a task move never re-derives
    // snapshotCategoryId. The entry keeps the discipline it was logged under.
  }

  if (args.isBillable !== undefined) {
    updates.isBillable = args.isBillable;
  }

  // Re-resolve the rate snapshot only when the entry's OWN category changes
  // (explicit edit) or billability toggles. A task move does NOT re-resolve:
  // the category is sticky and the same-project invariant keeps the rate
  // cascade identical. The category feeding both the rate lookup and the
  // stored snapshot is the explicit selection, else the entry's current
  // (sticky) category — never the task's.
  const categoryChanged =
    args.workCategoryId !== undefined && args.workCategoryId !== entry.snapshotCategoryId;
  const billableChanged =
    args.isBillable !== undefined && args.isBillable !== entry.isBillable;
  const effectiveIsBillable = args.isBillable ?? entry.isBillable;

  if (categoryChanged || billableChanged) {
    const nextCategoryId = args.workCategoryId ?? entry.snapshotCategoryId;
    const task = await loadTargetTask();
    if (!task.projectId) throw new ConvexError("Task has no project");
    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");

    const snapshot = await resolveRateSnapshot(ctx, {
      userId: entry.userId,
      orgId,
      workCategoryId: nextCategoryId,
      project,
      isBillable: effectiveIsBillable,
    });
    updates.costRate = snapshot.costRate;
    updates.billableRate = snapshot.billableRate;
    updates.rateCurrency = snapshot.rateCurrency;
    updates.snapshotCategoryId = nextCategoryId;
  }

  await ctx.db.patch(args.id, updates);

  // trackedMinutes (§5.5): a move takes the old minutes off the source
  // task and puts the new ones on the target.
  const nextMinutes = (updates.durationMinutes as number | undefined) ?? entry.durationMinutes;
  const nextTaskId = (updates.taskId as Id<"tasks"> | undefined) ?? entry.taskId;
  if (nextTaskId !== entry.taskId) {
    await onTimeEntryChange(ctx, entry.taskId, -entry.durationMinutes);
    await onTimeEntryChange(ctx, nextTaskId, nextMinutes);
  } else {
    await onTimeEntryChange(ctx, entry.taskId, nextMinutes - entry.durationMinutes);
  }

  if (args.durationMinutes !== undefined && updates.durationMinutes !== entry.durationMinutes) {
    await logActivity(ctx, {
      taskId: entry.taskId,
      orgId,
      userId,
      via: auth.via,
      type: "time_entry_edited",
      metadata: {
        entryId: args.id,
        oldDuration: formatDurationHHMM(entry.durationMinutes),
        newDuration: formatDurationHHMM(updates.durationMinutes as number),
      },
    });
  }
}

/**
 * Deletes a time entry as `auth`: members their own, admins any in the org;
 * close-locked entries are refused (same rule as `updateTimeEntryForAuth`).
 * Logs `time_entry_deleted` (with `auth.via`, D15).
 */
export async function removeTimeEntryForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  id: Id<"timeEntries">,
): Promise<void> {
  const { userId, orgId, isAdmin } = auth;
  const entry = await ctx.db.get(id);
  if (!entry || entry.orgId !== orgId) throw new ConvexError("Time entry not found");

  if (!isAdmin && entry.userId !== userId) {
    throw new ConvexError("You can only delete your own time entries");
  }

  // Close lock (N1), same rule as `update`.
  if (entry.closeId !== undefined) {
    throw new ConvexError(await closeLockMessage(ctx, entry.closeId, "delete"));
  }

  await logActivity(ctx, {
    taskId: entry.taskId,
    orgId,
    userId,
    via: auth.via,
    type: "time_entry_deleted",
    metadata: { entryId: id, duration: formatDurationHHMM(entry.durationMinutes) },
  });

  await ctx.db.delete(id);
  await onTimeEntryChange(ctx, entry.taskId, -entry.durationMinutes);
}

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
    workCategoryId: v.optional(v.id("workCategories")), // explicit category override
  },
  handler: async (ctx, args) => {
    return await createTimeEntryForAuth(ctx, await getAuthContext(ctx), args);
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
    workCategoryId: v.optional(v.id("workCategories")), // explicit category change
  },
  handler: async (ctx, args) => {
    await updateTimeEntryForAuth(ctx, await getAuthContext(ctx), args);
  },
});

export const remove = mutation({
  args: { id: v.id("timeEntries") },
  handler: async (ctx, args) => {
    await removeTimeEntryForAuth(ctx, await getAuthContext(ctx), args.id);
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
      // Skip close-locked entries — their billability is frozen in the
      // close snapshot (N1, N2).
      if (entry.closeId !== undefined) continue;

      // Re-resolve per entry (each entry may belong to a different user) using
      // the entry's OWN sticky category, never the task's — a billable toggle
      // must not silently re-snapshot the discipline.
      const snapshot = await resolveRateSnapshot(ctx, {
        userId: entry.userId,
        orgId,
        workCategoryId: entry.snapshotCategoryId,
        project,
        isBillable: args.isBillable,
      });

      await ctx.db.patch(entry._id, {
        isBillable: args.isBillable,
        costRate: snapshot.costRate,
        billableRate: snapshot.billableRate,
        rateCurrency: snapshot.rateCurrency,
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
    // Collapsed UI states (matches `entryStatus()`):
    //   open         billable, no live close
    //   draft        settled by a close whose invoice is a draft
    //   closed       settled by a final close
    //   non_billable !isBillable (closed or not — billability is the row axis)
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

    const rawEntries = await getProjectEntries(ctx, orgId, args.projectId);

    // Members see only their own entries (matches listByTask).
    const visible = visibleTimeEntries({ userId, isAdmin }, rawEntries);

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

    const closeInfo = await loadEntryCloseInfo(ctx, orgId, visible);
    const invoiceIdOf = (e: Doc<"timeEntries">) =>
      e.closeId ? closeInfo.get(e.closeId)?.closeInvoiceId : undefined;
    const invoiceIds = new Set<string>();
    for (const e of visible) {
      const id = invoiceIdOf(e);
      if (id) invoiceIds.add(id.toString());
    }
    const invoices = await Promise.all(
      [...invoiceIds].map((id) => ctx.db.get(id as Id<"invoices">)),
    );
    const invoiceMap = new Map(
      invoices
        .filter((inv): inv is NonNullable<typeof inv> => Boolean(inv) && inv!.orgId === orgId)
        .map((inv) => [inv._id.toString(), inv]),
    );

    // Build rows. Close fields ride along via the shared `EntryCloseSnapshot`
    // type so the row and the component-side TimeEntryRow evolve together.
    type Row = EntryCloseSnapshot & {
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
      /**
       * Ledger value of the entry (minutes × its rate snapshot), raw — a
       * reporting figure, never rounded (the bill comes from the close). The
       * UI sums it and never multiplies rates itself.
       */
      amount: number;
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
      const invoiceId = invoiceIdOf(e);
      const inv = invoiceId ? invoiceMap.get(invoiceId.toString()) : undefined;
      const close = e.closeId ? closeInfo.get(e.closeId) : undefined;
      return {
        _id: e._id,
        closeStatus: close?.closeStatus,
        closeKind: close?.closeKind,
        closePeriodStart: close?.closePeriodStart,
        closePeriodEnd: close?.closePeriodEnd,
        closedAt: close?.closedAt,
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
        amount: (e.durationMinutes / 60) * e.billableRate,
        workCategoryId: catId,
        workCategoryName: cat?.name,
        workCategoryColor: cat?.color,
        invoiceId: inv?._id,
        invoicePrefix: inv?.prefix,
        invoiceNumber: inv?.number,
        invoiceStatus: inv?.status,
        invoiceDueDate: inv?.dueDate,
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
      // The row badge's own rule, so the filter can never disagree with it.
      rows = rows.filter((r) => entryStatus(r) === args.billingStatus);
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
 * and the project header "Last activity" date. Admin-only: it carries amounts
 * and cost (A13).
 */
export const projectOverview = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => await projectOverviewForAuth(ctx, await requireAdmin(ctx), args),
});

/**
 * `projectOverview` for an already-built auth context (UI and MCP `report`).
 * Admin-only, like the query (A13): it carries amounts and cost.
 */
export async function projectOverviewForAuth(ctx: QueryCtx, auth: AuthContext, args: { projectId: Id<"projects"> }) {
  assertAdmin(auth);
  const { orgId } = auth;

  const project = await ctx.db.get(args.projectId);
  if (!project || project.orgId !== orgId) return null;

  // Every entry of the project, archived tasks included (historical reporting).
  const allEntries = (await getProjectEntries(ctx, orgId, args.projectId)).map((e) => ({
    ...e,
    workCategoryId: e.snapshotCategoryId,
  }));
  const closeInfo = await loadEntryCloseInfo(ctx, orgId, allEntries);

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
  // FOUR buckets over billable entries, in lock-step with `entryStatus()`
  // so the data shape matches the row display (`billableOverviewBucket`):
  //   open      → no live close (needs billing or closure)
  //   draft     → close with a draft invoice
  //   invoiced  → final T&M close
  //   settled   → final retainer close (covered, no extra revenue)
  //
  // Money totals use ONE definition of billed (A15, PRD §6.8): billed =
  // covered by a live close, draft or final — `billedMinutes/Amount` below,
  // the same rule as `computeTmSummary`. The draft bucket stays for the
  // row badge only; no surface shows "Draft" as a money column.
  let openMinutes = 0;
  let openAmount = 0;
  // `openAmount` (the open, unbilled amount on the overview) groups like
  // a T&M close — by (category, task, rate), rounded up with the
  // workspace default.
  const defaultRounding = orgSettings?.roundingMinutes ?? 1;
  const openGroups = new Map<string, { minutes: number; rate: number }>();
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
      const close = e.closeId ? closeInfo.get(e.closeId) : undefined;
      switch (billableOverviewBucket(close ?? {})) {
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
        case "open": {
          openMinutes += e.durationMinutes;
          const rate = e.billableRate ?? 0;
          const gKey = `${e.snapshotCategoryId ?? "none"}::${e.taskId}::${rate}`;
          const g = openGroups.get(gKey) ?? { minutes: 0, rate };
          g.minutes += e.durationMinutes;
          openGroups.set(gKey, g);
          break;
        }
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

  // Materialize the open promise exactly as a T&M close prices it.
  const currency = await getProjectCurrency(ctx, project);
  let openAmountMinor = 0;
  for (const g of openGroups.values()) {
    openAmountMinor += priceMinutesMinor(
      ceilToIncrement(g.minutes, defaultRounding),
      toMinor(g.rate, currency),
    );
  }
  openAmount = fromMinor(openAmountMinor, currency);

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
          if (li.lineType === "fixed") fixedLineItemsAmount += fromMinor(li.amountMinor, inv.currency);
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
    // Invoice money (with manual lines) comes from the invoices
    // themselves — billingViews.getProjectBillingPeriods.
    openMinutes,     // no live close
    openAmount,
    // Billed = covered by a live close (draft or final T&M) — §6.8.
    billedMinutes: draftMinutes + invoicedMinutes,
    billedAmount: draftAmount + invoicedAmount,
    draftMinutes,    // close with a draft invoice
    draftAmount,
    invoicedMinutes, // final T&M close
    invoicedAmount,
    settledMinutes,  // final retainer close
    settledAmount,
    invoiceCount,
    // Fixed-specific — sum of `fixed`-type line items across invoices.
    // Distinct from `invoicedAmount` above (entry-derived).
    fixedLineItemsAmount,
  };
}

/**
 * Monthly breakdown of time entries for a project — grouped by month, then
 * billable/non-billable, then category, then task. Used by Fixed and T&M overviews.
 */
export const projectMonthlyBreakdown = query({
  args: { projectId: v.id("projects") },
  // Admin-only: rows carry billable amounts and cost (A13).
  handler: async (ctx, args) => await projectMonthlyBreakdownForAuth(ctx, await requireAdmin(ctx), args),
});

/** `projectMonthlyBreakdown` for an already-built auth context; admin-only like `projectOverviewForAuth` (A13). */
export async function projectMonthlyBreakdownForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { projectId: Id<"projects"> },
) {
  assertAdmin(auth);
  const { orgId } = auth;

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

  const taskById = new Map(tasks.map((t) => [t._id.toString(), t]));
  const allEntries = (await getProjectEntries(ctx, orgId, args.projectId)).flatMap((e) => {
    const task = taskById.get(e.taskId.toString());
    if (!task) return [];
    return [
      {
        ...e,
        taskId: task._id.toString(),
        taskTitle: task.title,
        workCategoryId: e.snapshotCategoryId?.toString() ?? null,
      },
    ];
  });

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
}

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
