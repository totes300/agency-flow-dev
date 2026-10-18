import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext, type AuthContext } from "../lib/auth";

/**
 * The ONLY authorization entry points for tasks (docs/prd-tasks-refactor.md
 * §5.3, invariant T1).
 *
 * - Org and role come from the Clerk JWT via `getAuthContext`, never from
 *   client-supplied ids.
 * - Admins read and write every task in their org.
 * - A member reads and writes a task iff a `taskAssignees` edge
 *   (task, member) exists. The `tasks.assigneeIds` cache is NOT consulted.
 * - Inaccessible, missing and other-org tasks all fail with the same
 *   "Task not found" error so ids cannot be probed.
 *
 * Slice 0 ships the policy; slices 1–2 route every task function through it.
 */

export const TASK_NOT_FOUND = "Task not found";

export type TaskAccess = {
  auth: AuthContext;
  task: Doc<"tasks">;
  /** The caller has a `taskAssignees` edge on this task. */
  isAssignee: boolean;
};

/** What the pure policy checks need; `TaskAccess` satisfies it. */
export type TaskPolicySubject = {
  auth: Pick<AuthContext, "userId" | "isAdmin">;
  isAssignee: boolean;
};

async function hasAssigneeEdge(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  taskId: Id<"tasks">,
  userId: Id<"users">,
): Promise<boolean> {
  const edge = await ctx.db
    .query("taskAssignees")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId).eq("userId", userId))
    .first();
  return edge !== null && edge.orgId === orgId;
}

async function resolveTaskAccess(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  auth: AuthContext | undefined,
): Promise<TaskAccess | null> {
  const resolvedAuth = auth ?? (await getAuthContext(ctx));
  const task = await ctx.db.get(taskId);
  if (!task || task.orgId !== resolvedAuth.orgId) return null;
  const isAssignee = await hasAssigneeEdge(ctx, resolvedAuth.orgId, taskId, resolvedAuth.userId);
  if (!resolvedAuth.isAdmin && !isAssignee) return null;
  return { auth: resolvedAuth, task, isAssignee };
}

/**
 * Loads a task the caller may read, or throws "Task not found". Pass `auth`
 * when the caller already resolved it (bulk paths) to skip the user lookup.
 */
export async function loadTaskForRead(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  auth?: AuthContext,
): Promise<TaskAccess> {
  const access = await resolveTaskAccess(ctx, taskId, auth);
  if (!access) throw new ConvexError(TASK_NOT_FOUND);
  return access;
}

/** Like `loadTaskForRead` but returns null instead of throwing (graceful queries). */
export async function loadTaskForReadOrNull(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  auth?: AuthContext,
): Promise<TaskAccess | null> {
  return await resolveTaskAccess(ctx, taskId, auth);
}

/**
 * Loads a task the caller may write, or throws "Task not found". Access to a
 * task for writing equals access for reading (§5.3); what the caller may
 * change is decided per field/action by the checks below.
 */
export async function loadTaskForWrite(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  auth?: AuthContext,
): Promise<TaskAccess> {
  const access = await resolveTaskAccess(ctx, taskId, auth);
  if (!access) throw new ConvexError(TASK_NOT_FOUND);
  return access;
}

// ─── Field and action policy (§5.3, D5) ──────────────────────────────────────

/**
 * Editable task properties. `subtasks` covers creating/reordering sub-tasks
 * under this task. Assignees have their own rule (`canChangeAssignees`).
 */
export type TaskField =
  | "title"
  | "description"
  | "status"
  | "priority"
  | "startDate"
  | "dueDate"
  | "estimate"
  | "labels"
  | "subtasks"
  | "project"
  | "workCategory"
  | "billable";

/** Billing-relevant properties only an admin may change (D5). */
export const ADMIN_ONLY_TASK_FIELDS: ReadonlySet<TaskField> = new Set<TaskField>([
  "project",
  "workCategory",
  "billable",
]);

function hasTaskAccess(subject: TaskPolicySubject): boolean {
  return subject.auth.isAdmin || subject.isAssignee;
}

export function canEditField(subject: TaskPolicySubject, field: TaskField): boolean {
  if (subject.auth.isAdmin) return true;
  return subject.isAssignee && !ADMIN_ONLY_TASK_FIELDS.has(field);
}

export function canArchive(subject: TaskPolicySubject): boolean {
  return hasTaskAccess(subject);
}

export function canDelete(subject: TaskPolicySubject): boolean {
  return subject.auth.isAdmin;
}

export type AssigneeChangeDecision =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether the caller may change the assignee set from `current` to `next`.
 * Admins may make any change, including clearing every assignee. An assigned
 * member may add anyone, may remove only themselves, and never the last
 * assignee.
 */
export function canChangeAssignees(
  subject: TaskPolicySubject,
  current: readonly Id<"users">[],
  next: readonly Id<"users">[],
): AssigneeChangeDecision {
  if (subject.auth.isAdmin) return { ok: true };
  if (!subject.isAssignee) return { ok: false, reason: TASK_NOT_FOUND };
  const nextSet = new Set(next);
  const removed = current.filter((id) => !nextSet.has(id));
  if (removed.some((id) => id !== subject.auth.userId)) {
    return { ok: false, reason: "Only admins can remove other assignees" };
  }
  if (removed.length > 0 && nextSet.size === 0) {
    return { ok: false, reason: "A task must keep at least one assignee" };
  }
  return { ok: true };
}

// ─── Throwing wrappers for mutations ─────────────────────────────────────────

export function assertCanEditFields(subject: TaskPolicySubject, fields: readonly TaskField[]): void {
  for (const field of fields) {
    if (!canEditField(subject, field)) {
      throw new ConvexError(
        hasTaskAccess(subject) ? `Only admins can change the task's ${field}` : TASK_NOT_FOUND,
      );
    }
  }
}

export function assertCanArchive(subject: TaskPolicySubject): void {
  if (!canArchive(subject)) throw new ConvexError(TASK_NOT_FOUND);
}

export function assertCanDelete(subject: TaskPolicySubject): void {
  if (!canDelete(subject)) {
    throw new ConvexError(hasTaskAccess(subject) ? "Only admins can delete tasks" : TASK_NOT_FOUND);
  }
}

export function assertCanChangeAssignees(
  subject: TaskPolicySubject,
  current: readonly Id<"users">[],
  next: readonly Id<"users">[],
): void {
  const decision = canChangeAssignees(subject, current, next);
  if (!decision.ok) throw new ConvexError(decision.reason);
}
