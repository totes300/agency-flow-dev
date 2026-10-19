import { v, ConvexError } from "convex/values";
import { generateNKeysBetween } from "fractional-indexing";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext, type AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import {
  addDaysToDateString,
  planRemovalOps,
  segmentCoversDate,
  summarizeRemovalOps,
  SEGMENT_SCAN_WINDOW_DAYS,
} from "../lib/todayPlan";
import { filterReadableTasks, loadTaskForRead, loadTaskForWrite } from "./access";
import { isClosedCategory } from "./model";
import {
  loadAssignedTo,
  loadCreatedBy,
  loadPerUser,
  toRowDTO,
  todayFor,
  type PerUserRowState,
  type TaskRowDTO,
} from "./read";

/**
 * My Tasks "Today" — the sun (docs/prd-tasks-refactor.md §5.6, D9, U8).
 *
 * A plan is a `planSegments` row (user × task × date range). The caller's
 * Today = their segments covering today; "Carried over" = their segments that
 * ended in the last 14 days on tasks that are still open and have no segment
 * today; "Done today" = their tasks whose `completedAt` falls on today in the
 * `completed` category (§11.3 — canceled does not count, `updatedAt` is never
 * read).
 *
 * Who a plan is for (D9): a member plans only their own day; an admin pressing
 * the sun plans for every assignee of the task. A task without assignees
 * cannot be planned (`NO_ASSIGNEE`). Planning someone else's day sends no
 * notification (§11.4) and writes no activity — the plan is not part of the
 * task's workflow record. The caller's own Today list (Keep, Remove, the
 * picker, reorder) always acts on the caller's own segments.
 *
 * Sub-tasks are planned with their parent: they never appear in Today and
 * cannot be planned. Archived and closed tasks cannot be planned either.
 * Planner board CRUD (`planner.ts`) is unchanged.
 */

/** How far back "Carried over" looks (§5.6). */
export const CARRIED_WINDOW_DAYS = 14;
/** Segment rows read for one user's plan around today (bounded, T7). */
export const PLAN_SEGMENT_CAP = 500;
/** Org segments read for the admin sun state (newest first). */
export const ORG_PLAN_SEGMENT_CAP = 2000;
/** Tasks completed in the org around today, read before the "mine" filter. */
export const DONE_TODAY_CAP = 300;
/** Tasks per bulk request. */
export const BULK_TODAY_MAX = 200;

/** Created-by rows read for the My Tasks "Created" tab count (any category, newest first). */
export const CREATED_COUNT_SCAN_CAP = 2000;

/** The typed error code for "the task has no assignee to plan for" (D9). */
export const NO_ASSIGNEE_CODE = "NO_ASSIGNEE";
export const NO_ASSIGNEE_MESSAGE = "Assign the task first: Today plans for the assignees";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const todayArg = v.optional(v.string()); // YYYY-MM-DD, client calendar
const timezoneArg = v.optional(v.string()); // IANA zone of the client

type Ctx = QueryCtx | MutationCtx;
type Segment = Doc<"planSegments">;

// ─── Pure plan math ─────────────────────────────────────────────────────────

export type TodayEntry = { taskId: Id<"tasks">; todaySortKey: string | null; createdAt: number };
export type CarriedEntry = { taskId: Id<"tasks">; plannedOn: string };

/**
 * Splits one user's segments into today's plan and the carried-over set.
 *
 * - Today: a segment covers `today`. Per task the smallest `todaySortKey`
 *   wins (fractional-indexing code-point order), otherwise arrival order
 *   (earliest covering segment) — new entries append at the bottom.
 * - Carried: no segment covers today, and the task's latest segment ended
 *   within `[today − 14, today − 1]`. `plannedOn` is that end date. Newest first.
 *
 * Task state (open/closed, archived, sub-task) is applied by the caller.
 */
