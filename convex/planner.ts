import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { query, mutation, internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  getAuthContext,
  requireAdmin,
  validateStringLength,
  assertCanManagePlanFor,
} from "./lib/auth";
import { assertValidDateString } from "./lib/dateValidation";
import { getDefaultStatusId } from "./lib/task_helpers";
import { logActivity } from "./activityLog";
import {
  rankTaskSegments,
  segmentSpanDays,
  type PartRank,
} from "./lib/plannerMath";
import {
  planRemovalOps,
  summarizeRemovalOps,
  segmentCoversDate,
} from "./lib/todayPlan";
import { getOrgSettings } from "./lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import type { StatusType } from "./lib/constants";

/** Cap one weekGrid call well below Convex's 16k-doc read limit (mirrors
 *  convex/workday.ts). Revisit if per-range segment counts grow. */
const MAX_SEGMENTS_PER_RANGE = 10_000;

export type PlannerSegmentBar = {
  _id: Id<"planSegments">;
  taskId: Id<"tasks">;
  startDate: string;
  endDate: string;
  taskTitle: string;
  projectName: string | null;
  categoryColor: string | null;
  statusType: StatusType;
  /** 1-based rank among ALL of the task's segments (incl. off-screen ones). */
  partIndex: number;
  /** Total segments of the task; badge shows only when > 1. */
  partCount: number;
  /** Stable lane-packing priority (lower = higher on screen): the stored
   *  manual `laneOrder` when the owner has reordered the bar, else its
   *  creation time. Never derived from dates — the row must not reshuffle
   *  while dates are edited (owner ruling). */
  laneOrder: number;
};

export type PlannerUserRow = {
  user: {
    _id: Id<"users">;
    name: string;
    imageUrl: string | undefined;
    role: "admin" | "member";
  };
  segments: PlannerSegmentBar[];
};

export type PlannerGridData = {
  rows: PlannerUserRow[];
};

/**
 * Write-time invariant shared by every planSegments write path (seed today;
 * createSegment/updateSegment/createTaskWithSegment in later slices).
 */
export function assertSegmentRange(startDate: string, endDate: string): void {
  assertValidDateString(startDate, "startDate");
  assertValidDateString(endDate, "endDate");
  if (endDate < startDate) {
    throw new ConvexError("endDate must be on or after startDate");
  }
}

/**
 * The Planner board: rows for ALL org members, each with its plan segments
 * overlapping the visible range, joined to light task data.
 *
 * Deliberate difference from workday.weekGrid: non-admin members are NOT
 * scoped to their own row — the Planner is a shared board; everyone sees
 * every row. Segments of archived tasks are excluded (archive is reversible;
 * the segments stay in the table).
 */
