import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { computeElapsedMs, totalElapsedMs, msToMinutes, getDateInTimezone } from "./lib/timer";
import { roundMinutes } from "./lib/rounding";
import { resolveRate, type RateContext } from "./lib/rates";

const MAX_TIMER_MS = 16 * 60 * 60 * 1000; // 16 hours
const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 hours

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function clearTimerFields(ctx: { db: { patch: (id: any, data: any) => Promise<void> } }, userId: any) {
  await ctx.db.patch(userId, {
    timerTaskId: undefined,
    timerStartedAt: undefined,
    timerAccumulatedMs: undefined,
    timerStatus: undefined,
  });
}

async function getOrgSettings(ctx: any, orgId: string) {
  return await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q: any) => q.eq("orgId", orgId))
    .first();
}

async function buildRateContext(
  ctx: any,
  task: any,
  project: any,
): Promise<RateContext> {
  const rateCtx: RateContext = {
    billingType: project.billingType,
    tmRateMode: project.tmRateMode,
    hourlyRate: project.hourlyRate,
    tmCategoryRates: project.tmCategoryRates,
    overageRate: project.overageRate,
    workCategoryId: task.workCategoryId?.toString(),
  };

  // For fixed projects, look up the category estimate
  if (project.billingType === "fixed" && task.workCategoryId) {
    const estimates = await ctx.db
      .query("projectCategoryEstimates")
      .withIndex("by_projectId", (q: any) => q.eq("projectId", project._id))
      .collect();
    const match = estimates.find(
      (e: any) => e.workCategoryId.toString() === task.workCategoryId.toString(),
    );
    if (match) {
      rateCtx.categoryEstimate = {
        internalCostRate: match.internalCostRate,
        clientBillingRate: match.clientBillingRate,
      };
    }
  }

  return rateCtx;
}

// ─── Queries ────────────────────────────────────────────────────────────────────

export const getState = query({
  args: {},
  handler: async (ctx) => {
    const { user, orgId } = await getAuthContext(ctx);

    if (!user.timerTaskId || !user.timerStatus) {
      return null;
    }

    const task = await ctx.db.get(user.timerTaskId);
    if (!task || task.orgId !== orgId) return null;

    const project = task.projectId ? await ctx.db.get(task.projectId) : null;
    const client = project ? await ctx.db.get(project.clientId) : null;

    return {
      taskId: user.timerTaskId,
      taskName: task.title,
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
      startedAt: user.timerStartedAt ?? null,
      accumulatedMs: user.timerAccumulatedMs ?? 0,
      status: user.timerStatus,
      isBillable: task.billable,
    };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const start = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { userId, orgId, isAdmin, user } = await getAuthContext(ctx);

    // Reject if a timer is already running (client must stop first)
    if (user.timerTaskId && user.timerStatus) {
      throw new ConvexError("A timer is already running. Stop it before starting a new one.");
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (task.archivedAt) throw new ConvexError("Cannot start timer on an archived task");
    if (!task.projectId) throw new ConvexError("Assign a project first");

    // Member: only on assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only start timers on tasks assigned to you");
    }

    const now = Date.now();
    await ctx.db.patch(userId, {
      timerTaskId: args.taskId,
      timerStartedAt: now,
      timerAccumulatedMs: 0,
      timerStatus: "running" as const,
    });
  },
});

