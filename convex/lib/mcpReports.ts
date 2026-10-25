import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { assertValidDateString } from "./dateValidation";
import { getOrgSettings, getProjectCurrency } from "./orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./timer";
import { referenceClientPrefix } from "./helpers";
import { addDaysToDateString } from "./todayPlan";
import { REPORT_RANGE_DAYS_MAX, isValidMonthKey, lastDayOfMonth } from "./reportCore";
import { buildTimesheetTable, formatTimesheetPeriodLabel } from "./timesheetPivot";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { projectSummary, richTextMarkdown, userNames } from "./mcpRecords";
import {
  MAX_REPORT_ENTRIES,
  clientMonthlySummaryForAuth,
  orgFinanceSnapshotForAuth,
  retainerHealthForMonthForAuth,
  timeByMemberForAuth,
} from "../reports";
import { collectTimesheetDataForAuth } from "../timesheets";
import { projectMonthlyBreakdownForAuth, projectOverviewForAuth } from "../timeEntries";
import { getMonthlyReportForAuth } from "../billingReports";
import { getNeedsActionForAuth } from "../billingViews";
import { PERIOD_STATE_COPY } from "./billing/periodState";
import { daysPastDue } from "./mcpRefs";
import { getInvoiceMetricsForAuth } from "../invoices";
import { isClosedCategory } from "../tasks/model";
import { loadAssignedTo } from "../tasks/read";
import { REF_CAP } from "../workspaceRefs";
import { capText } from "../../lib/mcp/tiptap-markdown";
import { type ReportKind } from "../../lib/mcp/limits";
import { tzWallToEpoch } from "../../lib/workday";
import {
  flattenInvoiceMetrics,
  flattenMonthlyBreakdown,
  flattenProjectOverview,
  flattenRetainerStatement,
} from "../../lib/reports/views";

/**
 * MCP `report` kinds (docs/prd-mcp.md §8) for an already-authorized caller.
 * Each kind resolves its references in the caller's org (I3), applies the
 * app's role rules and runs the SAME core the app's screen or internal query
 * runs (`*ForAuth`), then returns compact rows; the route renders the table
 * (D1: every number, subtotal and count is computed here, by code, never by
 * the model).
 *
 * Role rules, exactly as the app:
 * - members: `time_by_member` (their own time only, like Workday) and
 *   `missing_time` (tasks assigned to them). Neither carries money.
 * - every other kind is admin-only: its screen is an admin route (projects,
 *   clients, billing, invoices) or its core is admin-gated.
 * Money is never summed across currencies: every amount carries its currency
 * and every total is per currency (the cores already partition).
 *
 * Read budget (Convex: 4,096 index ranges and 32,000 documents per call).
 * The cores read what the app reads for the same screen, and that is NOT
 * bounded by this layer: timesheet, client_monthly and the project kinds read
 * every entry of each project involved, all time (`getProjectEntries`, like
 * the project page and the worksheet export), so a project past Convex's
 * per-call limits fails here as it does in the app. On top of the cores:
 * - timesheet: in-range entries ≤ MAX_REPORT_ENTRIES and tasks ≤
 *   TIMESHEET_TASK_CAP (refused before any per-task read); one read per
 *   task inside the collector and one per distinct project for codes;
 * - client_monthly: tasks ≤ CLIENT_TASK_CAP; per task the task, its parent
 *   (sub-tasks) and one comment range of ≤ CLOSING_COMMENT_SCAN documents,
 *   plus two reads per distinct mentioned user;
 * - time_by_member: up to 5 members read their own entries (`by_userId_date`),
 *   more scan the org's range; both ≤ MAX_REPORT_ENTRIES;
 * - missing_time: see `missingTimeReport` for its worst case.
 * A scan over its cap throws a model-actionable error; nothing is ever
 * returned clipped.
 */

export const TIMESHEET_TASK_CAP = 1000;
/** Tasks per client_monthly report: the task table at ~150 characters a row stays well inside one result. */
export const CLIENT_TASK_CAP = 300;
/** Characters of a task's closing comment in client_monthly (as the changes feed, D29). */
export const CLOSING_COMMENT_MAX = 500;
/** Newest comments read per task when looking for its closing comment. */
export const CLOSING_COMMENT_SCAN = 20;
/** missing_time: tasks closed in the period's window (one range). */
export const MISSING_CLOSED_CAP = 400;
/** missing_time: tasks currently in the requested non-closed statuses, in all. */
export const MISSING_OPEN_CAP = 100;
/** missing_time fallback: one person's assignment edges. */
export const MISSING_ASSIGNED_CAP = 1000;
/** missing_time: sub-tasks checked per parent for logged time. */
export const MISSING_SUBTASK_SCAN = 20;
/** missing_time: activity rows read (newest first, then older) to date a status change. */
export const STATUS_SCAN_FIRST = 20;
export const STATUS_SCAN_MORE = 80;
/** Statuses and work categories read per org; more refuses instead of dropping some. */
export const ORG_LIST_CAP = 500;

/** Members get exactly the app's surfaces: admin screens refuse with what they can run instead. */
function requireAdminReport(auth: AuthContext, kind: ReportKind): void {
  if (auth.isAdmin) return;
  throw new ConvexError(
    `The ${kind} report is admin-only, as in the app. Members can run time_by_member (your own time) and missing_time (your tasks).`,
  );
}

