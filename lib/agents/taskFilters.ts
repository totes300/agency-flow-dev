/**
 * Agent-friendly task filter façade — pure mapping layer.
 *
 * `api.tasks.list` speaks the UI's wire format: op/value filter objects,
 * tab unions, grouping. Exposing that shape to the model invites
 * hallucinated operators and malformed filter objects, so the `findTasks`
 * tool accepts a FLAT input (one optional scalar per dimension) and this
 * module maps it into the real query args (`mapAgentTaskFilters`) and
 * flattens the grouped response back into plain rows
 * (`flattenTaskGroups`). Both directions are pure and unit-tested; the
 * registry tool only wires them to `ctx.runQuery`.
 *
 * Ids stay plain strings here (this file must not import Convex types);
 * the Convex validator on `tasks.list` rejects malformed ids at runtime
 * with a model-actionable error.
 */

export const AGENT_TASK_LIMIT_DEFAULT = 50;
export const AGENT_TASK_LIMIT_MAX = 100;

export const AGENT_TASK_STATUS_TYPES = [
  "backlog",
  "in_progress",
  "review",
  "blocked",
  "done",
] as const;

export type AgentTaskStatusType = (typeof AGENT_TASK_STATUS_TYPES)[number];

export type AgentTaskFilterInput = {
  statusType?: AgentTaskStatusType;
  statusId?: string;
  clientId?: string;
  projectId?: string;
  assigneeId?: string;
  workCategoryId?: string;
  /** Due on or after this date (YYYY-MM-DD). */
  dueAfter?: string;
  /** Due on or before this date (YYYY-MM-DD). */
  dueBefore?: string;
  search?: string;
  /** Archived tasks live on their own tab; statusType is ignored with it. */
  includeArchived?: boolean;
  limit?: number;
};

/** Structural mirror of `api.tasks.list` args (ids as plain strings). */
export type TaskListQueryArgs = {
  tab:
    | "all"
    | "backlog"
    | "in_progress"
    | "review"
    | "blocked"
    | "done"
    | "archived";
  filters?: {
    statusId?: { op: "is"; value: string[] };
    clientId?: { op: "is"; value: string };
    projectId?: { op: "is"; value: string[] };
    assigneeIds?: { op: "is"; value: string[] };
    workCategoryId?: { op: "is"; value: string[] };
    dateFrom?: string;
    dateTo?: string;
  };
  groupBy: null;
  search?: string;
  sortBy: "updatedAt";
  sortOrder: "desc";
  limit: number;
};

/**
 * Map the flat agent input onto `tasks.list` args. Always ungrouped and
 * sorted by recent activity (updatedAt desc) — deterministic and the most
 * useful default for "what's going on" questions.
 */
export function mapAgentTaskFilters(
  input: AgentTaskFilterInput,
): TaskListQueryArgs {
  const filters: NonNullable<TaskListQueryArgs["filters"]> = {};
  if (input.statusId) filters.statusId = { op: "is", value: [input.statusId] };
  if (input.clientId) filters.clientId = { op: "is", value: input.clientId };
  if (input.projectId)
    filters.projectId = { op: "is", value: [input.projectId] };
  if (input.assigneeId)
    filters.assigneeIds = { op: "is", value: [input.assigneeId] };
  if (input.workCategoryId)
    filters.workCategoryId = { op: "is", value: [input.workCategoryId] };
  if (input.dueAfter) filters.dateFrom = input.dueAfter;
  if (input.dueBefore) filters.dateTo = input.dueBefore;

  const limit = Math.max(
    1,
    Math.min(input.limit ?? AGENT_TASK_LIMIT_DEFAULT, AGENT_TASK_LIMIT_MAX),
  );

  const search = input.search?.trim();

  return {
    // The archived tab is exclusive in `tasks.list`; statusType is ignored
    // when the caller asks for archived tasks (documented on the tool).
    tab: input.includeArchived ? "archived" : (input.statusType ?? "all"),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    groupBy: null,
    ...(search ? { search } : {}),
    sortBy: "updatedAt",
    sortOrder: "desc",
    limit,
  };
}

// ─── Response flattening ────────────────────────────────────────────────────

/** Structural subset of one enriched task inside a `tasks.list` group. */
export type TaskGroupTaskLike = {
  _id: string;
  title: string;
  statusType: string;
  billable: boolean;
  dueDate?: string | null;
  status?: { name: string } | null;
  project?: { name: string } | null;
  client?: { name: string } | null;
  category?: { name: string } | null;
  assignees?: Array<{ name: string }>;
};

export type TaskGroupLike = {
  tasks: TaskGroupTaskLike[];
};

export type FlatTaskRow = {
  id: string;
  title: string;
  status: string | null;
  statusType: string;
  projectName: string | null;
  clientName: string | null;
  categoryName: string | null;
  assigneeNames: string[];
  dueDate: string | null;
  billable: boolean;
};

/**
 * Flatten the grouped `tasks.list` response into plain rows. The agent
 * query always passes `groupBy: null` (a single bucket), but this handles
 * any number of groups defensively.
 */
export function flattenTaskGroups(groups: TaskGroupLike[]): FlatTaskRow[] {
  return groups.flatMap((group) =>
    group.tasks.map((t) => ({
      id: t._id,
      title: t.title,
      status: t.status?.name ?? null,
      statusType: t.statusType,
      projectName: t.project?.name ?? null,
      clientName: t.client?.name ?? null,
      categoryName: t.category?.name ?? null,
      assigneeNames: (t.assignees ?? []).map((a) => a.name),
      dueDate: t.dueDate ?? null,
      billable: t.billable,
    })),
  );
}
