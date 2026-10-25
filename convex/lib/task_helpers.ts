/**
 * Shared helpers for task queries and mutations.
 * Extracted from convex/tasks.ts for maintainability.
 */

import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { deleteStatesOfTask } from "../tasks/userState";
import { deleteContentForStorage } from "../attachmentContents";

// ─── Validation helpers ──────────────────────────────────────────────────────────

/** Validate that all user IDs belong to the given org via orgMembers table. */
export async function validateAssignees(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  assigneeIds: Id<"users">[],
) {
  if (assigneeIds.length === 0) return;
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const memberUserIds = new Set(members.map((m) => m.userId?.toString()).filter(Boolean));
  for (const uid of assigneeIds) {
    if (!memberUserIds.has(uid.toString())) {
      throw new ConvexError("One or more assignees are not members of this organization");
    }
  }
}

/** Validate that a work category belongs to the given org. */
export async function validateWorkCategory(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  workCategoryId: Id<"workCategories">,
) {
  const cat = await ctx.db.get(workCategoryId);
  if (!cat || cat.orgId !== orgId) {
    throw new ConvexError("Work category not found");
  }
}

// ─── Cascade delete ──────────────────────────────────────────────────────────────

/**
 * True if the task has at least one time entry. Time entries are financial
 * ledger records — a task carrying any (even unbilled ones, which are future
 * revenue) must be archived, not deleted. Mirrors the projects.remove rule.
 */
export async function taskHasTimeEntries(ctx: QueryCtx, taskId: Id<"tasks">): Promise<boolean> {
  const entry = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .first();
  return entry !== null;
}

/**
 * Cascade-delete all related data for a single task (not subtasks — call separately for those).
 * Removes: time entries, activity log, comments (+ reactions + attachments), attachments, read receipts, notifications, per-user state, plan segments.
 *
 * Callers MUST check `taskHasTimeEntries` on the whole task tree first — this
 * function deletes entries unconditionally and would otherwise destroy
 * invoiced/settled ledger rows that every entry-level mutation protects.
 */
export async function cascadeDeleteTaskData(ctx: MutationCtx, taskId: Id<"tasks">) {
  // Plan segments — a Planner bar must never outlive its task. The task doc
  // still exists at every call site (rows are deleted after this cascade),
  // so its orgId is available for the org-scoped index.
  const task = await ctx.db.get(taskId);
  if (task) {
    const planSegments = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_taskId", (q) =>
        q.eq("orgId", task.orgId).eq("taskId", taskId),
      )
      .collect();
    for (const s of planSegments) await ctx.db.delete(s._id);
  }

  // Time entries
  const timeEntries = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .collect();
  for (const te of timeEntries) await ctx.db.delete(te._id);

  // Activity log
  const activities = await ctx.db
    .query("activityLog")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const a of activities) await ctx.db.delete(a._id);

  // Comment reactions
  const reactions = await ctx.db
    .query("commentReactions")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const r of reactions) await ctx.db.delete(r._id);

  // Comment attachments
  const commentAttachments = await ctx.db
    .query("commentAttachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const ca of commentAttachments) {
    await ctx.storage.delete(ca.fileId);
    await deleteContentForStorage(ctx, ca.fileId);
    await ctx.db.delete(ca._id);
  }

  // Comments
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const c of comments) await ctx.db.delete(c._id);

  // Task attachments
  const attachments = await ctx.db
    .query("attachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const att of attachments) {
    await ctx.storage.delete(att.fileId);
    await deleteContentForStorage(ctx, att.fileId);
    await ctx.db.delete(att._id);
  }

  // Comment read receipts
  const receipts = await ctx.db
    .query("commentReadReceipts")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const r of receipts) await ctx.db.delete(r._id);

  // Notifications
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const n of notifications) await ctx.db.delete(n._id);

  // Per-user task state (§4.3; also holds the mute)
  await deleteStatesOfTask(ctx, taskId);
}

/**
 * Resolve the default assignee for a task based on its project + category.
 *
 * Looks up the project's `defaultAssignees` mapping for the given category.
 * Validates the resolved user is still a valid org member before returning.
 *
 * Returns the userId if found and valid, null otherwise.
 * Pure lookup — no side effects, no mutations.
 */
export async function resolveDefaultAssignee(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: Id<"projects"> | undefined,
  categoryId: Id<"workCategories"> | undefined,
): Promise<Id<"users"> | null> {
  if (!projectId || !categoryId) return null;

  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== orgId || !project.defaultAssignees) return null;

  const match = project.defaultAssignees.find(
    (da) => da.workCategoryId === categoryId
  );
  if (!match) return null;

  // Validate the user is still a valid org member (O(1) indexed lookup)
  const membership = await ctx.db
    .query("orgMembers")
    .withIndex("by_userId", (q) => q.eq("userId", match.userId))
    .first();
  if (!membership || membership.orgId !== orgId) return null;

  return match.userId;
}
