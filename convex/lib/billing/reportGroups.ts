/**
 * Category → task grouping of a report's entries — shared by the monthly
 * report queries so the statement document and the breakdown never disagree
 * on what work was logged.
 */

import type { Doc, Id } from "../../_generated/dataModel";

export type EntryRow = {
  _id: Id<"timeEntries">;
  taskId: Id<"tasks">;
  workCategoryId?: Id<"workCategories">;
  durationMinutes: number;
  date: string;
};

/**
 * Group a month's billable entries by category → task. Mirrors the shape of
 * `buildRetainerCategoryGroups` in `convex/projects.ts` so the statement
 * document and the monthly breakdown row never disagree on what work was
 * logged. We re-derive (rather than calling getRetainerData) because that
 * query is cycle-scoped and would force this to compute the right
 * cycleOffset just to read one month.
 */
export function groupByCategory(
  entries: EntryRow[],
  taskMap: Map<string, Doc<"tasks">>,
  catMap: Map<string, { name: string; color: string }>,
) {
  type Task = {
    taskId: string;
    taskTitle: string;
    totalMinutes: number;
  };
  type CategoryGroup = {
    categoryName: string;
    categoryColor: string;
    totalMinutes: number;
    tasks: Task[];
  };

  const byCat = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const key = e.workCategoryId?.toString() ?? "uncategorized";
    const bucket = byCat.get(key);
    if (bucket) bucket.push(e);
    else byCat.set(key, [e]);
  }

  const out: CategoryGroup[] = [];
  for (const [catKey, catEntries] of byCat) {
    const cat = catKey === "uncategorized" ? null : catMap.get(catKey);
    const categoryName = cat?.name ?? "No category";
    const categoryColor = cat?.color ?? "gray";

    const byTask = new Map<string, EntryRow[]>();
    for (const e of catEntries) {
      const tid = e.taskId.toString();
      const bucket = byTask.get(tid);
      if (bucket) bucket.push(e);
      else byTask.set(tid, [e]);
    }

    const tasks: Task[] = [];
    for (const [taskId, taskEntries] of byTask) {
      const task = taskMap.get(taskId);
      tasks.push({
        taskId,
        taskTitle: task?.title ?? "Unknown task",
        totalMinutes: taskEntries.reduce((s, e) => s + e.durationMinutes, 0),
      });
    }
    tasks.sort((a, b) => b.totalMinutes - a.totalMinutes);

    out.push({
      categoryName,
      categoryColor,
      totalMinutes: catEntries.reduce((s, e) => s + e.durationMinutes, 0),
      tasks,
    });
  }
  out.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  return out;
}
