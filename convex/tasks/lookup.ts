import { v, ConvexError } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { getAuthContext, type AuthContext } from "../lib/auth";
import { filterReadableTasks, loadTaskForReadOrNull, type TaskAccess } from "./access";
import {
  CATEGORY_LABELS,
  PRIORITY,
  PRIORITY_LABELS,
  TASK_CATEGORIES,
  categoryOfStatus,
  compareBySortKey,
  isClosedCategory,
  normalizeIdentifier,
  taskCategoryValidator,
  type TaskCategory,
} from "./model";
import { matchesFilters } from "./filters";
import {
  CLOSED_ROW_DEFAULT,
  OPEN_ROW_CAP,
  SEARCH_CAP,
  loadAssignedTo,
  loadByCategories,
  loadProjectTasks,
  loadRecentlyClosed,
  loadSubtasksOf,
  loadViaParentSubtasks,
  planListLoad,
  type Loaded,
} from "./read";
import {
  agentTaskCategories,
  agentTaskViewFilters,
  clampAgentTaskLimit,
  inDueRange,
  type AgentTaskRow,
} from "../../lib/task-lookup";
import { taskDescriptionToPlainText } from "../../lib/reports/views";

/**
 * Task lookup reads (docs/prd-tasks-refactor.md §7), kept as the core for the
 * MCP server's task tools (docs/prd-mcp.md). They run with the CALLING USER's
 * identity: org and role come from `getAuthContext`, access
 * from `access.ts` (T1), loading from the bounded loaders of `read.ts` (T7).
 *
 * Results are flat and model-friendly: names resolved, identifiers
 * (`ARLO-21`) first-class, `truncated` whenever a cap was hit — a capped
 * read never claims to be complete. Tools accept identifiers or ids; ids
 * travel as plain strings and are normalized here, so a malformed or
 * foreign id is a model-actionable error, not a validator crash.
 */

/** Tasks read per category when counting (archived rows count against it). */
export const COUNT_CAP_PER_CATEGORY = 1000;

// ─── Identifier / id resolution ──────────────────────────────────────────────

/**
 * Resolves a task reference — an identifier (`arlo-21`, case-insensitive,
 * old identifiers via `taskIdentifierAliases`) or a task id — to a task id
 * in the caller's org. Null when unknown. Access is checked by the caller.
 */
export async function resolveTaskRef(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  ref: string,
): Promise<Id<"tasks"> | null> {
  const trimmed = ref.trim();
  const identifier = normalizeIdentifier(trimmed);
  if (identifier) {
    const live = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
      .first();
    if (live) return live._id;
    const alias = await ctx.db
      .query("taskIdentifierAliases")
      .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
      .first();
    return alias?.taskId ?? null;
  }
  return ctx.db.normalizeId("tasks", trimmed);
}

type OrgTable = "statuses" | "clients" | "projects" | "workCategories" | "labels";

const REF_HINT: Record<OrgTable, { noun: string; source: string }> = {
  statuses: { noun: "status", source: "listStatuses" },
  clients: { noun: "client", source: "listClients" },
  projects: { noun: "project", source: "listProjects" },
  workCategories: { noun: "work category", source: "listWorkCategories" },
  labels: { noun: "label", source: "listLabels" },
};

/** A model-supplied id of an org-owned table, validated against the caller's org. */
async function requireOrgRef<T extends OrgTable>(
  ctx: QueryCtx,
  orgId: string,
  table: T,
  raw: string,
): Promise<Doc<T>> {
  const id = ctx.db.normalizeId(table, raw.trim());
  const doc = id ? ((await ctx.db.get(id)) as Doc<T> | null) : null;
  if (!doc || doc.orgId !== orgId) {
    const hint = REF_HINT[table];
    throw new ConvexError(
      `No ${hint.noun} with id "${raw}" in this workspace. Use an exact id from ${hint.source}.`,
    );
  }
  return doc;
}

// ─── Name resolution (memoized, bounded by the rows returned) ────────────────

type Named = { name?: string; orgId?: string };

function nameResolver(ctx: QueryCtx, orgId: string) {
  const cache = new Map<string, string | null>();
  return async (id: Id<TableNames> | undefined | null): Promise<string | null> => {
    if (!id) return null;
    const known = cache.get(id);
    if (known !== undefined) return known;
    const doc = (await ctx.db.get(id)) as Named | null;
    // Users carry no orgId; every other referenced table must be in the org.
    const name = doc && (doc.orgId === undefined || doc.orgId === orgId) ? (doc.name ?? null) : null;
    cache.set(id, name);
    return name;
  };
}

