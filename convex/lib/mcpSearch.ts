import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { assertValidDateString } from "./dateValidation";
import { referenceClientPrefix } from "./helpers";
import { getDateInTimezone } from "./timer";
import { addDaysToDateString } from "./todayPlan";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { commentPreview, isOverdue, orgClock, timeEntryRow, userNames, type OrgClock } from "./mcpRecords";
import { listTaskCommentsForAuth } from "../comments";
import { filterReadableTasks } from "../tasks/access";
import { findTaskDocsForAuth, toAgentTaskRows, type FindTasksInput } from "../tasks/lookup";
import { isTaskCategory, type TaskCategory } from "../tasks/model";
import { visibleTimeEntries } from "../timeEntries";
import { REF_CAP } from "../workspaceRefs";
import { extractPlainText } from "../../lib/tiptap-utils";
import { SEARCH_LIMIT_MAX } from "../../lib/mcp/limits";

/**
 * MCP `search` per result type (docs/prd-mcp.md §6, §7), for an
 * already-authorized caller. Each type loads through the app's bounded
 * loaders and access rules, filters, sorts deterministically and returns one
 * page (`offset` / `limit`) plus the full match count. A loader that hit its
 * cap sets `incomplete`: more matches may exist, and the renderer says so —
 * a clipped set is never presented as complete. No money in any row.
 *
 * Read budget (Convex: 4,096 index ranges and 32,000 documents per call;
 * every db.get / query is one range):
 * - tasks: the shared task core (findTaskDocsForAuth) — a few ranges for
 *   admins; for members one range per assigned task (edge cap 2,000) plus
 *   their access checks — then up to ~6 per row on the page;
 * - projects / clients: one range (≤ 2,001 docs) plus one per page row;
 *   members: one range plus one per org member;
 * - time entries: one range (≤ 2,001 docs) plus one per distinct project
 *   (client filter) and ~2 per page row;
 * - comments: one activity range (≤ 501 rows), then per comment one get,
 *   per distinct task one get and (members) up to two edge checks: at most
 *   ~2,000 ranges; with a task filter, the task's comments in one range.
 * Filters by member email add one range per org member (mcpRefs.ts).
 */

/** Deepest offset a cursor may page to (results come from capped loads anyway). */
export const SEARCH_OFFSET_MAX = 10_000;
/** Time entries read per search before filtering. */
export const TIME_SEARCH_CAP = 2000;
/**
 * Activity rows scanned per comment search (comments are found via their
 * `comment_added` row); sized to the 4,096-range budget above.
 */
export const COMMENT_SCAN_CAP = 500;
/** Preview length of a comment row. */
export const COMMENT_PREVIEW_CHARS = 200;

const DAY_MS = 86_400_000;

export type SearchPage<Row> = {
  rows: Row[];
  /** Matches found (within the loaded rows). */
  total: number;
  offset: number;
  /** A bounded loader hit its cap: more matches may exist than `total`. */
  incomplete: boolean;
  /** Model-facing notes, e.g. a member only seeing their own time entries. */
  notes: string[];
};

export type PageArgs = { offset: number; limit: number };

export type DateRangeArgs = { from?: string; to?: string };

function assertPage({ offset, limit }: PageArgs): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
    throw new ConvexError(`limit must be between 1 and ${SEARCH_LIMIT_MAX}.`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > SEARCH_OFFSET_MAX) {
    throw new ConvexError("Invalid cursor. Search again without a cursor.");
  }
}

function assertRange(range: DateRangeArgs, name: string): void {
  if (range.from !== undefined) assertValidDateString(range.from, `${name}_from`);
  if (range.to !== undefined) assertValidDateString(range.to, `${name}_to`);
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    throw new ConvexError(`${name}_from must not be after ${name}_to.`);
  }
}

function inRange(date: string, range: DateRangeArgs): boolean {
  return (range.from === undefined || date >= range.from) && (range.to === undefined || date <= range.to);
}

function page<T>(items: readonly T[], args: PageArgs): T[] {
  return items.slice(args.offset, args.offset + args.limit);
}

