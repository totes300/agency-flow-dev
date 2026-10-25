import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { assertValidDateString } from "./dateValidation";
import { getOrgSettings, getProjectCurrency } from "./orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./timer";
import { referenceClientPrefix } from "./helpers";
import { isValidMonthKey } from "./reportCore";
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
import { getCloseQueueForAuth } from "../billingViews";
import { getInvoiceMetricsForAuth } from "../invoices";
import { loadAssignedTo } from "../tasks/read";
import { capText } from "../../lib/mcp/tiptap-markdown";
import { REPORT_RANGE_DAYS_MAX, type ReportKind } from "../../lib/mcp/limits";
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
 * (D1: every number is computed here, by code, never by the model).
 *
 * Role rules, exactly as the app:
 * - members: `time_by_member` (their own time only, like Workday) and
 *   `missing_time` (tasks assigned to them). Neither carries money.
 * - every other kind is admin-only: its screen is an admin route (projects,
 *   clients, billing, invoices) or its core is admin-gated.
 * Money is never summed across currencies: every amount carries its currency
 * and every total is per currency (the cores already partition).
 *
 * Read budget (Convex: 4,096 index ranges and 32,000 documents per call):
 * the cores read what the app reads for the same screen. MCP adds at most
 * one range per output row (task keys, project codes, emails) plus:
 * - timesheet: one per task (cap TIMESHEET_TASK_CAP), entries ≤ 20,000;
 * - client_monthly: two per task (task, latest comment) plus mention lookups,
 *   tasks ≤ CLIENT_TASK_CAP;
 * - missing_time: one range for completed tasks (≤ MISSING_DONE_CAP), one per
 *   review status (≤ MISSING_REVIEW_CAP tasks in all) or the member's
 *   assigned tasks (≤ MISSING_ASSIGNED_CAP, one range each), then per
 *   candidate one time-entry probe and, for review tasks, one activity probe.
 * A scan over its cap throws a "narrow the period / filter" error; nothing is
 * ever returned clipped.
 */

export const TIMESHEET_TASK_CAP = 1000;
export const CLIENT_TASK_CAP = 600;
export const MISSING_DONE_CAP = 1000;
export const MISSING_REVIEW_CAP = 500;
export const MISSING_ASSIGNED_CAP = 1000;
/** Characters of a task's latest comment in client_monthly (longer ends with "…"). */
export const CLOSING_COMMENT_MAX = 2000;

const KIND_LABEL: Record<ReportKind, string> = {
  timesheet: "timesheet",
  time_by_member: "time_by_member",
  client_monthly: "client_monthly",
  missing_time: "missing_time",
  project_overview: "project_overview",
  project_monthly: "project_monthly",
  retainer_statement: "retainer_statement",
  retainer_health: "retainer_health",
  close_queue: "close_queue",
  invoice_metrics: "invoice_metrics",
  org_finance: "org_finance",
};