export function partitionPlan(
  segments: readonly (Pick<Segment, "taskId" | "startDate" | "endDate" | "createdAt" | "todaySortKey"> & {
    _creationTime?: number;
  })[],
  today: string,
  windowDays: number = CARRIED_WINDOW_DAYS,
): { today: TodayEntry[]; carried: CarriedEntry[] } {
  const floor = addDaysToDateString(today, -windowDays);
  const todayByTask = new Map<Id<"tasks">, TodayEntry>();
  const lastEndByTask = new Map<Id<"tasks">, string>();
  for (const seg of segments) {
    if (segmentCoversDate(seg, today)) {
      const prev = todayByTask.get(seg.taskId);
      const key = seg.todaySortKey ?? null;
      todayByTask.set(seg.taskId, {
        taskId: seg.taskId,
        todaySortKey:
          prev?.todaySortKey != null && key != null
            ? (key < prev.todaySortKey ? key : prev.todaySortKey)
            : (prev?.todaySortKey ?? key),
        // `_creationTime` breaks same-millisecond ties (bulk adds).
        createdAt: Math.min(prev?.createdAt ?? Infinity, seg._creationTime ?? seg.createdAt),
      });
    } else if (seg.endDate < today) {
      const prev = lastEndByTask.get(seg.taskId);
      if (!prev || seg.endDate > prev) lastEndByTask.set(seg.taskId, seg.endDate);
    }
  }
  const todayEntries = [...todayByTask.values()].sort(compareTodayEntries);
  const carried: CarriedEntry[] = [];
  for (const [taskId, plannedOn] of lastEndByTask) {
    if (todayByTask.has(taskId) || plannedOn < floor) continue;
    carried.push({ taskId, plannedOn });
  }
  carried.sort((a, b) => (a.plannedOn === b.plannedOn ? 0 : a.plannedOn < b.plannedOn ? 1 : -1));
  return { today: todayEntries, carried };
}

function compareTodayEntries(a: TodayEntry, b: TodayEntry): number {
  if (a.todaySortKey !== null && b.todaySortKey !== null && a.todaySortKey !== b.todaySortKey) {
    return a.todaySortKey < b.todaySortKey ? -1 : 1;
  }
  // A keyed entry sits above an unkeyed one; otherwise arrival order.
  if (a.todaySortKey !== null && b.todaySortKey === null) return -1;
  if (a.todaySortKey === null && b.todaySortKey !== null) return 1;
  return a.createdAt - b.createdAt;
}

/**
 * Whose day the sun plans (D9): a member → their own; an admin → every
 * assignee. Empty when the task has no assignee (the caller rejects it).
 */
export function planTargets(
  auth: Pick<AuthContext, "userId" | "isAdmin">,
  assigneeIds: readonly Id<"users">[],
): Id<"users">[] {
  if (assigneeIds.length === 0) return [];
  return auth.isAdmin ? [...new Set(assigneeIds)] : [auth.userId];
}

/** Why a task cannot be planned, or null when it can. */
export function unplannableReason(task: Pick<Doc<"tasks">, "archivedAt" | "parentTaskId" | "statusCategory">): string | null {
  if (task.archivedAt) return "Archived tasks cannot be planned";
  if (task.parentTaskId) return "Sub-tasks are planned with their parent task";
  if (task.statusCategory && isClosedCategory(task.statusCategory)) return "Closed tasks cannot be planned";
  return null;
}

/** The ms window that can hold `today` in any timezone (UTC−12 … UTC+14). */
export function dayWindowMs(today: string): { from: number; to: number } {
  const [y, m, d] = today.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return { from: utcMidnight - 14 * 3_600_000, to: utcMidnight + 36 * 3_600_000 };
}

// ─── Context helpers ────────────────────────────────────────────────────────

function validTimezone(timezone: string | undefined): string | undefined {
  if (!timezone) return undefined;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

async function orgTimezone(ctx: Ctx, orgId: string): Promise<string> {
  const settings = await getOrgSettings(ctx, orgId);
  return settings?.timezone ?? ORG_TIMEZONE_FALLBACK;
}

/**
 * The date a mutation plans on: the client's calendar day when it is within a
 * day of the org's (time zones), else the org's. Keeps "today" honest without
 * letting a caller plan arbitrary dates through the sun.
 */
async function resolvePlanDay(ctx: MutationCtx, orgId: string, today: string | undefined): Promise<string> {
  const orgToday = getDateInTimezone(Date.now(), await orgTimezone(ctx, orgId));
  if (!today) return orgToday;
  if (!YMD.test(today)) throw new ConvexError("Invalid date");
  const near = [addDaysToDateString(orgToday, -1), orgToday, addDaysToDateString(orgToday, 1)];
  if (!near.includes(today)) throw new ConvexError("Invalid date");
  return today;
}

/** The user's segments that can cover or precede `today` (one index range, capped). */
async function loadUserSegments(ctx: Ctx, orgId: string, userId: Id<"users">, today: string): Promise<Segment[]> {
  return await ctx.db
    .query("planSegments")
    .withIndex("by_orgId_userId_startDate", (q) =>
      q
        .eq("orgId", orgId)
        .eq("userId", userId)
        .gte("startDate", addDaysToDateString(today, -SEGMENT_SCAN_WINDOW_DAYS))
        .lte("startDate", today),
    )
    .order("desc")
    .take(PLAN_SEGMENT_CAP);
}

async function taskSegments(ctx: Ctx, orgId: string, taskId: Id<"tasks">): Promise<Segment[]> {
  return await ctx.db
    .query("planSegments")
    .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", taskId))
    .take(PLAN_SEGMENT_CAP);
}

/** Assignees from the edge table (source of truth, D1). */
async function assigneesOf(ctx: Ctx, taskId: Id<"tasks">, orgId: string): Promise<Id<"users">[]> {
  const edges = await ctx.db
    .query("taskAssignees")
    .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId))
    .take(100);
  return edges.filter((e) => e.orgId === orgId).map((e) => e.userId);
}

