/**
 * Pure helper functions for the My Tasks view.
 * No Convex ctx dependency — easily testable.
 */

import type { Id } from "../_generated/dataModel";
import type { StatusType } from "./constants";

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Minimal task shape needed by helpers (avoids importing full Doc type in tests). */
export type MinimalTask = {
  _id: Id<"tasks">;
  statusId: Id<"statuses">;
  statusType: StatusType;
  assigneeIds: Id<"users">[];
  parentTaskId?: Id<"tasks">;
  archivedAt?: number;
  manualSortKey?: string;
  dueDate?: string;
  createdAt: number;
  updatedAt: number;
};

/** Minimal status shape needed by helpers. */
export type MinimalStatus = {
  _id: Id<"statuses">;
  name: string;
  type: StatusType;
  color: string;
  icon?: string;
  sortOrder: number;
  archivedAt?: number;
};

export type MyTasksGroup<T extends MinimalTask = MinimalTask> = {
  key: string;
  label: string;
  statusType: string;
  statusId?: Id<"statuses">;
  tasks: T[];
  count: number;
};

// ─── filterMyTasks ──────────────────────────────────────────────────────────────

/**
 * Filter tasks to only those relevant for the current user's My Tasks view:
 * - Assigned to userId
 * - Not archived
 * - Not a subtask
 */
export function filterMyTasks<T extends MinimalTask>(
  tasks: T[],
  userId: Id<"users">,
): T[] {
  return tasks.filter(
    (t) =>
      t.assigneeIds.includes(userId) &&
      !t.archivedAt &&
      !t.parentTaskId,
  );
}

// ─── groupByStatus ──────────────────────────────────────────────────────────────

/**
 * Group tasks by individual status for the My Tasks view.
 *
 * - Tasks whose statusId is in visibleStatusIds → one group per status
 * - Tasks with done/review type updated today → "completed_today" group (always shown)
 * - Everything else → hidden (counted separately)
 *
 * @param visibleStatusIds - resolved list of status IDs to show as groups
 * @param statuses - all active statuses (for label/sort lookup)
 * @param todayDateStr - YYYY-MM-DD string for "completed today" filtering
 */
export function groupByStatus<T extends MinimalTask>(
  tasks: T[],
  statuses: MinimalStatus[],
  visibleStatusIds: Id<"statuses">[],
  todayDateStr: string,
): MyTasksGroup<T>[] {
  const statusMap = new Map(statuses.map((s) => [s._id as string, s]));
  const visibleSet = new Set(visibleStatusIds.map((id) => id as string));

  const groupMap = new Map<string, MyTasksGroup<T>>();

  const getOrCreateGroup = (
    key: string,
    label: string,
    statusType: string,
    statusId?: Id<"statuses">,
  ): MyTasksGroup<T> => {
    let group = groupMap.get(key);
    if (!group) {
      group = { key, label, statusType, statusId, tasks: [], count: 0 };
      groupMap.set(key, group);
    }
    return group;
  };

  for (const task of tasks) {
    let placed = false;

    // 1. Status group: if the task's status is visible → its own group
    if (visibleSet.has(task.statusId as string)) {
      const status = statusMap.get(task.statusId as string);
      const key = `status_${task.statusId}`;
      const label = status?.name ?? "Unknown";
      const group = getOrCreateGroup(key, label, task.statusType, task.statusId);
      group.tasks.push(task);
      group.count++;
      placed = true;
    }

    // 2. Completed today: done/review tasks updated today ALWAYS appear here too
    if (task.statusType === "done" || task.statusType === "review") {
      const taskDate = new Date(task.updatedAt).toISOString().slice(0, 10);
      if (taskDate === todayDateStr) {
        const group = getOrCreateGroup("completed_today", "Completed today", "done");
        group.tasks.push(task);
        group.count++;
        placed = true;
      }
    }

    // Not placed anywhere = hidden
    if (!placed) {
      // done/review from other days without visible status → hidden
      // other types without visible status → hidden
    }
  }

  // Always include visible status groups even if empty (shows inline add)
  for (const statusId of visibleStatusIds) {
    const key = `status_${statusId}`;
    if (!groupMap.has(key)) {
      const status = statusMap.get(statusId as string);
      if (status) {
        getOrCreateGroup(key, status.name, status.type, statusId);
      }
    }
  }

  // Sort groups: visible statuses by sortOrder, completed_today last
  const statusSortOrder = new Map(
    visibleStatusIds.map((id, idx) => {
      const status = statusMap.get(id as string);
      return [id as string, status?.sortOrder ?? idx];
    }),
  );

  return Array.from(groupMap.values())
    .filter((g) => g.tasks.length > 0 || g.key !== "completed_today")
    .sort((a, b) => {
      // completed_today always last
      if (a.key === "completed_today") return 1;
      if (b.key === "completed_today") return -1;
      // Sort by status sortOrder
      const aOrder = a.statusId ? (statusSortOrder.get(a.statusId as string) ?? 50) : 50;
      const bOrder = b.statusId ? (statusSortOrder.get(b.statusId as string) ?? 50) : 50;
      return aOrder - bOrder;
    });
}

// ─── sortWithinGroup ────────────────────────────────────────────────────────────

/**
 * Sort tasks within a group:
 * - Both have manualSortKey → string compare (fractional indexing)
 * - Otherwise → createdAt ASC (oldest first, newest at the end)
 */
export function sortWithinGroup<T extends MinimalTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    // Both have manualSortKey → use code-point order (required by fractional-indexing)
    if (a.manualSortKey != null && b.manualSortKey != null) {
      if (a.manualSortKey < b.manualSortKey) return -1;
      if (a.manualSortKey > b.manualSortKey) return 1;
    }

    // Fallback: createdAt ASC (newest at the end)
    return a.createdAt - b.createdAt;
  });
}

// ─── hiddenCount ────────────────────────────────────────────────────────────────

/**
 * Count tasks that are filtered out by the current view settings.
 * "completed_today" tasks are never hidden.
 */
export function countHiddenTasks<T extends MinimalTask>(
  tasks: T[],
  visibleStatusIds: Id<"statuses">[],
  todayDateStr: string,
): number {
  const visibleSet = new Set(visibleStatusIds.map((id) => id as string));

  return tasks.filter((task) => {
    // Completed today tasks are always shown
    if (task.statusType === "done" || task.statusType === "review") {
      const taskDate = new Date(task.updatedAt).toISOString().slice(0, 10);
      if (taskDate === todayDateStr) return false;
    }
    // Check if status is in visible set
    return !visibleSet.has(task.statusId as string);
  }).length;
}
