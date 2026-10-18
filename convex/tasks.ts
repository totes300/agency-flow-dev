import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { MAX_TIMER_MS } from "./lib/timer";
import { STATUS_TYPES } from "./lib/constants";
import type { StatusType } from "./lib/constants";
import { isTiptapEmpty } from "../lib/tiptap-utils";
import { computeTaskIndicatorState } from "./lib/taskActivityIndicators";
import {
  TAB_STATUS_TYPE,
  isVisibleTopLevelTask,
  taskHasTimeEntries,
  createTaskEnricher,
} from "./lib/task_helpers";
import {
  TASK_NOT_FOUND,
  canChangeAssignees,
  canDelete,
  canEditField,
  loadTaskForReadOrNull,
  loadTaskForWrite,
} from "./tasks/access";
import { taskPriorityValidator } from "./tasks/model";
import {
  archiveTask,
  createTask,
  duplicateTask,
  removeTask,
  reorderSubtasks as reorderSubtasksWrite,
  reorderTask as reorderTaskWrite,
  restoreTask,
  updateTask,
  type TimerRescue,
} from "./tasks/write";

// ─── Detail Query ────────────────────────────────────────────────────────────────

/**
 * Fetch a single task with all joined metadata for the detail modal.
 */
export const getDetail = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You don't have access to this task");
    }

    const status = task.statusId ? await ctx.db.get(task.statusId) : null;

    let project: { _id: Id<"projects">; name: string; code: string } | null = null;
    let client: { _id: Id<"clients">; name: string; prefix: string; usePrefix?: boolean } | null = null;
    if (task.projectId) {
      const p = await ctx.db.get(task.projectId);
      if (p) {
        project = { _id: p._id, name: p.name, code: p.code };
        if (p.clientId) {
          const c = await ctx.db.get(p.clientId);
          if (c) client = { _id: c._id, name: c.name, prefix: c.prefix ?? c.invoicePrefix ?? "", usePrefix: c.usePrefix };
        }
      }
    }

    const category = task.workCategoryId
      ? await ctx.db.get(task.workCategoryId)
      : null;

    const assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">> = [];
    for (const uid of task.assigneeIds) {
      const user = await ctx.db.get(uid);
      if (user) {
        assignees.push({ _id: user._id, name: user.name, email: user.email, imageUrl: user.imageUrl });
      }
    }

    // Join parent task title for subtask breadcrumb
    const parentTask = task.parentTaskId ? await ctx.db.get(task.parentTaskId) : null;

    // Resolve created-by user
    const createdByUser = task.createdBy ? await ctx.db.get(task.createdBy) : null;

    const timeEntries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", id))
      .collect();
    const totalMinutes = timeEntries.reduce((sum, e) => sum + e.durationMinutes, 0);

    return {
      _id: task._id,
      title: task.title,
      description: task.description,
      statusType: task.statusType,
      billable: task.billable,
      estimate: task.estimate,
      dueDate: task.dueDate,
      parentTaskId: task.parentTaskId,
      parentTaskTitle: parentTask?.title,
      projectId: task.projectId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      createdBy: task.createdBy,
      createdByUser: createdByUser
        ? { _id: createdByUser._id, name: createdByUser.name, imageUrl: createdByUser.imageUrl }
        : null,
      status: status
        ? { _id: status._id, name: status.name, color: status.color, type: status.type }
        : null,
      project,
      client,
      clientName: client?.name,
      projectName: project?.name,
      category: category
        ? { _id: category._id, name: category.name, color: category.color }
        : null,
      assignees,
      assigneeIds: task.assigneeIds,
      workCategoryId: task.workCategoryId,
      totalMinutes,
    };
  },
});

/**
 * Minimal read for the time-log form's category pre-fill: the task's own
 * category id (the last step of the entry-category default chain). Tolerant —
 * returns null instead of throwing so a display-only lookup can never crash
 * a task row for a member who isn't an assignee (unlike getDetail).
 */
export const getWorkCategoryId = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) return null;
    return task.workCategoryId ?? null;
  },
});

// ─── Subtask Queries & Mutations ─────────────────────────────────────────────────