/** Inserts a one-day segment for `userId` unless one of theirs already covers `day`. */
async function planDay(
  ctx: MutationCtx,
  input: { orgId: string; taskId: Id<"tasks">; userId: Id<"users">; day: string; createdBy: Id<"users"> },
  existing: readonly Segment[],
): Promise<boolean> {
  if (existing.some((s) => s.userId === input.userId && segmentCoversDate(s, input.day))) return false;
  const now = Date.now();
  await ctx.db.insert("planSegments", {
    orgId: input.orgId,
    taskId: input.taskId,
    userId: input.userId,
    startDate: input.day,
    endDate: input.day,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  });
  return true;
}

/** Takes `day` out of `userId`'s plan of a task (single-day delete, trim or split). */
async function unplanDay(
  ctx: MutationCtx,
  segments: readonly Segment[],
  userId: Id<"users">,
  day: string,
): Promise<ReturnType<typeof summarizeRemovalOps>> {
  const covering = segments.filter((s) => s.userId === userId && segmentCoversDate(s, day));
  const ops = planRemovalOps(covering, day);
  const byId = new Map(covering.map((s) => [s._id as string, s]));
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
      const source = byId.get(op.fromSegmentId)!;
      // The split remainder keeps the source's lane so the Planner row does not reshuffle.
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
  return summarizeRemovalOps(ops);
}

// ─── Queries ────────────────────────────────────────────────────────────────

export type TodayListResult = {
  date: string;
  rows: TaskRowDTO[];
  /** Today's plan in the user's order; `todaySortKey` is the effective key (reorder neighbours). */
  today: { taskId: Id<"tasks">; todaySortKey: string | null }[];
  carried: CarriedEntry[];
  /** Completed today, most recent first. */
  doneToday: Id<"tasks">[];
  perUser: Record<Id<"tasks">, PerUserRowState>;
  /** A plan or done-today read hit its cap. */
  truncated: boolean;
};

/** Open, readable, top-level tasks of the caller's plan, split into today and carried. */
async function loadMyPlan(ctx: Ctx, auth: AuthContext, today: string) {
  const segments = await loadUserSegments(ctx, auth.orgId, auth.userId, today);
  const plan = partitionPlan(segments, today);
  const ids = [...new Set([...plan.today.map((e) => e.taskId), ...plan.carried.map((e) => e.taskId)])];
  const docs = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter(
    (t): t is Doc<"tasks"> => t !== null && unplannableReason(t) === null,
  );
  const readable = await filterReadableTasks(ctx, auth, docs);
  const byId = new Map(readable.map((t) => [t._id, t]));
  return {
    segments,
    tasksById: byId,
    today: plan.today.filter((e) => byId.has(e.taskId)),
    carried: plan.carried.filter((e) => byId.has(e.taskId)),
    truncated: segments.length >= PLAN_SEGMENT_CAP,
  };
}

/**
 * The caller's Today tab: today's plan (manual order), carried over, and done
 * today. Rows are the same flat DTOs as `listView`, so the client renders
 * them with the shared row.
 */