/** A YYYY-MM-DD range of at most REPORT_RANGE_DAYS_MAX days. */
export function assertReportRange(from: string, to: string): void {
  assertValidDateString(from, "from");
  assertValidDateString(to, "to");
  if (to < from) throw new ConvexError("to must not be before from.");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > REPORT_RANGE_DAYS_MAX) {
    throw new ConvexError(
      `The period is ${days} days; reports cover at most ${REPORT_RANGE_DAYS_MAX} days per call. Split it and run the report per part.`,
    );
  }
}

function assertMonth(month: string, name: string): void {
  if (!isValidMonthKey(month)) throw new ConvexError(`${name} must be a month in YYYY-MM format, e.g. 2026-06.`);
}

async function resolveClient(resolver: RefResolver, ref: string): Promise<Doc<"clients">> {
  const resolved = await resolver.require(ref, "client");
  if (resolved.type !== "client") throw new Error(`Expected a client, resolved a ${resolved.type}`);
  return resolved.client;
}

async function resolveProject(resolver: RefResolver, ref: string): Promise<Doc<"projects">> {
  const resolved = await resolver.require(ref, "project");
  if (resolved.type !== "project") throw new Error(`Expected a project, resolved a ${resolved.type}`);
  return resolved.project;
}

async function resolveMember(resolver: RefResolver, ref: string): Promise<Doc<"users">> {
  const resolved = await resolver.require(ref, "member");
  if (resolved.type !== "member") throw new Error(`Expected a member, resolved a ${resolved.type}`);
  return resolved.user;
}

function clientInfo(client: Doc<"clients">) {
  return { id: client._id, name: client.name, prefix: referenceClientPrefix(client), currency: client.currency };
}

function projectInfo(project: Doc<"projects">) {
  return { id: project._id, code: project.code, name: project.name, billingType: project.billingType };
}

/** Tasks by id, memoized; foreign or missing tasks read as null. */
function taskLookup(ctx: QueryCtx, orgId: string) {
  const cache = new Map<string, Doc<"tasks"> | null>();
  return async (taskId: string): Promise<Doc<"tasks"> | null> => {
    if (cache.has(taskId)) return cache.get(taskId)!;
    const id = ctx.db.normalizeId("tasks", taskId);
    const task = id ? await ctx.db.get(id) : null;
    const owned = task && task.orgId === orgId ? task : null;
    cache.set(taskId, owned);
    return owned;
  };
}

/** Project codes by id (one read each, memoized); null when missing or foreign. */
function projectCodes(ctx: QueryCtx, orgId: string) {
  const cache = new Map<string, string | null>();
  return async (projectId: string | null): Promise<string | null> => {
    if (projectId === null) return null;
    if (cache.has(projectId)) return cache.get(projectId)!;
    const id = ctx.db.normalizeId("projects", projectId);
    const project = id ? await ctx.db.get(id) : null;
    const code = project && project.orgId === orgId ? project.code : null;
    cache.set(projectId, code);
    return code;
  };
}

/** The org's statuses by id (one range); more than ORG_LIST_CAP refuses rather than dropping some. */
async function statusMap(ctx: QueryCtx, orgId: string): Promise<Map<Id<"statuses">, Doc<"statuses">>> {
  const rows = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(ORG_LIST_CAP + 1);
  if (rows.length > ORG_LIST_CAP) {
    throw new ConvexError(`This workspace has more than ${ORG_LIST_CAP} statuses, more than a report reads in one call.`);
  }
  return new Map(rows.map((s) => [s._id, s]));
}

/** First instant after `date` (YYYY-MM-DD) in `timezone`, epoch ms. */
function endOfDayMs(date: string, timezone: string): number {
  const [y, m, d] = addDaysToDateString(date, 1).split("-").map(Number);
  return tzWallToEpoch(y, m, d, 0, 0, 0, timezone);
}

async function orgTimezone(ctx: QueryCtx, orgId: string): Promise<string> {
  return (await getOrgSettings(ctx, orgId))?.timezone ?? ORG_TIMEZONE_FALLBACK;
}

// ─── timesheet ───────────────────────────────────────────────────────────────

/**
 * Per-task time of a client (optionally one of its projects) in a date
 * range: the worksheet collector the app's exports run, per project, plus the
 * timesheet pivot's category totals and per-project subtotals. Admin-only
 * (worksheets are).
 */
