import { v, ConvexError } from "convex/values";
import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext } from "../lib/auth";
import { filterReadableTasks, loadTaskForReadOrNull } from "./access";
import {
  DEFAULT_SYSTEM_VIEW,
  SYSTEM_VIEWS,
  isClosedCategory,
  listViewSurfaceValidator,
  normalizeIdentifier,
  taskViewSpecValidator,
  type TaskViewSpec,
} from "./model";
import {
  OPEN_CATEGORIES,
  OPEN_ROW_CAP,
  PICKER_DEFAULT_LIMIT,
  PICKER_MAX_LIMIT,
  SEARCH_CAP,
  clampClosedLimit,
  loadAssignedTo,
  loadPerUser,
  loadProjectTasks,
  loadSubtasksOf,
  loadView,
  loadViaParentSubtasks,
  matchesFilters,
  toDetailDTO,
  toRowDTO,
  todayFor,
  type TaskDetailDTO,
  type TaskRowDTO,
} from "./read";

/**
 * Public task reads (docs/prd-tasks-refactor.md §5.1, §5.4). Every read goes
 * through `access.ts` (T1) and the bounded loaders of `read.ts` (T7).
 */

const todayArg = v.optional(v.string()); // YYYY-MM-DD in the org timezone (client clock)

/**
 * One view of tasks: a system view (`viewKey`) or an explicit `spec`
 * (a saved view or the URL's unsaved state). The spec's filters are the
 * view's scope and are applied here; grouping, ordering and facets run
 * client-side over `rows`. Closed rows come newest-closed first, capped at
 * `closedLimit` (default 200; "Load more" raises it).
 */
export const listView = query({
  args: {
    surface: listViewSurfaceValidator,
    viewKey: v.optional(v.string()),
    spec: v.optional(taskViewSpecValidator),
    projectId: v.optional(v.id("projects")),
    closedLimit: v.optional(v.number()),
    today: todayArg,
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    let spec: TaskViewSpec;
    if (args.spec) {
      spec = args.spec;
    } else {
      const key = args.viewKey ?? DEFAULT_SYSTEM_VIEW[args.surface];
      const view = SYSTEM_VIEWS[args.surface][key];
      if (!view) throw new ConvexError(`Unknown view "${key}"`);
      spec = view.spec;
    }
    if (args.surface === "project") {
      if (!args.projectId) throw new ConvexError("projectId is required for the project surface");
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== auth.orgId) throw new ConvexError("Project not found");
    }
    const closedLimit = clampClosedLimit(args.closedLimit);
    const loaded = await loadView(ctx, auth, {
      filters: spec.filters,
      // The Planner panel plans top-level tasks only.
      showSubtasks: args.surface === "planner" ? false : spec.showSubtasks,
      projectId: args.surface === "project" ? args.projectId : undefined,
      closedLimit,
    });
    const today = await todayFor(ctx, auth.orgId, args.today);
    const perUser = await loadPerUser(
      ctx,
      auth.orgId,
      auth.userId,
      loaded.tasks.map((t) => t._id),
      today,
    );
    const newComments = spec.filters.filter((f) => f.property === "newComments");
    const tasks =
      newComments.length === 0
        ? loaded.tasks
        : loaded.tasks.filter((t) =>
            matchesFilters(t, newComments, auth.userId, perUser[t._id]?.unreadComments ?? 0),
          );
    return {
      rows: tasks.map(toRowDTO),
      truncated: loaded.truncated,
      hasMoreClosed: loaded.hasMoreClosed,
      perUser,
      spec,
    };
  },
});

/**
 * Resolves an identifier (`ARLO-21`, case-insensitive) to the task's detail.
 * Old identifiers resolve through `taskIdentifierAliases` (T5);
 * `resolvedFromAlias` tells the full-page route to redirect to `identifier`.
 * Unknown, inaccessible and other-org identifiers all return null.
 */
export const getByIdentifier = query({
  args: { identifier: v.string(), today: todayArg },
  handler: async (ctx, args): Promise<(TaskDetailDTO & { resolvedFromAlias: boolean }) | null> => {
    const auth = await getAuthContext(ctx);
    const identifier = normalizeIdentifier(args.identifier);
    if (!identifier) return null;
    let taskId: Id<"tasks"> | undefined;
    let resolvedFromAlias = false;
    const live = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_identifier", (q) => q.eq("orgId", auth.orgId).eq("identifier", identifier))
      .first();
    if (live) {
      taskId = live._id;
    } else {
      const alias = await ctx.db
        .query("taskIdentifierAliases")
        .withIndex("by_orgId_identifier", (q) => q.eq("orgId", auth.orgId).eq("identifier", identifier))
        .first();
      if (alias) {
        taskId = alias.taskId;
        resolvedFromAlias = true;
      }
    }
    if (!taskId) return null;
    const access = await loadTaskForReadOrNull(ctx, taskId, auth);
    if (!access) return null;
    return { ...(await toDetailDTO(ctx, access, { today: args.today })), resolvedFromAlias };
  },
});