export const weekGrid = query({
  args: {
    startDate: v.string(), // YYYY-MM-DD inclusive
    endDate: v.string(),   // YYYY-MM-DD inclusive
    userIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args): Promise<PlannerGridData> => {
    assertValidDateString(args.startDate, "startDate");
    assertValidDateString(args.endDate, "endDate");
    if (args.startDate > args.endDate) {
      throw new ConvexError("startDate must be on or before endDate");
    }

    const { orgId } = await getAuthContext(ctx);

    // 1. Membership list — defines the rows even when there is no plan yet.
    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const linkedMemberships = memberships.flatMap((m) =>
      m.userId ? [{ userId: m.userId, role: m.role }] : [],
    );
    const userDocs = await Promise.all(
      linkedMemberships.map((m) => ctx.db.get(m.userId)),
    );
    const rowUserById = new Map<string, PlannerUserRow["user"]>();
    linkedMemberships.forEach((m, i) => {
      const u = userDocs[i];
      if (!u || u.deletedAt) return;
      rowUserById.set(u._id.toString(), {
        _id: u._id,
        name: u.name,
        imageUrl: u.imageUrl,
        role: m.role,
      });
    });

    let rowUsers = [...rowUserById.values()];
    if (args.userIds && args.userIds.length > 0) {
      const allow = new Set(args.userIds.map((id) => id.toString()));
      rowUsers = rowUsers.filter((u) => allow.has(u._id.toString()));
    }
    rowUsers.sort((a, b) => a.name.localeCompare(b.name));

    // 2. Overlapping segments: index range on startDate <= rangeEnd, then
    //    in-memory endDate >= rangeStart (per PRD — acceptable at MVP scale).
    const segmentsRaw = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_startDate", (q) =>
        q.eq("orgId", orgId).lte("startDate", args.endDate),
      )
      .take(MAX_SEGMENTS_PER_RANGE + 1);
    if (segmentsRaw.length > MAX_SEGMENTS_PER_RANGE) {
      throw new ConvexError(
        `Planner range exceeded ${MAX_SEGMENTS_PER_RANGE} segments — switch to per-user paged queries.`,
      );
    }

    const allowed = new Set(rowUsers.map((u) => u._id.toString()));
    const segments = segmentsRaw.filter(
      (s) => s.endDate >= args.startDate && allowed.has(s.userId.toString()),
    );

    // 3. Single-round-trip hydration — tasks → projects / categories.
    const taskIds = [...new Set(segments.map((s) => s.taskId.toString()))];
    const tasks = await Promise.all(
      taskIds.map((id) => ctx.db.get(id as Id<"tasks">)),
    );
    const taskMap = new Map<string, Doc<"tasks">>();
    for (const t of tasks) {
      // Archived tasks stay out of the board; their segments are kept so
      // unarchiving restores the plan.
      if (t && t.orgId === orgId && !t.archivedAt) taskMap.set(t._id.toString(), t);
    }

    const projectIds = [
      ...new Set(
        [...taskMap.values()]
          .map((t) => t.projectId)
          .filter((id): id is Id<"projects"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const projects = await Promise.all(
      projectIds.map((id) => ctx.db.get(id as Id<"projects">)),
    );
    const projectMap = new Map<string, Doc<"projects">>();
    for (const p of projects) {
      if (p && p.orgId === orgId) projectMap.set(p._id.toString(), p);
    }

    const categoryIds = [
      ...new Set(
        [...taskMap.values()]
          .map((t) => t.workCategoryId)
          .filter((id): id is Id<"workCategories"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const categories = await Promise.all(
      categoryIds.map((id) => ctx.db.get(id as Id<"workCategories">)),
    );
    const categoryMap = new Map<string, Doc<"workCategories">>();
    for (const c of categories) {
      if (c && c.orgId === orgId) categoryMap.set(c._id.toString(), c);
    }

    // 3b. Part badges: rank across ALL of each task's segments (a sibling
    //     sitting may live outside the range or on another person's row).
    const partRankByTask = new Map<string, Map<string, PartRank>>();
    await Promise.all(
      [...taskMap.values()].map(async (task) => {
        const all = await ctx.db
          .query("planSegments")
          .withIndex("by_orgId_taskId", (q) =>
            q.eq("orgId", orgId).eq("taskId", task._id),
          )
          .collect();
        partRankByTask.set(task._id.toString(), rankTaskSegments(all));
      }),
    );

    // 4. Group per user, sorted by startDate (ties by endDate) for stable lanes.
    const segsByUser = new Map<string, PlannerSegmentBar[]>();
    for (const s of segments) {
      const task = taskMap.get(s.taskId.toString());
      if (!task) continue; // archived or gone
      const project = task.projectId
        ? projectMap.get(task.projectId.toString()) ?? null
        : null;
      const category = task.workCategoryId
        ? categoryMap.get(task.workCategoryId.toString()) ?? null
        : null;

      const rank = partRankByTask
        .get(s.taskId.toString())
        ?.get(s._id.toString());

      const bar: PlannerSegmentBar = {
        _id: s._id,
        taskId: s.taskId,
        startDate: s.startDate,
        endDate: s.endDate,
        taskTitle: task.title,
        projectName: project?.name ?? null,
        categoryColor: category?.color ?? null,
        statusType: task.statusType,
        partIndex: rank?.partIndex ?? 1,
        partCount: rank?.partCount ?? 1,
        laneOrder: s.laneOrder ?? s.createdAt,
      };
      const list = segsByUser.get(s.userId.toString()) ?? [];
      list.push(bar);
      segsByUser.set(s.userId.toString(), list);
    }

    const rows: PlannerUserRow[] = rowUsers.map((u) => {
      const segs = (segsByUser.get(u._id.toString()) ?? []).slice();
      segs.sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.endDate.localeCompare(b.endDate),
      );
      return { user: u, segments: segs };
    });

    return { rows };
  },
});

/** Cap the panel read well below Convex limits; the PRD defers server-side
 *  narrowing/pagination until backlogs outgrow client-side filtering. */
const MAX_PANEL_TASKS = 5_000;

export type TaskPanelItem = {
  _id: Id<"tasks">;
  title: string;
  projectId: Id<"projects"> | null;
  projectName: string | null;
  clientId: Id<"clients"> | null;
  clientName: string | null;
  categoryId: Id<"workCategories"> | null;
  categoryName: string | null;
  categoryColor: string | null;
  statusType: StatusType;
  /** YYYY-MM-DD deadline; drives the panel's Due filter. */
  dueDate: string | null;
  /** Minutes (same unit the estimate cell edits); null when unset. */
  estimate: number | null;
  /** Sum of day-spans across ALL of the task's segments. */
  plannedDays: number;
  segmentCount: number;
  createdAt: number;
};

/**
 * The Tasks panel: every active (non-archived) top-level task with the
 * light fields the cards and the default-span rule need, newest first.
 * Search / tab / filter narrowing runs client-side (PRD: fine at hundreds
 * of tasks). Subtasks are excluded — they are planned via their parent.
 */
export const taskPanel = query({
  args: {},
  handler: async (ctx): Promise<TaskPanelItem[]> => {
    const { orgId } = await getAuthContext(ctx);

    const tasksRaw = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(MAX_PANEL_TASKS + 1);
    if (tasksRaw.length > MAX_PANEL_TASKS) {
      throw new ConvexError(
        `Task panel exceeded ${MAX_PANEL_TASKS} tasks — switch to a paginated panel query.`,
      );
    }
    const tasks = tasksRaw.filter((t) => !t.archivedAt && !t.parentTaskId);

    // One bounded read over the org's segments, grouped per task — beats a
    // per-task index query for every card.
    const segments = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_startDate", (q) => q.eq("orgId", orgId))
      .take(MAX_SEGMENTS_PER_RANGE + 1);
    if (segments.length > MAX_SEGMENTS_PER_RANGE) {
      throw new ConvexError(
        `Task panel exceeded ${MAX_SEGMENTS_PER_RANGE} segments — switch to per-task reads.`,
      );
    }
    const planByTask = new Map<string, { days: number; count: number }>();
    for (const s of segments) {
      const key = s.taskId.toString();
      const agg = planByTask.get(key) ?? { days: 0, count: 0 };
      agg.days += segmentSpanDays(s.startDate, s.endDate);
      agg.count += 1;
      planByTask.set(key, agg);
    }

    const projectIds = [
      ...new Set(
        tasks
          .map((t) => t.projectId)
          .filter((id): id is Id<"projects"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const projects = await Promise.all(
      projectIds.map((id) => ctx.db.get(id as Id<"projects">)),
    );
    const projectMap = new Map<string, Doc<"projects">>();
    for (const p of projects) {
      if (p && p.orgId === orgId) projectMap.set(p._id.toString(), p);
    }

    const clientIds = [
      ...new Set(
        [...projectMap.values()].map((p) => p.clientId.toString()),
      ),
    ];
    const clients = await Promise.all(
      clientIds.map((id) => ctx.db.get(id as Id<"clients">)),
    );
    const clientMap = new Map<string, Doc<"clients">>();
    for (const c of clients) {
      if (c && c.orgId === orgId) clientMap.set(c._id.toString(), c);
    }

    const categoryIds = [
      ...new Set(
        tasks
          .map((t) => t.workCategoryId)
          .filter((id): id is Id<"workCategories"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const categories = await Promise.all(
      categoryIds.map((id) => ctx.db.get(id as Id<"workCategories">)),
    );
    const categoryMap = new Map<string, Doc<"workCategories">>();
    for (const c of categories) {
      if (c && c.orgId === orgId) categoryMap.set(c._id.toString(), c);
    }

    return tasks
      .map((t) => {
        const project = t.projectId
          ? projectMap.get(t.projectId.toString()) ?? null
          : null;
        const client = project
          ? clientMap.get(project.clientId.toString()) ?? null
          : null;
        const category = t.workCategoryId
          ? categoryMap.get(t.workCategoryId.toString()) ?? null
          : null;
        const plan = planByTask.get(t._id.toString());
        return {
          _id: t._id,
          title: t.title,
          projectId: project?._id ?? null,
          projectName: project?.name ?? null,
          clientId: client?._id ?? null,
          clientName: client?.name ?? null,
          categoryId: category?._id ?? null,
          categoryName: category?.name ?? null,
          categoryColor: category?.color ?? null,
          statusType: t.statusType,
          dueDate: t.dueDate ?? null,
          estimate: t.estimate ?? null,
          plannedDays: plan?.days ?? 0,
          segmentCount: plan?.count ?? 0,
          createdAt: t.createdAt,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export type TaskPlanSegment = {
  _id: Id<"planSegments">;
  userId: Id<"users">;
  userName: string;
  startDate: string;
  endDate: string;
  partIndex: number;
  partCount: number;
};

/**
 * All sittings of one task, for the task drawer's "Plan" section. Readable
 * by every org member (the plan is a shared board); sorted by start date
 * with the same part ranking the grid badges use.
 */
export const taskSegments = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args): Promise<TaskPlanSegment[]> => {
    const { orgId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

    const segments = await ctx.db
      .query("planSegments")
      .withIndex("by_orgId_taskId", (q) =>
        q.eq("orgId", orgId).eq("taskId", args.taskId),
      )
      .collect();

    const rank = rankTaskSegments(segments);

    const userIds = [...new Set(segments.map((s) => s.userId.toString()))];
    const users = await Promise.all(
      userIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    const nameById = new Map<string, string>();
    users.forEach((u) => {
      if (u) nameById.set(u._id.toString(), u.name);
    });

    return segments
      .map((s) => ({
        _id: s._id,
        userId: s.userId,
        userName: nameById.get(s.userId.toString()) ?? "Unknown",
        startDate: s.startDate,
        endDate: s.endDate,
        partIndex: rank.get(s._id.toString())?.partIndex ?? 1,
        partCount: rank.get(s._id.toString())?.partCount ?? 1,
      }))
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.endDate.localeCompare(b.endDate),
      );
  },
});

// ─── Mutations (admin-or-self gated; every referenced id org-validated) ──────
//
// Permission model (Today × Planner PRD): admins manage every row; members
// manage segments on their OWN row only (create with own userId, touch only
// own segments, no reassigning to others). None of these mutations writes
// activity-log events — the plan is not part of the task's workflow record.

/** A user id is a valid segment target only if it belongs to this org. */
async function assertOrgMember(
  ctx: MutationCtx,
  orgId: string,
  userId: Id<"users">,
): Promise<void> {
  const memberships = await ctx.db
    .query("orgMembers")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  if (!memberships.some((m) => m.orgId === orgId)) {
    throw new ConvexError("User is not a member of this organization");
  }
}

/** Schedule a (new) sitting of a task: the ⌥-split drop and, in later
 *  slices, panel drag-to-schedule. Never duplicates the task — segments are
 *  references, so the same taskId simply gains another row. */
export const createSegment = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const { orgId, userId: createdBy } = auth;
    assertCanManagePlanFor(auth, args.userId);

    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");
    if (task.archivedAt) {
      throw new ConvexError("Archived tasks cannot be scheduled");
    }

    await assertOrgMember(ctx, orgId, args.userId);
    assertSegmentRange(args.startDate, args.endDate);

    const now = Date.now();
    return await ctx.db.insert("planSegments", {
      orgId,
      taskId: args.taskId,
      userId: args.userId,
      startDate: args.startDate,
      endDate: args.endDate,
      createdAt: now,
      updatedAt: now,
      createdBy,
    });
  },
});

/** Move / resize / reassign / restack one segment. Partial args merge onto
 *  the stored segment; the merged range must satisfy the date invariant.
 *  `laneOrder` is the manual vertical stacking priority within a row
 *  (lower = higher; unset segments fall back to createdAt). */
export const updateSegment = mutation({
  args: {
    id: v.id("planSegments"),
    userId: v.optional(v.id("users")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    laneOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const { orgId } = auth;
    const seg = await ctx.db.get(args.id);
    if (!seg || seg.orgId !== orgId) throw new ConvexError("Segment not found");
    // Own-segment guard + no-reassign-to-others guard (both no-ops for admins)
    assertCanManagePlanFor(auth, seg.userId);
    if (args.userId) assertCanManagePlanFor(auth, args.userId);

    if (args.userId) await assertOrgMember(ctx, orgId, args.userId);

    const startDate = args.startDate ?? seg.startDate;
    const endDate = args.endDate ?? seg.endDate;
    assertSegmentRange(startDate, endDate);

    await ctx.db.patch(args.id, {
      userId: args.userId ?? seg.userId,
      startDate,
      endDate,
      ...(args.laneOrder !== undefined ? { laneOrder: args.laneOrder } : {}),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Draw-to-create: one atomic mutation creates the task AND its first plan
 * segment — a failure anywhere (bad project, cross-org user, inverted
 * range) leaves no half-created task behind (Convex mutations are
 * transactions, and every referenced id is validated before any write).
 *
 * Task defaults are deliberately identical to the /tasks inline-add path
 * (tasks.create called with only title + project): default backlog status,
 * no category, no due date, billable, appended fractional sort key, empty
 * assignees — resolveDefaultAssignee needs a category to match a project's
 * defaultAssignees mapping, and Planner-created tasks never have one. The
 * segment's row user is NOT assigned to the task (PRD: `assigneeIds` is
 * untouched by the Planner; segments carry their own userId).
 */
export const createTaskWithSegment = mutation({
  args: {
    title: v.string(),
    projectId: v.optional(v.id("projects")),
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId, userId: createdBy } = await requireAdmin(ctx);

    const title = args.title.trim();
    if (!title) throw new ConvexError("Task title is required");
    validateStringLength(title, 500, "Task title");

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== orgId) {
        throw new ConvexError("Project not found");
      }
    }
    await assertOrgMember(ctx, orgId, args.userId);
    assertSegmentRange(args.startDate, args.endDate);

    const defaults = await getDefaultStatusId(ctx, orgId);

    // Append after the org's highest manual sort key (same index + OCC
    // serialization argument as tasks.create).
    const lastSorted = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_manualSortKey", (q) => q.eq("orgId", orgId))
      .order("desc")
      .first();
    const manualSortKey = generateKeyBetween(
      lastSorted?.manualSortKey ?? null,
      null,
    );

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      orgId,
      title,
      statusId: defaults.statusId,
      statusType: defaults.statusType,
      projectId: args.projectId,
      assigneeIds: [],
      billable: true,
      manualSortKey,
      createdAt: now,
      updatedAt: now,
      createdBy,
    });
    await logActivity(ctx, {
      taskId,
      orgId,
      userId: createdBy,
      type: "task_created",
      metadata: {},
    });

    const segmentId = await ctx.db.insert("planSegments", {
      orgId,
      taskId,
      userId: args.userId,
      startDate: args.startDate,
      endDate: args.endDate,
      createdAt: now,
      updatedAt: now,
      createdBy,
    });

    return { taskId, segmentId };
  },
});

/** Unschedule one segment (the task itself is untouched). */
export const removeSegment = mutation({
  args: { id: v.id("planSegments") },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const seg = await ctx.db.get(args.id);
    if (!seg || seg.orgId !== auth.orgId) throw new ConvexError("Segment not found");
    assertCanManagePlanFor(auth, seg.userId);
    await ctx.db.delete(args.id);
  },
});

// ─── Today wrapper mutations (the sun gesture) ────────────────────────────────

/**
 * Resolve "today" (org timezone) plus the caller's segments of one task.
 * Shared by addToToday / removeFromToday — both are self-scoped: they only
 * ever operate on the CALLER's segments, so they are member-callable by
 * construction.
 */
async function getMyTaskPlanContext(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
) {
  const { orgId, userId } = await getAuthContext(ctx);

  const task = await ctx.db.get(taskId);
  if (!task || task.orgId !== orgId) throw new ConvexError("Task not found");

  const orgSettings = await getOrgSettings(ctx, orgId);
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
  const today = getDateInTimezone(Date.now(), timezone);

  const taskSegments = await ctx.db
    .query("planSegments")
    .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", taskId))
    .collect();
  const myCoveringToday = taskSegments.filter(
    (s) => s.userId === userId && segmentCoversDate(s, today),
  );

  return { orgId, userId, task, today, myCoveringToday };
}

/**
 * The sun gesture, add side: plan this task for ME, TODAY, as a one-day
 * segment. Idempotent — if any of my segments already covers today, this is
 * a no-op (rapid clicking is safe, no duplicate segments).
 */
export const addToToday = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args): Promise<{ added: boolean }> => {
    const { orgId, userId, task, today, myCoveringToday } =
      await getMyTaskPlanContext(ctx, args.taskId);

    if (task.archivedAt) {
      throw new ConvexError("Archived tasks cannot be planned");
    }
    if (myCoveringToday.length > 0) return { added: false };

    const now = Date.now();
    await ctx.db.insert("planSegments", {
      orgId,
      taskId: args.taskId,
      userId,
      startDate: today,
      endDate: today,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    return { added: true };
  },
});

/**
 * The sun gesture, remove side: take this task out of MY today. Applies
 * `planRemovalOps` surgery to every covering segment of mine — single-day
 * deletes; multi-day bars keep their other days (trim or split). Idempotent
 * on tasks not in my today. Returns the summary kind for toast copy.
 */
export const removeFromToday = mutation({
  args: { taskId: v.id("tasks") },
  handler: async (
    ctx,
    args,
  ): Promise<{ removed: boolean; kind: "deleted" | "trimmed" | "split" | null }> => {
    const { today, myCoveringToday } = await getMyTaskPlanContext(ctx, args.taskId);

    const ops = planRemovalOps(myCoveringToday, today);
    if (ops.length === 0) return { removed: false, kind: null };

    const segById = new Map(myCoveringToday.map((s) => [s._id.toString(), s]));
    const now = Date.now();
    for (const op of ops) {
      if (op.op === "delete") {
        await ctx.db.delete(op.segmentId as Id<"planSegments">);
      } else if (op.op === "patch") {
        await ctx.db.patch(op.segmentId as Id<"planSegments">, {
          startDate: op.startDate,
          endDate: op.endDate,
          updatedAt: now,
        });
      } else {
        const source = segById.get(op.fromSegmentId)!;
        // The split remainder inherits the source's lane priority so the
        // Planner row does not reshuffle (stable lane packing).
        await ctx.db.insert("planSegments", {
          orgId: source.orgId,
          taskId: source.taskId,
          userId: source.userId,
          startDate: op.startDate,
          endDate: op.endDate,
          laneOrder: source.laneOrder ?? source.createdAt,
          createdAt: now,
          updatedAt: now,
          createdBy: source.createdBy,
        });
      }
    }

    return { removed: true, kind: summarizeRemovalOps(ops) };
  },
});

// ─── Dev seed ─────────────────────────────────────────────────────────────────

function ymdFromUtcMs(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdFromUtcMs(Date.UTC(y, m - 1, d) + n * 86_400_000);
}

/**
 * DEV-ONLY seed for Slice 1 verification. Not part of the product API —
 * internal so it is only reachable via `npx convex run planner:seedDemo`.
 * Replaces the org's existing segments with a demo set on real tasks and
 * real members: one split task (two segments), one overlap (lane stacking),
 * one weekend-spanning bar.
 */
export const seedDemo = internalMutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const anyMember = args.orgId
      ? null
      : await ctx.db.query("orgMembers").first();
    const orgId = args.orgId ?? anyMember?.orgId;
    if (!orgId) throw new ConvexError("No orgMembers found — pass { orgId }");

    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const users: Doc<"users">[] = [];
    for (const m of memberships) {
      if (!m.userId) continue;
      const u = await ctx.db.get(m.userId);
      if (u && !u.deletedAt) users.push(u);
    }
    if (users.length === 0) throw new ConvexError(`Org ${orgId} has no members`);

    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(200);
    const tasks = allTasks
      .filter((t) => !t.archivedAt && !t.parentTaskId)
      .slice(0, 3);
    if (tasks.length === 0) {
      throw new ConvexError(`Org ${orgId} has no active tasks to plan`);
    }

    // Wipe existing segments so re-running the seed stays deterministic.
    let wiped = 0;
    for (;;) {
      const batch = await ctx.db
        .query("planSegments")
        .withIndex("by_orgId_startDate", (q) => q.eq("orgId", orgId))
        .take(500);
      if (batch.length === 0) break;
      for (const s of batch) await ctx.db.delete(s._id);
      wiped += batch.length;
    }

    // Monday of the current week (UTC — good enough for a dev seed).
    const now = Date.now();
    const today = ymdFromUtcMs(now);
    const [y, m, d] = today.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
    const monday = addDaysYmd(today, dow === 0 ? -6 : 1 - dow);

    const userA = users[0];
    const userB = users[1] ?? users[0];
    const createdBy =
      memberships.find((mm) => mm.role === "admin" && mm.userId)?.userId ??
      userA._id;

    const day = (n: number) => addDaysYmd(monday, n);
    const wanted: Array<{
      taskId: Id<"tasks">;
      userId: Id<"users">;
      startDate: string;
      endDate: string;
    }> = [
      // Task 0, split into two sittings on userA's row (part 1/2 + 2/2).
      { taskId: tasks[0]._id, userId: userA._id, startDate: day(0), endDate: day(2) },
      { taskId: tasks[0]._id, userId: userA._id, startDate: day(7), endDate: day(8) },
    ];
    if (tasks[1]) {
      // Overlaps task 0 on the same row → demoes lane stacking.
      wanted.push({ taskId: tasks[1]._id, userId: userA._id, startDate: day(1), endDate: day(3) });
    }
    if (tasks[2]) {
      // Thu → Sun on another row → demoes continuous weekend spanning.
      wanted.push({ taskId: tasks[2]._id, userId: userB._id, startDate: day(3), endDate: day(6) });
    }

    for (const w of wanted) {
      assertSegmentRange(w.startDate, w.endDate);
      await ctx.db.insert("planSegments", {
        orgId,
        ...w,
        createdAt: now,
        updatedAt: now,
        createdBy,
      });
    }

    return { orgId, wiped, created: wanted.length, weekStart: monday };
  },
});