export async function timesheetReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { client: string; from: string; to: string; project?: string },
) {
  requireAdminReport(auth, "timesheet");
  assertReportRange(args.from, args.to);
  const resolver = createRefResolver(ctx, auth);
  const client = await resolveClient(resolver, args.client);
  const project = args.project !== undefined ? await resolveProject(resolver, args.project) : null;
  if (project && project.clientId !== client._id) {
    throw new ConvexError(`${project.code} is not a project of ${args.client}. Drop project, or use one of the client's project codes.`);
  }

  const data = await collectTimesheetDataForAuth(
    ctx,
    auth,
    {
      clientId: client._id,
      periodStart: args.from,
      periodEnd: args.to,
      projectIds: project ? [project._id] : undefined,
    },
    {
      aiInput: false,
      caps: {
        entries: MAX_REPORT_ENTRIES,
        tasks: TIMESHEET_TASK_CAP,
        message: `The period has more than ${MAX_REPORT_ENTRIES} time entries or ${TIMESHEET_TASK_CAP} tasks for this client. Narrow the period (e.g. one month) or add project.`,
      },
    },
  );

  // The pivot's category totals and order: the same numbers the timesheet table sums.
  const pivot = buildTimesheetTable({ title: "", rows: data.rows, categoryOrder: data.categoryOrder });
  const categories = pivot.columns
    .filter((c) => c.key.startsWith("cat:"))
    .map((c) => ({ name: c.label, minutes: Number(pivot.totals?.[c.key] ?? 0) }));

  // The pivot's row order: project, first worked, title.
  const sorted = [...data.rows].sort((a, b) =>
    a.projectName !== b.projectName
      ? a.projectName.localeCompare(b.projectName)
      : a.firstWorked !== b.firstWorked
        ? (a.firstWorked < b.firstWorked ? -1 : 1)
        : a.title.localeCompare(b.title),
  );
  const codes = projectCodes(ctx, auth.orgId);
  const rows = [];
  const projects = new Map<string, { code: string; name: string; minutes: number; billableMinutes: number; nonBillableMinutes: number; entryCount: number }>();
  for (const r of sorted) {
    const code = (await codes(r.projectId)) ?? r.projectName;
    rows.push({
      identifier: r.identifier,
      title: r.title,
      project: code,
      category: r.categoryName,
      firstWorked: r.firstWorked,
      lastWorked: r.lastWorked,
      minutes: r.totalMinutes,
      billableMinutes: r.billableMinutes,
      nonBillableMinutes: r.nonBillableMinutes,
      entryCount: r.entryCount,
    });
    const subtotal = projects.get(r.projectId) ?? { code, name: r.projectName, minutes: 0, billableMinutes: 0, nonBillableMinutes: 0, entryCount: 0 };
    subtotal.minutes += r.totalMinutes;
    subtotal.billableMinutes += r.billableMinutes;
    subtotal.nonBillableMinutes += r.nonBillableMinutes;
    subtotal.entryCount += r.entryCount;
    projects.set(r.projectId, subtotal);
  }
  return {
    client: clientInfo(client),
    project: project ? projectInfo(project) : null,
    from: args.from,
    to: args.to,
    periodLabel: formatTimesheetPeriodLabel({ startDate: args.from, endDate: args.to }),
    rows,
    /** Per-project subtotals in row order (D1: the table's subtotal rows). */
    projects: [...projects.values()],
    categories,
    totals: {
      minutes: Number(pivot.totals?.total ?? 0),
      billableMinutes: rows.reduce((s, r) => s + r.billableMinutes, 0),
      nonBillableMinutes: rows.reduce((s, r) => s + r.nonBillableMinutes, 0),
      entryCount: rows.reduce((s, r) => s + r.entryCount, 0),
    },
  };
}

// ─── time_by_member ──────────────────────────────────────────────────────────

/**
 * Time per member and project in a date range (`timeByMemberForAuth`). Admins
 * get the whole team, or one member; members get exactly their own time, as
 * on Workday. Minutes only: no rates or amounts for anyone. Project rows
 * carry their code (and, for admins, their id for the link).
 */
export async function timeByMemberReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { from: string; to: string; member?: string },
) {
  assertReportRange(args.from, args.to);
  const resolver = createRefResolver(ctx, auth);
  const member = args.member !== undefined ? await resolveMember(resolver, args.member) : null;
  if (!auth.isAdmin && member && member._id !== auth.userId) {
    throw new ConvexError(
      'Members can only report their own time, as in the app. Use member "me" or leave member out.',
    );
  }
  const scope: "self" | "member" | "team" = !auth.isAdmin ? "self" : member ? "member" : "team";
  const data = await timeByMemberForAuth(ctx, auth, {
    fromDate: args.from,
    toDate: args.to,
    userIds: auth.isAdmin && member ? [member._id] : undefined,
    allMembers: auth.isAdmin && !member,
  });
  const codes = projectCodes(ctx, auth.orgId);
  const members = [];
  for (const m of data.members) {
    const id = ctx.db.normalizeId("users", m.userId);
    const user = id ? await ctx.db.get(id) : null;
    const projects = [];
    for (const p of m.byProject) {
      projects.push({
        // Project pages are admin routes: members get the code, not the link.
        id: auth.isAdmin ? p.projectId : null,
        code: await codes(p.projectId),
        name: p.projectName,
        client: p.clientName,
        minutes: p.minutes,
        billableMinutes: p.billableMinutes,
        nonBillableMinutes: p.minutes - p.billableMinutes,
      });
    }
    members.push({
      name: m.userName,
      email: user?.email ?? null,
      minutes: m.minutes,
      billableMinutes: m.billableMinutes,
      nonBillableMinutes: m.nonBillableMinutes,
      entryCount: m.entryCount,
      projects,
    });
  }
  return { from: args.from, to: args.to, scope, members, totals: data.totals };
}

// ─── client_monthly ──────────────────────────────────────────────────────────