function identifierResolver(ctx: QueryCtx, orgId: string) {
  const cache = new Map<Id<"tasks">, string | null>();
  return async (id: Id<"tasks"> | undefined): Promise<string | null> => {
    if (!id) return null;
    const known = cache.get(id);
    if (known !== undefined) return known;
    const doc = await ctx.db.get(id);
    const identifier = doc && doc.orgId === orgId ? (doc.identifier ?? null) : null;
    cache.set(id, identifier);
    return identifier;
  };
}

function priorityLabel(task: Doc<"tasks">): string {
  return PRIORITY_LABELS[task.priority ?? PRIORITY.none];
}

/** Most recent activity first (the useful default for "what's going on"). */
function byRecentActivity(a: Doc<"tasks">, b: Doc<"tasks">): number {
  return (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt);
}

function mergeLoaded(...parts: Loaded[]): Loaded {
  return {
    tasks: parts.flatMap((p) => p.tasks),
    truncated: parts.some((p) => p.truncated),
  };
}

/**
 * The caller's own edges plus the sub-tasks of their assigned parents (§11.5).
 * Every row is readable by construction (T1, access.ts): `own` rows come off
 * the caller's own `taskAssignees` range in this org, `via` rows are the
 * org-indexed sub-tasks of those parents — exactly the two edges
 * `filterReadableTasks` would read again. Callers use the rows as they are.
 */
async function loadMemberVisible(ctx: QueryCtx, auth: AuthContext): Promise<Loaded> {
  const own = await loadAssignedTo(ctx, auth.orgId, auth.userId);
  const via = await loadViaParentSubtasks(ctx, auth.orgId, own.tasks);
  return mergeLoaded(own, via);
}

// ─── findTasks ───────────────────────────────────────────────────────────────

export type AgentFindTasksResult = {
  tasks: AgentTaskRow[];
  /** More matching tasks may exist: a load cap or `limit` was hit. Narrow the filters. */
  truncated: boolean;
};

/** The flat `findTasks` filters; ids travel as plain strings (validated here). */
export type FindTasksInput = {
  category?: TaskCategory;
  statusId?: string;
  clientId?: string;
  projectId?: string;
  assigneeId?: string;
  workCategoryId?: string;
  labelId?: string;
  dueAfter?: string;
  dueBefore?: string;
  search?: string;
  includeClosed?: boolean;
  /** An extra row predicate applied with the filters (e.g. MCP's updated range). */
  where?: (task: Doc<"tasks">) => boolean;
  /**
   * Preloaded candidate rows (e.g. MCP's external-ref and next-assignee
   * lookups): used instead of the loaders; access and every filter still
   * apply, `search` as a case-insensitive title match.
   */
  candidates?: Loaded;
};

export type FoundTaskDocs = {
  /** Every readable match of the loaded rows, in result order. */
  matched: Doc<"tasks">[];
  /** A bounded loader hit its cap: more matches may exist beyond `matched`. */
  loadTruncated: boolean;
};

/**
 * The `findTasks` core for an already-authorized caller, shared by the UI
 * query below and the MCP `search` tool. Open tasks only unless
 * `includeClosed` (or a closed `category` / closed `statusId`); archived
 * tasks never. Sub-tasks are included. Members see what they can read:
 * their own edges and the sub-tasks of their assigned parents. Sorted by
 * most recent activity; search hits keep relevance order.
 */
