import { v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { loadTaskForRead, type TaskAccess } from "./access";
import type { ActivityType } from "./model";
import { markTaskNotificationsRead } from "../notifications";

/**
 * Per-user task state (docs/prd-tasks-refactor.md §4.3): fan-out on write,
 * so a list row reads one `taskUserState` row instead of recomputing unread
 * comments and unseen changes from receipts and the activity log.
 *
 * Subscription rule (decided in slice 2, PRD §12 row 2):
 * - Subscribers of a task = its current assignees ∪ its creator ∪ anyone who
 *   commented on it ∪ anyone whose row already says `subscribed` (an
 *   assignee removed later stays subscribed, Linear-style).
 * - `muted` users stay subscribed but receive no fan-out and no comment
 *   notifications (`notifications.muteTask` / `unmuteTask` set it).
 * - Rows are created lazily: the first fan-out to a subscriber, or the first
 *   time a user opens the task (an admin viewer who is not a participant gets
 *   a row with `subscribed: false` that only tracks `lastViewedAt`).
 *
 * Fan-out:
 * - a comment increments `unreadComments` for every subscriber except the
 *   author; the author becomes a subscriber;
 * - a comment delete recounts `unreadComments` (comments by others newer
 *   than the user's `lastViewedAt`) for rows that had unread comments;
 * - an activity event in `UNSEEN_CHANGE_TYPES` sets `hasUnseenChanges` for
 *   every subscriber except the actor;
 * - opening the task (`markViewed`) resets `unreadComments` and
 *   `hasUnseenChanges` and stamps `lastViewedAt`.
 *
 * `taskUserState` is not a T2 table (it is per-user state, not task data);
 * this module is its only writer.
 */

/** Bound on per-task state rows read by one fan-out (subscribers of one task). */
const STATE_ROWS_PER_TASK_CAP = 500;
/** Bound on comments recounted after a delete. */
const RECOUNT_COMMENT_CAP = 500;

/**
 * Activity that lights the unseen-update dot (U4): the same set the old
 * activity indicators used, plus the new properties (priority, labels, start
 * date). Comments have their own counter; time entries, archive and title
 * edits do not light the dot.
 */
export const UNSEEN_CHANGE_TYPES: ReadonlySet<ActivityType> = new Set<ActivityType>([
  "status_changed",
  "assignee_added",
  "assignee_removed",
  "subtask_created",
  "subtask_completed",
  "due_date_changed",
  "start_date_changed",
  "priority_changed",
  "label_added",
  "label_removed",
  "category_changed",
  "project_changed",
]);

type StatePatch = Partial<
  Pick<Doc<"taskUserState">, "lastViewedAt" | "unreadComments" | "hasUnseenChanges" | "subscribed" | "muted">
>;

async function statesOfTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
): Promise<Doc<"taskUserState">[]> {
  return await ctx.db
    .query("taskUserState")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId))
    .take(STATE_ROWS_PER_TASK_CAP);
}

export async function getUserState(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  userId: Id<"users">,
): Promise<Doc<"taskUserState"> | null> {
  return await ctx.db
    .query("taskUserState")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId).eq("userId", userId))
    .first();
}

/** Writes only the fields that differ; inserts a row with defaults when none exists. */
async function upsertState(
  ctx: MutationCtx,
  task: Pick<Doc<"tasks">, "_id" | "orgId">,
  userId: Id<"users">,
  existing: Doc<"taskUserState"> | null,
  patch: StatePatch,
  defaults: { lastViewedAt: number; subscribed: boolean },
): Promise<void> {
  if (existing) {
    const changed = (Object.keys(patch) as Array<keyof StatePatch>).filter((k) => patch[k] !== existing[k]);
    if (changed.length === 0) return;
    await ctx.db.patch(existing._id, Object.fromEntries(changed.map((k) => [k, patch[k]])));
    return;
  }
  await ctx.db.insert("taskUserState", {
    orgId: task.orgId,
    userId,
    taskId: task._id,
    lastViewedAt: defaults.lastViewedAt,
    unreadComments: 0,
    hasUnseenChanges: false,
    subscribed: defaults.subscribed,
    muted: false,
    ...patch,
  });
}

/**
 * The fan-out targets of `task`: subscribed rows plus participants without a
 * row yet (assignees, creator), each paired with its row. Muted users and
 * `exceptUserId` (the actor) are dropped.
 */