export const getSubtasks = query({
  args: { parentTaskId: v.id("tasks") },
  handler: async (ctx, { parentTaskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const parent = await ctx.db.get(parentTaskId);
    if (!parent || parent.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !parent.assigneeIds.includes(userId)) {
      throw new ConvexError("You don't have access to this task");
    }

    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", parentTaskId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();

    subtasks.sort((a, b) => (a.sortOrder ?? a.createdAt) - (b.sortOrder ?? b.createdAt));

    const timeMap = new Map<string, number>();
    for (const sub of subtasks) {
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", sub._id))
        .collect();
      timeMap.set(sub._id, entries.reduce((sum, e) => sum + e.durationMinutes, 0));
    }

    const enriched = await Promise.all(subtasks.map(async (sub) => {
      const status = sub.statusId ? await ctx.db.get(sub.statusId) : null;
      const category = sub.workCategoryId ? await ctx.db.get(sub.workCategoryId) : null;
      const assignees: Array<{ _id: Id<"users">; name: string; email?: string; imageUrl?: string }> = [];
      for (const uid of sub.assigneeIds) {
        const user = await ctx.db.get(uid);
        if (user) assignees.push({ _id: user._id, name: user.name, email: user.email, imageUrl: user.imageUrl });
      }

      return {
        _id: sub._id,
        title: sub.title,
        statusType: sub.statusType,
        sortOrder: sub.sortOrder,
        billable: sub.billable,
        dueDate: sub.dueDate,
        status: status ? { _id: status._id, name: status.name, color: status.color, type: status.type } : null,
        category: category ? { _id: category._id, name: category.name, color: category.color } : null,
        assignees,
        totalMinutes: timeMap.get(sub._id) ?? 0,
      };
    }));

    return enriched;
  },
});

/**
 * List non-archived tasks for a project — used by the time-entry modal task
 * picker. Ordered by status type (to-do first), then alpha by title.
 * Members see only tasks they are assigned to (matches top-level visibility);
 * admins see all.
 */
export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return [];

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();

    const visible = tasks.filter((t) => {
      if (t.archivedAt) return false;
      if (!isAdmin && !t.assigneeIds.includes(userId)) return false;
      return true;
    });

    const statusTypeOrder: Record<StatusType, number> = {
      backlog: 0,
      in_progress: 1,
      review: 2,
      blocked: 3,
      done: 4,
    };

    return visible
      .map((t) => ({
        _id: t._id,
        title: t.title,
        billable: t.billable,
        workCategoryId: t.workCategoryId,
        statusType: t.statusType,
      }))
      .sort((a, b) => {
        const statusDiff =
          (statusTypeOrder[a.statusType] ?? 99) -
          (statusTypeOrder[b.statusType] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return a.title.localeCompare(b.title);
      });
  },
});

export const createSubtask = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    title: v.string(),
    statusId: v.optional(v.id("statuses")),
    workCategoryId: v.optional(v.id("workCategories")),
    assigneeIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    // Parent access, one-level rule and project inheritance (T8) live in write.ts.
    return await createTask(
      ctx,
      auth,
      {
        title: args.title,
        parentTaskId: args.parentTaskId,
        statusId: args.statusId,
        workCategoryId: args.workCategoryId,
        assigneeIds: args.assigneeIds,
      },
      { defaultAssignee: true },
    );
  },
});

export const reorderSubtasks = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    orderedIds: v.array(v.id("tasks")),
  },
  handler: async (ctx, { parentTaskId, orderedIds }) => {
    const access = await loadTaskForWrite(ctx, parentTaskId);
    await reorderSubtasksWrite(ctx, access, orderedIds);
  },
});

// ─── Counts ──────────────────────────────────────────────────────────────────────

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const typeCounts: Record<StatusType, number> = {
      backlog: 0, in_progress: 0, review: 0, blocked: 0, done: 0,
    };
    let archivedCount = 0;

    // Collect all tasks per statusType bucket (no limit — counts must be exact)
    for (const type of STATUS_TYPES) {
      const docs = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_statusType", (q) =>
          q.eq("orgId", orgId).eq("statusType", type)
        )
        .collect();
      for (const t of docs) {
        if (!isVisibleTopLevelTask(t, userId, isAdmin)) continue;
        if (t.archivedAt) {
          archivedCount++;
        } else {
          typeCounts[type]++;
        }
      }
    }

    return {
      all: typeCounts.backlog + typeCounts.in_progress + typeCounts.review + typeCounts.blocked + typeCounts.done,
      ...typeCounts,
      archived: archivedCount,
    };
  },
});

// ─── Main List Query ─────────────────────────────────────────────────────────────

