import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { computeElapsedMs, totalElapsedMs, msToMinutes, getDateInTimezone, MAX_TIMER_MS, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { roundMinutes } from "./lib/rounding";
import { getOrgSettings, resolveRateSnapshot } from "./lib/orgHelpers";
import { assertValidDateString } from "./lib/dateValidation";
import { insertTimerEntry } from "./lib/timerEntry";

const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 hours
const MAX_OVERRIDE_MINUTES = 24 * 60; // sanity ceiling for stale-dialog input

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
    const { userId, orgId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) return { ok: false as const, reason: "Task not found" };
    if (task.archivedAt) return { ok: false as const, reason: "Task is archived" };
    if (!task.projectId) return { ok: false as const, reason: "Assign a project first" };
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      return { ok: false as const, reason: "Task isn't assigned to you" };
    }

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

/**
 * Stop the timer AND persist the entry in one transaction (create-at-stop,
 * Toggl model). The measured time exists in the database the moment this
 * mutation returns — a tab close, crash or forgotten form can never lose
 * it. The commit form that follows EDITS the created entry (or deletes it).
 *
 * - Duration is the SERVER's measurement, not a client-supplied number.
 *   `overrideMinutes` exists for the stale-timer dialog, where the whole
 *   point is that the measurement is wrong and the user supplies the truth.
 * - If entry creation fails (e.g. a rate was deleted mid-session), the
 *   whole mutation rolls back and the timer KEEPS RUNNING — fix the config,
 *   stop again. Nothing is lost either way.
 * - Under 30 seconds (and no override): nothing worth saving — the timer is
 *   cleared and `discarded: true` is returned so the client can say so.
 */
export const stop = mutation({
  args: {
    overrideMinutes: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId, user } = await getAuthContext(ctx);

    if (!user.timerTaskId || !user.timerStatus) {
      throw new ConvexError("No active timer");
    }
    if (args.overrideMinutes !== undefined && args.overrideMinutes <= 0) {
      throw new ConvexError("Duration must be greater than 0");
    }
    if (
      args.overrideMinutes !== undefined &&
      args.overrideMinutes > MAX_OVERRIDE_MINUTES
    ) {
      throw new ConvexError("Duration cannot exceed 24 hours for one session.");
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

    // Task/project must exist to persist an entry. They should (task delete
    // and archive clear timers), but if a data race left a dangling timer,
    // clear it and report instead of throwing forever.
    const task = await ctx.db.get(user.timerTaskId);
    const project = task?.projectId ? await ctx.db.get(task.projectId) : null;
    if (!task || task.orgId !== orgId || !project) {
      await clearTimerFields(ctx, userId);
      return {
        taskId: user.timerTaskId,
        entryId: null,
        discarded: true as const,
        elapsedMs,
        roundedMinutes: 0,
        taskName: task?.title ?? "Unknown",
        projectName: null,
        clientName: null,
        isBillable: false,
        isStale,
      };
    }
    const client = await ctx.db.get(project.clientId);

    // Under 30s with no explicit override: not worth an entry.
    if (args.overrideMinutes === undefined && elapsedMs < 30_000) {
      await clearTimerFields(ctx, userId);
      return {
        taskId: task._id,
        entryId: null,
        discarded: true as const,
        elapsedMs,
        roundedMinutes: 0,
        taskName: task.title,
        projectName: project.name,
        clientName: client?.name ?? null,
        isBillable: task.billable,
        isStale,
      };
    }

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;

    const { entryId, durationMinutes, date } = await insertTimerEntry(ctx, {
      orgId,
      ownerId: userId,
      createdBy: userId,
      task,
      project,
      rawMinutes: args.overrideMinutes ?? msToMinutes(elapsedMs),
      sessionStartedAt:
        user.timerStatus === "running" ? user.timerStartedAt : undefined,
      note: args.note,
      isBillable: task.billable,
      timezone,
    });

    await clearTimerFields(ctx, userId);

    return {
      taskId: task._id,
      entryId,
      discarded: false as const,
      elapsedMs,
      roundedMinutes: durationMinutes,
      date,
      taskName: task.title,
      projectName: project.name,
      clientName: client?.name ?? null,
      isBillable: task.billable,
      isStale,
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

/**
 * Escape-hatch entry creation for timer flows that bypass `stop`'s
 * server-measured duration (the under-30s "Save as 1m" toast action).
 * Normal stops persist via `stop` itself — see create-at-stop above.
 *
 * Hardened (2026-07-05 review): archived-task guard (manual create has it;
 * this path was a bypass) and the date is anchored so a long duration can
 * never silently file the entry under yesterday — `insertTimerEntry` clamps
 * to today whenever the synthetic start day would be settled, and here the
 * caller has no date control, so we always anchor within today.
 */
export const commitEntry = mutation({
  args: {
    taskId: v.id("tasks"),
    durationMinutes: v.number(),
    note: v.optional(v.string()),
    isBillable: v.boolean(),
    date: v.optional(v.string()), // YYYY-MM-DD, must be today in org timezone
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await getAuthContext(ctx);

    if (args.durationMinutes <= 0) {
      throw new ConvexError("Duration must be greater than 0");
    }

    if (args.date) assertValidDateString(args.date);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (task.archivedAt) {
      throw new ConvexError(
        "This task was archived — restore it to save time on it.",
      );
    }
    if (!task.projectId) throw new ConvexError("Task must have a project");

    const project = await ctx.db.get(task.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;

    const now = Date.now();
    const today = getDateInTimezone(now, timezone);
    if (args.date !== undefined && args.date !== today) {
      throw new ConvexError(
        `Timer entries are saved for today (${today}). Use manual time logging for other dates.`,
      );
    }

    // Anchor within today: a duration longer than the time since org-tz
    // midnight must not push the entry into yesterday.
    const synthetic = now - roundMinutes(args.durationMinutes, 1) * 60_000;
    const sessionStartedAt =
      getDateInTimezone(synthetic, timezone) === today ? synthetic : now;

    const { entryId } = await insertTimerEntry(ctx, {
      orgId,
      ownerId: userId,
      createdBy: userId,
      task,
      project,
      rawMinutes: args.durationMinutes,
      sessionStartedAt,
      note: args.note,
      isBillable: args.isBillable,
      timezone,
    });

    return entryId;
  },
});