/** Case-insensitive substring match on any of `fields`. */
function textMatch(query: string | undefined, ...fields: Array<string | null | undefined>): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** "Updated" filters on an epoch timestamp: since (exclusive) and a date range in the org timezone. */
type UpdatedArgs = { updatedSince?: number; updated: DateRangeArgs };

function updatedMatch(at: number, args: UpdatedArgs, clock: OrgClock): boolean {
  if (args.updatedSince !== undefined && at <= args.updatedSince) return false;
  if (args.updated.from === undefined && args.updated.to === undefined) return true;
  return inRange(getDateInTimezone(at, clock.timezone), args.updated);
}

/** The person filter: `mine` or an `assignee` ref (`me`, email, ID, link). */
async function personFilter(
  resolver: RefResolver,
  auth: AuthContext,
  args: { assignee?: string; mine?: boolean },
): Promise<Id<"users"> | undefined> {
  if (args.mine && args.assignee !== undefined) {
    throw new ConvexError('Use either mine or assignee, not both. assignee: "me" equals mine.');
  }
  if (args.mine) return auth.userId;
  if (args.assignee === undefined) return undefined;
  const member = await resolver.require(args.assignee, "member");
  if (member.type !== "member") throw new Error(`Expected a member, resolved a ${member.type}`);
  return member.user._id;
}

async function clientFilter(resolver: RefResolver, ref: string | undefined): Promise<Doc<"clients"> | undefined> {
  if (ref === undefined) return undefined;
  const resolved = await resolver.require(ref, "client");
  if (resolved.type !== "client") throw new Error(`Expected a client, resolved a ${resolved.type}`);
  return resolved.client;
}

async function projectFilter(resolver: RefResolver, ref: string | undefined): Promise<Doc<"projects"> | undefined> {
  if (ref === undefined) return undefined;
  const resolved = await resolver.require(ref, "project");
  if (resolved.type !== "project") throw new Error(`Expected a project, resolved a ${resolved.type}`);
  return resolved.project;
}

/** A task ref the caller can read (comment / time-entry search `task` filter). */
async function taskFilter(resolver: RefResolver, ref: string | undefined): Promise<Doc<"tasks"> | undefined> {
  if (ref === undefined) return undefined;
  const resolved = await resolver.require(ref, "task");
  if (resolved.type !== "task") throw new Error(`Expected a task, resolved a ${resolved.type}`);
  return resolved.access.task;
}

/** A reference table read in full under `REF_CAP`; refuses rather than match against a clipped list. */
function refTable<T>(rows: T[], noun: string): T[] {
  if (rows.length > REF_CAP) {
    throw new ConvexError(`This workspace has more than ${REF_CAP} ${noun}, so a ${noun.replace(/e?s$/, "")} filter cannot be matched by name.`);
  }
  return rows;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export type TaskSearchArgs = PageArgs & {
  query?: string;
  assignee?: string;
  mine?: boolean;
  status?: string;
  label?: string;
  client?: string;
  project?: string;
  due: DateRangeArgs;
  overdue?: boolean;
  updated: DateRangeArgs;
  updatedSince?: number;
  now: number;
};

/** How a `status` filter narrows tasks: a status, a category, open (default) or any. */
async function statusFilter(
  ctx: QueryCtx,
  orgId: string,
  status: string | undefined,
): Promise<Pick<FindTasksInput, "statusId" | "category" | "includeClosed"> & { closedAllowed: boolean }> {
  const value = status?.trim();
  if (!value || value.toLowerCase() === "open") return { closedAllowed: false };
  if (value.toLowerCase() === "any") return { includeClosed: true, closedAllowed: true };
  const statuses = refTable(
    await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1),
    "statuses",
  );
  const named = statuses.filter((s) => s.name.toLowerCase() === value.toLowerCase());
  if (named.length === 1) {
    return { statusId: named[0]._id, closedAllowed: named[0].category === "completed" || named[0].category === "canceled" };
  }
  if (named.length > 1) {
    throw new ConvexError(
      `Status "${value}" is ambiguous: ${named.length} statuses share that name (${named.map((s) => s.category).join(", ")}). Filter by category instead.`,
    );
  }
  const category = value.toLowerCase();
  if (isTaskCategory(category)) {
    return { category: category as TaskCategory, closedAllowed: category === "completed" || category === "canceled" };
  }
  throw new ConvexError(
    `No status "${value}". Use a status name from fetch("workspace"), a category (backlog, unstarted, started, completed, canceled), "open" (default) or "any".`,
  );
}

