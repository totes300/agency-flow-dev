import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { query, mutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { logActivity } from "./activityLog";
import { STATUS_TYPES } from "./lib/constants";
import type { StatusType } from "./lib/constants";
import { isTiptapEmpty, extractPlainText } from "../lib/tiptap-utils";
import { computeTaskIndicatorState } from "./lib/taskActivityIndicators";
import { createNotifications } from "./notifications";
import {
  extractMentionIds,
  diffMentionIds,
  safeParseDoc,
  truncatePreview,
} from "./lib/notificationEvents";
import {
  TAB_STATUS_TYPE,
  isVisibleTopLevelTask,
  validateAssignees,
  validateWorkCategory,
  getDefaultStatusId,
  cascadeDeleteTaskData,
  createTaskEnricher,
  resolveDefaultAssignee,
} from "./lib/task_helpers";

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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const parent = await ctx.db.get(args.parentTaskId);
    if (!parent || parent.orgId !== orgId) throw new ConvexError("Parent task not found");
    if (!isAdmin && !parent.assigneeIds.includes(userId)) {
      throw new ConvexError("You don't have access to this task");
    }
    if (parent.parentTaskId) {
      throw new ConvexError("Subtasks cannot have subtasks (max 1 level)");
    }

    const title = args.title.trim();
    if (!title) throw new ConvexError("Subtask title is required");
    validateStringLength(title, 500, "Subtask title");

    let statusId = args.statusId;
    let statusType: StatusType = "backlog";
    if (statusId) {
      const status = await ctx.db.get(statusId);
      if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
      statusType = status.type as StatusType;
    } else {
      const defaults = await getDefaultStatusId(ctx, orgId);
      statusId = defaults.statusId;
      statusType = defaults.statusType;
    }

    if (args.workCategoryId) {
      await validateWorkCategory(ctx, orgId, args.workCategoryId);
    }
    let assigneeIds = args.assigneeIds ?? [...parent.assigneeIds];
    if (assigneeIds.length > 0) {
      await validateAssignees(ctx, orgId, assigneeIds);
    }
    // Auto-assign default assignee if no assignees after inheritance
    if (assigneeIds.length === 0) {
      const effectiveCategoryId = args.workCategoryId ?? parent.workCategoryId;
      const defaultUserId = await resolveDefaultAssignee(ctx, orgId, parent.projectId, effectiveCategoryId);
      if (defaultUserId) assigneeIds = [defaultUserId];
    }

    const existingSubtasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", args.parentTaskId))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();
    const maxSort = existingSubtasks.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), -1);

    const now = Date.now();
    const subtaskId = await ctx.db.insert("tasks", {
      orgId,
      title,
      statusId: statusId!,
      statusType,
      projectId: parent.projectId,
      assigneeIds,
      workCategoryId: args.workCategoryId ?? parent.workCategoryId,
      billable: parent.billable,
      parentTaskId: args.parentTaskId,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    await logActivity(ctx, {
      taskId: args.parentTaskId,
      orgId,
      userId,
      type: "subtask_created",
      metadata: { subtaskId, title },
    });

    // Notification fan-out: assignment (incl. inherited + default assignee;
    // actor self-assign is excluded in createNotifications)
    const createdSubtask = await ctx.db.get(subtaskId);
    if (createdSubtask && assigneeIds.length > 0) {
      await createNotifications(ctx, {
        orgId,
        actorId: userId,
        task: createdSubtask,
        events: assigneeIds.map((recipientId) => ({
          recipientId,
          type: "assigned" as const,
          previewText: title,
        })),
      });
    }

    return subtaskId;
  },
});

