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

// ─── Group ordering (matches status type workflow) ──────────────────────────

const GROUP_ORDER: Record<string, number> = {
  today: 0,
  in_progress: 1,
  backlog: 2,
  blocked: 3,
  done: 4,
  completed_today: 99, // always last
};

const TYPE_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
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
 * Group tasks by status for the My Tasks view.
 *
 * - Tasks with the "Today" named status → "today" group (always shown)
 * - Tasks with done/review type updated today → "completed_today" group (always shown)
 * - Other tasks → grouped by statusType (only if in todayVisibleStatuses)
 *
 * @param todayVisibleStatuses - undefined = focus mode (today + completed_today only);
 *   string[] = expanded mode with additional status type keys
 * @param todayDateStr - YYYY-MM-DD string for "completed today" filtering
 */
export function groupByStatus<T extends MinimalTask>(
  tasks: T[],
  statuses: MinimalStatus[],
  todayVisibleStatuses: string[] | undefined,
  todayDateStr: string,
): MyTasksGroup<T>[] {
  // Find the "Today" named status
  const todayStatus = statuses.find(
    (s) => s.name === "Today" && !s.archivedAt,
  );

  const groupMap = new Map<string, MyTasksGroup<T>>();

  const getOrCreateGroup = (key: string, label: string, statusType: string, statusId?: Id<"statuses">): MyTasksGroup<T> => {
    let group = groupMap.get(key);
    if (!group) {
      group = { key, label, statusType, statusId, tasks: [], count: 0 };
      groupMap.set(key, group);
    }
    return group;
  };

  for (const task of tasks) {
    // Done/review tasks updated today → "completed_today" group
    if (task.statusType === "done" || task.statusType === "review") {
      const taskDate = new Date(task.updatedAt).toISOString().slice(0, 10);
      if (taskDate === todayDateStr) {
        const group = getOrCreateGroup("completed_today", "Completed today", "done");
        group.tasks.push(task);
        group.count++;
      }
      continue;
    }

    // "Today" named status → "today" group
    if (todayStatus && task.statusId === todayStatus._id) {
      const group = getOrCreateGroup("today", "Today", "backlog", todayStatus._id);
      group.tasks.push(task);
      group.count++;
      continue;
    }

    // Other tasks → grouped by statusType (only if visible)
    const typeKey = task.statusType;
    const isVisible = todayVisibleStatuses?.includes(typeKey);
    if (isVisible) {
      const label = TYPE_LABELS[typeKey] ?? typeKey;
      const group = getOrCreateGroup(typeKey, label, typeKey);
      group.tasks.push(task);
      group.count++;
    }
  }

  // Always include "today" group even if empty (shows empty state + inline add)
  if (todayStatus && !groupMap.has("today")) {
    getOrCreateGroup("today", "Today", "backlog", todayStatus._id);
  }

  // Convert to array, filter empty (except "today" which always shows), sort by group order
  return Array.from(groupMap.values())
    .filter((g) => g.tasks.length > 0 || g.key === "today")
    .sort((a, b) => (GROUP_ORDER[a.key] ?? 50) - (GROUP_ORDER[b.key] ?? 50));
}

// ─── sortWithinGroup ────────────────────────────────────────────────────────────

/**
 * Sort tasks within a group:
 * 1. manualSortKey (string sort, present before absent)
 * 2. dueDate ASC (present before absent)
 * 3. createdAt DESC
 */
export function sortWithinGroup<T extends MinimalTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    // 1. manualSortKey: present before absent, then string compare
    const aHasKey = a.manualSortKey != null;
    const bHasKey = b.manualSortKey != null;
    if (aHasKey !== bHasKey) return aHasKey ? -1 : 1;
    if (aHasKey && bHasKey) {
      const cmp = a.manualSortKey!.localeCompare(b.manualSortKey!);
      if (cmp !== 0) return cmp;
    }

    // 2. dueDate ASC: present before absent
    const aHasDate = a.dueDate != null;
    const bHasDate = b.dueDate != null;
    if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
    if (aHasDate && bHasDate) {
      const cmp = a.dueDate!.localeCompare(b.dueDate!);
      if (cmp !== 0) return cmp;
    }

    // 3. createdAt DESC
    return b.createdAt - a.createdAt;
  });
}

// ─── hiddenCount ────────────────────────────────────────────────────────────────

/**
 * Count tasks that are filtered out by the current view settings.
 * "completed_today" and "today" tasks are never hidden.
 */
export function countHiddenTasks<T extends MinimalTask>(
  tasks: T[],
  statuses: MinimalStatus[],
  todayVisibleStatuses: string[] | undefined,
  todayDateStr: string,
): number {
  const todayStatus = statuses.find(
    (s) => s.name === "Today" && !s.archivedAt,
  );

  return tasks.filter((task) => {
    // Completed today tasks are always shown
    if (task.statusType === "done" || task.statusType === "review") {
      const taskDate = new Date(task.updatedAt).toISOString().slice(0, 10);
      if (taskDate === todayDateStr) return false;
    }
    // Today status tasks are always shown
    if (todayStatus && task.statusId === todayStatus._id) return false;
    // Check if type is in visible statuses
    return !todayVisibleStatuses?.includes(task.statusType);
  }).length;
}
