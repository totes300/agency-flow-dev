import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import {
  addDaysToDateString,
  segmentCoversDate,
  SEGMENT_SCAN_WINDOW_DAYS,
} from "../lib/todayPlan";
import {
  canArchive,
  canDelete,
  canEditField,
  filterReadableTasks,
  type TaskAccess,
  type TaskField,
} from "./access";
import {
  ME_FILTER_VALUE,
  PRIORITY,
  TASK_CATEGORIES,
  isClosedCategory,
  isTaskCategory,
  type TaskCategory,
  type TaskPriority,
  type TaskViewSpec,
} from "./model";
import { loadUserStates } from "./userState";

/**
 * The task read layer (docs/prd-tasks-refactor.md §5.4, invariant T7).
 *
 * - Every loader reads ONE index range with an explicit cap (`take(cap + 1)`)
 *   and reports `truncated` when the cap is hit. No loader scans the org.
 * - Index selection (`planListLoad`): a member, or an "assigned to X" view →
 *   `taskAssignees.by_orgId_userId_taskId`; a project → the project index;
 *   "created by X" → `by_orgId_createdBy`; otherwise the category index for
 *   open categories and `by_orgId_completedAt` (newest first) for closed ones.
 * - Rows are flat, id-based DTOs (`TaskRowDTO`); names and colours come from
 *   `workspaceRefs`. Grouping, sorting and facets run client-side.
 * - Access: loaders return candidate rows; `filterReadableTasks` (access.ts)
 *   decides what the caller may see (T1). A member's lists are built from
 *   their own edges, plus the sub-tasks of their assigned parents (§11.5).
 */

type ReadCtx = QueryCtx | MutationCtx;

// ─── Caps ────────────────────────────────────────────────────────────────────

/** Open rows per view (§5.4). */
export const OPEN_ROW_CAP = 1000;
/** Closed (completed + canceled) rows per page, newest first ("Load more" raises the limit). */
export const CLOSED_ROW_DEFAULT = 200;
export const CLOSED_ROW_MAX = 2000;
/** Edge rows read for one user (open and closed tasks share the edge index). */
export const ASSIGNEE_EDGE_CAP = 2000;
/** Sub-tasks read per parent. */
export const SUBTASK_CAP = 200;
/** Caller state rows joined into one list. */
export const USER_STATE_CAP = 2000;
/** Search hits read before access/closed filtering. */
export const SEARCH_CAP = 200;
export const PICKER_DEFAULT_LIMIT = 20;
export const PICKER_MAX_LIMIT = 50;

export const OPEN_CATEGORIES: readonly TaskCategory[] = TASK_CATEGORIES.filter((c) => !isClosedCategory(c));
export const CLOSED_CATEGORIES: readonly TaskCategory[] = TASK_CATEGORIES.filter(isClosedCategory);

export type Loaded = { tasks: Doc<"tasks">[]; truncated: boolean };

function capped<T>(rows: T[], cap: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, cap), truncated: rows.length > cap };
}

// ─── Loaders (one index range each, T7) ──────────────────────────────────────

/** Open/closed rows of the given categories in the org, sort-key order, one shared cap. */
export async function loadByCategories(
  ctx: ReadCtx,
  orgId: string,
  categories: readonly TaskCategory[],
  cap: number,
): Promise<Loaded> {
  const tasks: Doc<"tasks">[] = [];
  for (const category of categories) {
    const remaining = cap - tasks.length;
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_statusCategory_sortKey", (q) =>
        q.eq("orgId", orgId).eq("statusCategory", category),
      )
      .take(remaining + 1);
    const page = capped(rows, remaining);
    tasks.push(...page.rows);
    if (page.truncated) return { tasks, truncated: true };
  }
  return { tasks, truncated: false };
}