export const list = query({
  args: {
    tab: v.union(
      v.literal("all"), v.literal("backlog"), v.literal("in_progress"),
      v.literal("review"), v.literal("blocked"), v.literal("done"),
      v.literal("archived")
    ),
    filters: v.optional(v.object({
      statusId: v.optional(v.object({
        op: v.union(v.literal("is"), v.literal("isNot"), v.literal("anyOf"), v.literal("noneOf")),
        value: v.array(v.id("statuses")),
      })),
      clientId: v.optional(v.object({
        op: v.union(v.literal("is"), v.literal("isNot")),
        value: v.id("clients"),
      })),
      projectId: v.optional(v.object({
        op: v.union(v.literal("is"), v.literal("isNot"), v.literal("anyOf"), v.literal("noneOf")),
        value: v.array(v.id("projects")),
      })),
      assigneeIds: v.optional(v.object({
        op: v.union(v.literal("is"), v.literal("isNot"), v.literal("anyOf"), v.literal("noneOf")),
        value: v.array(v.id("users")),
      })),
      workCategoryId: v.optional(v.object({
        op: v.union(v.literal("is"), v.literal("isNot"), v.literal("anyOf"), v.literal("noneOf")),
        value: v.array(v.id("workCategories")),
      })),
      dateFrom: v.optional(v.string()),
      dateTo: v.optional(v.string()),
    })),
    groupBy: v.optional(v.union(
      v.literal("project"), v.literal("client"), v.literal("category"),
      v.literal("assignee"), v.literal("status"), v.null()
    )),
    search: v.optional(v.string()),
    sortBy: v.optional(v.union(
      v.literal("title"), v.literal("status"), v.literal("category"),
      v.literal("dueDate"), v.literal("createdAt"), v.literal("updatedAt"),
    )),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const limit = args.limit ?? 50;
    const maxScan = 1000;
    const tabType = TAB_STATUS_TYPE[args.tab];
    const isArchivedTab = args.tab === "archived";

    // ── Step 1: Fetch tasks by tab ───────────────────────────────────────
    let tasks: Doc<"tasks">[];
    let hitScanLimit = false;

    function passesBaseFilter(t: Doc<"tasks">): boolean {
      if (!isVisibleTopLevelTask(t, userId, isAdmin)) return false;
      if (isArchivedTab) { if (!t.archivedAt) return false; }
      else { if (t.archivedAt) return false; }
      return true;
    }

    if (args.search) {
      const searchResults = await ctx.db
        .query("tasks")
        .withSearchIndex("search_title", (q) =>
          q.search("title", args.search!).eq("orgId", orgId)
        )
        .collect();
      tasks = searchResults.filter(passesBaseFilter);
    } else if (tabType === null) {
      const allTypes = STATUS_TYPES;
      const taskArrays = await Promise.all(
        allTypes.map(async (type) => {
          const docs = await ctx.db
            .query("tasks")
            .withIndex("by_orgId_statusType", (q) =>
              q.eq("orgId", orgId).eq("statusType", type)
            )
            .take(maxScan);
          return { docs: docs.filter(passesBaseFilter), limited: docs.length >= maxScan };
        })
      );
      tasks = taskArrays.flatMap((r) => r.docs);
      hitScanLimit = taskArrays.some((r) => r.limited);
    } else {
      const docs = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_statusType", (q) =>
          q.eq("orgId", orgId).eq("statusType", tabType)
        )
        .take(maxScan);
      tasks = docs.filter(passesBaseFilter);
      hitScanLimit = docs.length >= maxScan;
    }

    // ── Step 2: Apply filters ────────────────────────────────────────────
    const projectMap = new Map<string, Doc<"projects">>();
    const needProjects = args.filters?.clientId || args.groupBy === "client" || args.groupBy === "project";
    if (needProjects) {
      const allProjects = await ctx.db
        .query("projects")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      for (const p of allProjects) projectMap.set(p._id.toString(), p);
    }

    if (args.filters) {
      const f = args.filters;

      function matchesArrayFilter<T>(
        taskValue: T | undefined,
        filterValues: T[],
        op: "is" | "isNot" | "anyOf" | "noneOf"
      ): boolean {
        if (!taskValue) return op === "isNot" || op === "noneOf";
        const isIn = filterValues.some((v) => v === taskValue);
        return (op === "is" || op === "anyOf") ? isIn : !isIn;
      }

      if (f.statusId) {
        const { op, value: ids } = f.statusId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.statusId, ids, op));
      }
      if (f.clientId) {
        tasks = tasks.filter((t) => {
          if (!t.projectId) return f.clientId!.op === "isNot";
          const project = projectMap.get(t.projectId.toString());
          if (!project) return f.clientId!.op === "isNot";
          const matches = project.clientId === f.clientId!.value;
          return f.clientId!.op === "is" ? matches : !matches;
        });
      }
      if (f.projectId) {
        const { op, value: ids } = f.projectId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.projectId, ids, op));
      }
      if (f.assigneeIds) {
        const { op, value: ids } = f.assigneeIds;
        tasks = tasks.filter((t) => {
          if (t.assigneeIds.length === 0) return op === "isNot" || op === "noneOf";
          switch (op) {
            case "is":
            case "anyOf":
              return ids.some((id) => t.assigneeIds.includes(id));
            case "isNot":
            case "noneOf":
              return !ids.some((id) => t.assigneeIds.includes(id));
          }
        });
      }
      if (f.workCategoryId) {
        const { op, value: ids } = f.workCategoryId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.workCategoryId, ids, op));
      }
      if (f.dateFrom) {
        const from = f.dateFrom;
        tasks = tasks.filter((t) => t.dueDate && t.dueDate >= from);
      }
      if (f.dateTo) {
        const to = f.dateTo;
        tasks = tasks.filter((t) => t.dueDate && t.dueDate <= to);
      }
    }

    // ── Step 3: Sort ─────────────────────────────────────────────────────
    // When sortBy is omitted → "manual" mode: order by manualSortKey → createdAt
    const sortBy = args.sortBy ?? "manual";
    const sortOrder = args.sortOrder ?? "asc";
    const mul = sortOrder === "asc" ? 1 : -1;

    // Pre-fetch lookup maps for relation-based sorts
    let statusSortMap: Map<string, { typeOrder: number; sortOrder: number; name: string }> | undefined;
    let categorySortMap: Map<string, string> | undefined;

    if (sortBy === "status") {
      const TYPE_ORDER: Record<string, number> = { backlog: 0, in_progress: 1, review: 2, blocked: 3, done: 4 };
      const allStatuses = await ctx.db.query("statuses")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      statusSortMap = new Map();
      for (const s of allStatuses) {
        statusSortMap.set(s._id, { typeOrder: TYPE_ORDER[s.type] ?? 99, sortOrder: s.sortOrder ?? 0, name: s.name });
      }
    }

    if (sortBy === "category") {
      const allCategories = await ctx.db.query("workCategories")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      categorySortMap = new Map();
      for (const c of allCategories) {
        categorySortMap.set(c._id, c.name);
      }
    }

    tasks.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "manual": {
          // Fractional key sort: tasks with keys before tasks without, then createdAt
          const ak = a.manualSortKey;
          const bk = b.manualSortKey;
          if (ak && bk) { cmp = ak < bk ? -1 : ak > bk ? 1 : 0; }
          else if (ak) { cmp = -1; }
          else if (bk) { cmp = 1; }
          else { cmp = 0; }
          break;
        }
        case "title":
          cmp = a.title.localeCompare(b.title) * mul;
          break;
        case "createdAt":
          cmp = (a.createdAt - b.createdAt) * mul;
          break;
        case "updatedAt":
          cmp = (a.updatedAt - b.updatedAt) * mul;
          break;
        case "dueDate": {
          const ad = a.dueDate;
          const bd = b.dueDate;
          // Nulls always last regardless of direction
          if (!ad && !bd) { cmp = 0; break; }
          if (!ad) return 1;
          if (!bd) return -1;
          cmp = ad.localeCompare(bd) * mul;
          break;
        }
        case "status": {
          const sa = statusSortMap?.get(a.statusId) ?? { typeOrder: 99, sortOrder: 0, name: "" };
          const sb = statusSortMap?.get(b.statusId) ?? { typeOrder: 99, sortOrder: 0, name: "" };
          cmp = ((sa.typeOrder - sb.typeOrder) || (sa.sortOrder - sb.sortOrder) || sa.name.localeCompare(sb.name)) * mul;
          break;
        }
        case "category": {
          const ca = a.workCategoryId ? categorySortMap?.get(a.workCategoryId) : undefined;
          const cb = b.workCategoryId ? categorySortMap?.get(b.workCategoryId) : undefined;
          // Nulls always last regardless of direction
          if (!ca && !cb) { cmp = 0; break; }
          if (!ca) return 1;
          if (!cb) return -1;
          cmp = ca.localeCompare(cb) * mul;
          break;
        }
      }
      // Tie-breaker: createdAt asc (insertion order for tasks without manual keys)
      return cmp || (a.createdAt - b.createdAt);
    });
    const totalCount = tasks.length;

    // ── Step 4: Group ────────────────────────────────────────────────────
    type GroupBucket = { key: string; label: string; color?: string; statusType?: string; sortKey: string; tasks: Doc<"tasks">[] };
    const buckets = new Map<string, GroupBucket>();

    function assignToBucket(task: Doc<"tasks">, key: string, label: string, sortKey: string, color?: string, statusType?: string) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, label, color, statusType, sortKey, tasks: [] };
        buckets.set(key, bucket);
      }
      bucket.tasks.push(task);
    }

    if (!args.groupBy) {
      for (const task of tasks) assignToBucket(task, "__all__", "All Tasks", "a");
    } else {
      const statusMap = new Map<string, Doc<"statuses">>();
      const categoryMap = new Map<string, Doc<"workCategories">>();
      const userMap = new Map<string, Doc<"users">>();

      if (args.groupBy === "status") {
        const docs = await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
        for (const d of docs) statusMap.set(d._id.toString(), d);
      }
      if (args.groupBy === "category") {
        const docs = await ctx.db.query("workCategories").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
        for (const d of docs) categoryMap.set(d._id.toString(), d);
      }
      if (args.groupBy === "assignee") {
        const uids = new Set<string>();
        for (const t of tasks) for (const uid of t.assigneeIds) uids.add(uid.toString());
        const docs = await Promise.all([...uids].map((id) => ctx.db.get(id as Id<"users">)));
        for (const d of docs) if (d) userMap.set(d._id.toString(), d);
      }
      if ((args.groupBy === "project" || args.groupBy === "client") && !projectMap.size) {
        const allProjects = await ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
        for (const p of allProjects) projectMap.set(p._id.toString(), p);
      }

      const clientMap = new Map<string, Doc<"clients">>();
      if (args.groupBy === "project" || args.groupBy === "client") {
        const clientIds = new Set<string>();
        for (const p of projectMap.values()) clientIds.add(p.clientId.toString());
        const docs = await Promise.all([...clientIds].map((id) => ctx.db.get(id as Id<"clients">)));
        for (const d of docs) if (d) clientMap.set(d._id.toString(), d);
      }

      for (const task of tasks) {
        switch (args.groupBy) {
          case "project": {
            if (!task.projectId) {
              assignToBucket(task, "__no_project__", "No Project", "zzz");
            } else {
              const proj = projectMap.get(task.projectId.toString());
              const cl = proj ? clientMap.get(proj.clientId.toString()) : null;
              const label = cl ? `${cl.name} · ${proj?.name}` : (proj?.name ?? "Unknown");
              assignToBucket(task, task.projectId.toString(), label, label.toLowerCase());
            }
            break;
          }
          case "client": {
            if (!task.projectId) {
              assignToBucket(task, "__no_client__", "No Client", "zzz");
            } else {
              const proj = projectMap.get(task.projectId.toString());
              const cl = proj ? clientMap.get(proj.clientId.toString()) : null;
              const key = cl?._id.toString() ?? "__no_client__";
              assignToBucket(task, key, cl?.name ?? "No Client", (cl?.name ?? "zzz").toLowerCase());
            }
            break;
          }
          case "category": {
            if (!task.workCategoryId) {
              assignToBucket(task, "__no_category__", "No Category", "zzz");
            } else {
              const cat = categoryMap.get(task.workCategoryId.toString());
              assignToBucket(task, task.workCategoryId.toString(), cat?.name ?? "Unknown", (cat?.name ?? "zzz").toLowerCase(), cat?.color);
            }
            break;
          }
          case "assignee": {
            if (task.assigneeIds.length === 0) {
              assignToBucket(task, "__unassigned__", "Unassigned", "zzz");
            } else {
              const uid = task.assigneeIds[0];
              const user = userMap.get(uid.toString());
              assignToBucket(task, uid.toString(), user?.name ?? "Unknown", (user?.name ?? "zzz").toLowerCase());
            }
            break;
          }
          case "status": {
            const st = statusMap.get(task.statusId.toString());
            const typeOrder: Record<StatusType, number> = { backlog: 0, in_progress: 1, review: 2, blocked: 3, done: 4 };
            const order = st ? typeOrder[st.type] : 99;
            const sortKey = `${order}-${String(st?.sortOrder ?? 999).padStart(3, "0")}`;
            assignToBucket(task, task.statusId.toString(), st?.name ?? "Unknown", sortKey, st?.color, st?.type);
            break;
          }
        }
      }
    }

    const sortedBuckets = [...buckets.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // ── Step 5: Enrich paginated tasks ───────────────────────────────────
    const paginatedTasksByGroup = sortedBuckets.map((b) => b.tasks.slice(0, limit));
    const allPaginatedTasks = paginatedTasksByGroup.flat();

    const statusIds = new Set<string>();
    const projectIdsForEnrich = new Set<string>();
    const categoryIds = new Set<string>();
    const userIds = new Set<string>();

    for (const t of allPaginatedTasks) {
      statusIds.add(t.statusId.toString());
      if (t.projectId) projectIdsForEnrich.add(t.projectId.toString());
      if (t.workCategoryId) categoryIds.add(t.workCategoryId.toString());
      for (const uid of t.assigneeIds) userIds.add(uid.toString());
    }

    const [statusDocs, categoryDocs, userDocs] = await Promise.all([
      Promise.all([...statusIds].map((id) => ctx.db.get(id as Id<"statuses">))),
      Promise.all([...categoryIds].map((id) => ctx.db.get(id as Id<"workCategories">))),
      Promise.all([...userIds].map((id) => ctx.db.get(id as Id<"users">))),
    ]);

    if (projectIdsForEnrich.size > 0) {
      const missingProjectIds = [...projectIdsForEnrich].filter((id) => !projectMap.has(id));
      if (missingProjectIds.length > 0) {
        const docs = await Promise.all(missingProjectIds.map((id) => ctx.db.get(id as Id<"projects">)));
        for (const p of docs) if (p) projectMap.set(p._id.toString(), p);
      }
    }

    const enrichClientIds = new Set<string>();
    for (const pid of projectIdsForEnrich) {
      const p = projectMap.get(pid);
      if (p) enrichClientIds.add(p.clientId.toString());
    }
    const enrichClientDocs = await Promise.all(
      [...enrichClientIds].map((id) => ctx.db.get(id as Id<"clients">))
    );

    const enrichTask = createTaskEnricher({
      statusMap: new Map(statusDocs.filter(Boolean).map((s) => [s!._id.toString(), s!])),
      projectMap,
      clientMap: new Map(enrichClientDocs.filter(Boolean).map((c) => [c!._id.toString(), c!])),
      categoryMap: new Map(categoryDocs.filter(Boolean).map((c) => [c!._id.toString(), c!])),
      userMap: new Map(userDocs.filter(Boolean).map((u) => [u!._id.toString(), u!])),
    });

    // ── Step 6: Build response ───────────────────────────────────────────
    const groups = sortedBuckets.map((bucket, i) => ({
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      statusType: bucket.statusType,
      count: bucket.tasks.length,
      tasks: paginatedTasksByGroup[i].map(enrichTask),
      hasMore: bucket.tasks.length > limit,
    }));

    return { groups, totalCount, hitScanLimit };
  },
});