async function labelFilter(ctx: QueryCtx, orgId: string, label: string | undefined): Promise<Id<"labels"> | undefined> {
  const value = label?.trim();
  if (!value) return undefined;
  const labels = refTable(
    await ctx.db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1),
    "labels",
  );
  const named = labels.filter((l) => l.name.toLowerCase() === value.toLowerCase());
  if (named.length === 0) throw new ConvexError(`No label "${value}". Labels are listed in fetch("workspace").`);
  if (named.length > 1) throw new ConvexError(`Label "${value}" is ambiguous: ${named.length} labels share that name.`);
  return named[0]._id;
}

export async function searchTasks(ctx: QueryCtx, auth: AuthContext, args: TaskSearchArgs) {
  assertPage(args);
  assertRange(args.due, "due");
  assertRange(args.updated, "updated");
  const clock = await orgClock(ctx, auth.orgId, args.now);
  const resolver = createRefResolver(ctx, auth);

  const assigneeId = await personFilter(resolver, auth, args);
  const client = await clientFilter(resolver, args.client);
  const project = await projectFilter(resolver, args.project);
  const status = await statusFilter(ctx, auth.orgId, args.status);
  const labelId = await labelFilter(ctx, auth.orgId, args.label);

  let dueBefore = args.due.to;
  if (args.overdue) {
    if (status.closedAllowed) {
      throw new ConvexError("overdue covers open tasks only. Drop status, or drop overdue.");
    }
    const yesterday = addDaysToDateString(clock.today, -1);
    dueBefore = dueBefore === undefined || yesterday < dueBefore ? yesterday : dueBefore;
  }

  const filterUpdated = args.updatedSince !== undefined || args.updated.from !== undefined || args.updated.to !== undefined;
  const { matched, loadTruncated } = await findTaskDocsForAuth(ctx, auth, {
    statusId: status.statusId,
    category: status.category,
    includeClosed: status.includeClosed,
    clientId: client?._id,
    projectId: project?._id,
    assigneeId,
    labelId,
    dueAfter: args.due.from,
    dueBefore,
    search: args.query,
    where: filterUpdated ? (t) => updatedMatch(t.lastActivityAt ?? t.updatedAt, args, clock) : undefined,
  });

  const shown = page(matched, args);
  const base = await toAgentTaskRows(ctx, auth.orgId, shown);
  // The identifier's key already is the project code: no project column.
  const rows = shown.map((task, i) => ({
    identifier: task.identifier,
    title: task.title,
    status: base[i].status,
    statusCategory: task.statusCategory,
    priority: base[i].priority,
    assignees: base[i].assignees,
    dueDate: base[i].dueDate,
    overdue: isOverdue(task, clock.today),
    parent: base[i].parent,
  }));
  const result: SearchPage<(typeof rows)[number]> & { today: string } = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete: loadTruncated,
    notes: [],
    today: clock.today,
  };
  return result;
}

// ─── Projects, clients, members (workspace reference data) ───────────────────

/** Org rows of a reference table read under `REF_CAP`; `incomplete` when clipped. */
function capped<T>(rows: T[]): { rows: T[]; incomplete: boolean } {
  return { rows: rows.slice(0, REF_CAP), incomplete: rows.length > REF_CAP };
}

/** Active before archived, then by a display key. */
function activeFirst<T extends { archivedAt?: number }>(key: (row: T) => string) {
  return (a: T, b: T) =>
    Number(a.archivedAt !== undefined) - Number(b.archivedAt !== undefined) || key(a).localeCompare(key(b));
}

