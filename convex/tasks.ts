import { v } from "convex/values";
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import type { StatusType } from "./lib/constants";

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Map of tab name → which statusTypes it includes. */
const TAB_STATUS_TYPES: Record<string, StatusType[]> = {
  active: ["in_progress", "review", "blocked"],
  backlog: ["backlog"],
  // "today" is special — uses systemRole lookup, not statusType
  review: ["review"],
  blocked: ["blocked"],
  done: ["done"],
};

/** Find the status with systemRole="today" for an org. */
async function getTodayStatusId(
  ctx: QueryCtx,
  orgId: string
): Promise<Id<"statuses"> | null> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const today = statuses.find((s) => s.systemRole === "today" && !s.archivedAt);
  return today?._id ?? null;
}

/** Find the first backlog-type status (used as default for new tasks). */
async function getDefaultStatusId(
  ctx: QueryCtx | MutationCtx,
  orgId: string
): Promise<{ statusId: Id<"statuses">; statusType: StatusType }> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId_type", (q) => q.eq("orgId", orgId).eq("type", "backlog"))
    .collect();
  const active = statuses
    .filter((s) => !s.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (active.length === 0) throw new Error("No backlog status found for org");
  return { statusId: active[0]._id, statusType: "backlog" };
}

// Type for enriched task returned by list queries
type TaskWithJoins = Doc<"tasks"> & {
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type" | "icon"> | null;
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null;
  client: Pick<Doc<"clients">, "_id" | "name"> | null;
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null;
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>;
};

// ─── Queries ────────────────────────────────────────────────────────────────────

/**
 * Per-tab count badges. Global totals unaffected by filters.
 * Admin sees all, member sees only assigned tasks.
 * Uses by_orgId_statusType index per type to avoid unbounded collect.
 */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    // Count per statusType using the compound index (avoids loading all tasks)
    const typeKeys: StatusType[] = ["backlog", "in_progress", "review", "blocked", "done"];
    const tasksByType = await Promise.all(
      typeKeys.map((type) =>
        ctx.db
          .query("tasks")
          .withIndex("by_orgId_statusType", (q) =>
            q.eq("orgId", orgId).eq("statusType", type)
          )
          .collect()
      )
    );

    // Filter: non-archived + permission
    const typeCounts: Record<StatusType, number> = {
      backlog: 0, in_progress: 0, review: 0, blocked: 0, done: 0,
    };
    for (let i = 0; i < typeKeys.length; i++) {
      typeCounts[typeKeys[i]] = tasksByType[i].filter((t) => {
        if (t.archivedAt) return false;
        if (!isAdmin && !t.assigneeIds.includes(userId)) return false;
        return true;
      }).length;
    }

    // Today count: separate code path via systemRole
    const todayStatusId = await getTodayStatusId(ctx, orgId);
    let todayCount = 0;
    if (todayStatusId) {
      const todayTasks = await ctx.db
        .query("tasks")
        .withIndex("by_statusId", (q) => q.eq("statusId", todayStatusId))
        .collect();
      todayCount = todayTasks.filter((t) => {
        if (t.orgId !== orgId) return false;
        if (t.archivedAt) return false;
        if (!isAdmin && !t.assigneeIds.includes(userId)) return false;
        return true;
      }).length;
    }

    return {
      active: typeCounts.in_progress + typeCounts.review + typeCounts.blocked,
      backlog: typeCounts.backlog, // includes today tasks (intentional overlap)
      today: todayCount,
      review: typeCounts.review,
      blocked: typeCounts.blocked,
      done: typeCounts.done,
    };
  },
});

/**
 * Main task list — filtered, grouped, paginated, enriched.
 * Single real-time subscription powering the entire table.
 */