// ─── Activity Indicators ─────────────────────────────────────────────────────────

export const activityIndicators = query({
  args: { taskIds: v.array(v.id("tasks")) },
  handler: async (ctx, { taskIds }) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const capped = taskIds.slice(0, 500);
    const result: Record<string, {
      subtaskTotal: number;
      subtaskDone: number;
      commentCount: number;
      hasAttachments: boolean; // backward compat — removed in Phase 2
      hasDescription: boolean;
      hasUnseenNonComment: boolean;
      hasUnseenSubtasks: boolean;
      hasUnseenDescription: boolean;
      hasUnseenComments: boolean;
      hasUnseen: boolean;
      unreadCommentCount: number;
      unseenActivityCount: number;
      lastActivity: {
        userName: string;
        type: string;
        metadata: Record<string, unknown>;
        createdAt: number;
      } | null;
    }> = {};

    // Cache user names across tasks
    const userNameCache = new Map<string, string>();
    async function getUserName(uid: Id<"users">): Promise<string> {
      const key = uid.toString();
      if (!userNameCache.has(key)) {
        const user = await ctx.db.get(uid);
        userNameCache.set(key, user?.name ?? "Unknown");
      }
      return userNameCache.get(key)!;
    }

    await Promise.all(capped.map(async (taskId) => {
      const task = await ctx.db.get(taskId);
      if (!task || task.orgId !== orgId) return;

      // hasDescription via isTiptapEmpty
      let hasDescription = false;
      if (task?.description) {
        try {
          hasDescription = !isTiptapEmpty(JSON.parse(task.description));
        } catch {
          hasDescription = false;
        }
      }

      const [subtasks, comments, attachments] = await Promise.all([
        ctx.db.query("tasks")
          .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", taskId))
          .filter((q) => q.eq(q.field("archivedAt"), undefined))
          .collect(),
        ctx.db.query("comments")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .collect(),
        ctx.db.query("attachments")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .take(1),
      ]);

      // Fetch receipts for unseen computation
      const [viewReceipt, commentReceipt] = await Promise.all([
        ctx.db.query("taskViewReceipts")
          .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
          .unique(),
        ctx.db.query("commentReadReceipts")
          .withIndex("by_user_task", (q) => q.eq("userId", userId).eq("taskId", taskId))
          .unique(),
      ]);

      const lastViewedAt = viewReceipt?.lastViewedAt ?? 0;
      const lastSeenAt = commentReceipt?.lastSeenAt ?? 0;

      const events = (await ctx.db
        .query("activityLog")
        .withIndex("by_task", (q) => q.eq("taskId", taskId).gt("createdAt", lastViewedAt))
        .collect())
        .filter((event) => event.type !== "description_changed");

      const indicatorState = computeTaskIndicatorState({
        events: events.map((event) => ({
          createdAt: event.createdAt,
          type: event.type,
          userId: event.userId,
        })),
        comments: comments.map((comment) => ({
          createdAt: comment.createdAt,
          userId: comment.userId,
        })),
        currentUserId: userId,
        lastViewedAt,
        lastSeenAt,
      });

      // lastActivity: most recent activityLog event
      const latestEvent = (await ctx.db
        .query("activityLog")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .order("desc")
        .take(20))
        .find((event) => event.type !== "description_changed");

      let lastActivity: {
        userName: string;
        type: string;
        metadata: Record<string, unknown>;
        createdAt: number;
      } | null = null;

      if (latestEvent) {
        const userName = await getUserName(latestEvent.userId);
        lastActivity = {
          userName,
          type: latestEvent.type,
          metadata: latestEvent.metadata as Record<string, unknown>,
          createdAt: latestEvent.createdAt,
        };
      }

      result[taskId] = {
        subtaskTotal: subtasks.length,
        subtaskDone: subtasks.filter((s) => s.statusType === "done").length,
        commentCount: comments.length,
        hasAttachments: attachments.length > 0,
        hasDescription,
        hasUnseenNonComment: indicatorState.hasUnseenNonComment,
        hasUnseenSubtasks: indicatorState.hasUnseenSubtasks,
        hasUnseenDescription: indicatorState.hasUnseenDescription,
        hasUnseenComments: indicatorState.hasUnseenComments,
        hasUnseen: indicatorState.hasUnseen,
        unreadCommentCount: indicatorState.unreadCommentCount,
        unseenActivityCount: indicatorState.unseenActivityCount,
        lastActivity,
      };
    }));

    return result;
  },
});