export async function searchProjects(
  ctx: QueryCtx,
  auth: AuthContext,
  args: PageArgs & { query?: string; client?: string },
) {
  assertPage(args);
  const client = await clientFilter(createRefResolver(ctx, auth), args.client);
  const loaded = capped(
    client
      ? await ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", client._id)).take(REF_CAP + 1)
      : await ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId)).take(REF_CAP + 1),
  );
  const matched = loaded.rows
    .filter((p) => p.orgId === auth.orgId && textMatch(args.query, p.name, p.code))
    .sort(activeFirst((p) => p.code));
  const clientCache = new Map<Id<"clients">, Doc<"clients"> | null>();
  const rows = [];
  for (const p of page(matched, args)) {
    if (!clientCache.has(p.clientId)) {
      const c = await ctx.db.get(p.clientId);
      clientCache.set(p.clientId, c && c.orgId === auth.orgId ? c : null);
    }
    const c = clientCache.get(p.clientId) ?? null;
    rows.push({
      id: p._id,
      code: p.code,
      name: p.name,
      client: c ? { name: c.name, prefix: referenceClientPrefix(c) } : null,
      archived: p.archivedAt !== undefined,
    });
  }
  const result: SearchPage<(typeof rows)[number]> = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete: loaded.incomplete,
    notes: [],
  };
  return result;
}

export async function searchClients(ctx: QueryCtx, auth: AuthContext, args: PageArgs & { query?: string }) {
  assertPage(args);
  const loaded = capped(
    await ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId)).take(REF_CAP + 1),
  );
  const matched = loaded.rows
    .filter((c) => textMatch(args.query, c.name, referenceClientPrefix(c)))
    .sort(activeFirst((c) => c.name));
  const rows = page(matched, args).map((c) => ({
    id: c._id,
    name: c.name,
    prefix: referenceClientPrefix(c),
    archived: c.archivedAt !== undefined,
  }));
  const result: SearchPage<(typeof rows)[number]> = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete: loaded.incomplete,
    notes: [],
  };
  return result;
}

export async function searchMembers(ctx: QueryCtx, auth: AuthContext, args: PageArgs & { query?: string }) {
  assertPage(args);
  const loaded = capped(
    await ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId)).take(REF_CAP + 1),
  );
  const members = [];
  for (const m of loaded.rows) {
    const user = m.userId ? await ctx.db.get(m.userId) : null;
    if (user && !user.deletedAt) members.push({ id: user._id, name: user.name, email: user.email ?? null, role: m.role });
  }
  const matched = members
    .filter((m) => textMatch(args.query, m.name, m.email))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const rows = page(matched, args);
  const result: SearchPage<(typeof rows)[number]> = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete: loaded.incomplete,
    notes: [],
  };
  return result;
}

// ─── Time entries ────────────────────────────────────────────────────────────

export type TimeSearchArgs = PageArgs & {
  query?: string;
  assignee?: string;
  mine?: boolean;
  task?: string;
  client?: string;
  project?: string;
  tracked: DateRangeArgs;
  updated: DateRangeArgs;
  updatedSince?: number;
  now: number;
};

/**
 * Time entries the caller may see (admins: the org, members: their own, as
 * in the app), loaded through the most selective index: the person's
 * `by_userId_date` range, the task's entries, the org's date range when
 * dates are given, a project's entries, else the org's latest entries.
 */