/** Closed tasks of the org, most recently closed first (T4: completedAt ⇔ closed). */
export async function loadRecentlyClosed(ctx: ReadCtx, orgId: string, limit: number): Promise<Loaded> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_completedAt", (q) => q.eq("orgId", orgId).gte("completedAt", 0))
    .order("desc")
    .take(limit + 1);
  const page = capped(rows, limit);
  return { tasks: page.rows, truncated: page.truncated };
}

/** A project's tasks of the given categories (closed ones newest-created first). */
export async function loadProjectTasks(
  ctx: ReadCtx,
  orgId: string,
  projectId: Id<"projects">,
  categories: readonly TaskCategory[],
  cap: number,
): Promise<Loaded> {
  const tasks: Doc<"tasks">[] = [];
  for (const category of categories) {
    const remaining = cap - tasks.length;
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId_statusCategory", (q) =>
        q.eq("orgId", orgId).eq("projectId", projectId).eq("statusCategory", category),
      )
      .order(isClosedCategory(category) ? "desc" : "asc")
      .take(remaining + 1);
    const page = capped(rows, remaining);
    tasks.push(...page.rows);
    if (page.truncated) return { tasks, truncated: true };
  }
  return { tasks, truncated: false };
}

/** Tasks with an assignee edge for `userId` (any category). */
export async function loadAssignedTo(
  ctx: ReadCtx,
  orgId: string,
  userId: Id<"users">,
  edgeCap: number = ASSIGNEE_EDGE_CAP,
): Promise<Loaded> {
  const edges = await ctx.db
    .query("taskAssignees")
    .withIndex("by_orgId_userId_taskId", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .take(edgeCap + 1);
  const page = capped(edges, edgeCap);
  const docs = await Promise.all(page.rows.map((e) => ctx.db.get(e.taskId)));
  return {
    tasks: docs.filter((t): t is Doc<"tasks"> => t !== null && t.orgId === orgId),
    truncated: page.truncated,
  };
}

/** Tasks created by `userId` (any category). */
export async function loadCreatedBy(
  ctx: ReadCtx,
  orgId: string,
  userId: Id<"users">,
  cap: number,
): Promise<Loaded> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_createdBy", (q) => q.eq("orgId", orgId).eq("createdBy", userId))
    .order("desc")
    .take(cap + 1);
  const page = capped(rows, cap);
  return { tasks: page.rows, truncated: page.truncated };
}

/** A parent's sub-tasks (archived included; callers filter). */
export async function loadSubtasksOf(
  ctx: ReadCtx,
  orgId: string,
  parentId: Id<"tasks">,
  cap: number = SUBTASK_CAP,
): Promise<Loaded> {
  const rows = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", parentId))
    .take(cap + 1);
  const page = capped(rows, cap);
  return { tasks: page.rows, truncated: page.truncated };
}

/**
 * Sub-tasks reachable through assigned parents (§11.5) that are not already
 * in `tasks`. One bounded parent-index read per parent that has sub-tasks.
 */
export async function loadViaParentSubtasks(
  ctx: ReadCtx,
  orgId: string,
  tasks: readonly Doc<"tasks">[],
): Promise<Loaded> {
  const have = new Set(tasks.map((t) => t._id));
  const extra: Doc<"tasks">[] = [];
  let truncated = false;
  for (const parent of tasks) {
    if (parent.parentTaskId || parent.subtaskCount === 0) continue;
    const subs = await loadSubtasksOf(ctx, orgId, parent._id);
    truncated ||= subs.truncated;
    for (const sub of subs.tasks) {
      if (!have.has(sub._id)) {
        have.add(sub._id);
        extra.push(sub);
      }
    }
  }
  return { tasks: extra, truncated };
}

// ─── Index selection (§5.4) ──────────────────────────────────────────────────

export type ListFilter = TaskViewSpec["filters"][number];

export type LoadPlan =
  | { kind: "assignee"; userId: Id<"users"> }
  | { kind: "createdBy"; userId: Id<"users"> }
  | { kind: "project"; projectId: Id<"projects">; categories: TaskCategory[] }
  | { kind: "category"; open: TaskCategory[]; closed: TaskCategory[] };