/** One task's detail (drawer). Null when missing, other-org or not readable. */
export const getDetail = query({
  args: { taskId: v.id("tasks"), today: todayArg },
  handler: async (ctx, args): Promise<TaskDetailDTO | null> => {
    const access = await loadTaskForReadOrNull(ctx, args.taskId);
    if (!access) return null;
    return await toDetailDTO(ctx, access, { today: args.today });
  },
});

/**
 * A parent's non-archived sub-tasks in manual order. Readable by whoever can
 * read the parent — for a member that includes sub-tasks they are not
 * assigned to (§11.5).
 */
export const subtasks = query({
  args: { parentTaskId: v.id("tasks"), today: todayArg },
  handler: async (ctx, args) => {
    const access = await loadTaskForReadOrNull(ctx, args.parentTaskId);
    if (!access) return null;
    const { auth, task } = access;
    const loaded = await loadSubtasksOf(ctx, auth.orgId, task._id);
    const subs = loaded.tasks
      .filter((s) => !s.archivedAt)
      .sort((a, b) => compareSortKeys(a, b));
    const today = await todayFor(ctx, auth.orgId, args.today);
    return {
      rows: subs.map(toRowDTO),
      truncated: loaded.truncated,
      perUser: await loadPerUser(ctx, auth.orgId, auth.userId, subs.map((s) => s._id), today),
    };
  },
});

function compareSortKeys(a: Doc<"tasks">, b: Doc<"tasks">): number {
  const ak = a.sortKey ?? a.manualSortKey;
  const bk = b.sortKey ?? b.manualSortKey;
  if (ak !== undefined && bk !== undefined && ak !== bk) return ak < bk ? -1 : 1;
  if (ak !== undefined && bk === undefined) return -1;
  if (ak === undefined && bk !== undefined) return 1;
  return a.createdAt - b.createdAt;
}

/**
 * Small candidate lists for pickers (Add to Today, time-entry task picker,
 * parent pickers). With `search`: title search, access-filtered. Without:
 * the project's tasks when `projectId` is given, else the caller's assigned
 * tasks. Open tasks only unless `includeClosed`; top-level only unless
 * `includeSubtasks`.
 */
export const pickerCandidates = query({
  args: {
    search: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    includeClosed: v.optional(v.boolean()),
    includeSubtasks: v.optional(v.boolean()),
    excludeIds: v.optional(v.array(v.id("tasks"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<TaskRowDTO[]> => {
    const auth = await getAuthContext(ctx);
    const limit = Math.max(1, Math.min(PICKER_MAX_LIMIT, Math.floor(args.limit ?? PICKER_DEFAULT_LIMIT)));
    const search = args.search?.trim();
    let candidates: Doc<"tasks">[];
    if (search) {
      candidates = await ctx.db
        .query("tasks")
        .withSearchIndex("search_title", (q) => q.search("title", search).eq("orgId", auth.orgId))
        .take(SEARCH_CAP);
    } else if (args.projectId && auth.isAdmin) {
      candidates = (
        await loadProjectTasks(
          ctx,
          auth.orgId,
          args.projectId,
          args.includeClosed ? [...OPEN_CATEGORIES, "completed", "canceled"] : OPEN_CATEGORIES,
          OPEN_ROW_CAP,
        )
      ).tasks;
    } else {
      // A member's candidates are their own edges (filtered by project below),
      // plus the sub-tasks of their assigned parents (§11.5).
      candidates = (await loadAssignedTo(ctx, auth.orgId, auth.userId)).tasks;
      if (args.includeSubtasks) {
        candidates = [...candidates, ...(await loadViaParentSubtasks(ctx, auth.orgId, candidates)).tasks];
      }
    }
    const excluded = new Set(args.excludeIds ?? []);
    const eligible = candidates.filter(
      (t) =>
        !t.archivedAt &&
        !excluded.has(t._id) &&
        (args.includeSubtasks || !t.parentTaskId) &&
        (args.projectId === undefined || t.projectId === args.projectId) &&
        (args.includeClosed || !t.statusCategory || !isClosedCategory(t.statusCategory)),
    );
    if (!search) {
      // Suggested order: due soonest first, then manual order.
      eligible.sort(
        (a, b) =>
          (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || compareSortKeys(a, b),
      );
    }
    // Bounded: at most SEARCH_CAP search hits, or one loader's cap.
    const readable = await filterReadableTasks(ctx, auth, eligible);
    return readable.slice(0, limit).map(toRowDTO);
  },
});
