import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { categoryOfStatus, isClosedCategory, type ActivityType, type TaskCategory } from "./model";
import { patchDerivedFields } from "./write";
import { onCommentCreated, onCommentDeleted, onTaskChanged } from "./userState";

/**
 * Derived task data (docs/prd-tasks-refactor.md §5.5, invariant T6).
 *
 * The counters on `tasks` (trackedMinutes, commentCount, lastCommentAt,
 * subtaskCount, subtaskDoneCount) and `lastActivity` are maintained here,
 * called from write.ts and from the comment / time-entry write paths. The
 * actual patch goes through `write.ts` (T2): this module decides values,
 * write.ts writes them.
 *
 * Counting rules — `recomputeTaskCounters` is the reference the hooks must
 * agree with (the seed and the T6 test both use it):
 * - `subtaskCount` counts non-archived sub-tasks.
 * - `subtaskDoneCount` counts non-archived sub-tasks in a CLOSED category
 *   (completed + canceled): a canceled sub-task is finished work and must not
 *   hold the parent's progress below 100%. Matches the old UI, which counted
 *   legacy `done` (canceled maps to legacy `done`).
 * - `commentCount` counts every comment on the task, replies included.
 * - `trackedMinutes` is the sum of `durationMinutes` over the task's own time
 *   entries (no roll-up from sub-tasks).
 */

export type TaskCounters = {
  trackedMinutes: number;
  commentCount: number;
  lastCommentAt: number | undefined;
  subtaskCount: number;
  subtaskDoneCount: number;
};

async function categoryOfTask(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"tasks">,
): Promise<TaskCategory | undefined> {
  if (task.statusCategory) return task.statusCategory;
  const status = await ctx.db.get(task.statusId);
  return status ? categoryOfStatus(status) : undefined;
}

async function subtaskCounts(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  parentId: Id<"tasks">,
): Promise<Pick<TaskCounters, "subtaskCount" | "subtaskDoneCount">> {
  const children = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", parentId))
    .collect();
  let subtaskCount = 0;
  let subtaskDoneCount = 0;
  for (const child of children) {
    if (child.archivedAt) continue;
    subtaskCount++;
    const category = await categoryOfTask(ctx, child);
    if (category && isClosedCategory(category)) subtaskDoneCount++;
  }
  return { subtaskCount, subtaskDoneCount };
}

async function commentStats(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
): Promise<Pick<TaskCounters, "commentCount" | "lastCommentAt">> {
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  let lastCommentAt: number | undefined;
  for (const c of comments) {
    if (lastCommentAt === undefined || c.createdAt > lastCommentAt) lastCommentAt = c.createdAt;
  }
  return { commentCount: comments.length, lastCommentAt };
}

async function trackedMinutesOf(ctx: QueryCtx | MutationCtx, taskId: Id<"tasks">): Promise<number> {
  const entries = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .collect();
  return entries.reduce((sum, e) => sum + e.durationMinutes, 0);
}

/** Every counter recomputed from the source tables (the T6 reference). */
export async function recomputeTaskCounters(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"tasks">,
): Promise<TaskCounters> {
  return {
    trackedMinutes: await trackedMinutesOf(ctx, task._id),
    ...(await commentStats(ctx, task._id)),
    ...(await subtaskCounts(ctx, task.orgId, task._id)),
  };
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** `lastActivity` / `lastActivityAt` follow the newest event on the task. */
export async function touchLastActivity(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  event: { kind: ActivityType; actorId: Id<"users">; at: number },
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;
  if (task.lastActivityAt !== undefined && task.lastActivityAt > event.at) return;
  await patchDerivedFields(ctx, taskId, { lastActivityAt: event.at, lastActivity: event });
}

/**
 * Every activity event (`logActivity`): moves `lastActivity` forward and
 * fans an unseen-change flag out to the task's subscribers (§4.3,
 * `userState.UNSEEN_CHANGE_TYPES`).
 */
export async function onActivity(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  event: { kind: ActivityType; actorId: Id<"users">; at: number },
): Promise<void> {
  await touchLastActivity(ctx, taskId, event);
  const task = await ctx.db.get(taskId);
  if (task) await onTaskChanged(ctx, task, { type: event.kind, actorId: event.actorId });
}

/**
 * A comment was created or deleted. Creation increments; deletion recounts
 * (it may remove the newest comment, so `lastCommentAt` must be recomputed).
 * Both fan out to the subscribers' `taskUserState` (§4.3).
 */
export async function onComment(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  change: { kind: "created"; at: number; actorId: Id<"users"> } | { kind: "deleted" },
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;
  if (change.kind === "created") {
    await onCommentCreated(ctx, task, { authorId: change.actorId, at: change.at });
  } else {
    await onCommentDeleted(ctx, task);
  }
  if (change.kind === "created" && task.commentCount !== undefined) {
    await patchDerivedFields(ctx, taskId, {
      commentCount: task.commentCount + 1,
      lastCommentAt: Math.max(task.lastCommentAt ?? 0, change.at),
    });
    return;
  }
  // Deletion, or a task the seed never backfilled: recount from the table.
  await patchDerivedFields(ctx, taskId, await commentStats(ctx, taskId));
}

/** A sub-task of `parentId` was created, changed category, archived, restored or deleted. */
export async function onSubtaskChange(ctx: MutationCtx, parentId: Id<"tasks">): Promise<void> {
  const parent = await ctx.db.get(parentId);
  if (!parent) return;
  const counts = await subtaskCounts(ctx, parent.orgId, parentId);
  if (counts.subtaskCount === parent.subtaskCount && counts.subtaskDoneCount === parent.subtaskDoneCount) {
    return;
  }
  await patchDerivedFields(ctx, parentId, counts);
}

/**
 * The time-entry write path changed the task's logged minutes by `delta`
 * (create: +minutes, delete: −minutes, edit: new − old, move: −old on the
 * source task and +new on the target). The only touchpoint with billing code
 * (§5.5): it reads nothing billing-specific and changes no billing data.
 * Called AFTER the entry write, so a task the seed never backfilled is
 * recomputed from its entries instead of starting from zero.
 */
export async function onTimeEntryChange(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const task = await ctx.db.get(taskId);
  if (!task) return;
  const trackedMinutes =
    task.trackedMinutes === undefined
      ? await trackedMinutesOf(ctx, taskId)
      : Math.max(0, task.trackedMinutes + delta);
  await patchDerivedFields(ctx, taskId, { trackedMinutes });
}