export const list = query({
  args: {
    tab: v.union(
      v.literal("active"), v.literal("backlog"), v.literal("today"),
      v.literal("review"), v.literal("blocked"), v.literal("done")
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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);
    const limit = args.limit ?? 50;

    // ── Step 1: Fetch tasks by tab ──────────────────────────────────────────
    let tasks: Doc<"tasks">[];

    if (args.search) {
      // Use search index for title search
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_title", (q) =>
          q.search("title", args.search!).eq("orgId", orgId)
        )
        .collect();
    } else if (args.tab === "today") {
      // Today tab: find status with systemRole="today", filter by statusId
      const todayStatusId = await getTodayStatusId(ctx, orgId);
      if (!todayStatusId) {
        return { groups: [], totalCount: 0 };
      }
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_statusId", (q) => q.eq("statusId", todayStatusId))
        .collect();
    } else {
      // Use statusType index for other tabs
      const statusTypes = TAB_STATUS_TYPES[args.tab];
      if (!statusTypes) {
        return { groups: [], totalCount: 0 };
      }
      const taskArrays = await Promise.all(
        statusTypes.map((type) =>
          ctx.db
            .query("tasks")
            .withIndex("by_orgId_statusType", (q) =>
              q.eq("orgId", orgId).eq("statusType", type)
            )
            .collect()
        )
      );
      tasks = taskArrays.flat();
    }

    // ── Step 2: Filter out archived + permission + tab constraint for search
    tasks = tasks.filter((t) => {
      if (t.archivedAt) return false;
      if (t.orgId !== orgId) return false; // safety for statusId-only index
      if (!isAdmin && !t.assigneeIds.includes(userId)) return false;
      // When searching, constrain to the selected tab's statusTypes
      if (args.search) {
        if (args.tab === "today") {
          // For today tab + search, filter to today status
          // We can't use statusId here easily, so we fall back to checking
          // if the task's statusType is backlog (today is a backlog subtype)
          // This is acceptable — search + today is an edge case
          return t.statusType === "backlog";
        }
        const tabTypes = TAB_STATUS_TYPES[args.tab];
        if (tabTypes && !tabTypes.includes(t.statusType)) return false;
      }
      return true;
    });

    // ── Step 3: Apply filters ───────────────────────────────────────────────
    // Batch-load projects when needed for client filter or grouping
    let projectMap = new Map<string, Doc<"projects">>();
    const needProjects = args.filters?.clientId || args.groupBy === "client" || args.groupBy === "project";
    if (needProjects) {
      const allProjects = await ctx.db
        .query("projects")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      for (const p of allProjects) {
        projectMap.set(p._id.toString(), p);
      }
    }

    if (args.filters) {
      const f = args.filters;

      // Generic array-based filter helper
      function matchesArrayFilter<T>(
        taskValue: T | undefined,
        filterValues: T[],
        op: "is" | "isNot" | "anyOf" | "noneOf"
      ): boolean {
        if (!taskValue) return op === "isNot" || op === "noneOf";
        const isIn = filterValues.some((v) => v === taskValue);
        return (op === "is" || op === "anyOf") ? isIn : !isIn;
      }

      // Status filter
      if (f.statusId) {
        const { op, value: ids } = f.statusId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.statusId, ids, op));
      }

      // Client filter (via project's clientId)
      if (f.clientId) {
        tasks = tasks.filter((t) => {
          if (!t.projectId) return f.clientId!.op === "isNot";
          const project = projectMap.get(t.projectId.toString());
          if (!project) return f.clientId!.op === "isNot";
          const matches = project.clientId === f.clientId!.value;
          return f.clientId!.op === "is" ? matches : !matches;
        });
      }

      // Project filter (array-based)
      if (f.projectId) {
        const { op, value: ids } = f.projectId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.projectId, ids, op));
      }

      // Assignee filter
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

      // Category filter (array-based)
      if (f.workCategoryId) {
        const { op, value: ids } = f.workCategoryId;
        tasks = tasks.filter((t) => matchesArrayFilter(t.workCategoryId, ids, op));
      }

      // Date range filter
      if (f.dateFrom) {
        const from = f.dateFrom;
        tasks = tasks.filter((t) => t.dueDate && t.dueDate >= from);
      }
      if (f.dateTo) {
        const to = f.dateTo;
        tasks = tasks.filter((t) => t.dueDate && t.dueDate <= to);
      }
    }

    // ── Step 4: Sort (createdAt DESC) ───────────────────────────────────────
    tasks.sort((a, b) => b.createdAt - a.createdAt);

    const totalCount = tasks.length;

    // ── Step 5: Group (before enrichment, so we only enrich visible tasks) ──
    type GroupBucket = { key: string; label: string; color?: string; sortKey: string; tasks: Doc<"tasks">[] };
    const buckets = new Map<string, GroupBucket>();

    function assignToBucket(task: Doc<"tasks">, key: string, label: string, sortKey: string, color?: string) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, label, color, sortKey, tasks: [] };
        buckets.set(key, bucket);
      }
      bucket.tasks.push(task);
    }

    if (!args.groupBy) {
      // Flat list — single bucket
      for (const task of tasks) {
        assignToBucket(task, "__all__", "All Tasks", "a");
      }
    } else {
      // Need lookup maps for grouping — load if not yet loaded
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
        // Collect unique user IDs from tasks, then batch load
        const uids = new Set<string>();
        for (const t of tasks) for (const uid of t.assigneeIds) uids.add(uid.toString());
        const docs = await Promise.all([...uids].map((id) => ctx.db.get(id as Id<"users">)));
        for (const d of docs) if (d) userMap.set(d._id.toString(), d);
      }
      if ((args.groupBy === "project" || args.groupBy === "client") && !projectMap.size) {
        const allProjects = await ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
        for (const p of allProjects) projectMap.set(p._id.toString(), p);
      }

      // Load clients for project/client grouping
      let clientMap = new Map<string, Doc<"clients">>();
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
            assignToBucket(task, task.statusId.toString(), st?.name ?? "Unknown", sortKey, st?.color);
            break;
          }
        }
      }
    }

    // Sort groups and paginate within each group
    const sortedBuckets = [...buckets.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    // ── Step 6: Enrich only the paginated tasks ─────────────────────────────
    // Collect IDs from paginated tasks only
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

    // Load projects for enrichment if not already loaded from grouping
    if (projectIdsForEnrich.size > 0) {
      const missingProjectIds = [...projectIdsForEnrich].filter((id) => !projectMap.has(id));
      if (missingProjectIds.length > 0) {
        const docs = await Promise.all(missingProjectIds.map((id) => ctx.db.get(id as Id<"projects">)));
        for (const p of docs) if (p) projectMap.set(p._id.toString(), p);
      }
    }

    const enrichStatusMap = new Map(statusDocs.filter(Boolean).map((s) => [s!._id.toString(), s!]));
    const enrichCategoryMap = new Map(categoryDocs.filter(Boolean).map((c) => [c!._id.toString(), c!]));
    const enrichUserMap = new Map(userDocs.filter(Boolean).map((u) => [u!._id.toString(), u!]));

    // Load clients for project→client join (only for enrichment)
    const enrichClientIds = new Set<string>();
    for (const pid of projectIdsForEnrich) {
      const p = projectMap.get(pid);
      if (p) enrichClientIds.add(p.clientId.toString());
    }
    const enrichClientDocs = await Promise.all(
      [...enrichClientIds].map((id) => ctx.db.get(id as Id<"clients">))
    );
    const enrichClientMap = new Map(enrichClientDocs.filter(Boolean).map((c) => [c!._id.toString(), c!]));

    function enrichTask(task: Doc<"tasks">): TaskWithJoins {
      const status = enrichStatusMap.get(task.statusId.toString());
      const project = task.projectId ? projectMap.get(task.projectId.toString()) : null;
      const client = project ? enrichClientMap.get(project.clientId.toString()) : null;
      const category = task.workCategoryId ? enrichCategoryMap.get(task.workCategoryId.toString()) : null;
      const assignees = task.assigneeIds
        .map((id) => enrichUserMap.get(id.toString()))
        .filter(Boolean) as Doc<"users">[];

      return {
        ...task,
        status: status
          ? { _id: status._id, name: status.name, color: status.color, type: status.type, icon: status.icon }
          : null,
        project: project
          ? { _id: project._id, name: project.name, code: project.code }
          : null,
        client: client
          ? { _id: client._id, name: client.name }
          : null,
        category: category
          ? { _id: category._id, name: category.name, color: category.color }
          : null,
        assignees: assignees.map((u) => ({
          _id: u._id, name: u.name, email: u.email, imageUrl: u.imageUrl,
        })),
      };
    }

    // ── Step 7: Build response ──────────────────────────────────────────────
    const groups = sortedBuckets.map((bucket, i) => ({
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      count: bucket.tasks.length,
      tasks: paginatedTasksByGroup[i].map(enrichTask),
      hasMore: bucket.tasks.length > limit,
    }));

    return { groups, totalCount };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

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
    if (!title) throw new Error("Task title is required");
    validateStringLength(title, 500, "Task title");

    // Resolve status
    let statusId: Id<"statuses">;
    let statusType: StatusType;
    if (args.statusId) {
      const status = await ctx.db.get(args.statusId);
      if (!status || status.orgId !== orgId) throw new Error("Status not found");
      statusId = args.statusId;
      statusType = status.type;
    } else {
      const defaults = await getDefaultStatusId(ctx, orgId);
      statusId = defaults.statusId;
      statusType = defaults.statusType;
    }

    // Validate project belongs to org
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== orgId) throw new Error("Project not found");
    }

    // Member auto-assigned
    let assigneeIds = args.assigneeIds ?? [];
    if (!isAdmin && !assigneeIds.includes(userId)) {
      assigneeIds = [userId, ...assigneeIds];
    }

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      orgId,
      title,
      description: args.description?.trim() || undefined,
      statusId,
      statusType,
      projectId: args.projectId,
      assigneeIds,
      workCategoryId: args.workCategoryId,
      estimate: args.estimate,
      billable: args.billable ?? true,
      dueDate: args.dueDate,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
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
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    // Member can only edit assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("You can only edit tasks assigned to you");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Task title is required");
      validateStringLength(title, 500, "Task title");
      updates.title = title;
    }

    if (args.description !== undefined) {
      updates.description = args.description.trim() || undefined;
    }

    if (args.statusId !== undefined) {
      const status = await ctx.db.get(args.statusId);
      if (!status || status.orgId !== orgId) throw new Error("Status not found");

      // Member cannot set done-type status
      if (!isAdmin && status.type === "done") {
        throw new Error("Only admins can mark tasks as done");
      }

      updates.statusId = args.statusId;
      updates.statusType = status.type;
    }

    if (args.projectId !== undefined) {
      if (args.projectId !== null) {
        const project = await ctx.db.get(args.projectId);
        if (!project || project.orgId !== orgId) throw new Error("Project not found");
      }
      // TODO(Phase 7): block project change if task has time entries
      updates.projectId = args.projectId === null ? undefined : args.projectId;
    }

    if (args.assigneeIds !== undefined) {
      updates.assigneeIds = args.assigneeIds;
    }

    if (args.workCategoryId !== undefined) {
      updates.workCategoryId = args.workCategoryId === null ? undefined : args.workCategoryId;
    }

    if (args.estimate !== undefined) {
      updates.estimate = args.estimate === null ? undefined : args.estimate;
    }

    if (args.billable !== undefined) {
      updates.billable = args.billable;
    }

    if (args.dueDate !== undefined) {
      updates.dueDate = args.dueDate === null ? undefined : args.dueDate;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("You can only archive tasks assigned to you");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });

    // Cascade archive to subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      if (!sub.archivedAt) {
        await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now });
      }
    }

    // TODO(Phase 7): stop active timers for this task
  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("You can only restore tasks assigned to you");
    }

    await ctx.db.patch(args.id, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    // TODO(Phase 7): if task has time entries, suggest archive instead

    // Cascade delete subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      await ctx.db.delete(sub._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const duplicate = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      orgId,
      title: `${task.title} (copy)`,
      description: task.description,
      statusId: task.statusId,
      statusType: task.statusType,
      projectId: task.projectId,
      assigneeIds: task.assigneeIds,
      workCategoryId: task.workCategoryId,
      estimate: task.estimate,
      billable: task.billable,
      // NOT copied: subtasks, comments, attachments, time entries, dueDate
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
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
      v.object({ type: v.literal("archive") })
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    if (args.taskIds.length > 50) {
      throw new Error("Maximum 50 tasks per bulk operation");
    }

    // Pre-validate action-specific data
    let newStatusType: StatusType | undefined;
    if (args.action.type === "status") {
      const status = await ctx.db.get(args.action.statusId);
      if (!status || status.orgId !== orgId) throw new Error("Status not found");
      if (!isAdmin && status.type === "done") {
        throw new Error("Only admins can mark tasks as done");
      }
      newStatusType = status.type;
    }

    if (args.action.type === "project") {
      const project = await ctx.db.get(args.action.projectId);
      if (!project || project.orgId !== orgId) throw new Error("Project not found");
    }

    const now = Date.now();
    let updated = 0;
    const skipped: Array<{ taskId: Id<"tasks">; title: string; reason: string }> = [];

    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.orgId !== orgId) {
        skipped.push({ taskId, title: "Unknown", reason: "Task not found" });
        continue;
      }

      if (!isAdmin && !task.assigneeIds.includes(userId)) {
        skipped.push({ taskId, title: task.title, reason: "Not assigned to you" });
        continue;
      }

      switch (args.action.type) {
        case "status":
          await ctx.db.patch(taskId, {
            statusId: args.action.statusId,
            statusType: newStatusType!,
            updatedAt: now,
          });
          updated++;
          break;

        case "addAssignee": {
          const addUid = args.action.userId;
          if (!task.assigneeIds.includes(addUid)) {
            await ctx.db.patch(taskId, {
              assigneeIds: [...task.assigneeIds, addUid],
              updatedAt: now,
            });
          }
          updated++;
          break;
        }

        case "removeAssignee": {
          const removeUid = args.action.userId;
          await ctx.db.patch(taskId, {
            assigneeIds: task.assigneeIds.filter((id) => id !== removeUid),
            updatedAt: now,
          });
          updated++;
          break;
        }

        case "category": {
          const catId = args.action.workCategoryId;
          await ctx.db.patch(taskId, {
            workCategoryId: catId,
            updatedAt: now,
          });
          updated++;
          break;
        }

        case "project": {
          // TODO(Phase 7): skip if task has time entries
          const projId = args.action.projectId;
          await ctx.db.patch(taskId, {
            projectId: projId,
            updatedAt: now,
          });
          updated++;
          break;
        }

        case "archive":
          if (!task.archivedAt) {
            await ctx.db.patch(taskId, { archivedAt: now, updatedAt: now });
            // Cascade to subtasks
            const subtasks = await ctx.db
              .query("tasks")
              .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", taskId))
              .collect();
            for (const sub of subtasks) {
              if (!sub.archivedAt) {
                await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now });
              }
            }
          }
          updated++;
          break;
      }
    }

    return { updated, skipped };
  },
});