/**
 * A client's months (`clientMonthlySummaryForAuth`, optionally one of its
 * projects) with per-project subtotals, plus, per task worked in the range,
 * the raw material for a client summary (D25): key (and its parent's for a
 * sub-task), title, status, completion date, minutes, its time-entry notes
 * (non-billable ones marked) and its closing comment — the newest comment
 * written by a person (not through MCP) up to the end of the period, capped
 * at CLOSING_COMMENT_MAX. The server never summarizes. Admin-only.
 */
export async function clientMonthlyReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { client: string; fromMonth: string; toMonth: string; project?: string },
) {
  requireAdminReport(auth, "client_monthly");
  assertMonth(args.fromMonth, "from_month");
  assertMonth(args.toMonth, "to_month");
  const resolver = createRefResolver(ctx, auth);
  const client = await resolveClient(resolver, args.client);
  const project = args.project !== undefined ? await resolveProject(resolver, args.project) : null;
  if (project && project.clientId !== client._id) {
    throw new ConvexError(`${project.code} is not a project of ${args.client}. Drop project, or use one of the client's project codes.`);
  }
  const data = await clientMonthlySummaryForAuth(
    ctx,
    auth,
    { clientId: client._id, fromMonth: args.fromMonth, toMonth: args.toMonth },
    { tasks: true, projectId: project?._id },
  );
  const rollups = data.tasks ?? [];
  if (rollups.length > CLIENT_TASK_CAP) {
    throw new ConvexError(
      `${rollups.length} tasks were worked in the range, more than one report lists (${CLIENT_TASK_CAP}). Run it per project (project) or for fewer months.`,
    );
  }

  const timezone = await orgTimezone(ctx, auth.orgId);
  const periodEnd = endOfDayMs(lastDayOfMonth(data.toMonth), timezone);
  const task = taskLookup(ctx, auth.orgId);
  const codes = projectCodes(ctx, auth.orgId);
  const statuses = await statusMap(ctx, auth.orgId);
  const name = userNames(ctx);
  const markdown = richTextMarkdown(ctx, auth.orgId);
  const tasks = [];
  for (const r of rollups) {
    const doc = await task(r.taskId);
    const parent = doc?.parentTaskId ? await task(doc.parentTaskId) : null;
    const recent = doc
      ? await ctx.db
          .query("comments")
          .withIndex("by_task", (q) => q.eq("taskId", doc._id).lt("createdAt", periodEnd))
          .order("desc")
          .take(CLOSING_COMMENT_SCAN)
      : [];
    const closing = recent.find((c) => c.orgId === auth.orgId && c.via === undefined) ?? null;
    const comment = closing ? capText(await markdown.content(closing.content), CLOSING_COMMENT_MAX) : null;
    const status = doc ? statuses.get(doc.statusId) : undefined;
    tasks.push({
      identifier: doc?.identifier ?? null,
      parent: parent?.identifier ?? null,
      title: doc?.title ?? "Deleted task",
      status: status?.name ?? null,
      statusCategory: doc?.statusCategory ?? null,
      completedOn:
        doc?.statusCategory === "completed" && doc.completedAt !== undefined
          ? getDateInTimezone(doc.completedAt, timezone)
          : null,
      archived: doc?.archivedAt !== undefined,
      project: (await codes(r.projectId)) ?? r.projectName,
      minutes: r.minutes,
      billableMinutes: r.billableMinutes,
      nonBillableMinutes: r.nonBillableMinutes,
      entryCount: r.entryCount,
      notes: r.notes,
      closingComment:
        closing && comment
          ? { author: await name(closing.userId), createdAt: closing.createdAt, text: comment.text, truncated: comment.truncated }
          : null,
    });
  }
  const months = [];
  for (const m of data.months) {
    const byProject = [];
    for (const p of m.byProject) byProject.push({ code: await codes(p.projectId), name: p.projectName, minutes: p.minutes });
    months.push({
      month: m.month,
      minutes: m.minutes,
      billableMinutes: m.billableMinutes,
      nonBillableMinutes: m.nonBillableMinutes,
      billableAmount: m.billableAmount,
      entryCount: m.entryCount,
      byProject,
    });
  }
  return {
    client: clientInfo(client),
    project: project ? projectInfo(project) : null,
    fromMonth: data.fromMonth,
    toMonth: data.toMonth,
    timezone,
    months,
    totals: data.totals,
    tasks,
  };
}

// ─── missing_time ────────────────────────────────────────────────────────────

type MissingTimeStatus = { id: Id<"statuses">; name: string; category: Doc<"statuses">["category"] };

/**
 * The statuses a missing_time report covers: the names given (matched to the
 * org's statuses, case-insensitively; an unknown name is an error listing the
 * valid ones), or by default every completed-category status (owner decision
 * D-MISSING, 2026-10-25). Names are never guessed.
 */
