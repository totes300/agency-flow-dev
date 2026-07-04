/**
 * Shared helpers for task queries and mutations.
 * Extracted from convex/tasks.ts for maintainability.
 */

import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { StatusType } from "./constants";

// ─── Types ───────────────────────────────────────────────────────────────────────

export type TaskWithJoins = Doc<"tasks"> & {
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type" | "icon"> | null;
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null;
  client: Pick<Doc<"clients">, "_id" | "name" | "prefix" | "usePrefix"> | null;
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null;
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>;
};

// ─── Base visibility filter ──────────────────────────────────────────────────────

/**
 * Shared predicate: is this task a top-level task visible to the given user?
 * Used by both `counts` and `list` queries to guarantee identical filtering.
 *
 * Rules:
 * - Subtasks (parentTaskId set) are always excluded
 * - Members only see tasks assigned to them; admins see all
 *
 * Does NOT filter by archived state — callers handle that based on context
 * (counts buckets archived separately, list filters by tab).
 */
export function isVisibleTopLevelTask(
  task: Doc<"tasks">,
  userId: Id<"users">,
  isAdmin: boolean,
): boolean {
  if (task.parentTaskId) return false;
  if (!isAdmin && !task.assigneeIds.includes(userId)) return false;
  return true;
}

// ─── Constants ───────────────────────────────────────────────────────────────────

/** 1:1 mapping — each tab filters by exactly one statusType. "all" = no filter. */
export const TAB_STATUS_TYPE: Record<string, StatusType | null> = {
  all: null,
  archived: null,
  backlog: "backlog",
  in_progress: "in_progress",
  review: "review",
  blocked: "blocked",
  done: "done",
};

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

/** Find the first backlog-type status (used as default for new tasks). */
export async function getDefaultStatusId(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<{ statusId: Id<"statuses">; statusType: StatusType }> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId_type", (q) => q.eq("orgId", orgId).eq("type", "backlog"))
    .collect();
  const active = statuses
    .filter((s) => !s.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (active.length === 0) throw new ConvexError("No backlog status found for org");
  return { statusId: active[0]._id, statusType: "backlog" };
}

// ─── Cascade delete ──────────────────────────────────────────────────────────────

/**
 * Cascade-delete all related data for a single task (not subtasks — call separately for those).
 * Removes: time entries, activity log, comments (+ reactions + attachments), attachments, read receipts, notifications, task mutes.
 */
export async function cascadeDeleteTaskData(ctx: MutationCtx, taskId: Id<"tasks">) {
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

  // Task mutes
  const mutes = await ctx.db
    .query("taskMutes")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const m of mutes) await ctx.db.delete(m._id);
}

// ─── Enrichment ──────────────────────────────────────────────────────────────────

/**
 * Build the enrichTask function from pre-loaded lookup maps.
 * Used by the list query after batch-loading all referenced entities.
 */
export function createTaskEnricher(maps: {
  statusMap: Map<string, Doc<"statuses">>;
  projectMap: Map<string, Doc<"projects">>;
  clientMap: Map<string, Doc<"clients">>;
  categoryMap: Map<string, Doc<"workCategories">>;
  userMap: Map<string, Doc<"users">>;
}) {
  return function enrichTask(task: Doc<"tasks">): TaskWithJoins {
    const status = maps.statusMap.get(task.statusId.toString());
    const project = task.projectId ? maps.projectMap.get(task.projectId.toString()) : null;
    const client = project ? maps.clientMap.get(project.clientId.toString()) : null;
    const category = task.workCategoryId ? maps.categoryMap.get(task.workCategoryId.toString()) : null;
    const assignees = task.assigneeIds
      .map((id) => maps.userMap.get(id.toString()))
      .filter(Boolean) as Doc<"users">[];

    return {
      ...task,
      status: status
        ? { _id: status._id, name: status.name, color: status.color, type: status.type, icon: status.icon }
        : null,
      project: project
        ? { _id: project._id, name: project.name, code: project.code }
        : null,
      client: client
        ? { _id: client._id, name: client.name, prefix: client.prefix, usePrefix: client.usePrefix }
        : null,
      category: category
        ? { _id: category._id, name: category.name, color: category.color }
        : null,
      assignees: assignees.map((u) => ({
        _id: u._id, name: u.name, email: u.email, imageUrl: u.imageUrl,
      })),
    };
  };
}

// ─── Default assignee resolution ────────────────────────────────────────────────

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