/**
 * Up to 5 subtasks for a single task — used by subtask hover popover.
 * Sort: incomplete first (by creation order), then completed (by creation order).
 */
export const subtaskPreview = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) return [];
    if (!isAdmin && !task.assigneeIds.includes(userId)) return [];

    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", taskId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();

    // Sort: incomplete first, then completed, both by creation order
    const incomplete = subtasks.filter((s) => s.statusType !== "done");
    const completed = subtasks.filter((s) => s.statusType === "done");
    const sorted = [...incomplete, ...completed].slice(0, 5);

    // Resolve first assignee avatar for each subtask
    const userCache = new Map<string, { name: string; imageUrl?: string }>();
    for (const s of sorted) {
      if (s.assigneeIds.length > 0 && !userCache.has(s.assigneeIds[0].toString())) {
        const user = await ctx.db.get(s.assigneeIds[0]);
        if (user) userCache.set(s.assigneeIds[0].toString(), { name: user.name, imageUrl: user.imageUrl });
      }
    }

    return sorted.map((s) => {
      const assignee = s.assigneeIds.length > 0 ? userCache.get(s.assigneeIds[0].toString()) : undefined;
      return {
        _id: s._id,
        title: s.title,
        statusType: s.statusType,
        assignee: assignee ? { name: assignee.name, imageUrl: assignee.imageUrl } : null,
      };
    });
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────────

const taskPatchArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  statusId: v.optional(v.id("statuses")),
  projectId: v.optional(v.union(v.id("projects"), v.null())),
  assigneeIds: v.optional(v.array(v.id("users"))),
  workCategoryId: v.optional(v.union(v.id("workCategories"), v.null())),
  estimate: v.optional(v.union(v.number(), v.null())),
  billable: v.optional(v.boolean()),
  dueDate: v.optional(v.union(v.string(), v.null())),
  startDate: v.optional(v.union(v.string(), v.null())),
  priority: v.optional(taskPriorityValidator),
  labelIds: v.optional(v.array(v.id("labels"))),
};

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    projectId: v.optional(v.id("projects")),
    assigneeIds: v.optional(v.array(v.id("users"))),
    workCategoryId: v.optional(v.id("workCategories")),
    estimate: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    dueDate: v.optional(v.string()),
    startDate: v.optional(v.string()),
    priority: v.optional(taskPriorityValidator),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const { estimate, ...input } = args;
    return await createTask(
      ctx,
      auth,
      { ...input, estimateMinutes: estimate },
      // The project's default assignee only when the caller did not pick assignees.
      { defaultAssignee: args.assigneeIds === undefined },
    );
  },
});

export const update = mutation({
  args: { id: v.id("tasks"), ...taskPatchArgs },
  handler: async (ctx, args) => {
    const { id, estimate, ...patch } = args;
    const access = await loadTaskForWrite(ctx, id);
    await updateTask(ctx, access, { ...patch, estimateMinutes: estimate });
  },
});