function resolveStatuses(all: ReadonlyMap<Id<"statuses">, Doc<"statuses">>, names: readonly string[] | undefined): MissingTimeStatus[] {
  const statuses = [...all.values()];
  const picked =
    names === undefined
      ? statuses.filter((s) => s.category === "completed")
      : names.flatMap((raw) => {
          const key = raw.trim().toLowerCase();
          const match = statuses.filter((s) => s.name.trim().toLowerCase() === key);
          if (match.length === 0) {
            const valid = statuses.filter((s) => s.archivedAt === undefined).map((s) => s.name);
            throw new ConvexError(`Unknown status "${raw}". Statuses: ${valid.join(", ")} (fetch("workspace") lists them).`);
          }
          return match;
        });
  const unique = new Map(picked.map((s) => [s._id, { id: s._id, name: s.name, category: s.category }]));
  return [...unique.values()];
}

/**
 * When the task entered its current status, from its activity: the newest
 * status change, read newest-first in two bounded pages (STATUS_SCAN_FIRST,
 * then STATUS_SCAN_MORE older rows). No status change in a task's whole
 * history means it was created in that status. null = the change lies
 * beyond both pages (unknown; the task is reported as unchecked).
 */
async function enteredStatusAt(ctx: QueryCtx, task: Doc<"tasks">): Promise<number | null> {
  const recent = await ctx.db
    .query("activityLog")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .take(STATUS_SCAN_FIRST);
  const first = recent.find((row) => row.type === "status_changed");
  if (first) return first.createdAt;
  if (recent.length < STATUS_SCAN_FIRST) return task.createdAt;
  const oldest = recent[recent.length - 1].createdAt;
  const older = await ctx.db
    .query("activityLog")
    .withIndex("by_task", (q) => q.eq("taskId", task._id).lt("createdAt", oldest))
    .order("desc")
    .take(STATUS_SCAN_MORE);
  const change = older.find((row) => row.type === "status_changed");
  if (change) return change.createdAt;
  return older.length < STATUS_SCAN_MORE ? task.createdAt : null;
}

/**
 * Whether time was logged on the task or any of its sub-tasks (owner rule:
 * only real gaps — a parent whose time sits on its checklist is not one).
 * The task's own entries by index; sub-tasks by their tracked-minutes
 * counter (kept with every entry write, tasks/derived.ts), read only when
 * the task has sub-tasks. null = more than MISSING_SUBTASK_SCAN sub-tasks and
 * none of the first ones has time (unknown; reported as unchecked).
 */
async function hasLoggedTime(ctx: QueryCtx, task: Doc<"tasks">): Promise<boolean | null> {
  const own = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
    .first();
  if (own) return true;
  if ((task.subtaskCount ?? 0) === 0) return false;
  const subtasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .take(MISSING_SUBTASK_SCAN + 1);
  if (subtasks.slice(0, MISSING_SUBTASK_SCAN).some((s) => (s.trackedMinutes ?? 0) > 0)) return true;
  return subtasks.length > MISSING_SUBTASK_SCAN ? null : false;
}

/**
 * Tasks that reached the given statuses in the period with no time logged
 * (D25, D-MISSING). `statuses` defaults to the completed-category ones.
 * - A closed status (completed or canceled category) counts when the task
 *   was closed (`completedAt`) in the period, in the org's timezone.
 * - Any other status counts when the task is in it now and entered it in the
 *   period (`enteredStatusAt`).
 * Only top-level project tasks: a sub-task is a checklist item, and a task
 * without a project cannot carry time (D28). Archived tasks are left out,
 * like the app's lists. "Time logged" = an entry by anyone on the task or a
 * sub-task (the app shows members a task's total tracked time too). Members
 * get the tasks assigned to them; admins every task, or one member's.
 *
 * Loading is period- and status-bounded, then filtered by assignee in
 * memory: closed statuses by the `completedAt` window (≤ MISSING_CLOSED_CAP),
 * others by status (≤ MISSING_OPEN_CAP in all). Only when one of those is
 * over its cap AND an assignee is known (a member, or member) does it fall
 * back to that person's assignment edges (≤ MISSING_ASSIGNED_CAP); otherwise
 * it refuses, saying which narrowing works.
 *
 * Worst case, per call: ranges ≈ 10 fixed + 1 window + 1 per open status +
 * 1,001 (edge fallback) + per candidate 2 (time probe, sub-tasks) for 400
 * closed and 4 (+ two activity pages) for 100 open = 1,200, + one read per
 * distinct assignee / project / client shown (≤ 3 × 500) ≈ 3,700 < 4,096.
 * Documents ≈ 400 + 100 + 1,000 + 500 × (1 + 21) + 100 × 100 + 1,500 + 500
 * (statuses) ≈ 24,500 < 32,000.
 */
