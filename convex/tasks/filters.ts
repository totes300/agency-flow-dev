import { ME_FILTER_VALUE, NONE_FILTER_VALUE, type TaskViewSpec } from "./model";

/**
 * Saved-view filter matching, pure (docs/prd-tasks-refactor.md §4.4, §5.4).
 *
 * One implementation for both sides: `read.ts` applies a view's scope filters
 * server-side, the task view applies transient URL filters and facets
 * client-side over the loaded rows. No `ctx`, no Convex server imports, so
 * the client bundle can import it.
 */

export type ListFilter = TaskViewSpec["filters"][number];

/** The task fields a filter reads, as plain ids/strings (`null`/`undefined` = unset). */
export type FilterSubject = {
  statusId: string;
  statusCategory?: string | null;
  /** Unset = no priority (0). */
  priority?: number | null;
  assigneeIds: readonly string[];
  labelIds?: readonly string[] | null;
  projectId?: string | null;
  clientId?: string | null;
  workCategoryId?: string | null;
  createdBy: string;
  startDate?: string | null;
  dueDate?: string | null;
  billable: boolean;
};

/** Resolves "me" in assignee/createdBy filter values to the caller's id. */
export function resolveFilterValue(value: string, me: string): string {
  return value === ME_FILTER_VALUE ? me : value;
}

function matchIds(present: readonly string[], f: ListFilter, me: string): boolean {
  const values = f.values.map((v) => resolveFilterValue(v, me));
  // `none` stands for "the property is unset" (No assignee, No label, …).
  const hit = values.includes(NONE_FILTER_VALUE) && present.length === 0;
  switch (f.operator) {
    case "is":
      return hit || present.some((p) => values.includes(p));
    case "isNot":
      return !hit && !present.some((p) => values.includes(p));
    case "isEmpty":
      return present.length === 0;
    case "isNotEmpty":
      return present.length > 0;
    default:
      return true;
  }
}

function matchDate(value: string | null | undefined, f: ListFilter): boolean {
  const pivot = f.values[0];
  const set = value !== undefined && value !== null;
  switch (f.operator) {
    case "isEmpty":
      return !set;
    case "isNotEmpty":
      return set;
    case "before":
      return set && pivot !== undefined && value < pivot;
    case "after":
      return set && pivot !== undefined && value > pivot;
    case "is":
      return set && f.values.includes(value);
    case "isNot":
      return !set || !f.values.includes(value);
  }
}

const one = (id: string | null | undefined): string[] => (id === undefined || id === null ? [] : [id]);

/**
 * Whether a task passes one filter. `newComments` reads the caller's unread
 * count (`unreadComments`), which only the per-user join knows.
 */
export function matchesFilter(
  task: FilterSubject,
  f: ListFilter,
  me: string,
  unreadComments = 0,
): boolean {
  switch (f.property) {
    case "status":
      return matchIds([task.statusId], f, me);
    case "statusCategory":
      return matchIds(one(task.statusCategory), f, me);
    case "priority":
      return matchIds([String(task.priority ?? 0)], f, me);
    case "assignee":
      return matchIds(task.assigneeIds, f, me);
    case "label":
      return matchIds(task.labelIds ?? [], f, me);
    case "project":
      return matchIds(one(task.projectId), f, me);
    case "client":
      return matchIds(one(task.clientId), f, me);
    case "workCategory":
      return matchIds(one(task.workCategoryId), f, me);
    case "createdBy":
      return matchIds([task.createdBy], f, me);
    case "startDate":
      return matchDate(task.startDate, f);
    case "dueDate":
      return matchDate(task.dueDate, f);
    case "billable":
      return f.operator === "isNot"
        ? !f.values.includes(String(task.billable))
        : f.values.length === 0 || f.values.includes(String(task.billable));
    case "newComments": {
      const want = f.values[0] !== "false";
      const has = unreadComments > 0;
      return f.operator === "isNot" ? has !== want : has === want;
    }
  }
}

export function matchesFilters(
  task: FilterSubject,
  filters: readonly ListFilter[],
  me: string,
  unreadComments = 0,
): boolean {
  return filters.every((f) => matchesFilter(task, f, me, unreadComments));
}
