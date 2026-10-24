/**
 * Agent task-tool helpers — pure mapping layer (docs/prd-tasks-refactor.md §7).
 *
 * The `findTasks` tool accepts a FLAT input (one optional scalar per
 * dimension) instead of the view layer's filter objects, so the model can't
 * hallucinate operators or malformed filters. This module maps that input
 * onto the shared view filters (`convex/tasks/filters.ts`, the same matcher
 * the task views use) and decides which status categories a query covers.
 * `convex/tasks/agent.ts` loads through the bounded read layer and applies
 * these; everything here is pure and unit-tested.
 *
 * Ids stay plain strings: `convex/tasks/agent.ts` normalizes and validates
 * them against the caller's org before filtering, with model-actionable
 * errors for malformed or foreign ids.
 */

import type { ListFilter } from "../convex/tasks/filters";
import {
  TASK_CATEGORIES,
  isClosedCategory,
  type TaskCategory,
} from "../convex/tasks/model";

export const AGENT_TASK_LIMIT_DEFAULT = 50;
export const AGENT_TASK_LIMIT_MAX = 100;

/** The five fixed status categories, as the tools' enum. */
export const AGENT_TASK_CATEGORIES = TASK_CATEGORIES;

export type AgentTaskFilterInput = {
  /** One status category; wins over `includeClosed`. */
  category?: TaskCategory;
  statusId?: string;
  clientId?: string;
  projectId?: string;
  assigneeId?: string;
  workCategoryId?: string;
  /** Due on or after this date (YYYY-MM-DD), inclusive. */
  dueAfter?: string;
  /** Due on or before this date (YYYY-MM-DD), inclusive. */
  dueBefore?: string;
  search?: string;
  /** Also return completed and canceled tasks (default: open only). */
  includeClosed?: boolean;
  limit?: number;
};

export function clampAgentTaskLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return AGENT_TASK_LIMIT_DEFAULT;
  return Math.max(1, Math.min(AGENT_TASK_LIMIT_MAX, Math.floor(limit)));
}

/**
 * The categories a query covers: the explicit `category`, else the
 * category of the pinned status (`statusCategory`, resolved by the caller),
 * else every open category — plus the closed ones with `includeClosed`.
 */
export function agentTaskCategories(input: {
  category?: TaskCategory;
  statusCategory?: TaskCategory;
  includeClosed?: boolean;
}): TaskCategory[] {
  if (input.category) return [input.category];
  if (input.statusCategory) return [input.statusCategory];
  return TASK_CATEGORIES.filter((c) => input.includeClosed === true || !isClosedCategory(c));
}

/**
 * The id filters of a flat input as view filters (one `is` per set
 * dimension), plus the category scope. Due dates are NOT mapped: the view
 * matcher's `before`/`after` are strict, the agent's range is inclusive
 * (`inDueRange`).
 */
export function agentTaskViewFilters(
  input: Pick<AgentTaskFilterInput, "statusId" | "clientId" | "projectId" | "assigneeId" | "workCategoryId">,
  categories: readonly TaskCategory[],
): ListFilter[] {
  const filters: ListFilter[] = [{ property: "statusCategory", operator: "is", values: [...categories] }];
  const pin = (property: ListFilter["property"], value: string | undefined) => {
    if (value) filters.push({ property, operator: "is", values: [value] });
  };
  pin("status", input.statusId);
  pin("client", input.clientId);
  pin("project", input.projectId);
  pin("assignee", input.assigneeId);
  pin("workCategory", input.workCategoryId);
  return filters;
}

/** Inclusive due-date range; a task without a due date never matches a set bound. */
export function inDueRange(
  dueDate: string | null | undefined,
  range: { dueAfter?: string; dueBefore?: string },
): boolean {
  if (!range.dueAfter && !range.dueBefore) return true;
  if (!dueDate) return false;
  if (range.dueAfter && dueDate < range.dueAfter) return false;
  if (range.dueBefore && dueDate > range.dueBefore) return false;
  return true;
}

/** One `findTasks` row: flat, names resolved, nothing the model must join. */
export type AgentTaskRow = {
  id: string;
  /** `ARLO-21` — what the user sees and what the task tools accept. */
  identifier: string | null;
  title: string;
  status: string | null;
  statusCategory: TaskCategory | null;
  priority: string;
  project: string | null;
  client: string | null;
  workCategory: string | null;
  assignees: string[];
  dueDate: string | null;
  billable: boolean;
  /** The parent's identifier when this is a sub-task. */
  parent: string | null;
};
