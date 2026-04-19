import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { computeElapsedMs, totalElapsedMs, msToMinutes, getDateInTimezone } from "./lib/timer";
import { roundMinutes } from "./lib/rounding";
import { getOrgSettings, resolveRateSnapshot } from "./lib/orgHelpers";

const MAX_TIMER_MS = 16 * 60 * 60 * 1000; // 16 hours
const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 hours

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function clearTimerFields(ctx: MutationCtx, userId: Id<"users">) {
  await ctx.db.patch(userId, {
    timerTaskId: undefined,
    timerStartedAt: undefined,
    timerAccumulatedMs: undefined,
    timerStatus: undefined,
  });
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
    if (!task.projectId) throw new ConvexError("Assign a project to this task before starting a timer");

    // Member: only on assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only start timers on tasks assigned to you");
    }

    // Validate rates upfront so the user discovers missing rates before
    // spending time, not when they try to commit the entry.
    const project = await ctx.db.get(task.projectId);
    if (!project) throw new ConvexError("Project not found");
    await resolveRateSnapshot(ctx, {
      userId,
      orgId,
      task,
      project,
      isBillable: task.billable,
    });

    const now = Date.now();
    await ctx.db.patch(userId, {
      timerTaskId: args.taskId,
      timerStartedAt: now,
      timerAccumulatedMs: 0,
      timerStatus: "running" as const,
    });
  },
});

/**
 * Read-only preview: returns whether the user can log time on this task at the
 * resolved rates, with a user-friendly reason if not. Intended for timer
 * buttons / time-entry forms to show inline warnings without firing a mutation.
 */
export const previewRateForTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { userId, orgId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) return { ok: false as const, reason: "Task not found" };
    if (!task.projectId) return { ok: false as const, reason: "Assign a project first" };

    const project = await ctx.db.get(task.projectId);
    if (!project) return { ok: false as const, reason: "Project not found" };

    try {
      const snapshot = await resolveRateSnapshot(ctx, {
        userId,
        orgId,
        task,
        project,
        isBillable: task.billable,
      });
      return {
        ok: true as const,
        billableRate: snapshot.billableRate,
        rateCurrency: snapshot.rateCurrency,
      };
    } catch (err) {
      const reason = err instanceof ConvexError ? String(err.data ?? err.message) : "Rate not configured";
      return { ok: false as const, reason };
    }
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

    const rawElapsedMs =
      user.timerStatus === "running"
        ? totalElapsedMs(startedAt, now, accumulated)
        : accumulated;
    const elapsedMs = Math.min(rawElapsedMs, MAX_TIMER_MS);

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

    // Compute rate snapshot preview — non-blocking
    let rateSnapshot: { costRate?: number; billableRate?: number; rateCurrency?: string } = {};
    const isBillable = task?.billable ?? false;
    if (task && project) {
      try {
        const snapshot = await resolveRateSnapshot(ctx, {
          userId,
          orgId,
          task,
          project,
          isBillable,
        });
        rateSnapshot = snapshot;
      } catch {
        // Rate preview failure is non-blocking
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
      isBillable,
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

    if (args.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || isNaN(new Date(args.date).getTime())) {
        throw new ConvexError("Invalid date format — expected YYYY-MM-DD");
      }
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

    // Rate snapshot (new model)
    const rateSnapshot = await resolveRateSnapshot(ctx, {
      userId,
      orgId,
      task,
      project,
      isBillable: args.isBillable,
    });

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
      costRate: rateSnapshot.costRate,
      billableRate: rateSnapshot.billableRate,
      rateCurrency: rateSnapshot.rateCurrency,
      snapshotCategoryId: task.workCategoryId,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    return entryId;
  },
});