async function fanOutTargets(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  exceptUserId: Id<"users">,
): Promise<Array<{ userId: Id<"users">; state: Doc<"taskUserState"> | null }>> {
  const states = await statesOfTask(ctx, task._id);
  const byUser = new Map(states.map((s) => [s.userId, s]));
  const targets = new Map<Id<"users">, Doc<"taskUserState"> | null>();
  for (const s of states) if (s.subscribed) targets.set(s.userId, s);
  for (const userId of [...task.assigneeIds, task.createdBy]) {
    if (!targets.has(userId)) targets.set(userId, byUser.get(userId) ?? null);
  }
  targets.delete(exceptUserId);
  return [...targets]
    .filter(([, state]) => !state?.muted)
    .map(([userId, state]) => ({ userId, state }));
}

/** `derived.onComment` (created): fan-out of one new comment. */
export async function onCommentCreated(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  comment: { authorId: Id<"users">; at: number },
): Promise<void> {
  for (const { userId, state } of await fanOutTargets(ctx, task, comment.authorId)) {
    await upsertState(
      ctx,
      task,
      userId,
      state,
      { subscribed: true, unreadComments: (state?.unreadComments ?? 0) + 1 },
      { lastViewedAt: 0, subscribed: true },
    );
  }
  // Commenting subscribes the author (they have seen their own comment).
  const own = await getUserState(ctx, task._id, comment.authorId);
  await upsertState(ctx, task, comment.authorId, own, { subscribed: true }, {
    lastViewedAt: comment.at,
    subscribed: true,
  });
}

/**
 * `derived.onComment` (deleted): rows with unread comments are recounted
 * against the comments that remain (by others, newer than `lastViewedAt`).
 */
export async function onCommentDeleted(ctx: MutationCtx, task: Doc<"tasks">): Promise<void> {
  const unread = (await statesOfTask(ctx, task._id)).filter((s) => s.unreadComments > 0);
  if (unread.length === 0) return;
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .take(RECOUNT_COMMENT_CAP);
  for (const state of unread) {
    const count = comments.filter((c) => c.userId !== state.userId && c.createdAt > state.lastViewedAt).length;
    await upsertState(ctx, task, state.userId, state, { unreadComments: count }, {
      lastViewedAt: state.lastViewedAt,
      subscribed: state.subscribed,
    });
  }
}

/** `derived.onActivity`: an update other than a comment lights the unseen dot. */
export async function onTaskChanged(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  event: { type: ActivityType; actorId: Id<"users"> },
): Promise<void> {
  if (!UNSEEN_CHANGE_TYPES.has(event.type)) return;
  for (const { userId, state } of await fanOutTargets(ctx, task, event.actorId)) {
    if (state?.hasUnseenChanges) continue;
    await upsertState(ctx, task, userId, state, { subscribed: true, hasUnseenChanges: true }, {
      lastViewedAt: 0,
      subscribed: true,
    });
  }
}

/** Reset on open: the caller has now seen every comment and change. */
export async function markTaskViewed(ctx: MutationCtx, access: TaskAccess, now: number): Promise<void> {
  const { task, auth } = access;
  const existing = await getUserState(ctx, task._id, auth.userId);
  const participant = access.isAssignee || task.createdBy === auth.userId;
  await upsertState(
    ctx,
    task,
    auth.userId,
    existing,
    {
      lastViewedAt: now,
      unreadComments: 0,
      hasUnseenChanges: false,
      ...(participant ? { subscribed: true } : {}),
    },
    { lastViewedAt: now, subscribed: participant },
  );
}

/** The task mute (`notifications.muteTask`/`unmuteTask`). */
export async function setTaskMuted(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  userId: Id<"users">,
  muted: boolean,
): Promise<void> {
  const existing = await getUserState(ctx, task._id, userId);
  if (!existing && !muted) return;
  await upsertState(ctx, task, userId, existing, { muted }, { lastViewedAt: 0, subscribed: true });
}

/** Drops every state row of a deleted task. */
export async function deleteStatesOfTask(ctx: MutationCtx, taskId: Id<"tasks">): Promise<void> {
  for (const s of await statesOfTask(ctx, taskId)) await ctx.db.delete(s._id);
}

/**
 * The caller's state rows in one index range (`by_orgId_userId_unreadComments`),
 * unread-first, capped. Lists join their rows against this map instead of
 * reading one row per task.
 */
