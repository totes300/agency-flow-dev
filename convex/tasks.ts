import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { MAX_TIMER_MS } from "./lib/timer";
import { taskHasTimeEntries } from "./lib/task_helpers";
import {
  TASK_NOT_FOUND,
  canChangeAssignees,
  canDelete,
  canEditField,
  loadTaskForReadOrNull,
  loadTaskForWrite,
} from "./tasks/access";
import { taskPriorityValidator } from "./tasks/model";
import { loadSubtasksOf } from "./tasks/read";
import {
  archiveTask,
  createTask,
  duplicateTask,
  removeTask,
  reorderSubtasks as reorderSubtasksWrite,
  reorderTask as reorderTaskWrite,
  restoreTask,
  updateTask,
  type TimerRescue,
} from "./tasks/write";

/**
 * Public task mutations (docs/prd-tasks-refactor.md §5.1): thin wrappers over
 * `tasks/write.ts` (T2) with access from `tasks/access.ts` (T1). Task reads
 * live in `tasks/queries.ts` (+ `tasks/today.ts`, `tasks/views.ts`).
 */
/**
 * Minimal read for the time-log form's category pre-fill: the task's own
 * category id (the last step of the entry-category default chain). Tolerant —
 * returns null instead of throwing so a display-only lookup can never crash
 * a task row for a member who isn't an assignee (unlike getDetail).
 */
export const getWorkCategoryId = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForReadOrNull(ctx, args.taskId);
    return access?.task.workCategoryId ?? null;
  },
});

// ─── Sub-tasks ───────────────────────────────────────────────────────────────────

export const createSubtask = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    title: v.string(),
    statusId: v.optional(v.id("statuses")),
    workCategoryId: v.optional(v.id("workCategories")),
    assigneeIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    // Parent access, one-level rule and project inheritance (T8) live in write.ts.
    return await createTask(
      ctx,
      auth,
      {
        title: args.title,
        parentTaskId: args.parentTaskId,
        statusId: args.statusId,
        workCategoryId: args.workCategoryId,
        assigneeIds: args.assigneeIds,
      },
      { defaultAssignee: true },
    );
  },
});

export const reorderSubtasks = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    orderedIds: v.array(v.id("tasks")),
  },
  handler: async (ctx, { parentTaskId, orderedIds }) => {
    const access = await loadTaskForWrite(ctx, parentTaskId);
    await reorderSubtasksWrite(ctx, access, orderedIds);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────────

const taskPatchArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  statusId: v.optional(v.id("statuses")),
  projectId: v.optional(v.union(v.id("projects"), v.null())),
  assigneeIds: v.optional(v.array(v.id("users"))),
  workCategoryId: v.optional(v.union(v.id("workCategories"), v.null())),
  estimate: v.optional(v.union(v.number(), v.null())),
  billable: v.optional(v.boolean()),
  dueDate: v.optional(v.union(v.string(), v.null())),
  startDate: v.optional(v.union(v.string(), v.null())),
  priority: v.optional(taskPriorityValidator),
  labelIds: v.optional(v.array(v.id("labels"))),
};

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    projectId: v.optional(v.id("projects")),
    assigneeIds: v.optional(v.array(v.id("users"))),
    workCategoryId: v.optional(v.id("workCategories")),
    estimate: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    dueDate: v.optional(v.string()),
    startDate: v.optional(v.string()),
    priority: v.optional(taskPriorityValidator),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const { estimate, ...input } = args;
    return await createTask(
      ctx,
      auth,
      { ...input, estimateMinutes: estimate },
      // The project's default assignee only when the caller did not pick assignees.
      { defaultAssignee: args.assigneeIds === undefined },
    );
  },
});

export const update = mutation({
  args: { id: v.id("tasks"), ...taskPatchArgs },
  handler: async (ctx, args) => {
    const { id, estimate, ...patch } = args;
    const access = await loadTaskForWrite(ctx, id);
    await updateTask(ctx, access, { ...patch, estimateMinutes: estimate });
  },
});

export const updateDescription = mutation({
  args: {
    id: v.id("tasks"),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await updateTask(ctx, access, { description: args.description ?? "" });
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    // Running timers on the tree are auto-saved as entries (returned so the
    // caller's toast can say whose time was saved / left running).
    const rescue = await archiveTask(ctx, access);
    return { autoSavedTimers: rescue.saved, timerSaveFailures: rescue.failed };
  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await restoreTask(ctx, access);
  },
});

/**
 * What deleting this task (and its subtasks) would destroy. Powers the
 * delete-confirmation dialog so the user gets the resolution (archive /
 * delete-with-entries) in place instead of a dead-end error.
 */
export const deleteImpact = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForReadOrNull(ctx, args.id);
    if (!access) return null;
    const { task } = access;
    const { orgId } = access.auth;

    const subtasks = (await loadSubtasksOf(ctx, orgId, args.id)).tasks;

    let entryCount = 0;
    let totalMinutes = 0;
    let lockedCount = 0;
    let lockedMinutes = 0;
    for (const t of [task, ...subtasks]) {
      const entries = await ctx.db.query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
        .collect();
      for (const e of entries) {
        entryCount++;
        totalMinutes += e.durationMinutes;
        if (e.closeId) {
          lockedCount++;
          lockedMinutes += e.durationMinutes;
        }
      }
    }

    // Running/paused timers on the tree: deleting the task discards them
    // (an entry can't outlive its task), so the dialog must say so.
    const affectedIds = new Set([task._id.toString(), ...subtasks.map((s) => s._id.toString())]);
    const members = await ctx.db.query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    let runningTimerCount = 0;
    let runningTimerMinutes = 0;
    const now = Date.now();
    for (const member of members) {
      if (!member.userId) continue;
      const u = await ctx.db.get(member.userId);
      if (!u?.timerTaskId || !affectedIds.has(u.timerTaskId.toString())) continue;
      const accumulated = u.timerAccumulatedMs ?? 0;
      const elapsedMs = Math.min(
        u.timerStatus === "running" && u.timerStartedAt
          ? now - u.timerStartedAt + accumulated
          : accumulated,
        MAX_TIMER_MS,
      );
      runningTimerCount++;
      runningTimerMinutes += Math.round(elapsedMs / 60_000);
    }

    return {
      entryCount,
      totalMinutes,
      lockedCount,
      lockedMinutes,
      subtaskCount: subtasks.length,
      runningTimerCount,
      runningTimerMinutes,
    };
  },
});