export const stop = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId, user } = await getAuthContext(ctx);

    if (!user.timerTaskId || !user.timerStatus) {
      throw new ConvexError("No active timer");
    }

    const now = Date.now();
    const accumulated = user.timerAccumulatedMs ?? 0;
    const startedAt = user.timerStartedAt ?? now;

    // Compute total elapsed
    let elapsedMs: number;
    if (user.timerStatus === "running") {
      elapsedMs = totalElapsedMs(startedAt, now, accumulated);
    } else {
      // Paused — just the accumulated time
      elapsedMs = accumulated;
    }

    // Cap at 16 hours
    if (elapsedMs > MAX_TIMER_MS) elapsedMs = MAX_TIMER_MS;

    const isStale = elapsedMs >= STALE_THRESHOLD_MS;

    // Get org settings for rounding
    const orgSettings = await getOrgSettings(ctx, orgId);
    const roundingMinutes = orgSettings?.roundingMinutes ?? 1;

    const rawMinutes = msToMinutes(elapsedMs);
    const roundedMinutes = roundMinutes(rawMinutes, roundingMinutes);

    // Get task + project + client for response
    const task = await ctx.db.get(user.timerTaskId);
    const project = task?.projectId ? await ctx.db.get(task.projectId) : null;
    const client = project ? await ctx.db.get(project.clientId) : null;

    // Compute rate snapshot
    let rateSnapshot = {};
    if (task && project) {
      const rateCtx = await buildRateContext(ctx, task, project);
      const rateResult = resolveRate(rateCtx);
      if (rateResult.ok) {
        rateSnapshot = rateResult.snapshot;
      }
    }

    // Clear timer
    await clearTimerFields(ctx, userId);

    return {
      taskId: user.timerTaskId,
      elapsedMs,
      roundedMinutes,
      taskName: task?.title ?? "Unknown",
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
      isBillable: task?.billable ?? false,
      isStale,
      rateSnapshot,
    };
  },
});

export const pause = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await getAuthContext(ctx);

    if (!user.timerTaskId || user.timerStatus !== "running") {
      throw new ConvexError("No running timer to pause");
    }

    const now = Date.now();
    const startedAt = user.timerStartedAt ?? now;
    const currentSegment = computeElapsedMs(startedAt, now);
    const accumulated = (user.timerAccumulatedMs ?? 0) + currentSegment;

    await ctx.db.patch(userId, {
      timerStartedAt: undefined,
      timerAccumulatedMs: accumulated,
      timerStatus: "paused" as const,
    });
  },
});

export const resume = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await getAuthContext(ctx);

    if (!user.timerTaskId || user.timerStatus !== "paused") {
      throw new ConvexError("No paused timer to resume");
    }

    const now = Date.now();
    await ctx.db.patch(userId, {
      timerStartedAt: now,
      timerStatus: "running" as const,
    });
  },
});

export const discard = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await getAuthContext(ctx);

    if (!user.timerTaskId) {
      throw new ConvexError("No active timer to discard");
    }

    await clearTimerFields(ctx, userId);
  },
});

export const commitEntry = mutation({
  args: {
    taskId: v.id("tasks"),
    durationMinutes: v.number(),
    note: v.optional(v.string()),
    isBillable: v.boolean(),
    date: v.optional(v.string()), // YYYY-MM-DD, defaults to today in org timezone
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await getAuthContext(ctx);

    if (args.durationMinutes <= 0) {
      throw new ConvexError("Duration must be greater than 0");
    }

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!task.projectId) throw new ConvexError("Task must have a project");

    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");

    // Get org settings
    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? "America/New_York";
    const roundingMinutes = orgSettings?.roundingMinutes ?? 1;

    // Round duration
    const rounded = roundMinutes(args.durationMinutes, roundingMinutes);

    // Resolve date
    const date = args.date ?? getDateInTimezone(Date.now(), timezone);

    // Rate snapshot
    const rateCtx = await buildRateContext(ctx, task, project);
    const rateResult = resolveRate(rateCtx);
    if (!rateResult.ok) {
      throw new ConvexError(rateResult.error);
    }

    const now = Date.now();
    const entryId = await ctx.db.insert("timeEntries", {
      orgId,
      taskId: args.taskId,
      userId,
      date,
      durationMinutes: rounded,
      note: args.note?.trim() || undefined,
      isBillable: args.isBillable,
      method: "timer",
      ...rateResult.snapshot,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    return entryId;
  },
});