export const listToday = query({
  args: { today: todayArg, timezone: timezoneArg },
  handler: async (ctx, args): Promise<TodayListResult> => {
    const auth = await getAuthContext(ctx);
    const today = await todayFor(ctx, auth.orgId, args.today && YMD.test(args.today) ? args.today : undefined);
    const plan = await loadMyPlan(ctx, auth, today);

    // Done today: the org's tasks completed around today (one index range),
    // kept when completed (not canceled) on the caller's calendar day and
    // the caller's — assigned to them, or planned by them today.
    const timezone = validTimezone(args.timezone) ?? (await orgTimezone(ctx, auth.orgId));
    const window = dayWindowMs(today);
    const recentlyClosed = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_completedAt", (q) =>
        q.eq("orgId", auth.orgId).gte("completedAt", window.from).lt("completedAt", window.to),
      )
      .order("desc")
      .take(DONE_TODAY_CAP + 1);
    const plannedToday = new Set(
      plan.segments.filter((s) => segmentCoversDate(s, today)).map((s) => s.taskId),
    );
    const doneCandidates: Doc<"tasks">[] = [];
    for (const task of recentlyClosed.slice(0, DONE_TODAY_CAP)) {
      if (task.statusCategory !== "completed" || task.archivedAt || task.parentTaskId || !task.completedAt) continue;
      if (getDateInTimezone(task.completedAt, timezone) !== today) continue;
      const mine =
        plannedToday.has(task._id) ||
        (await ctx.db
          .query("taskAssignees")
          .withIndex("by_taskId_userId", (q) => q.eq("taskId", task._id).eq("userId", auth.userId))
          .first()) !== null;
      if (mine) doneCandidates.push(task);
    }
    const done = await filterReadableTasks(ctx, auth, doneCandidates);

    const rowsById = new Map<Id<"tasks">, Doc<"tasks">>(plan.tasksById);
    for (const t of done) rowsById.set(t._id, t);
    const rows = [...rowsById.values()];
    return {
      date: today,
      rows: rows.map(toRowDTO),
      today: plan.today.map((e) => ({ taskId: e.taskId, todaySortKey: e.todaySortKey })),
      carried: plan.carried,
      doneToday: done.map((t) => t._id),
      perUser: await loadPerUser(ctx, auth.orgId, auth.userId, rows.map((t) => t._id), today),
      truncated: plan.truncated || recentlyClosed.length > DONE_TODAY_CAP,
    };
  },
});

/** Sidebar My Tasks badge (§5.4): the caller's open tasks planned for today. */
export const badgeCount = query({
  args: { today: todayArg },
  handler: async (ctx, args): Promise<number> => {
    const auth = await getAuthContext(ctx);
    const today = await todayFor(ctx, auth.orgId, args.today && YMD.test(args.today) ? args.today : undefined);
    return (await loadMyPlan(ctx, auth, today)).today.length;
  },
});

/** One My Tasks tab count; `truncated` = the bounded read hit its cap (show "N+"). */
export type TabCount = { count: number; truncated: boolean };

/** Open, top-level, not archived — what the Assigned / Created tab counts (§11.11). */
function isOpenTopLevel(task: Doc<"tasks">): boolean {
  if (task.archivedAt !== undefined || task.parentTaskId !== undefined) return false;
  return task.statusCategory === undefined || !isClosedCategory(task.statusCategory);
}

/**
 * My Tasks tab counts (§11.11): Today = the caller's open plan for today (the
 * sidebar badge); Assigned = open top-level tasks assigned to the caller (the
 * Assigned view's scope); Created = open top-level tasks the caller created
 * and can read. Closed tasks are not counted (the tab shows open work).
 * Bounded (T7): the caller's edges, the newest created rows and today's plan
 * segments, each with its cap.
 */
export const tabCounts = query({
  args: { today: todayArg },
  handler: async (ctx, args): Promise<{ today: TabCount; assigned: TabCount; created: TabCount }> => {
    const auth = await getAuthContext(ctx);
    const today = await todayFor(ctx, auth.orgId, args.today && YMD.test(args.today) ? args.today : undefined);
    const plan = await loadMyPlan(ctx, auth, today);
    const assigned = await loadAssignedTo(ctx, auth.orgId, auth.userId);
    const created = await loadCreatedBy(ctx, auth.orgId, auth.userId, CREATED_COUNT_SCAN_CAP);
    const createdOpen = await filterReadableTasks(ctx, auth, created.tasks.filter(isOpenTopLevel));
    return {
      today: { count: plan.today.length, truncated: plan.truncated },
      assigned: { count: assigned.tasks.filter(isOpenTopLevel).length, truncated: assigned.truncated },
      created: { count: createdOpen.length, truncated: created.truncated },
    };
  },
});

/**
 * Who has each task planned today — the sun state on lists. An admin's sun
 * plans for every assignee (D9), so admins get the org's plans for today; a
 * member gets their own. Bounded: newest segments first, capped.
 */