export async function missingTimeReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { from: string; to: string; statuses?: string[]; client?: string; project?: string; member?: string },
) {
  assertReportRange(args.from, args.to);
  if (args.client !== undefined && args.project !== undefined) {
    throw new ConvexError("Use either client or project, not both.");
  }
  if (args.statuses !== undefined && args.statuses.length === 0) {
    throw new ConvexError('statuses must name at least one status, or be left out for the completed ones (e.g. "Done").');
  }
  const resolver = createRefResolver(ctx, auth);
  const client = args.client !== undefined ? await resolveClient(resolver, args.client) : null;
  const project = args.project !== undefined ? await resolveProject(resolver, args.project) : null;
  const member = args.member !== undefined ? await resolveMember(resolver, args.member) : null;
  if (!auth.isAdmin && member && member._id !== auth.userId) {
    throw new ConvexError('Members see only their own tasks, as in the app. Use member "me" or leave member out.');
  }
  const timezone = await orgTimezone(ctx, auth.orgId);
  const allStatuses = await statusMap(ctx, auth.orgId);
  const statuses = resolveStatuses(allStatuses, args.statuses);
  const selected = new Map(statuses.map((s) => [s.id, s]));
  const closed = statuses.filter((s) => isClosedCategory(s.category));
  const open = statuses.filter((s) => !isClosedCategory(s.category));
  const assignee = !auth.isAdmin ? auth.userId : member?._id;
  const inPeriod = (at: number) => {
    const date = getDateInTimezone(at, timezone);
    return date >= args.from && date <= args.to;
  };

  // Period- and status-bounded loads.
  let candidates: Doc<"tasks">[] = [];
  let closedOver = false;
  const openOver: string[] = [];
  if (closed.length > 0) {
    // A margin around the org-timezone dates; the exact day filter follows.
    const lo = Date.parse(`${args.from}T00:00:00Z`) - 86_400_000;
    const hi = Date.parse(`${args.to}T00:00:00Z`) + 2 * 86_400_000;
    const window = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_completedAt", (q) => q.eq("orgId", auth.orgId).gte("completedAt", lo).lt("completedAt", hi))
      .take(MISSING_CLOSED_CAP + 1);
    if (window.length > MISSING_CLOSED_CAP) closedOver = true;
    else candidates.push(...window.filter((t) => selected.has(t.statusId)));
  }
  let openLoaded = 0;
  for (const status of open) {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_statusId", (q) => q.eq("orgId", auth.orgId).eq("statusId", status.id))
      .take(MISSING_OPEN_CAP + 1 - openLoaded);
    openLoaded += rows.length;
    if (openLoaded > MISSING_OPEN_CAP) {
      openOver.push(status.name);
      break;
    }
    candidates.push(...rows);
  }

  const who = !auth.isAdmin ? "You are" : "This member is";
  const overReasons = () =>
    [
      closedOver ? `more than ${MISSING_CLOSED_CAP} tasks were closed in the period` : null,
      openOver.length > 0 ? `more than ${MISSING_OPEN_CAP} tasks are in ${open.map((s) => s.name).join(", ")}` : null,
    ].filter((r): r is string => r !== null);
  const narrowing = () =>
    [closedOver ? "a shorter period" : null, openOver.length > 0 ? `without ${open.map((s) => s.name).join(", ")}` : null]
      .filter((r): r is string => r !== null)
      .join(" and ");
  if (closedOver || openOver.length > 0) {
    if (!assignee) {
      const reasons = overReasons().join(", and ");
      throw new ConvexError(
        `${reasons.charAt(0).toUpperCase()}${reasons.slice(1)}, more than this report reads in one call. Run it per member (member), or ${narrowing()}.`,
      );
    }
    // Fallback: one person's edges, filtered to the statuses in memory.
    const loaded = await loadAssignedTo(ctx, auth.orgId, assignee, MISSING_ASSIGNED_CAP);
    if (loaded.truncated) {
      throw new ConvexError(
        `${who} assigned more than ${MISSING_ASSIGNED_CAP} tasks and ${overReasons().join(", and ")}. Run it ${narrowing()}.`,
      );
    }
    candidates = loaded.tasks.filter((t) => selected.has(t.statusId));
    const inWindow = candidates.filter((t) => isClosedCategory(t.statusCategory) && t.completedAt !== undefined && inPeriod(t.completedAt));
    const openCandidates = candidates.filter((t) => !isClosedCategory(t.statusCategory));
    if (inWindow.length > MISSING_CLOSED_CAP || openCandidates.length > MISSING_OPEN_CAP) {
      throw new ConvexError(`Even for one person, too many tasks match. Run it ${narrowing() || "for a shorter period"}.`);
    }
  }

  const rows = [];
  const unchecked: Array<{ identifier: string; reason: "status_history" | "subtasks" }> = [];
  const names = userNames(ctx);
  const projects = new Map<Id<"projects">, Awaited<ReturnType<typeof projectSummary>>>();
  const clientNames = new Map<Id<"clients">, string | null>();
  for (const task of candidates) {
    if (task.orgId !== auth.orgId || task.archivedAt !== undefined || task.parentTaskId !== undefined) continue;
    if (task.projectId === undefined) continue;
    if (project && task.projectId !== project._id) continue;
    if (client && task.clientId !== client._id) continue;
    if (assignee && !task.assigneeIds.includes(assignee)) continue;
    const status = selected.get(task.statusId);
    if (!status) continue;

    let at: number;
    if (isClosedCategory(status.category)) {
      if (task.completedAt === undefined || !inPeriod(task.completedAt)) continue;
      at = task.completedAt;
    } else {
      const entered = await enteredStatusAt(ctx, task);
      if (entered === null) {
        unchecked.push({ identifier: task.identifier, reason: "status_history" });
        continue;
      }
      if (!inPeriod(entered)) continue;
      at = entered;
    }

    const logged = await hasLoggedTime(ctx, task);
    if (logged === true) continue;
    if (logged === null) {
      unchecked.push({ identifier: task.identifier, reason: "subtasks" });
      continue;
    }

    if (!projects.has(task.projectId)) projects.set(task.projectId, await projectSummary(ctx, auth.orgId, task.projectId));
    let clientName: string | null = null;
    if (task.clientId) {
      if (!clientNames.has(task.clientId)) {
        const doc = await ctx.db.get(task.clientId);
        clientNames.set(task.clientId, doc && doc.orgId === auth.orgId ? doc.name : null);
      }
      clientName = clientNames.get(task.clientId) ?? null;
    }
    const assignees = [];
    for (const id of task.assigneeIds) assignees.push(await names(id));
    rows.push({
      identifier: task.identifier,
      title: task.title,
      status: status.name,
      date: getDateInTimezone(at, timezone),
      project: projects.get(task.projectId)?.code ?? null,
      client: clientName,
      assignees,
    });
  }
  rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.identifier.localeCompare(b.identifier)));
  // D1: the per-assignee counts are computed here; a task with two assignees counts for both.
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const person of row.assignees.length > 0 ? row.assignees : ["Unassigned"]) counts.set(person, (counts.get(person) ?? 0) + 1);
  }
  return {
    from: args.from,
    to: args.to,
    timezone,
    scope: !auth.isAdmin ? ("self" as const) : member ? ("member" as const) : ("team" as const),
    statuses: statuses.map((s) => ({ name: s.name, category: s.category })),
    statusesDefaulted: args.statuses === undefined,
    rows,
    byAssignee: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unchecked,
  };
}