export const updateDescription = mutation({
  args: {
    id: v.id("tasks"),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await updateTask(ctx, access, { description: args.description ?? "" });
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    // Running timers on the tree are auto-saved as entries (returned so the
    // caller's toast can say whose time was saved / left running).
    const rescue = await archiveTask(ctx, access);
    return { autoSavedTimers: rescue.saved, timerSaveFailures: rescue.failed };
  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await restoreTask(ctx, access);
  },
});

/**
 * What deleting this task (and its subtasks) would destroy. Powers the
 * delete-confirmation dialog so the user gets the resolution (archive /
 * delete-with-entries) in place instead of a dead-end error.
 */
export const deleteImpact = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) return null;

    const subtasks = await ctx.db.query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", args.id))
      .collect();

    let entryCount = 0;
    let totalMinutes = 0;
    let lockedCount = 0;
    let lockedMinutes = 0;
    for (const t of [task, ...subtasks]) {
      const entries = await ctx.db.query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
        .collect();
      for (const e of entries) {
        entryCount++;
        totalMinutes += e.durationMinutes;
        if (e.closeId) {
          lockedCount++;
          lockedMinutes += e.durationMinutes;
        }
      }
    }

    // Running/paused timers on the tree: deleting the task discards them
    // (an entry can't outlive its task), so the dialog must say so.
    const affectedIds = new Set([task._id.toString(), ...subtasks.map((s) => s._id.toString())]);
    const members = await ctx.db.query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    let runningTimerCount = 0;
    let runningTimerMinutes = 0;
    const now = Date.now();
    for (const member of members) {
      if (!member.userId) continue;
      const u = await ctx.db.get(member.userId);
      if (!u?.timerTaskId || !affectedIds.has(u.timerTaskId.toString())) continue;
      const accumulated = u.timerAccumulatedMs ?? 0;
      const elapsedMs = Math.min(
        u.timerStatus === "running" && u.timerStartedAt
          ? now - u.timerStartedAt + accumulated
          : accumulated,
        MAX_TIMER_MS,
      );
      runningTimerCount++;
      runningTimerMinutes += Math.round(elapsedMs / 60_000);
    }

    return {
      entryCount,
      totalMinutes,
      lockedCount,
      lockedMinutes,
      subtaskCount: subtasks.length,
      runningTimerCount,
      runningTimerMinutes,
    };
  },
});