/** Members get exactly the app's surfaces: admin screens refuse with what they can run instead. */
function requireAdminReport(auth: AuthContext, kind: ReportKind): void {
  if (auth.isAdmin) return;
  throw new ConvexError(
    `The ${KIND_LABEL[kind]} report is admin-only, as in the app. Members can run time_by_member (your own time) and missing_time (your tasks).`,
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

/** Task keys and titles, memoized; foreign or missing tasks read as null. */
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

/** The org's statuses by id (one range; the workspace cap is far above any real status list). */
async function statusMap(ctx: QueryCtx, orgId: string): Promise<Map<Id<"statuses">, Doc<"statuses">>> {
  const rows = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(500);
  return new Map(rows.map((s) => [s._id, s]));
}

// ─── timesheet ───────────────────────────────────────────────────────────────

/**
 * Per-task time of a client (optionally one of its projects) in a date
 * range: the worksheet collector the app's exports run, per project, plus the
 * timesheet pivot's category totals. Admin-only (worksheets are).
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

  const task = taskLookup(ctx, auth.orgId);
  const codes = projectCodes(ctx, auth.orgId);
  const rows = [];
  // The pivot's row order: project, first worked, title.
  const sorted = [...data.rows].sort((a, b) =>
    a.projectName !== b.projectName
      ? a.projectName.localeCompare(b.projectName)
      : a.firstWorked !== b.firstWorked
        ? (a.firstWorked < b.firstWorked ? -1 : 1)
        : a.title.localeCompare(b.title),
  );
  for (const r of sorted) {
    rows.push({
      identifier: (await task(r.taskId))?.identifier ?? null,
      title: r.title,
      project: (await codes(r.projectId)) ?? r.projectName,
      category: r.categoryName,
      firstWorked: r.firstWorked,
      lastWorked: r.lastWorked,
      minutes: r.totalMinutes,
      billableMinutes: r.billableMinutes,
      nonBillableMinutes: r.nonBillableMinutes,
      entryCount: r.entryCount,
    });
  }
  return {
    client: clientInfo(client),
    project: project ? projectInfo(project) : null,
    from: args.from,
    to: args.to,
    periodLabel: formatTimesheetPeriodLabel({ startDate: args.from, endDate: args.to }),
    rows,
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
 * on Workday. Minutes only: no rates or amounts for anyone.
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
  const members = [];
  for (const m of data.members) {
    const id = ctx.db.normalizeId("users", m.userId);
    const user = id ? await ctx.db.get(id) : null;
    members.push({
      name: m.userName,
      email: user?.email ?? null,
      minutes: m.minutes,
      billableMinutes: m.billableMinutes,
      nonBillableMinutes: m.nonBillableMinutes,
      entryCount: m.entryCount,
      projects: m.byProject.map((p) => ({
        name: p.projectName,
        client: p.clientName,
        minutes: p.minutes,
        billableMinutes: p.billableMinutes,
      })),
    });
  }
  return { from: args.from, to: args.to, scope, members, totals: data.totals };
}

// ─── client_monthly ──────────────────────────────────────────────────────────

/**
 * A client's months (`clientMonthlySummaryForAuth`) plus, per task worked in
 * the range, the raw material for a client summary (D25): key, title,
 * status, minutes, its time-entry notes and its closing comment (the latest
 * comment on the task). The server never summarizes. Admin-only.
 */
export async function clientMonthlyReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { client: string; fromMonth: string; toMonth: string },
) {
  requireAdminReport(auth, "client_monthly");
  assertMonth(args.fromMonth, "from_month");
  assertMonth(args.toMonth, "to_month");
  const resolver = createRefResolver(ctx, auth);
  const client = await resolveClient(resolver, args.client);
  const data = await clientMonthlySummaryForAuth(
    ctx,
    auth,
    { clientId: client._id, fromMonth: args.fromMonth, toMonth: args.toMonth },
    { tasks: true },
  );
  const rollups = data.tasks ?? [];
  if (rollups.length > CLIENT_TASK_CAP) {
    throw new ConvexError(
      `${rollups.length} tasks were worked for this client in the range, more than one report lists (${CLIENT_TASK_CAP}). Ask for fewer months (e.g. one month).`,
    );
  }

  const task = taskLookup(ctx, auth.orgId);
  const codes = projectCodes(ctx, auth.orgId);
  const statuses = await statusMap(ctx, auth.orgId);
  const name = userNames(ctx);
  const markdown = richTextMarkdown(ctx, auth.orgId);
  const tasks = [];
  for (const r of rollups) {
    const doc = await task(r.taskId);
    const latest = doc
      ? await ctx.db
          .query("comments")
          .withIndex("by_task", (q) => q.eq("taskId", doc._id))
          .order("desc")
          .first()
      : null;
    const comment = latest && latest.orgId === auth.orgId
      ? capText(await markdown.content(latest.content), CLOSING_COMMENT_MAX)
      : null;
    const status = doc ? statuses.get(doc.statusId) : undefined;
    tasks.push({
      identifier: doc?.identifier ?? null,
      title: doc?.title ?? "Deleted task",
      status: status?.name ?? null,
      statusCategory: doc?.statusCategory ?? null,
      archived: doc?.archivedAt !== undefined,
      project: (await codes(r.projectId)) ?? r.projectName,
      minutes: r.minutes,
      billableMinutes: r.billableMinutes,
      nonBillableMinutes: r.nonBillableMinutes,
      entryCount: r.entryCount,
      notes: r.notes,
      closingComment:
        latest && comment
          ? { author: await name(latest.userId), createdAt: latest.createdAt, text: comment.text, truncated: comment.truncated }
          : null,
    });
  }
  const timezone = (await getOrgSettings(ctx, auth.orgId))?.timezone ?? ORG_TIMEZONE_FALLBACK;
  return {
    client: clientInfo(client),
    fromMonth: data.fromMonth,
    toMonth: data.toMonth,
    timezone,
    months: data.months.map((m) => ({
      month: m.month,
      minutes: m.minutes,
      billableMinutes: m.billableMinutes,
      nonBillableMinutes: m.nonBillableMinutes,
      billableAmount: m.billableAmount,
      entryCount: m.entryCount,
    })),
    totals: data.totals,
    tasks,
  };
}

// ─── missing_time ────────────────────────────────────────────────────────────

/** "Review" as the app models it: a started status whose name says review (Admin review, Client review). */
export function isReviewStatus(status: Pick<Doc<"statuses">, "category" | "name">): boolean {
  return status.category === "started" && /review/i.test(status.name);
}

const DAY_MS = 86_400_000;

/**
 * Review/Done tasks in the period with no time entries (D25):
 * - Done: a completed-category status, completed (`completedAt`) in the
 *   period, in the org's timezone;
 * - Review: currently in a review status (`isReviewStatus`) that it entered
 *   in the period — its latest status change, or its creation when it never
 *   changed status.
 * Only top-level project tasks count: sub-tasks are checklist items and a
 * task without a project cannot carry time (D28). Archived tasks are left
 * out, like the app's lists. "No time" means no entry by anyone (the app
 * shows members a task's total tracked time too). Members see the tasks
 * assigned to them; admins every task, or one member's with member.
 */
export async function missingTimeReport(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { from: string; to: string; client?: string; project?: string; member?: string },
) {
  assertReportRange(args.from, args.to);
  if (args.client !== undefined && args.project !== undefined) {
    throw new ConvexError("Use either client or project, not both.");
  }
  const resolver = createRefResolver(ctx, auth);
  const client = args.client !== undefined ? await resolveClient(resolver, args.client) : null;
  const project = args.project !== undefined ? await resolveProject(resolver, args.project) : null;
  const member = args.member !== undefined ? await resolveMember(resolver, args.member) : null;
  if (!auth.isAdmin && member && member._id !== auth.userId) {
    throw new ConvexError('Members see only their own tasks, as in the app. Use member "me" or leave member out.');
  }
  const timezone = (await getOrgSettings(ctx, auth.orgId))?.timezone ?? ORG_TIMEZONE_FALLBACK;
  const statuses = await statusMap(ctx, auth.orgId);
  const reviewStatuses = [...statuses.values()].filter(isReviewStatus);
  const reviewIds = new Set(reviewStatuses.map((s) => s._id));
  const inPeriod = (at: number) => {
    const date = getDateInTimezone(at, timezone);
    return date >= args.from && date <= args.to;
  };

  // Candidates: a member's own edges (their visibility), else the org's
  // completed-in-window and in-review tasks.
  const assignee = !auth.isAdmin ? auth.userId : member?._id;
  let candidates: Doc<"tasks">[];
  if (!auth.isAdmin) {
    const loaded = await loadAssignedTo(ctx, auth.orgId, auth.userId, MISSING_ASSIGNED_CAP);
    if (loaded.truncated) {
      throw new ConvexError(
        `You are assigned more than ${MISSING_ASSIGNED_CAP} tasks, more than this report reads in one call. Ask an admin to run it for you.`,
      );
    }
    candidates = loaded.tasks;
  } else {
    // A margin around the org-timezone dates; the exact day filter follows.
    const lo = Date.parse(`${args.from}T00:00:00Z`) - DAY_MS;
    const hi = Date.parse(`${args.to}T00:00:00Z`) + 2 * DAY_MS;
    const done = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_completedAt", (q) => q.eq("orgId", auth.orgId).gte("completedAt", lo).lt("completedAt", hi))
      .take(MISSING_DONE_CAP + 1);
    if (done.length > MISSING_DONE_CAP) {
      throw new ConvexError(
        `More than ${MISSING_DONE_CAP} tasks were closed in the period. Narrow the period (e.g. one month).`,
      );
    }
    const review: Doc<"tasks">[] = [];
    for (const status of reviewStatuses) {
      const rows = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_statusId", (q) => q.eq("orgId", auth.orgId).eq("statusId", status._id))
        .take(MISSING_REVIEW_CAP + 1 - review.length);
      review.push(...rows);
      if (review.length > MISSING_REVIEW_CAP) {
        throw new ConvexError(
          `More than ${MISSING_REVIEW_CAP} tasks are in a review status, more than this report reads in one call. Add project or member.`,
        );
      }
    }
    candidates = [...done, ...review];
  }

  const rows = [];
  const names = userNames(ctx);
  const projects = new Map<Id<"projects">, Awaited<ReturnType<typeof projectSummary>>>();
  const clientNames = new Map<Id<"clients">, string | null>();
  for (const task of candidates) {
    if (task.orgId !== auth.orgId || task.archivedAt !== undefined || task.parentTaskId !== undefined) continue;
    if (task.projectId === undefined) continue;
    if (project && task.projectId !== project._id) continue;
    if (client && task.clientId !== client._id) continue;
    if (assignee && !task.assigneeIds.includes(assignee)) continue;

    let kind: "done" | "review";
    let at: number;
    if (task.statusCategory === "completed" && task.completedAt !== undefined) {
      if (!inPeriod(task.completedAt)) continue;
      kind = "done";
      at = task.completedAt;
    } else if (reviewIds.has(task.statusId)) {
      const change = await ctx.db
        .query("activityLog")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .order("desc")
        .filter((q) => q.eq(q.field("type"), "status_changed"))
        .first();
      at = change ? change.createdAt : task.createdAt;
      if (!inPeriod(at)) continue;
      kind = "review";
    } else {
      continue;
    }

    const anyEntry = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .first();
    if (anyEntry) continue;

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
      status: statuses.get(task.statusId)?.name ?? null,
      kind,
      date: getDateInTimezone(at, timezone),
      project: projects.get(task.projectId)?.code ?? null,
      client: clientName,
      assignees,
    });
  }
  rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.identifier.localeCompare(b.identifier)));
  return {
    from: args.from,
    to: args.to,
    timezone,
    scope: !auth.isAdmin ? ("self" as const) : member ? ("member" as const) : ("team" as const),
    reviewStatuses: reviewStatuses.filter((s) => s.archivedAt === undefined).map((s) => s.name),
    rows,
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

/** Category names by id for the flatteners (one range; "No category" otherwise). */
async function categoryNameMap(ctx: QueryCtx, orgId: string): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query("workCategories")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(2000);
  return new Map(rows.map((c) => [c._id as string, c.name]));
}