export const remove = mutation({
  args: {
    id: v.id("tasks"),
    // Explicit consent to delete unlocked time entries along with the task.
    // Invoiced/settled entries can never be deleted this way.
    deleteEntries: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await removeTask(ctx, access, { deleteEntries: args.deleteEntries });
  },
});

export const duplicate = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    return await duplicateTask(ctx, access);
  },
});

type BulkSkip = { taskId: Id<"tasks">; title: string; reason: string };

export const bulkUpdate = mutation({
  args: {
    taskIds: v.array(v.id("tasks")),
    action: v.union(
      v.object({ type: v.literal("status"), statusId: v.id("statuses") }),
      v.object({ type: v.literal("addAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("removeAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("category"), workCategoryId: v.id("workCategories") }),
      v.object({ type: v.literal("project"), projectId: v.id("projects") }),
      v.object({ type: v.literal("archive") }),
      v.object({ type: v.literal("delete") }),
      v.object({ type: v.literal("restore") })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    if (args.taskIds.length > 50) throw new ConvexError("Maximum 50 tasks per bulk operation");
    const action = args.action;

    let updated = 0;
    const autoSavedTimers: TimerRescue["saved"] = [];
    const timerSaveFailures: TimerRescue["failed"] = [];
    const skipped: BulkSkip[] = [];

    // Every per-task rule is checked BEFORE that task's writes, so a skip
    // never leaves a half-applied task behind; unexpected errors abort the
    // whole batch (transaction rollback).
    for (const taskId of args.taskIds) {
      const access = await loadTaskForReadOrNull(ctx, taskId, auth);
      if (!access) { skipped.push({ taskId, title: "Unknown", reason: TASK_NOT_FOUND }); continue; }
      const { task } = access;
      const skip = (reason: string) => skipped.push({ taskId, title: task.title, reason });

      switch (action.type) {
        case "status":
          await updateTask(ctx, access, { statusId: action.statusId });
          break;
        case "addAssignee":
          if (!task.assigneeIds.includes(action.userId)) {
            await updateTask(ctx, access, { assigneeIds: [...task.assigneeIds, action.userId] });
          }
          break;
        case "removeAssignee": {
          if (!task.assigneeIds.includes(action.userId)) break;
          const next = task.assigneeIds.filter((id) => id !== action.userId);
          const decision = canChangeAssignees(access, task.assigneeIds, next);
          if (!decision.ok) { skip(decision.reason); continue; }
          await updateTask(ctx, access, { assigneeIds: next });
          break;
        }
        case "category":
          if (!canEditField(access, "workCategory")) { skip("Only admins can change the work category"); continue; }
          await updateTask(ctx, access, { workCategoryId: action.workCategoryId });
          break;
        case "project": {
          if (task.projectId === action.projectId) break;
          if (!canEditField(access, "project")) { skip("Only admins can change the project"); continue; }
          if (task.parentTaskId) { skip("Sub-tasks follow their parent's project"); continue; }
          if (await treeHasTimeEntries(ctx, task)) { skip("Has time entries — cannot change project"); continue; }
          await updateTask(ctx, access, { projectId: action.projectId });
          break;
        }
        case "archive": {
          const rescue = await archiveTask(ctx, access);
          autoSavedTimers.push(...rescue.saved);
          timerSaveFailures.push(...rescue.failed);
          break;
        }
        case "delete":
          if (!canDelete(access)) { skip("Only admins can delete tasks"); continue; }
          // Time entries are ledger records — same rule as projects.remove.
          if (await treeHasTimeEntries(ctx, task)) { skip("Task has logged time — archive it instead"); continue; }
          await removeTask(ctx, access);
          break;
        case "restore":
          if (!task.archivedAt) { skip("Task is not archived"); continue; }
          await restoreTask(ctx, access);
          break;
      }
      updated++;
    }

    return { updated, skipped, autoSavedTimers, timerSaveFailures };
  },
});

async function treeHasTimeEntries(ctx: QueryCtx, task: Doc<"tasks">): Promise<boolean> {
  if (await taskHasTimeEntries(ctx, task._id)) return true;
  const children = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .collect();
  for (const child of children) {
    if (await taskHasTimeEntries(ctx, child._id)) return true;
  }
  return false;
}

// ─── Reorder task (drag & drop, fractional indexing) ────────────────────────

export const reorderTask = mutation({
  args: {
    taskId: v.id("tasks"),
    beforeKey: v.optional(v.string()),   // sortKey of the item above (omitted = first)
    afterKey: v.optional(v.string()),    // sortKey of the item below (omitted = last)
  },
  handler: async (ctx, { taskId, beforeKey, afterKey }) => {
    const access = await loadTaskForWrite(ctx, taskId);
    await reorderTaskWrite(ctx, access, { beforeKey, afterKey });
  },
});