/** Resolves "me" in assignee/createdBy filter values to the caller's id. */
export function resolveFilterValue(value: string, me: Id<"users">): string {
  return value === ME_FILTER_VALUE ? me : value;
}

/** The categories a spec's `statusCategory` filters allow (all when unfiltered). */
export function categoriesOf(filters: readonly ListFilter[]): TaskCategory[] {
  let allowed: TaskCategory[] = [...TASK_CATEGORIES];
  for (const f of filters) {
    if (f.property !== "statusCategory") continue;
    const values = f.values.filter(isTaskCategory);
    if (f.operator === "is") allowed = allowed.filter((c) => values.includes(c));
    else if (f.operator === "isNot") allowed = allowed.filter((c) => !values.includes(c));
  }
  return allowed;
}

/** The single id an `is` filter on `property` pins, if any. */
function pinnedValue(filters: readonly ListFilter[], property: ListFilter["property"]): string | undefined {
  const f = filters.find((x) => x.property === property && x.operator === "is" && x.values.length === 1);
  return f?.values[0];
}

/**
 * Picks the most selective index for a list (§5.4). Members always read their
 * own edges (their visibility IS the edge set); admins narrow by a pinned
 * project, assignee or creator, else by category.
 */
export function planListLoad(input: {
  auth: Pick<AuthContext, "userId" | "isAdmin">;
  filters: readonly ListFilter[];
  projectId?: Id<"projects">;
}): LoadPlan {
  const { auth, filters } = input;
  const categories = categoriesOf(filters);
  if (!auth.isAdmin) return { kind: "assignee", userId: auth.userId };
  const project = input.projectId ?? (pinnedValue(filters, "project") as Id<"projects"> | undefined);
  if (project) return { kind: "project", projectId: project, categories };
  const assignee = pinnedValue(filters, "assignee");
  if (assignee) return { kind: "assignee", userId: resolveFilterValue(assignee, auth.userId) as Id<"users"> };
  const creator = pinnedValue(filters, "createdBy");
  if (creator) return { kind: "createdBy", userId: resolveFilterValue(creator, auth.userId) as Id<"users"> };
  return {
    kind: "category",
    open: categories.filter((c) => !isClosedCategory(c)),
    closed: categories.filter(isClosedCategory),
  };
}

// ─── Spec filters (pure) ─────────────────────────────────────────────────────

function matchIds(present: readonly string[], f: ListFilter, me: Id<"users">): boolean {
  const values = f.values.map((v) => resolveFilterValue(v, me));
  switch (f.operator) {
    case "is":
      return present.some((p) => values.includes(p));
    case "isNot":
      return !present.some((p) => values.includes(p));
    case "isEmpty":
      return present.length === 0;
    case "isNotEmpty":
      return present.length > 0;
    default:
      return true;
  }
}

function matchDate(value: string | undefined, f: ListFilter): boolean {
  const pivot = f.values[0];
  switch (f.operator) {
    case "isEmpty":
      return value === undefined;
    case "isNotEmpty":
      return value !== undefined;
    case "before":
      return value !== undefined && pivot !== undefined && value < pivot;
    case "after":
      return value !== undefined && pivot !== undefined && value > pivot;
    case "is":
      return value !== undefined && f.values.includes(value);
    case "isNot":
      return value === undefined || !f.values.includes(value);
  }
}

const one = (id: string | undefined) => (id === undefined ? [] : [id]);

/**
 * Whether a task passes one saved-view filter. `newComments` needs the
 * caller's state and is checked by `matchesFilters` with `unreadComments`.
 */