export const remove = mutation({
  args: {
    id: v.id("tasks"),
    // Explicit consent to delete unlocked time entries along with the task.
    // Invoiced/settled entries can never be deleted this way.
    deleteEntries: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    await removeTask(ctx, access, { deleteEntries: args.deleteEntries });
  },
});

export const duplicate = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const access = await loadTaskForWrite(ctx, args.id);
    return await duplicateTask(ctx, access);
  },
});

type BulkSkip = { taskId: Id<"tasks">; title: string; reason: string };

export const bulkUpdate = mutation({
  args: {
    taskIds: v.array(v.id("tasks")),
    action: v.union(
      v.object({ type: v.literal("status"), statusId: v.id("statuses") }),
      v.object({ type: v.literal("addAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("removeAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("category"), workCategoryId: v.id("workCategories") }),
      v.object({ type: v.literal("project"), projectId: v.id("projects") }),
      v.object({ type: v.literal("archive") }),
      v.object({ type: v.literal("delete") }),
      v.object({ type: v.literal("restore") })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    if (args.taskIds.length > 50) throw new ConvexError("Maximum 50 tasks per bulk operation");
    const action = args.action;

    let updated = 0;
    const autoSavedTimers: TimerRescue["saved"] = [];
    const timerSaveFailures: TimerRescue["failed"] = [];
    const skipped: BulkSkip[] = [];

    // Every per-task rule is checked BEFORE that task's writes, so a skip
    // never leaves a half-applied task behind; unexpected errors abort the
    // whole batch (transaction rollback).
    for (const taskId of args.taskIds) {
      const access = await loadTaskForReadOrNull(ctx, taskId, auth);
      if (!access) { skipped.push({ taskId, title: "Unknown", reason: TASK_NOT_FOUND }); continue; }
      const { task } = access;
      const skip = (reason: string) => skipped.push({ taskId, title: task.title, reason });

      switch (action.type) {
        case "status":
          await updateTask(ctx, access, { statusId: action.statusId });
          break;
        case "addAssignee":
          if (!task.assigneeIds.includes(action.userId)) {
            await updateTask(ctx, access, { assigneeIds: [...task.assigneeIds, action.userId] });
          }
          break;
        case "removeAssignee": {
          if (!task.assigneeIds.includes(action.userId)) break;
          const next = task.assigneeIds.filter((id) => id !== action.userId);
          const decision = canChangeAssignees(access, task.assigneeIds, next);
          if (!decision.ok) { skip(decision.reason); continue; }
          await updateTask(ctx, access, { assigneeIds: next });
          break;
        }
        case "category":
          if (!canEditField(access, "workCategory")) { skip("Only admins can change the work category"); continue; }
          await updateTask(ctx, access, { workCategoryId: action.workCategoryId });
          break;
        case "project": {
          if (task.projectId === action.projectId) break;
          if (!canEditField(access, "project")) { skip("Only admins can change the project"); continue; }
          if (task.parentTaskId) { skip("Sub-tasks follow their parent's project"); continue; }
          if (await treeHasTimeEntries(ctx, task)) { skip("Has time entries — cannot change project"); continue; }
          await updateTask(ctx, access, { projectId: action.projectId });
          break;
        }
        case "archive": {
          const rescue = await archiveTask(ctx, access);
          autoSavedTimers.push(...rescue.saved);
          timerSaveFailures.push(...rescue.failed);
          break;
        }
        case "delete":
          if (!canDelete(access)) { skip("Only admins can delete tasks"); continue; }
          // Time entries are ledger records — same rule as projects.remove.
          if (await treeHasTimeEntries(ctx, task)) { skip("Task has logged time — archive it instead"); continue; }
          await removeTask(ctx, access);
          break;
        case "restore":
          if (!task.archivedAt) { skip("Task is not archived"); continue; }
          await restoreTask(ctx, access);
          break;
      }
      updated++;
    }

    return { updated, skipped, autoSavedTimers, timerSaveFailures };
  },
});

async function treeHasTimeEntries(ctx: QueryCtx, task: Doc<"tasks">): Promise<boolean> {
  if (await taskHasTimeEntries(ctx, task._id)) return true;
  const children = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .collect();
  for (const child of children) {
    if (await taskHasTimeEntries(ctx, child._id)) return true;
  }
  return false;
}

// ─── Reorder task (drag & drop, fractional indexing) ────────────────────────

export const reorderTask = mutation({
  args: {
    taskId: v.id("tasks"),
    beforeKey: v.optional(v.string()),   // manualSortKey of the item above (null = first)
    afterKey: v.optional(v.string()),    // manualSortKey of the item below (null = last)
  },
  handler: async (ctx, { taskId, beforeKey, afterKey }) => {
    const access = await loadTaskForWrite(ctx, taskId);
    await reorderTaskWrite(ctx, access, { beforeKey, afterKey });
  },
});