export async function findTaskDocsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: FindTasksInput,
): Promise<FoundTaskDocs> {
  const { orgId } = auth;

  // Validate every model-supplied id up front (actionable errors).
  const status = args.statusId ? await requireOrgRef(ctx, orgId, "statuses", args.statusId) : null;
  const client = args.clientId ? await requireOrgRef(ctx, orgId, "clients", args.clientId) : null;
  const project = args.projectId ? await requireOrgRef(ctx, orgId, "projects", args.projectId) : null;
  const workCategory = args.workCategoryId
    ? await requireOrgRef(ctx, orgId, "workCategories", args.workCategoryId)
    : null;
  const label = args.labelId ? await requireOrgRef(ctx, orgId, "labels", args.labelId) : null;
  let assigneeId: Id<"users"> | null = null;
  if (args.assigneeId) {
    assigneeId = ctx.db.normalizeId("users", args.assigneeId.trim());
    if (!assigneeId) {
      throw new ConvexError(
        `No team member with id "${args.assigneeId}". Use an exact id from listTeamMembers.`,
      );
    }
  }

  const categories = agentTaskCategories({
    category: args.category,
    statusCategory: status ? categoryOfStatus(status) : undefined,
    includeClosed: args.includeClosed,
  });
  const filters = agentTaskViewFilters(
    {
      statusId: status?._id,
      clientId: client?._id,
      projectId: project?._id,
      assigneeId: assigneeId ?? undefined,
      workCategoryId: workCategory?._id,
      labelId: label?._id,
    },
    categories,
  );
  const open = categories.filter((c) => !isClosedCategory(c));
  const closed = categories.filter(isClosedCategory);
  const search = args.search?.trim();

  let loaded: Loaded;
  // True when the load itself proved every row readable (loadMemberVisible).
  let readableByLoad = false;
  if (args.candidates) {
    const needle = search?.toLowerCase();
    loaded = {
      tasks: needle ? args.candidates.tasks.filter((t) => t.title.toLowerCase().includes(needle)) : args.candidates.tasks,
      truncated: args.candidates.truncated,
    };
  } else if (search) {
    const hits = await ctx.db
      .query("tasks")
      .withSearchIndex("search_title", (q) =>
        categories.length === 1
          ? q.search("title", search).eq("orgId", orgId).eq("statusCategory", categories[0])
          : q.search("title", search).eq("orgId", orgId),
      )
      .take(SEARCH_CAP + 1);
    loaded = { tasks: hits.slice(0, SEARCH_CAP), truncated: hits.length > SEARCH_CAP };
  } else {
    // §5.4 index selection: members read their own edges; admins narrow by
    // a pinned project or assignee, else by category.
    const plan = planListLoad({ auth, filters });
    switch (plan.kind) {
      case "assignee":
        if (plan.userId === auth.userId && !auth.isAdmin) {
          loaded = await loadMemberVisible(ctx, auth);
          readableByLoad = true;
        } else {
          loaded = await loadAssignedTo(ctx, orgId, plan.userId);
        }
        break;
      case "project":
        loaded = mergeLoaded(
          await loadProjectTasks(ctx, orgId, plan.projectId, open, OPEN_ROW_CAP),
          await loadProjectTasks(ctx, orgId, plan.projectId, closed, CLOSED_ROW_DEFAULT),
        );
        break;
      case "createdBy":
      case "category":
        loaded = mergeLoaded(
          await loadByCategories(ctx, orgId, open, OPEN_ROW_CAP),
          closed.length > 0
            ? await loadRecentlyClosed(ctx, orgId, CLOSED_ROW_DEFAULT)
            : { tasks: [], truncated: false },
        );
        break;
    }
  }

  const readable = readableByLoad
    ? loaded.tasks.filter((t) => t.orgId === orgId)
    : await filterReadableTasks(ctx, auth, loaded.tasks);
  const matched = readable.filter(
    (t) =>
      !t.archivedAt &&
      t.statusCategory !== undefined &&
      categories.includes(t.statusCategory) &&
      matchesFilters(t, filters, auth.userId) &&
      inDueRange(t.dueDate, args) &&
      (args.where === undefined || args.where(t)),
  );
  if (!search || args.candidates) matched.sort(byRecentActivity);
  return { matched, loadTruncated: loaded.truncated };
}

/** `findTasks` rows for `tasks` (names resolved, memoized per call). */
export async function toAgentTaskRows(
  ctx: QueryCtx,
  orgId: string,
  tasks: readonly Doc<"tasks">[],
): Promise<AgentTaskRow[]> {
  const nameOf = nameResolver(ctx, orgId);
  const identifierOf = identifierResolver(ctx, orgId);
  const rows: AgentTaskRow[] = [];
  for (const t of tasks) {
    rows.push({
      id: t._id,
      identifier: t.identifier ?? null,
      title: t.title,
      status: await nameOf(t.statusId),
      statusCategory: t.statusCategory ?? null,
      priority: priorityLabel(t),
      project: await nameOf(t.projectId),
      client: await nameOf(t.clientId),
      workCategory: await nameOf(t.workCategoryId),
      assignees: (await Promise.all(t.assigneeIds.map(nameOf))).filter((n): n is string => n !== null),
      dueDate: t.dueDate ?? null,
      billable: t.billable,
      parent: await identifierOf(t.parentTaskId),
    });
  }
  return rows;
}