export const plannedToday = query({
  args: { today: todayArg },
  handler: async (ctx, args): Promise<Record<Id<"tasks">, Id<"users">[]>> => {
    const auth = await getAuthContext(ctx);
    const today = await todayFor(ctx, auth.orgId, args.today && YMD.test(args.today) ? args.today : undefined);
    const from = addDaysToDateString(today, -SEGMENT_SCAN_WINDOW_DAYS);
    const segments = auth.isAdmin
      ? await ctx.db
          .query("planSegments")
          .withIndex("by_orgId_startDate", (q) =>
            q.eq("orgId", auth.orgId).gte("startDate", from).lte("startDate", today),
          )
          .order("desc")
          .take(ORG_PLAN_SEGMENT_CAP)
      : await loadUserSegments(ctx, auth.orgId, auth.userId, today);
    const out: Record<Id<"tasks">, Id<"users">[]> = {};
    for (const s of segments) {
      if (!segmentCoversDate(s, today)) continue;
      const users = (out[s.taskId] ??= []);
      if (!users.includes(s.userId)) users.push(s.userId);
    }
    return out;
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

export type AddToTodayResult = {
  /** Users whose day gained the task. */
  added: Id<"users">[];
  /** Users who already had it today (idempotent). */
  alreadyPlanned: Id<"users">[];
};

async function addForTargets(
  ctx: MutationCtx,
  auth: AuthContext,
  task: Doc<"tasks">,
  day: string,
): Promise<AddToTodayResult> {
  const targets = planTargets(auth, await assigneesOf(ctx, task._id, auth.orgId));
  if (targets.length === 0) throw new ConvexError({ code: NO_ASSIGNEE_CODE, message: NO_ASSIGNEE_MESSAGE });
  const existing = await taskSegments(ctx, auth.orgId, task._id);
  const result: AddToTodayResult = { added: [], alreadyPlanned: [] };
  for (const userId of targets) {
    const created = await planDay(ctx, { orgId: auth.orgId, taskId: task._id, userId, day, createdBy: auth.userId }, existing);
    (created ? result.added : result.alreadyPlanned).push(userId);
  }
  return result;
}

/**
 * The sun (D9): plans the task today for its assignees — the caller only when
 * they are a member. Idempotent per (user, task, day). No assignee →
 * `{ code: "NO_ASSIGNEE" }`.
 */
export const addToToday = mutation({
  args: { taskId: v.id("tasks"), today: todayArg },
  handler: async (ctx, args): Promise<AddToTodayResult> => {
    const auth = await getAuthContext(ctx);
    const { task } = await loadTaskForWrite(ctx, args.taskId, auth);
    const reason = unplannableReason(task);
    if (reason) throw new ConvexError(reason);
    return await addForTargets(ctx, auth, task, await resolvePlanDay(ctx, auth.orgId, args.today));
  },
});

/**
 * The selection bar's "Add to today": the sun on every selected task. Tasks
 * without an assignee are skipped (`skippedNoAssignee`), as are ones that
 * cannot be planned or read (`skipped`). `added` counts tasks that are now in
 * at least one more day, `alreadyPlanned` tasks every target already had.
 */
export const bulkAddToToday = mutation({
  args: { taskIds: v.array(v.id("tasks")), today: todayArg },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    if (args.taskIds.length > BULK_TODAY_MAX) throw new ConvexError(`At most ${BULK_TODAY_MAX} tasks at once`);
    const day = await resolvePlanDay(ctx, auth.orgId, args.today);
    let added = 0;
    let alreadyPlanned = 0;
    let skippedNoAssignee = 0;
    let skipped = 0;
    for (const taskId of new Set(args.taskIds)) {
      const task = await ctx.db.get(taskId);
      if (!task || unplannableReason(task) || (await filterReadableTasks(ctx, auth, [task])).length === 0) {
        skipped++;
        continue;
      }
      if (planTargets(auth, await assigneesOf(ctx, taskId, auth.orgId)).length === 0) {
        skippedNoAssignee++;
        continue;
      }
      const result = await addForTargets(ctx, auth, task, day);
      if (result.added.length > 0) added++;
      else alreadyPlanned++;
    }
    return { added, alreadyPlanned, skippedNoAssignee, skipped };
  },
});

/**
 * Takes the task out of today. `mine` (the caller's own Today list) removes
 * it from the caller's day only; otherwise the same targets as the sun (D9),
 * plus the caller's own plan. Multi-day Planner bars keep their other days.
 */
export const removeFromToday = mutation({
  args: { taskId: v.id("tasks"), mine: v.optional(v.boolean()), today: todayArg },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const { task } = await loadTaskForWrite(ctx, args.taskId, auth);
    const day = await resolvePlanDay(ctx, auth.orgId, args.today);
    const targets = new Set<Id<"users">>([auth.userId]);
    if (!args.mine) for (const id of planTargets(auth, await assigneesOf(ctx, task._id, auth.orgId))) targets.add(id);
    const segments = await taskSegments(ctx, auth.orgId, task._id);
    const kinds: NonNullable<ReturnType<typeof summarizeRemovalOps>>[] = [];
    for (const userId of targets) {
      const kind = await unplanDay(ctx, segments, userId, day);
      if (kind) kinds.push(kind);
    }
    const kind = kinds.includes("split") ? "split" : kinds.includes("trimmed") ? "trimmed" : kinds[0] ?? null;
    return { removed: kinds.length, kind };
  },
});

/**
 * Plans tasks for the caller's own day: "Keep for today" and "Keep all" on
 * carried-over rows, and the "Add tasks to today" picker. The caller must be
 * an assignee of the task, or have planned it before (a carried row).
 */
export const keepCarried = mutation({
  args: { taskIds: v.array(v.id("tasks")), today: todayArg },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    if (args.taskIds.length > BULK_TODAY_MAX) throw new ConvexError(`At most ${BULK_TODAY_MAX} tasks at once`);
    const day = await resolvePlanDay(ctx, auth.orgId, args.today);
    let added = 0;
    let skipped = 0;
    for (const taskId of new Set(args.taskIds)) {
      const task = await ctx.db.get(taskId);
      if (!task || unplannableReason(task) || (await filterReadableTasks(ctx, auth, [task])).length === 0) {
        skipped++;
        continue;
      }
      const segments = await taskSegments(ctx, auth.orgId, taskId);
      const isAssignee = (await assigneesOf(ctx, taskId, auth.orgId)).includes(auth.userId);
      const plannedBefore = segments.some((s) => s.userId === auth.userId);
      if (!isAssignee && !plannedBefore) {
        skipped++;
        continue;
      }
      if (await planDay(ctx, { orgId: auth.orgId, taskId, userId: auth.userId, day, createdBy: auth.userId }, segments)) {
        added++;
      }
    }
    return { added, skipped };
  },
});