// ─── project_overview / project_monthly ──────────────────────────────────────

async function adminProject(ctx: QueryCtx, auth: AuthContext, kind: ReportKind, ref: string) {
  requireAdminReport(auth, kind);
  const project = await resolveProject(createRefResolver(ctx, auth), ref);
  const client = await ctx.db.get(project.clientId);
  return {
    project,
    client: client && client.orgId === auth.orgId ? clientInfo(client) : null,
    currency: await getProjectCurrency(ctx, project),
  };
}

/** Category names by id for the flatteners (one range); more than the workspace cap refuses. */
async function categoryNameMap(ctx: QueryCtx, orgId: string): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query("workCategories")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(REF_CAP + 1);
  if (rows.length > REF_CAP) {
    throw new ConvexError(`This workspace has more than ${REF_CAP} work categories, more than a report reads in one call.`);
  }
  return new Map(rows.map((c) => [c._id as string, c.name]));
}

/**
 * The project page's overview numbers (`projectOverviewForAuth`): time
 * totals, categories and the entry-ledger billing state — Unbilled, Billed
 * (covered by a live T&M close, draft or final: the app's one definition,
 * billing PRD §6.8) and Settled (retainer). Admin-only: the project pages are
 * admin routes and the amounts are money.
 */
export async function projectOverviewReport(ctx: QueryCtx, auth: AuthContext, args: { project: string }) {
  const { project, client, currency } = await adminProject(ctx, auth, "project_overview", args.project);
  const overview = await projectOverviewForAuth(ctx, auth, { projectId: project._id });
  if (!overview) throw new ConvexError(`${args.project} not found.`);
  return {
    project: projectInfo(project),
    client,
    currency,
    summary: flattenProjectOverview(overview, await categoryNameMap(ctx, auth.orgId)),
    billed: { minutes: overview.billedMinutes, amount: overview.billedAmount },
  };
}

/** The project page's monthly breakdown (`projectMonthlyBreakdownForAuth`), newest month first. Admin-only. */
export async function projectMonthlyReport(ctx: QueryCtx, auth: AuthContext, args: { project: string }) {
  const { project, client, currency } = await adminProject(ctx, auth, "project_monthly", args.project);
  const months = await projectMonthlyBreakdownForAuth(ctx, auth, { projectId: project._id });
  return {
    project: projectInfo(project),
    client,
    currency,
    months: flattenMonthlyBreakdown(months, true),
  };
}

// ─── retainer_statement / retainer_health ────────────────────────────────────

/**
 * A retainer month's statement — the report page's numbers
 * (`getMonthlyReportForAuth`): the balance row, cycle to date, the amount
 * due, the category groups and carried-in work. Admin-only.
 */
export async function retainerStatementReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { project: string; month: string },
) {
  requireAdminReport(auth, "retainer_statement");
  assertMonth(args.month, "month");
  const project = await resolveProject(createRefResolver(ctx, auth), args.project);
  if (project.billingType !== "retainer") {
    throw new ConvexError(`${project.code} is not a retainer project; statements exist for retainers only. Try project_overview.`);
  }
  const [year, month] = args.month.split("-").map(Number);
  const report = await getMonthlyReportForAuth(ctx, auth, { projectId: project._id, year, month });
  if (!report) {
    throw new ConvexError(
      `${project.code} has no statement for ${args.month}: the month has not started yet or is before the retainer's first cycle.`,
    );
  }
  return {
    project: projectInfo(project),
    month: args.month,
    isFinal: report.isFinal,
    statement: flattenRetainerStatement(report),
    usage: {
      kind: report.retainerUsage.kind,
      closed: report.retainerUsage.closed,
      rows: report.retainerUsage.rows.map((r) => ({
        month: `${r.year}-${String(r.month).padStart(2, "0")}`,
        availableMinutes: r.availableMinutes,
        usedMinutes: r.usedMinutes,
        balanceMinutes: r.balanceMinutes,
      })),
      total: report.retainerUsage.total,
    },
    carried: report.carriedGroups.map((g) => ({
      month: g.monthKey,
      minutes: g.totalMinutes,
      categories: [
        ...g.billableCategoryGroups.map((c) => ({ categoryName: c.categoryName, billable: true, minutes: c.totalMinutes })),
        ...g.nonBillableCategoryGroups.map((c) => ({ categoryName: c.categoryName, billable: false, minutes: c.totalMinutes })),
      ],
    })),
  };
}