export async function searchTimeEntries(ctx: QueryCtx, auth: AuthContext, args: TimeSearchArgs) {
  assertPage(args);
  assertRange(args.tracked, "tracked");
  assertRange(args.updated, "updated");
  const clock = await orgClock(ctx, auth.orgId, args.now);
  const resolver = createRefResolver(ctx, auth);
  const person = await personFilter(resolver, auth, args);
  const task = await taskFilter(resolver, args.task);
  const client = await clientFilter(resolver, args.client);
  const project = await projectFilter(resolver, args.project);
  const notes: string[] = [];

  // Members see only their own entries (visibleTimeEntries).
  if (!auth.isAdmin && person !== undefined && person !== auth.userId) {
    notes.push("Members see only their own time entries, so entries logged by others are not shown.");
  }
  const userId = auth.isAdmin ? person : auth.userId;
  const { from, to } = args.tracked;
  const hasDates = from !== undefined || to !== undefined;

  let loaded: Doc<"timeEntries">[];
  if (task !== undefined) {
    loaded = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .take(TIME_SEARCH_CAP + 1);
  } else if (userId !== undefined) {
    loaded = await ctx.db
      .query("timeEntries")
      .withIndex("by_userId_date", (q) => {
        const scoped = q.eq("userId", userId);
        if (from !== undefined && to !== undefined) return scoped.gte("date", from).lte("date", to);
        if (from !== undefined) return scoped.gte("date", from);
        if (to !== undefined) return scoped.lte("date", to);
        return scoped;
      })
      .order("desc")
      .take(TIME_SEARCH_CAP + 1);
  } else if (project !== undefined && !hasDates) {
    loaded = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_projectId_closeId", (q) => q.eq("orgId", auth.orgId).eq("projectId", project._id))
      .take(TIME_SEARCH_CAP + 1);
  } else {
    loaded = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_date", (q) => {
        const scoped = q.eq("orgId", auth.orgId);
        if (from !== undefined && to !== undefined) return scoped.gte("date", from).lte("date", to);
        if (from !== undefined) return scoped.gte("date", from);
        if (to !== undefined) return scoped.lte("date", to);
        return scoped;
      })
      .order("desc")
      .take(TIME_SEARCH_CAP + 1);
  }
  const incomplete = loaded.length > TIME_SEARCH_CAP;

  // Client filter: through each entry's project (stamped from its task).
  const projectClient = new Map<Id<"projects">, Id<"clients"> | null>();
  const clientOf = async (projectId: Id<"projects">) => {
    if (!projectClient.has(projectId)) {
      const p = await ctx.db.get(projectId);
      projectClient.set(projectId, p && p.orgId === auth.orgId ? p.clientId : null);
    }
    return projectClient.get(projectId) ?? null;
  };

  const visible = visibleTimeEntries(
    auth,
    loaded.slice(0, TIME_SEARCH_CAP).filter((e) => e.orgId === auth.orgId),
  );
  const matched: Doc<"timeEntries">[] = [];
  for (const e of visible) {
    if (person !== undefined && e.userId !== person) continue;
    if (task !== undefined && e.taskId !== task._id) continue;
    if (project !== undefined && e.projectId !== project._id) continue;
    if (!inRange(e.date, args.tracked)) continue;
    if (!updatedMatch(e.updatedAt, args, clock)) continue;
    if (!textMatch(args.query, e.note)) continue;
    if (client !== undefined && (await clientOf(e.projectId)) !== client._id) continue;
    matched.push(e);
  }
  matched.sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt || a._id.localeCompare(b._id));

  const nameOf = userNames(ctx);
  const rows = [];
  for (const e of page(matched, args)) rows.push(await timeEntryRow(ctx, auth.orgId, e, nameOf));
  const result: SearchPage<(typeof rows)[number]> & { totalMinutes: number } = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete,
    notes,
    totalMinutes: matched.reduce((sum, e) => sum + e.durationMinutes, 0),
  };
  return result;
}

// ─── Comments ────────────────────────────────────────────────────────────────

export type CommentSearchArgs = PageArgs & {
  query?: string;
  assignee?: string;
  mine?: boolean;
  task?: string;
  client?: string;
  project?: string;
  updated: DateRangeArgs;
  updatedSince?: number;
  now: number;
};

type CommentCandidate = {
  id: Id<"comments">;
  task: Doc<"tasks">;
  userId: Id<"users">;
  createdAt: number;
  content: unknown;
};

/** Comments of one readable task (its `by_task` range, capped by the comments core). */
async function taskCommentCandidates(ctx: QueryCtx, auth: AuthContext, task: Doc<"tasks">) {
  const result = await listTaskCommentsForAuth(ctx, auth, task._id);
  const candidates: CommentCandidate[] = (result?.comments ?? []).map((c) => ({
    id: c._id,
    task,
    userId: c.userId,
    createdAt: c.createdAt,
    content: c.content,
  }));
  return { candidates, incomplete: result?.truncated ?? false };
}

/**
 * Comments on readable tasks found through their `comment_added` activity
 * rows (`activityLog.by_org`, newest first, `COMMENT_SCAN_CAP` rows): comments
 * have no org index. The "updated" filters narrow that scan by when the
 * comment was written.
 */