/** Flat-filtered task search for the `findTasks` tool (see `findTaskDocsForAuth`). */
export const findTasks = query({
  args: {
    category: v.optional(taskCategoryValidator),
    statusId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    workCategoryId: v.optional(v.string()),
    dueAfter: v.optional(v.string()),
    dueBefore: v.optional(v.string()),
    search: v.optional(v.string()),
    includeClosed: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AgentFindTasksResult> => {
    const auth = await getAuthContext(ctx);
    const { limit: rawLimit, ...input } = args;
    const { matched, loadTruncated } = await findTaskDocsForAuth(ctx, auth, input);
    const limit = clampAgentTaskLimit(rawLimit);
    const tasks = await toAgentTaskRows(ctx, auth.orgId, matched.slice(0, limit));
    return { tasks, truncated: loadTruncated || matched.length > limit };
  },
});

// ─── getTaskDetail ───────────────────────────────────────────────────────────

export type AgentTaskDetail = {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string | null;
  statusCategory: TaskCategory | null;
  priority: string;
  project: string | null;
  client: string | null;
  workCategory: string | null;
  assignees: string[];
  labels: string[];
  startDate: string | null;
  dueDate: string | null;
  billable: boolean;
  estimateMinutes: number | null;
  trackedMinutes: number;
  archived: boolean;
  parent: { identifier: string | null; title: string } | null;
  subtasks: Array<{
    id: string;
    identifier: string | null;
    title: string;
    status: string | null;
    statusCategory: TaskCategory | null;
    trackedMinutes: number;
    assignees: string[];
  }>;
  subtasksTruncated: boolean;
};

/**
 * One task in full for an already-authorized caller, shared by the
 * `getTaskDetail` query below and the MCP `fetch` tool. `ref` is an
 * identifier (`ARLO-21`, case-insensitive, old identifiers resolve) or a
 * task id. Unknown, other-org and unreadable tasks all return null. `access`
 * carries the task document for callers that need more than the detail.
 */
export async function getTaskDetailForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  ref: string,
): Promise<{ detail: AgentTaskDetail; access: TaskAccess } | null> {
  const taskId = await resolveTaskRef(ctx, auth.orgId, ref);
  if (!taskId) return null;
  const access = await loadTaskForReadOrNull(ctx, taskId, auth);
  if (!access) return null;
  const { task } = access;
  const nameOf = nameResolver(ctx, auth.orgId);

  const parentDoc = task.parentTaskId ? await ctx.db.get(task.parentTaskId) : null;
  // Whoever reads a parent reads all of its sub-tasks (§11.5); one level deep (T8).
  const subs = task.parentTaskId
    ? { tasks: [], truncated: false }
    : await loadSubtasksOf(ctx, auth.orgId, task._id);
  const subtasks: AgentTaskDetail["subtasks"] = [];
  for (const s of subs.tasks.filter((s) => !s.archivedAt).sort(compareBySortKey)) {
    subtasks.push({
      id: s._id,
      identifier: s.identifier ?? null,
      title: s.title,
      status: await nameOf(s.statusId),
      statusCategory: s.statusCategory ?? null,
      trackedMinutes: s.trackedMinutes ?? 0,
      assignees: (await Promise.all(s.assigneeIds.map(nameOf))).filter((n): n is string => n !== null),
    });
  }

  const detail: AgentTaskDetail = {
    id: task._id,
    identifier: task.identifier ?? null,
    title: task.title,
    description: taskDescriptionToPlainText(task.description),
    status: await nameOf(task.statusId),
    statusCategory: task.statusCategory ?? null,
    priority: priorityLabel(task),
    project: await nameOf(task.projectId),
    client: await nameOf(task.clientId),
    workCategory: await nameOf(task.workCategoryId),
    assignees: (await Promise.all(task.assigneeIds.map(nameOf))).filter((n): n is string => n !== null),
    labels: (await Promise.all((task.labelIds ?? []).map(nameOf))).filter((n): n is string => n !== null),
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    billable: task.billable,
    estimateMinutes: task.estimateMinutes ?? null,
    trackedMinutes: task.trackedMinutes ?? 0,
    archived: task.archivedAt !== undefined,
    parent:
      parentDoc && parentDoc.orgId === auth.orgId
        ? { identifier: parentDoc.identifier ?? null, title: parentDoc.title }
        : null,
    subtasks,
    subtasksTruncated: subs.truncated,
  };
  return { detail, access };
}