/** Every active retainer's state in a month (`retainerHealthForMonthForAuth`). Admin-only. */
export async function retainerHealthReport(ctx: QueryCtx, auth: AuthContext, args: { month: string }) {
  requireAdminReport(auth, "retainer_health");
  assertMonth(args.month, "month");
  const [year, month] = args.month.split("-").map(Number);
  const data = await retainerHealthForMonthForAuth(ctx, auth, { year, month });
  const codes = projectCodes(ctx, auth.orgId);
  const rows = [];
  for (const r of data.rows) rows.push({ ...r, projectCode: await codes(r.projectId) });
  return { ...data, rows };
}

// ─── close_queue / invoice_metrics / org_finance ────────────────────────────

/**
 * The Billing hub's Needs action view (`getNeedsActionForAuth`, the same read
 * model as /billing and the sidebar badge, docs/prd-project-billing-redesign.md
 * §6.2): one row per period that needs action plus past-due invoices, grouped
 * Needs rate → Ready to invoice → Ready to close → Draft → Past due, with the
 * hub's tiles. Money per currency in minor units. Admin-only.
 */
export async function closeQueueReport(ctx: QueryCtx, auth: AuthContext) {
  requireAdminReport(auth, "close_queue");
  const data = await getNeedsActionForAuth(ctx, auth);
  const codes = projectCodes(ctx, auth.orgId);
  const byCurrency = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([currency, minor]) => ({ currency, minor }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  const rows = [];
  for (const r of data.rows) {
    const p = r.period;
    const inv = r.invoice;
    rows.push({
      group: r.group,
      projectId: r.projectId,
      projectCode: await codes(r.projectId),
      projectName: r.projectName,
      clientName: r.clientName,
      billingType: r.billingType,
      currency: r.currency,
      period: p
        ? {
            key: p.key,
            label: p.label,
            state: PERIOD_STATE_COPY[p.state].chip,
            usageMinutes: p.usageMinutes,
            includedMinutes: p.includedMinutes,
            overageMinutes: p.overageMinutes,
          }
        : null,
      invoice: inv
        ? {
            id: inv.id,
            number: inv.number,
            status: inv.status,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            daysOverdue: inv.status === "past_due" && inv.dueDate ? daysPastDue(inv.dueDate, data.today) : null,
          }
        : null,
      amountMinor: r.amountMinor,
      action: r.action ? { label: r.action.label, blockedReason: r.action.blocked?.reason ?? null } : null,
    });
  }
  return {
    today: data.today,
    needsActionCount: data.needsActionCount,
    pastDueCount: data.pastDueCount,
    tiles: {
      unbilled: { byCurrency: byCurrency(data.tiles.unbilled.minorByCurrency), readyCount: data.tiles.unbilled.readyCount, draftCount: data.tiles.unbilled.draftCount },
      outstanding: {
        byCurrency: byCurrency(data.tiles.outstanding.minorByCurrency),
        pastDueCount: data.tiles.outstanding.pastDueCount,
        invoicedCount: data.tiles.outstanding.invoicedCount,
      },
      paidThisMonth: { byCurrency: byCurrency(data.tiles.paidThisMonth.minorByCurrency), count: data.tiles.paidThisMonth.count },
      monthsToClose: data.tiles.monthsToClose,
    },
    rows,
  };
}

/** Org-wide invoice buckets (`getInvoiceMetricsForAuth`), per currency, plus outstanding (unpaid + past due). Admin-only. */
export async function invoiceMetricsReport(ctx: QueryCtx, auth: AuthContext) {
  requireAdminReport(auth, "invoice_metrics");
  const metrics = await getInvoiceMetricsForAuth(ctx, auth);
  const outstanding = {
    bucket: "outstanding" as const,
    count: metrics.outstanding.count,
    totals: Object.entries(metrics.outstanding.currencySums)
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
  return { buckets: [...flattenInvoiceMetrics(metrics), outstanding] };
}

/** Org-wide time, labor cost, billable value and invoicing for a range (`orgFinanceSnapshotForAuth`). Admin-only. */
export async function orgFinanceReport(ctx: QueryCtx, auth: AuthContext, args: { from: string; to: string }) {
  requireAdminReport(auth, "org_finance");
  assertReportRange(args.from, args.to);
  const data = await orgFinanceSnapshotForAuth(ctx, auth, { fromDate: args.from, toDate: args.to });
  const codes = projectCodes(ctx, auth.orgId);
  const projects = [];
  for (const p of data.projects) projects.push({ ...p, code: await codes(p.projectId) });
  return { ...data, projects };
}