/**
 * "Remove" on a carried-over row: deletes the caller's stale segments of the
 * task (ended in the carried window, before today). Segments covering today
 * or later, and older history, stay.
 */
export const removeCarried = mutation({
  args: { taskId: v.id("tasks"), today: todayArg },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    await loadTaskForRead(ctx, args.taskId, auth);
    const day = await resolvePlanDay(ctx, auth.orgId, args.today);
    const floor = addDaysToDateString(day, -CARRIED_WINDOW_DAYS);
    const stale = (await taskSegments(ctx, auth.orgId, args.taskId)).filter(
      (s) => s.userId === auth.userId && s.endDate < day && s.endDate >= floor,
    );
    for (const s of stale) await ctx.db.delete(s._id);
    return { removed: stale.length };
  },
});

/**
 * Manual order of the caller's Today list: `taskIds` is the list in its new
 * order. Writes fresh `todaySortKey`s onto the caller's segments covering
 * today, so rows that arrived without a key (new plans append at the bottom)
 * get one too. Ids not in the caller's today are ignored.
 */
export const reorderToday = mutation({
  args: { taskIds: v.array(v.id("tasks")), today: todayArg },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    if (args.taskIds.length > BULK_TODAY_MAX) throw new ConvexError(`At most ${BULK_TODAY_MAX} tasks at once`);
    const day = await resolvePlanDay(ctx, auth.orgId, args.today);
    const covering = (await loadUserSegments(ctx, auth.orgId, auth.userId, day)).filter((s) =>
      segmentCoversDate(s, day),
    );
    const byTask = new Map<Id<"tasks">, Segment[]>();
    for (const s of covering) byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s]);
    const ordered = [...new Set(args.taskIds)].filter((id) => byTask.has(id));
    if (ordered.length === 0) throw new ConvexError("Task is not in your today plan");
    const keys = generateNKeysBetween(null, null, ordered.length);
    const now = Date.now();
    for (const [i, taskId] of ordered.entries()) {
      for (const seg of byTask.get(taskId)!) await ctx.db.patch(seg._id, { todaySortKey: keys[i], updatedAt: now });
    }
    return { ordered: ordered.length };
  },
});