async function orgCommentCandidates(ctx: QueryCtx, auth: AuthContext, args: CommentSearchArgs) {
  // Index range in epoch ms, widened by a day on each side for timezones;
  // exact matching on the org-timezone date happens afterwards.
  let lower = args.updatedSince;
  if (args.updated.from !== undefined) {
    const fromMs = Date.parse(`${args.updated.from}T00:00:00Z`) - DAY_MS;
    lower = lower === undefined ? fromMs : Math.max(lower, fromMs);
  }
  const upper = args.updated.to !== undefined ? Date.parse(`${args.updated.to}T00:00:00Z`) + 2 * DAY_MS : undefined;
  const events = await ctx.db
    .query("activityLog")
    .withIndex("by_org", (q) => {
      const scoped = q.eq("orgId", auth.orgId);
      if (lower !== undefined && upper !== undefined) return scoped.gt("createdAt", lower).lt("createdAt", upper);
      if (lower !== undefined) return scoped.gt("createdAt", lower);
      if (upper !== undefined) return scoped.lt("createdAt", upper);
      return scoped;
    })
    .order("desc")
    .take(COMMENT_SCAN_CAP + 1);

  const comments: Doc<"comments">[] = [];
  const seen = new Set<Id<"comments">>();
  for (const event of events.slice(0, COMMENT_SCAN_CAP)) {
    if (event.type !== "comment_added") continue;
    const id = event.metadata.commentId;
    if (seen.has(id)) continue;
    seen.add(id);
    const comment = await ctx.db.get(id);
    if (comment && comment.orgId === auth.orgId) comments.push(comment);
  }

  // Access: only comments on tasks the caller can read (tasks/access.ts).
  const tasks = new Map<Id<"tasks">, Doc<"tasks">>();
  for (const c of comments) {
    if (tasks.has(c.taskId)) continue;
    const task = await ctx.db.get(c.taskId);
    if (task) tasks.set(c.taskId, task);
  }
  const readable = new Map(
    (await filterReadableTasks(ctx, auth, [...tasks.values()])).map((t) => [t._id, t] as const),
  );
  const candidates: CommentCandidate[] = [];
  for (const c of comments) {
    const task = readable.get(c.taskId);
    if (task) candidates.push({ id: c._id, task, userId: c.userId, createdAt: c.createdAt, content: c.content });
  }
  return { candidates, incomplete: events.length > COMMENT_SCAN_CAP };
}

/** Comments on tasks the caller can read, newest first. */
export async function searchComments(ctx: QueryCtx, auth: AuthContext, args: CommentSearchArgs) {
  assertPage(args);
  assertRange(args.updated, "updated");
  const clock = await orgClock(ctx, auth.orgId, args.now);
  const resolver = createRefResolver(ctx, auth);
  const author = await personFilter(resolver, auth, args);
  const task = await taskFilter(resolver, args.task);
  const client = await clientFilter(resolver, args.client);
  const project = await projectFilter(resolver, args.project);

  const { candidates, incomplete } = task
    ? await taskCommentCandidates(ctx, auth, task)
    : await orgCommentCandidates(ctx, auth, args);
  const matched = candidates.filter((c) => {
    if (author !== undefined && c.userId !== author) return false;
    if (project !== undefined && c.task.projectId !== project._id) return false;
    if (client !== undefined && c.task.clientId !== client._id) return false;
    if (!updatedMatch(c.createdAt, args, clock)) return false;
    return textMatch(args.query, extractPlainText(c.content));
  });
  matched.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const nameOf = userNames(ctx);
  const rows = [];
  for (const c of page(matched, args)) {
    const text = commentPreview(c.content, COMMENT_PREVIEW_CHARS);
    rows.push({
      id: c.id,
      task: { identifier: c.task.identifier, title: c.task.title },
      author: await nameOf(c.userId),
      createdAt: c.createdAt,
      text: text.text.replace(/\s+/g, " ").trim(),
      textTruncated: text.truncated,
    });
  }
  const result: SearchPage<(typeof rows)[number]> & { timezone: string } = {
    rows,
    total: matched.length,
    offset: args.offset,
    incomplete,
    notes: [],
    timezone: clock.timezone,
  };
  return result;
}