export function matchesFilter(
  task: Doc<"tasks">,
  f: ListFilter,
  me: Id<"users">,
  unreadComments = 0,
): boolean {
  switch (f.property) {
    case "status":
      return matchIds([task.statusId], f, me);
    case "statusCategory":
      return matchIds(one(task.statusCategory), f, me);
    case "priority":
      return matchIds([String(task.priority ?? PRIORITY.none)], f, me);
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
  task: Doc<"tasks">,
  filters: readonly ListFilter[],
  me: Id<"users">,
  unreadComments = 0,
): boolean {
  return filters.every((f) => matchesFilter(task, f, me, unreadComments));
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

/** One list row (§5.4): flat, id-based; names/colours come from `workspaceRefs`. */
export type TaskRowDTO = {
  _id: Id<"tasks">;
  identifier: string | null;
  title: string;
  statusId: Id<"statuses">;
  statusCategory: TaskCategory | null;
  priority: TaskPriority;
  projectId: Id<"projects"> | null;
  clientId: Id<"clients"> | null;
  workCategoryId: Id<"workCategories"> | null;
  billable: boolean;
  assigneeIds: Id<"users">[];
  labelIds: Id<"labels">[];
  parentTaskId: Id<"tasks"> | null;
  sortKey: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  trackedMinutes: number;
  commentCount: number;
  lastCommentAt: number | null;
  subtaskCount: number;
  subtaskDoneCount: number;
  hasDescription: boolean;
  lastActivityAt: number;
  lastActivity: { kind: string; actorId: Id<"users">; at: number } | null;
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  createdBy: Id<"users">;
  updatedAt: number;
};

export function toRowDTO(task: Doc<"tasks">): TaskRowDTO {
  return {
    _id: task._id,
    identifier: task.identifier ?? null,
    title: task.title,
    statusId: task.statusId,
    statusCategory: task.statusCategory ?? null,
    priority: task.priority ?? PRIORITY.none,
    projectId: task.projectId ?? null,
    clientId: task.clientId ?? null,
    workCategoryId: task.workCategoryId ?? null,
    billable: task.billable,
    assigneeIds: task.assigneeIds,
    labelIds: task.labelIds ?? [],
    parentTaskId: task.parentTaskId ?? null,
    sortKey: task.sortKey ?? task.manualSortKey ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    estimateMinutes: task.estimateMinutes ?? task.estimate ?? null,
    trackedMinutes: task.trackedMinutes ?? 0,
    commentCount: task.commentCount ?? 0,
    lastCommentAt: task.lastCommentAt ?? null,
    subtaskCount: task.subtaskCount ?? 0,
    subtaskDoneCount: task.subtaskDoneCount ?? 0,
    hasDescription: task.hasDescription ?? false,
    lastActivityAt: task.lastActivityAt ?? task.updatedAt,
    lastActivity: task.lastActivity ?? null,
    completedAt: task.completedAt ?? null,
    archivedAt: task.archivedAt ?? null,
    createdAt: task.createdAt,
    createdBy: task.createdBy,
    updatedAt: task.updatedAt,
  };
}

/** The caller's per-row state (§5.4). Rows absent from the map have the defaults. */
export type PerUserRowState = {
  unreadComments: number;
  hasUnseenChanges: boolean;
  inMyToday: boolean;
};

export const DEFAULT_PER_USER: PerUserRowState = {
  unreadComments: 0,
  hasUnseenChanges: false,
  inMyToday: false,
};

export type TaskDetailDTO = TaskRowDTO & {
  description: string | null;
  parent: { _id: Id<"tasks">; identifier: string | null; title: string } | null;
  /** What the caller may change (§5.3) — the UI's affordances, not the guard. */
  permissions: {
    isAssignee: boolean;
    viaParent: boolean;
    editable: Record<TaskField, boolean>;
    canArchive: boolean;
    canDelete: boolean;
  };
  perUser: PerUserRowState & { lastViewedAt: number | null; subscribed: boolean; muted: boolean };
};

const TASK_FIELDS: readonly TaskField[] = [
  "title",
  "description",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "estimate",
  "labels",
  "subtasks",
  "project",
  "workCategory",
  "billable",
];

export async function toDetailDTO(
  ctx: ReadCtx,
  access: TaskAccess,
  options: { today?: string } = {},
): Promise<TaskDetailDTO> {
  const { task, auth } = access;
  const parentDoc = task.parentTaskId ? await ctx.db.get(task.parentTaskId) : null;
  const state = await ctx.db
    .query("taskUserState")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", task._id).eq("userId", auth.userId))
    .first();
  const today = await todayFor(ctx, auth.orgId, options.today);
  const inToday = await myTodayTaskIds(ctx, auth.orgId, auth.userId, today);
  return {
    ...toRowDTO(task),
    description: task.description ?? null,
    parent:
      parentDoc && parentDoc.orgId === task.orgId
        ? { _id: parentDoc._id, identifier: parentDoc.identifier ?? null, title: parentDoc.title }
        : null,
    permissions: {
      isAssignee: access.isAssignee,
      viaParent: access.viaParent,
      editable: Object.fromEntries(TASK_FIELDS.map((f) => [f, canEditField(access, f)])) as Record<
        TaskField,
        boolean
      >,
      canArchive: canArchive(access),
      canDelete: canDelete(access),
    },
    perUser: {
      unreadComments: state?.unreadComments ?? 0,
      hasUnseenChanges: state?.hasUnseenChanges ?? false,
      inMyToday: inToday.has(task._id),
      lastViewedAt: state?.lastViewedAt ?? null,
      subscribed: state?.subscribed ?? false,
      muted: state?.muted ?? false,
    },
  };
}

// ─── Per-user join (§5.4) ────────────────────────────────────────────────────

/** Today's date for the org (client-supplied `today` wins so queries stay cacheable). */
export async function todayFor(ctx: ReadCtx, orgId: string, today: string | undefined): Promise<string> {
  if (today) return today;
  const settings = await getOrgSettings(ctx, orgId);
  return getDateInTimezone(Date.now(), settings?.timezone ?? ORG_TIMEZONE_FALLBACK);
}

/** Tasks with a segment of the user's covering `today` (the sun state, §5.6). */
export async function myTodayTaskIds(
  ctx: ReadCtx,
  orgId: string,
  userId: Id<"users">,
  today: string,
): Promise<Set<Id<"tasks">>> {
  const segments = await ctx.db
    .query("planSegments")
    .withIndex("by_orgId_userId_startDate", (q) =>
      q
        .eq("orgId", orgId)
        .eq("userId", userId)
        .gte("startDate", addDaysToDateString(today, -SEGMENT_SCAN_WINDOW_DAYS))
        .lte("startDate", today),
    )
    .take(OPEN_ROW_CAP);
  return new Set(segments.filter((s) => segmentCoversDate(s, today)).map((s) => s.taskId));
}

/**
 * The caller's state for `taskIds`: one range read of their `taskUserState`
 * rows plus one of their plan segments. Sparse: only rows that differ from
 * `DEFAULT_PER_USER` are returned.
 */
export async function loadPerUser(
  ctx: ReadCtx,
  orgId: string,
  userId: Id<"users">,
  taskIds: readonly Id<"tasks">[],
  today: string,
): Promise<Record<Id<"tasks">, PerUserRowState>> {
  const [states, inToday] = await Promise.all([
    loadUserStates(ctx, orgId, userId, USER_STATE_CAP),
    myTodayTaskIds(ctx, orgId, userId, today),
  ]);
  const out: Record<Id<"tasks">, PerUserRowState> = {};
  for (const id of taskIds) {
    const state = states.get(id);
    const row: PerUserRowState = {
      unreadComments: state?.unreadComments ?? 0,
      hasUnseenChanges: state?.hasUnseenChanges ?? false,
      inMyToday: inToday.has(id),
    };
    if (row.unreadComments > 0 || row.hasUnseenChanges || row.inMyToday) out[id] = row;
  }
  return out;
}

// ─── View loading ────────────────────────────────────────────────────────────

export type ViewLoad = {
  tasks: Doc<"tasks">[];
  /** An open-row (or edge) cap was hit: the list is incomplete (T7). */
  truncated: boolean;
  /** More closed rows exist beyond `closedLimit` ("Load more"). */
  hasMoreClosed: boolean;
  plan: LoadPlan;
};

/**
 * Loads the candidate tasks of a view through `planListLoad`, applies access
 * (T1), the archived/sub-task rules and the spec's filters, and caps closed
 * rows at `closedLimit` (newest closed first). `newComments` filters are
 * applied by the caller once per-user state is joined.
 */
export async function loadView(
  ctx: ReadCtx,
  auth: AuthContext,
  input: {
    filters: readonly ListFilter[];
    showSubtasks: boolean;
    projectId?: Id<"projects">;
    closedLimit: number;
  },
): Promise<ViewLoad> {
  const { orgId } = auth;
  const plan = planListLoad({ auth, filters: input.filters, projectId: input.projectId });
  const categories = categoriesOf(input.filters);
  let truncated = false;
  let candidates: Doc<"tasks">[] = [];

  switch (plan.kind) {
    case "assignee": {
      const loaded = await loadAssignedTo(ctx, orgId, plan.userId);
      truncated = loaded.truncated;
      candidates = loaded.tasks;
      // §11.5: a member also sees the sub-tasks of their assigned parents.
      if (input.showSubtasks && plan.userId === auth.userId) {
        const via = await loadViaParentSubtasks(ctx, orgId, candidates);
        truncated ||= via.truncated;
        candidates = [...candidates, ...via.tasks];
      }
      break;
    }
    case "createdBy": {
      const loaded = await loadCreatedBy(ctx, orgId, plan.userId, OPEN_ROW_CAP + input.closedLimit);
      truncated = loaded.truncated;
      candidates = loaded.tasks;
      break;
    }
    case "project": {
      const open = await loadProjectTasks(
        ctx,
        orgId,
        plan.projectId,
        plan.categories.filter((c) => !isClosedCategory(c)),
        OPEN_ROW_CAP,
      );
      const closed = await loadProjectTasks(
        ctx,
        orgId,
        plan.projectId,
        plan.categories.filter(isClosedCategory),
        input.closedLimit + 1,
      );
      truncated = open.truncated;
      candidates = [...open.tasks, ...closed.tasks];
      break;
    }
    case "category": {
      const open = await loadByCategories(ctx, orgId, plan.open, OPEN_ROW_CAP);
      truncated = open.truncated;
      candidates = open.tasks;
      if (plan.closed.length > 0) {
        const closed = await loadRecentlyClosed(ctx, orgId, input.closedLimit + 1);
        candidates = [...candidates, ...closed.tasks];
      }
      break;
    }
  }

  const readable = await filterReadableTasks(ctx, auth, candidates);
  const visible = readable.filter(
    (t) =>
      !t.archivedAt &&
      (input.showSubtasks || !t.parentTaskId) &&
      (t.statusCategory === undefined || categories.includes(t.statusCategory)) &&
      matchesFilters(
        t,
        input.filters.filter((f) => f.property !== "newComments"),
        auth.userId,
      ),
  );

  const open: Doc<"tasks">[] = [];
  const closed: Doc<"tasks">[] = [];
  for (const t of visible) {
    if (t.statusCategory && isClosedCategory(t.statusCategory)) closed.push(t);
    else open.push(t);
  }
  closed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  if (open.length > OPEN_ROW_CAP) truncated = true;
  return {
    tasks: [...open.slice(0, OPEN_ROW_CAP), ...closed.slice(0, input.closedLimit)],
    truncated,
    hasMoreClosed: closed.length > input.closedLimit,
    plan,
  };
}

export function clampClosedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return CLOSED_ROW_DEFAULT;
  return Math.max(0, Math.min(CLOSED_ROW_MAX, Math.floor(limit)));
}