export const reorderSubtasks = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    orderedIds: v.array(v.id("tasks")),
  },
  handler: async (ctx, { parentTaskId, orderedIds }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const parent = await ctx.db.get(parentTaskId);
    if (!parent || parent.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !parent.assigneeIds.includes(userId)) {
      throw new ConvexError("You don't have access to this task");
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const sub = await ctx.db.get(orderedIds[i]);
      if (!sub || sub.parentTaskId !== parentTaskId) {
        throw new ConvexError("Subtask does not belong to this parent");
      }
      await ctx.db.patch(orderedIds[i], { sortOrder: i, updatedAt: Date.now() });
    }
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
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const title = args.title.trim();
    if (!title) throw new ConvexError("Task title is required");
    validateStringLength(title, 500, "Task title");

    let statusId: Id<"statuses">;
    let statusType: StatusType;
    if (args.statusId) {
      const status = await ctx.db.get(args.statusId);
      if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
      statusId = args.statusId;
      statusType = status.type;
    } else {
      const defaults = await getDefaultStatusId(ctx, orgId);
      statusId = defaults.statusId;
      statusType = defaults.statusType;
    }

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
    }
    if (args.workCategoryId) {
      await validateWorkCategory(ctx, orgId, args.workCategoryId);
    }

    let assigneeIds = args.assigneeIds ?? [];
    if (!isAdmin && !assigneeIds.includes(userId)) {
      assigneeIds = [userId, ...assigneeIds];
    }
    // Auto-assign default assignee if no explicit assignees provided
    if (assigneeIds.length === 0 && args.assigneeIds === undefined) {
      const defaultUserId = await resolveDefaultAssignee(ctx, orgId, args.projectId, args.workCategoryId);
      if (defaultUserId) assigneeIds = [defaultUserId];
    }
    await validateAssignees(ctx, orgId, assigneeIds);

    // Generate manualSortKey — append after the task with the highest sort key in this org.
    // Uses a dedicated index so we always get the true maximum key, not just the latest doc.
    // Convex OCC ensures concurrent creates on the same index range will
    // serialize (second transaction retries), so duplicate keys cannot occur.
    const lastSorted = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_manualSortKey", (q) => q.eq("orgId", orgId))
      .order("desc")
      .first();
    const lastKey = lastSorted?.manualSortKey ?? null;
    const manualSortKey = generateKeyBetween(lastKey, null);

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      orgId, title,
      description: args.description?.trim() || undefined,
      statusId, statusType,
      projectId: args.projectId,
      assigneeIds,
      workCategoryId: args.workCategoryId,
      estimate: args.estimate,
      billable: args.billable ?? true,
      dueDate: args.dueDate,
      manualSortKey,
      createdAt: now, updatedAt: now, createdBy: userId,
    });

    await logActivity(ctx, { taskId, orgId, userId, type: "task_created", metadata: {} });

    // Notification fan-out: assignment (incl. default-assignee; actor
    // self-assign is excluded in createNotifications) + description mentions.
    const createdTask = await ctx.db.get(taskId);
    if (createdTask) {
      const events: Parameters<typeof createNotifications>[1]["events"] = assigneeIds.map(
        (recipientId) => ({ recipientId, type: "assigned" as const, previewText: title })
      );
      const descDoc = safeParseDoc(createdTask.description);
      const descMentions = extractMentionIds(descDoc);
      if (descMentions.length > 0) {
        const preview = truncatePreview(extractPlainText(descDoc));
        for (const recipientId of descMentions) {
          events.push({ recipientId, type: "mention_description", previewText: preview });
        }
      }
      if (events.length > 0) {
        await createNotifications(ctx, { orgId, actorId: userId, task: createdTask, events });
      }
    }

    return taskId;
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    assigneeIds: v.optional(v.array(v.id("users"))),
    workCategoryId: v.optional(v.union(v.id("workCategories"), v.null())),
    estimate: v.optional(v.union(v.number(), v.null())),
    billable: v.optional(v.boolean()),
    dueDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only edit tasks assigned to you");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new ConvexError("Task title is required");
      validateStringLength(title, 500, "Task title");
      updates.title = title;
    }
    const nextDescription = args.description !== undefined
      ? (args.description.trim() || undefined)
      : undefined;
    if (args.description !== undefined) {
      updates.description = nextDescription;
    }
    if (args.statusId !== undefined) {
      const status = await ctx.db.get(args.statusId);
      if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
      updates.statusId = args.statusId;
      updates.statusType = status.type;
    }
    if (args.projectId !== undefined) {
      if (args.projectId !== null) {
        const project = await ctx.db.get(args.projectId);
        if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
      }
      if (args.projectId !== null && task.projectId && args.projectId !== task.projectId) {
        const hasEntries = await ctx.db.query("timeEntries").withIndex("by_taskId", (q) => q.eq("taskId", args.id)).first();
        if (hasEntries) throw new ConvexError("Cannot change the project of a task with time entries — existing entries keep their original rate snapshots");
      }
      updates.projectId = args.projectId === null ? undefined : args.projectId;
    }
    if (args.assigneeIds !== undefined) {
      await validateAssignees(ctx, orgId, args.assigneeIds);
      updates.assigneeIds = args.assigneeIds;
    }
    if (args.workCategoryId !== undefined) {
      if (args.workCategoryId !== null) await validateWorkCategory(ctx, orgId, args.workCategoryId);
      updates.workCategoryId = args.workCategoryId === null ? undefined : args.workCategoryId;
    }
    if (args.estimate !== undefined) updates.estimate = args.estimate === null ? undefined : args.estimate;
    if (args.billable !== undefined) updates.billable = args.billable;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate === null ? undefined : args.dueDate;

    // Auto-assign default assignee when category or project changes
    // Only if caller did NOT explicitly set assigneeIds (undefined = not touched, [] = explicit clear)
    let autoAssignedUserId: Id<"users"> | null = null;
    if (args.assigneeIds === undefined) {
      const categoryChanged = args.workCategoryId !== undefined && args.workCategoryId !== (task.workCategoryId ?? null);
      const projectChanged = args.projectId !== undefined && args.projectId !== (task.projectId ?? null);
      const currentAssignees = task.assigneeIds;
      const hasNoAssignees = !Array.isArray(currentAssignees) || currentAssignees.length === 0;

      if ((categoryChanged || projectChanged) && hasNoAssignees) {
        const effectiveProjectId = (updates.projectId ?? task.projectId) as Id<"projects"> | undefined;
        const effectiveCategoryId = (updates.workCategoryId ?? task.workCategoryId) as Id<"workCategories"> | undefined;
        autoAssignedUserId = await resolveDefaultAssignee(ctx, orgId, effectiveProjectId, effectiveCategoryId);
        if (autoAssignedUserId) {
          updates.assigneeIds = [autoAssignedUserId];
        }
      }
    }

    await ctx.db.patch(args.id, updates);

    // ── Activity logging ─────────────────────────────────────────────────
    const logCtx = { taskId: args.id, orgId, userId };

    if (args.statusId !== undefined && args.statusId !== task.statusId) {
      const newStatus = await ctx.db.get(args.statusId);
      const oldStatus = task.statusId ? await ctx.db.get(task.statusId) : null;
      await logActivity(ctx, { ...logCtx, type: "status_changed", metadata: { from: oldStatus?.name ?? "None", to: newStatus?.name ?? "Unknown", fromId: task.statusId, toId: args.statusId } });

      // Log subtask_completed on the parent task when a subtask transitions INTO done
      if (
        newStatus?.type === "done" &&
        oldStatus?.type !== "done" &&
        task.parentTaskId
      ) {
        await logActivity(ctx, {
          taskId: task.parentTaskId,
          orgId,
          userId,
          type: "subtask_completed",
          metadata: { title: task.title, subtaskId: args.id },
        });
      }
    }
    if (args.assigneeIds !== undefined) {
      const oldSet = new Set(task.assigneeIds.map(String));
      const newSet = new Set(args.assigneeIds.map(String));
      for (const uid of args.assigneeIds) {
        if (!oldSet.has(uid.toString())) {
          const user = await ctx.db.get(uid);
          await logActivity(ctx, { ...logCtx, type: "assignee_added", metadata: { userId: uid, userName: user?.name ?? "Unknown" } });
        }
      }
      for (const uid of task.assigneeIds) {
        if (!newSet.has(uid.toString())) {
          const user = await ctx.db.get(uid);
          await logActivity(ctx, { ...logCtx, type: "assignee_removed", metadata: { userId: uid, userName: user?.name ?? "Unknown" } });
        }
      }
    }
    // Log auto-assigned default assignee (separate from explicit assignee changes)
    if (autoAssignedUserId) {
      const autoUser = await ctx.db.get(autoAssignedUserId);
      const effectiveCatId = (updates.workCategoryId ?? task.workCategoryId) as Id<"workCategories"> | undefined;
      const autoCat = effectiveCatId ? await ctx.db.get(effectiveCatId) : null;
      await logActivity(ctx, { ...logCtx, type: "assignee_added", metadata: { userId: autoAssignedUserId, userName: autoUser?.name ?? "Unknown", reason: "default_assignee", categoryName: autoCat?.name ?? "Unknown" } });
    }
    if (args.workCategoryId !== undefined && args.workCategoryId !== (task.workCategoryId ?? null)) {
      const oldCat = task.workCategoryId ? await ctx.db.get(task.workCategoryId) : null;
      const newCat = args.workCategoryId ? await ctx.db.get(args.workCategoryId) : null;
      await logActivity(ctx, { ...logCtx, type: "category_changed", metadata: { from: oldCat?.name ?? "None", to: newCat?.name ?? "None" } });
    }
    if (args.dueDate !== undefined && args.dueDate !== (task.dueDate ?? null)) {
      await logActivity(ctx, { ...logCtx, type: "due_date_changed", metadata: { from: task.dueDate ?? null, to: args.dueDate } });
    }
    if (args.projectId !== undefined && args.projectId !== (task.projectId ?? null)) {
      const oldProj = task.projectId ? await ctx.db.get(task.projectId) : null;
      const newProj = args.projectId ? await ctx.db.get(args.projectId) : null;
      await logActivity(ctx, { ...logCtx, type: "project_changed", metadata: { from: oldProj?.name ?? null, to: newProj?.name ?? null } });
    }
    if (args.billable !== undefined && args.billable !== task.billable) {
      await logActivity(ctx, { ...logCtx, type: "billable_changed", metadata: { from: task.billable, to: args.billable } });
    }

    // ── Notification fan-out ─────────────────────────────────────────────
    // Assignment: newly added ids (explicit diff + auto-assign path).
    // Description: only newly ADDED mentions notify (diff vs old content).
    const notifEvents: Parameters<typeof createNotifications>[1]["events"] = [];
    const taskTitle = (updates.title as string | undefined) ?? task.title;
    if (args.assigneeIds !== undefined) {
      const oldSet = new Set(task.assigneeIds.map(String));
      for (const uid of args.assigneeIds) {
        if (!oldSet.has(uid.toString())) {
          notifEvents.push({ recipientId: uid, type: "assigned", previewText: taskTitle });
        }
      }
    }
    if (autoAssignedUserId) {
      notifEvents.push({ recipientId: autoAssignedUserId, type: "assigned", previewText: taskTitle });
    }
    if (args.description !== undefined) {
      const newDoc = safeParseDoc(nextDescription);
      const addedMentions = diffMentionIds(safeParseDoc(task.description), newDoc);
      if (addedMentions.length > 0) {
        const preview = truncatePreview(extractPlainText(newDoc));
        for (const recipientId of addedMentions) {
          notifEvents.push({ recipientId, type: "mention_description", previewText: preview });
        }
      }
    }
    if (notifEvents.length > 0) {
      // Re-read: the access check must see the NEW assignee list, or the
      // just-added assignee would be filtered out as "no task access".
      const updatedTask = await ctx.db.get(args.id);
      if (updatedTask) {
        await createNotifications(ctx, { orgId, actorId: userId, task: updatedTask, events: notifEvents });
      }
    }
  },
});