/**
 * The project page's overview numbers (`projectOverviewForAuth`): time
 * totals, categories and the entry-ledger billing buckets. Admin-only: the
 * project pages are admin routes and the buckets carry money.
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

/** Billing → Close: one row per project period due (`getCloseQueueForAuth`). Admin-only. */
export async function closeQueueReport(ctx: QueryCtx, auth: AuthContext) {
  requireAdminReport(auth, "close_queue");
  const data = await getCloseQueueForAuth(ctx, auth);
  const codes = projectCodes(ctx, auth.orgId);
  const months = [];
  for (const m of data.months) {
    const rows = [];
    for (const r of m.rows) {
      rows.push({
        projectId: r.projectId,
        projectCode: await codes(r.projectId),
        projectName: r.projectName,
        clientName: r.clientName,
        billingType: r.billingType,
        periodToken: r.periodToken,
        periodLabel: r.periodLabel,
        amount: r.amount,
        currency: r.currency,
        isCloseRow: r.isCloseRow,
        overageHours: r.overageHours,
        loggedMinutes: r.loggedMinutes,
        includedMinutes: r.includedMinutes,
        entryCount: r.entryCount,
        flagCount: r.flagCount,
        configIssue: r.configIssue,
        pendingPeriods: r.pendingPeriods,
      });
    }
    months.push({
      monthKey: m.monthKey,
      label: m.label,
      openCount: m.openCount,
      closedCount: m.closedCount,
      totalCount: m.totalCount,
      totalsByCurrency: Object.entries(m.totalsByCurrency)
        .map(([currency, amount]) => ({ currency, amount }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      rows,
    });
  }
  return { months, actionableCount: data.actionableCount };
}

/** The Billing hub's invoice buckets (`getInvoiceMetricsForAuth`), per currency, plus outstanding (unpaid + past due). Admin-only. */
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
  return await orgFinanceSnapshotForAuth(ctx, auth, { fromDate: args.from, toDate: args.to });
}