/** One task in full for the `getTaskDetail` tool (see `getTaskDetailForAuth`). */
export const getTaskDetail = query({
  args: { task: v.string() },
  handler: async (ctx, args): Promise<AgentTaskDetail | null> => {
    const auth = await getAuthContext(ctx);
    return (await getTaskDetailForAuth(ctx, auth, args.task))?.detail ?? null;
  },
});

// ─── resolveTask (propose tools) ─────────────────────────────────────────────

/**
 * Resolves a task reference the caller can read to its id + title snapshot
 * (the `proposeArchiveTask` tool stores real ids, never model text).
 */
export const resolveTask = query({
  args: { task: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"tasks">; identifier: string | null; title: string; archived: boolean } | null> => {
    const auth = await getAuthContext(ctx);
    const taskId = await resolveTaskRef(ctx, auth.orgId, args.task);
    if (!taskId) return null;
    const access = await loadTaskForReadOrNull(ctx, taskId, auth);
    if (!access) return null;
    return {
      id: access.task._id,
      identifier: access.task.identifier ?? null,
      title: access.task.title,
      archived: access.task.archivedAt !== undefined,
    };
  },
});

// ─── countTasksByStatus ──────────────────────────────────────────────────────

export type AgentTaskCounts = {
  /** Whose tasks were counted. */
  scope: "organization" | "assigned to you";
  total: number;
  /** A cap was hit: every count is a lower bound ("at least N"). */
  truncated: boolean;
  byCategory: Array<{ category: TaskCategory; label: string; count: number; truncated: boolean }>;
  byStatus: Array<{ statusId: string; status: string; category: TaskCategory; count: number }>;
};

/**
 * Task counts per status category and per status for the tasks the caller
 * can see (admins: the org; members: their own and via-parent sub-tasks),
 * archived excluded. Bounded (T7): each category reads at most
 * `COUNT_CAP_PER_CATEGORY` rows (members: their capped edge set), and
 * `truncated` says when a count is a lower bound.
 */
export const countTasksByStatus = query({
  args: {},
  handler: async (ctx): Promise<AgentTaskCounts> => {
    const auth = await getAuthContext(ctx);
    const { orgId } = auth;

    const categoryTruncated = new Map<TaskCategory, boolean>();
    let tasks: Doc<"tasks">[] = [];
    if (auth.isAdmin) {
      for (const category of TASK_CATEGORIES) {
        const loaded = await loadByCategories(ctx, orgId, [category], COUNT_CAP_PER_CATEGORY);
        categoryTruncated.set(category, loaded.truncated);
        tasks.push(...loaded.tasks);
      }
    } else {
      const loaded = await loadMemberVisible(ctx, auth);
      // A capped edge set leaves every category incomplete.
      for (const category of TASK_CATEGORIES) categoryTruncated.set(category, loaded.truncated);
      // Readable by construction (loadMemberVisible): no edge re-check.
      tasks = loaded.tasks.filter((t) => t.orgId === orgId);
    }
    const live = tasks.filter((t) => !t.archivedAt && t.statusCategory !== undefined);

    const statusCounts = new Map<Id<"statuses">, number>();
    const categoryCounts = new Map<TaskCategory, number>();
    for (const t of live) {
      statusCounts.set(t.statusId, (statusCounts.get(t.statusId) ?? 0) + 1);
      const category = t.statusCategory!;
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }

    // Every active status (zero counts included) plus archived ones still in use.
    const byStatus: AgentTaskCounts["byStatus"] = [];
    for (const category of TASK_CATEGORIES) {
      const statuses = await ctx.db
        .query("statuses")
        .withIndex("by_orgId_category_position", (q) => q.eq("orgId", orgId).eq("category", category))
        .take(100);
      for (const s of statuses) {
        const count = statusCounts.get(s._id) ?? 0;
        if (s.archivedAt && count === 0) continue;
        byStatus.push({ statusId: s._id, status: s.name, category, count });
      }
    }

    const byCategory = TASK_CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      count: categoryCounts.get(category) ?? 0,
      truncated: categoryTruncated.get(category) ?? false,
    }));
    return {
      scope: auth.isAdmin ? "organization" : "assigned to you",
      total: live.length,
      truncated: byCategory.some((c) => c.truncated),
      byCategory,
      byStatus,
    };
  },
});