export async function loadUserStates(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  userId: Id<"users">,
  cap: number,
): Promise<Map<Id<"tasks">, Doc<"taskUserState">>> {
  const rows = await ctx.db
    .query("taskUserState")
    .withIndex("by_orgId_userId_unreadComments", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .order("desc")
    .take(cap);
  return new Map(rows.map((r) => [r.taskId, r]));
}

// ─── Seed / maintenance ──────────────────────────────────────────────────────

/**
 * Rebuilds a task's state rows from the source tables, with the runtime
 * semantics above: subscribers = assignees ∪ creator ∪ commenters ∪ existing
 * subscribed rows ∪ muted users; `lastViewedAt` = the newest of the legacy
 * view/comment receipts and the existing row; unread = comments by others
 * after `lastViewedAt`; unseen = an `UNSEEN_CHANGE_TYPES` event by someone
 * else after `lastViewedAt` (muted rows keep their counters; mute history is
 * not recorded, so for a user who muted and later unmuted the recompute also
 * counts what arrived while muted). Idempotent:
 * writes only differences, so after the hooks ran it is a no-op (tested).
 * Used by `devSeedTasks`; the hooks keep rows current afterwards.
 */
export async function recomputeUserStates(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  legacy: { viewedAt: ReadonlyMap<Id<"users">, number>; mutedUserIds: ReadonlySet<Id<"users">> },
): Promise<{ inserted: number; updated: number }> {
  const states = await statesOfTask(ctx, task._id);
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .take(RECOUNT_COMMENT_CAP);
  const events = await ctx.db
    .query("activityLog")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .take(RECOUNT_COMMENT_CAP);

  const subscribers = new Set<Id<"users">>([
    ...task.assigneeIds,
    task.createdBy,
    ...comments.map((c) => c.userId),
    ...states.filter((s) => s.subscribed).map((s) => s.userId),
    ...legacy.mutedUserIds,
  ]);
  const users = new Set<Id<"users">>([...subscribers, ...states.map((s) => s.userId)]);
  let inserted = 0;
  let updated = 0;
  for (const userId of users) {
    const existing = states.find((s) => s.userId === userId) ?? null;
    const lastViewedAt = Math.max(existing?.lastViewedAt ?? 0, legacy.viewedAt.get(userId) ?? 0);
    const muted = legacy.mutedUserIds.has(userId) || existing?.muted === true;
    // Muted users receive no fan-out, so their counters are left as they are.
    const desired = {
      lastViewedAt,
      unreadComments: muted
        ? (existing?.unreadComments ?? 0)
        : comments.filter((c) => c.userId !== userId && c.createdAt > lastViewedAt).length,
      hasUnseenChanges: muted
        ? (existing?.hasUnseenChanges ?? false)
        : events.some(
            (e) => e.userId !== userId && e.createdAt > lastViewedAt && UNSEEN_CHANGE_TYPES.has(e.type),
          ),
      subscribed: subscribers.has(userId),
      muted,
    };
    if (!existing) {
      // Rows are lazy (like the hooks): a participant with nothing to show
      // needs none; commenters, viewers and muted users do.
      const needsRow =
        desired.lastViewedAt > 0 ||
        desired.unreadComments > 0 ||
        desired.hasUnseenChanges ||
        desired.muted ||
        comments.some((c) => c.userId === userId);
      if (!needsRow) continue;
      await ctx.db.insert("taskUserState", { orgId: task.orgId, userId, taskId: task._id, ...desired });
      inserted++;
    } else if ((Object.keys(desired) as Array<keyof typeof desired>).some((k) => desired[k] !== existing[k])) {
      await ctx.db.patch(existing._id, desired);
      updated++;
    }
  }
  return { inserted, updated };
}

// ─── Public mutation ─────────────────────────────────────────────────────────

/**
 * Opening a task, for an already-loaded readable task: resets the caller's
 * unread comments and unseen changes and clears its inbox notifications.
 * Shared with MCP `mark_read` on a task or comment ref.
 */
export async function markViewedForAuth(ctx: MutationCtx, access: TaskAccess, now: number): Promise<void> {
  await markTaskViewed(ctx, access, now);
  // Honest badge: opening a task clears the viewer's unread inbox
  // notifications for it.
  await markTaskNotificationsRead(ctx, { userId: access.auth.userId, orgId: access.auth.orgId, taskId: access.task._id });
}

/**
 * Called when the caller opens a task (drawer, full page). Resets the
 * caller's unread comments and unseen-change dot.
 */
export const markViewed = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const access = await loadTaskForRead(ctx, taskId);
    await markViewedForAuth(ctx, access, Date.now());
  },
});