export const updateDescription = mutation({
  args: {
    id: v.id("tasks"),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only edit tasks assigned to you");
    }

    const nextDescription = args.description !== undefined
      ? (args.description.trim() || undefined)
      : undefined;

    if (nextDescription === task.description) return;

    await ctx.db.patch(args.id, {
      description: nextDescription,
      updatedAt: Date.now(),
    });

    // Notification fan-out: only newly ADDED mentions (diff absorbs autosave
    // churn; the unread dedupe in createNotifications absorbs re-adds).
    const newDoc = safeParseDoc(nextDescription);
    const addedMentions = diffMentionIds(safeParseDoc(task.description), newDoc);
    if (addedMentions.length > 0) {
      const preview = truncatePreview(extractPlainText(newDoc));
      await createNotifications(ctx, {
        orgId,
        actorId: userId,
        task,
        events: addedMentions.map((recipientId) => ({
          recipientId,
          type: "mention_description" as const,
          previewText: preview,
        })),
      });
    }
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) throw new ConvexError("You can only archive tasks assigned to you");

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });

    const subtasks = await ctx.db.query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      if (!sub.archivedAt) await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now });
    }

    // Stop active timers on affected tasks
    const affectedTaskIds = new Set([args.id.toString(), ...subtasks.map((s) => s._id.toString())]);
    const orgMembers = await ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
    for (const member of orgMembers) {
      if (!member.userId) continue;
      const user = await ctx.db.get(member.userId);
      if (user?.timerTaskId && affectedTaskIds.has(user.timerTaskId.toString())) {
        await ctx.db.patch(member.userId, { timerTaskId: undefined, timerStartedAt: undefined, timerAccumulatedMs: undefined, timerStatus: undefined });
      }
    }

  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) throw new ConvexError("You can only restore tasks assigned to you");
    if (!task.archivedAt) throw new ConvexError("Task is not archived");

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: undefined, updatedAt: now });

    const subtasks = await ctx.db.query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      if (sub.archivedAt) await ctx.db.patch(sub._id, { archivedAt: undefined, updatedAt: now });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    const subtasks = await ctx.db.query("tasks")
      .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      await cascadeDeleteTaskData(ctx, sub._id);
      await ctx.db.delete(sub._id);
    }
    await cascadeDeleteTaskData(ctx, args.id);

    const affectedTaskIds = new Set([args.id.toString(), ...subtasks.map((s) => s._id.toString())]);
    const orgMembers = await ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
    for (const member of orgMembers) {
      if (!member.userId) continue;
      const user = await ctx.db.get(member.userId);
      if (user?.timerTaskId && affectedTaskIds.has(user.timerTaskId.toString())) {
        await ctx.db.patch(member.userId, { timerTaskId: undefined, timerStartedAt: undefined, timerAccumulatedMs: undefined, timerStatus: undefined });
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const duplicate = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only duplicate tasks assigned to you");
    }

    // Place duplicate right after the original in manual sort order
    const manualSortKey = generateKeyBetween(task.manualSortKey ?? null, null);

    const now = Date.now();
    const newId = await ctx.db.insert("tasks", {
      orgId, title: `${task.title} (copy)`,
      description: task.description, statusId: task.statusId, statusType: task.statusType,
      projectId: task.projectId, assigneeIds: task.assigneeIds, workCategoryId: task.workCategoryId,
      estimate: task.estimate, billable: task.billable,
      manualSortKey,
      createdAt: now, updatedAt: now, createdBy: userId,
    });

    return newId;
  },
});

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
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    if (args.taskIds.length > 50) throw new ConvexError("Maximum 50 tasks per bulk operation");

    let newStatusType: StatusType | undefined;
    if (args.action.type === "status") {
      const status = await ctx.db.get(args.action.statusId);
      if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
      if (!isAdmin && status.type === "done") throw new ConvexError("Only admins can mark tasks as done");
      newStatusType = status.type;
    }
    if (args.action.type === "project") {
      const project = await ctx.db.get(args.action.projectId);
      if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
    }
    if (args.action.type === "addAssignee") await validateAssignees(ctx, orgId, [args.action.userId]);
    if (args.action.type === "category") await validateWorkCategory(ctx, orgId, args.action.workCategoryId);

    const now = Date.now();
    let updated = 0;
    const skipped: Array<{ taskId: Id<"tasks">; title: string; reason: string }> = [];

    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.orgId !== orgId) { skipped.push({ taskId, title: "Unknown", reason: "Task not found" }); continue; }
      if (!isAdmin && !task.assigneeIds.includes(userId)) { skipped.push({ taskId, title: task.title, reason: "Not assigned to you" }); continue; }

      switch (args.action.type) {
        case "status": {
          await ctx.db.patch(taskId, { statusId: args.action.statusId, statusType: newStatusType!, updatedAt: now });
          if (args.action.statusId !== task.statusId) {
            const newStatus = await ctx.db.get(args.action.statusId);
            const oldStatus = task.statusId ? await ctx.db.get(task.statusId) : null;
            await logActivity(ctx, { taskId, orgId, userId, type: "status_changed", metadata: { from: oldStatus?.name ?? "None", to: newStatus?.name ?? "Unknown" } });

            // Log subtask_completed on the parent when a subtask transitions INTO done
            if (
              newStatus?.type === "done" &&
              oldStatus?.type !== "done" &&
              task.parentTaskId
            ) {
              await logActivity(ctx, {
                taskId: task.parentTaskId,
                orgId,
                userId,
                type: "subtask_completed",
                metadata: { title: task.title, subtaskId: taskId },
              });
            }
          }
          updated++;
          break;
        }
        case "addAssignee": {
          if (!task.assigneeIds.includes(args.action.userId)) {
            const nextAssignees = [...task.assigneeIds, args.action.userId];
            await ctx.db.patch(taskId, { assigneeIds: nextAssignees, updatedAt: now });
            const user = await ctx.db.get(args.action.userId);
            await logActivity(ctx, { taskId, orgId, userId, type: "assignee_added", metadata: { userId: args.action.userId, userName: user?.name ?? "Unknown" } });
            // Access check needs the NEW assignee list; unread dedupe absorbs repeats
            await createNotifications(ctx, {
              orgId, actorId: userId,
              task: { ...task, assigneeIds: nextAssignees },
              events: [{ recipientId: args.action.userId, type: "assigned", previewText: task.title }],
            });
          }
          updated++;
          break;
        }
        case "removeAssignee": {
          const removeUid = args.action.userId;
          if (task.assigneeIds.includes(removeUid)) {
            await ctx.db.patch(taskId, { assigneeIds: task.assigneeIds.filter((id) => id !== removeUid), updatedAt: now });
            const user = await ctx.db.get(removeUid);
            await logActivity(ctx, { taskId, orgId, userId, type: "assignee_removed", metadata: { userId: removeUid, userName: user?.name ?? "Unknown" } });
          }
          updated++;
          break;
        }
        case "category": {
          if (args.action.workCategoryId !== task.workCategoryId) {
            const catPatch: Record<string, unknown> = { workCategoryId: args.action.workCategoryId, updatedAt: now };
            // Auto-assign default assignee if task has no assignees
            if (task.assigneeIds.length === 0 && task.projectId) {
              const defaultUser = await resolveDefaultAssignee(ctx, orgId, task.projectId, args.action.workCategoryId);
              if (defaultUser) catPatch.assigneeIds = [defaultUser];
            }
            await ctx.db.patch(taskId, catPatch);
            const oldCat = task.workCategoryId ? await ctx.db.get(task.workCategoryId) : null;
            const newCat = await ctx.db.get(args.action.workCategoryId);
            await logActivity(ctx, { taskId, orgId, userId, type: "category_changed", metadata: { from: oldCat?.name ?? "None", to: newCat?.name ?? "Unknown" } });
            if (catPatch.assigneeIds) {
              const autoAssignee = (catPatch.assigneeIds as Id<"users">[])[0];
              const autoUser = await ctx.db.get(autoAssignee);
              await logActivity(ctx, { taskId, orgId, userId, type: "assignee_added", metadata: { userId: autoAssignee, userName: autoUser?.name ?? "Unknown", reason: "default_assignee", categoryName: newCat?.name ?? "Unknown" } });
              await createNotifications(ctx, {
                orgId, actorId: userId,
                task: { ...task, assigneeIds: catPatch.assigneeIds as Id<"users">[] },
                events: [{ recipientId: autoAssignee, type: "assigned", previewText: task.title }],
              });
            }
          }
          updated++;
          break;
        }
        case "project": {
          if (task.projectId === args.action.projectId) { updated++; break; }
          if (task.projectId) {
            const hasEntries = await ctx.db.query("timeEntries").withIndex("by_taskId", (q) => q.eq("taskId", taskId)).first();
            if (hasEntries) { skipped.push({ taskId, title: task.title, reason: "Has time entries — cannot change project" }); continue; }
          }
          const projPatch: Record<string, unknown> = { projectId: args.action.projectId, updatedAt: now };
          // Auto-assign default assignee if task has no assignees
          if (task.assigneeIds.length === 0 && task.workCategoryId) {
            const defaultUser = await resolveDefaultAssignee(ctx, orgId, args.action.projectId, task.workCategoryId);
            if (defaultUser) projPatch.assigneeIds = [defaultUser];
          }
          await ctx.db.patch(taskId, projPatch);
          if (projPatch.assigneeIds) {
            const autoAssignee = (projPatch.assigneeIds as Id<"users">[])[0];
            const autoUser = await ctx.db.get(autoAssignee);
            const cat = task.workCategoryId ? await ctx.db.get(task.workCategoryId) : null;
            await logActivity(ctx, { taskId, orgId, userId, type: "assignee_added", metadata: { userId: autoAssignee, userName: autoUser?.name ?? "Unknown", reason: "default_assignee", categoryName: cat?.name ?? "Unknown" } });
            await createNotifications(ctx, {
              orgId, actorId: userId,
              task: { ...task, assigneeIds: projPatch.assigneeIds as Id<"users">[] },
              events: [{ recipientId: autoAssignee, type: "assigned", previewText: task.title }],
            });
          }
          updated++;
          break;
        }
        case "archive": {
          if (!task.archivedAt) {
            await ctx.db.patch(taskId, { archivedAt: now, updatedAt: now });
            const subs = await ctx.db.query("tasks").withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", taskId)).collect();
            for (const sub of subs) { if (!sub.archivedAt) await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now }); }
            // Stop active timers on affected tasks
            const affectedIds = new Set([taskId.toString(), ...subs.map((s) => s._id.toString())]);
            const archiveMembers = await ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
            for (const member of archiveMembers) {
              if (!member.userId) continue;
              const user = await ctx.db.get(member.userId);
              if (user?.timerTaskId && affectedIds.has(user.timerTaskId.toString())) {
                await ctx.db.patch(member.userId, { timerTaskId: undefined, timerStartedAt: undefined, timerAccumulatedMs: undefined, timerStatus: undefined });
              }
            }
          }
          updated++;
          break;
        }
        case "delete": {
          if (!isAdmin) { skipped.push({ taskId, title: task.title, reason: "Only admins can delete tasks" }); continue; }
          const delSubs = await ctx.db.query("tasks").withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", taskId)).collect();
          // Stop active timers on affected tasks
          const delAffectedIds = new Set([taskId.toString(), ...delSubs.map((s) => s._id.toString())]);
          const delMembers = await ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
          for (const member of delMembers) {
            if (!member.userId) continue;
            const user = await ctx.db.get(member.userId);
            if (user?.timerTaskId && delAffectedIds.has(user.timerTaskId.toString())) {
              await ctx.db.patch(member.userId, { timerTaskId: undefined, timerStartedAt: undefined, timerAccumulatedMs: undefined, timerStatus: undefined });
            }
          }
          for (const sub of delSubs) { await cascadeDeleteTaskData(ctx, sub._id); await ctx.db.delete(sub._id); }
          await cascadeDeleteTaskData(ctx, taskId);
          await ctx.db.delete(taskId);
          updated++;
          break;
        }
        case "restore": {
          if (!task.archivedAt) { skipped.push({ taskId, title: task.title, reason: "Task is not archived" }); continue; }
          await ctx.db.patch(taskId, { archivedAt: undefined, updatedAt: now });
          const restSubs = await ctx.db.query("tasks").withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", orgId).eq("parentTaskId", taskId)).collect();
          for (const sub of restSubs) { if (sub.archivedAt) await ctx.db.patch(sub._id, { archivedAt: undefined, updatedAt: now }); }
          updated++;
          break;
        }
      }
    }

    return { updated, skipped };
  },
});

// ─── Reorder task (drag & drop, fractional indexing) ────────────────────────


export const reorderTask = mutation({
  args: {
    taskId: v.id("tasks"),
    beforeKey: v.optional(v.string()),   // manualSortKey of the item above (null = first)
    afterKey: v.optional(v.string()),    // manualSortKey of the item below (null = last)
  },
  handler: async (ctx, { taskId, beforeKey, afterKey }) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== orgId) {
      throw new ConvexError("Task not found");
    }
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new ConvexError("You can only reorder tasks assigned to you");
    }

    // Generate fractional key between neighbors
    const newKey = generateKeyBetween(beforeKey ?? null, afterKey ?? null);

    await ctx.db.patch(taskId, { manualSortKey: newKey });
  },
});
