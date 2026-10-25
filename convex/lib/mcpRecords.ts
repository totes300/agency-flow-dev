import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { referenceClientPrefix } from "./helpers";
import { getOrgSettings } from "./orgHelpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./timer";
import { listTaskCommentsForAuth } from "../comments";
import { listTaskActivityForAuth } from "../activityLog";
import { listTaskAttachmentsForAuth } from "../attachments";
import { listCommentAttachmentsForAuth } from "../commentAttachments";
import { getTaskDetailForAuth } from "../tasks/lookup";
import { isClosedCategory } from "../tasks/model";
import { rankTaskSegments } from "./plannerMath";
import { visibleTimeEntries } from "../timeEntries";
import type { Resolved } from "./mcpRefs";
import { listTaskExternalRefs } from "./mcpExternalRefs";
import { projectTermsForAuth } from "./mcpProjectTerms";
import { capText, mentionedUserIds, tiptapToMarkdown } from "../../lib/mcp/tiptap-markdown";
import { loadContent } from "../attachmentContents";
import { ATTACHMENT_TEXT_FETCH_MAX, contentMessage, pageStoredText } from "../../lib/attachments/contents";
import { safeParseDoc } from "./notificationEvents";
import { getInvoiceForAuth } from "../invoices";
import { invoiceDisplayStatus } from "./billing/periodState";
import { periodRangeLabel } from "./billing/projectPeriods";
import { daysPastDue, invoiceKey } from "./mcpRefs";
import type { FetchInclude } from "../../lib/mcp/limits";

/**
 * Compact data for MCP `fetch` records (docs/prd-mcp.md §6, §7). Convex
 * returns data, the Next.js route renders markdown. Everything is read
 * through the app's cores with the caller's auth (`*ForAuth`), so a member
 * sees exactly what the app shows them. No money: rates, fees and amounts
 * are never part of a record — except for admins: invoices (as the app's
 * /invoices route, from the invoice page's own core `getInvoiceForAuth`,
 * amounts in minor units) and a project's billing terms (as its Settings
 * tab, convex/lib/mcpProjectTerms.ts, amounts in major units as stored).
 *
 * Bodies (descriptions, comments) are never cut here: the route fits a
 * result into its size budget by showing fewer list rows, and says so.
 * Lists are bounded; anything not returned is counted and flagged.
 *
 * Read budget per record (Convex: 4,096 index ranges, 32,000 documents per
 * call; the route fetches one ref per call): a task with every include is
 * about 30 ranges plus one per distinct comment author / activity actor /
 * time-entry member / planner-bar member or category, two per distinct mentioned user, and at most ~3,200 documents
 * (comments 501, activity 501, time entries 2,001, plan 101, files 51 + 51, sub-tasks 201, external refs 51);
 * attachment_text adds one range per listed file (≤ 50) and up to 50 × 50,000 characters of stored text.
 * A daily note is one read plus its author and mentioned users.
 */

/** Most recent comments / activity events / time entries returned per task. */
export const RECENT_ROWS = 30;
/** Time entries read per task (the total covers all of them). */
export const TASK_TIME_CAP = 2000;
/** Files listed per task (task + comment attachments). */
export const FILES_MAX = 50;
/** Note cap per time entry row (marked with "…" when cut). */
export const NOTE_MAX_CHARS = 300;
/** Projects listed on a client record. */
export const CLIENT_PROJECTS_MAX = 50;
/** Planner bars listed per task (include "plan"). */
export const PLAN_ROWS_MAX = 100;

export type OrgClock = { timezone: string; today: string };

/** The org's timezone and today's date there (`now` comes from the caller: no clock reads in queries). */
export async function orgClock(ctx: QueryCtx, orgId: string, now: number): Promise<OrgClock> {
  const timezone = (await getOrgSettings(ctx, orgId))?.timezone ?? ORG_TIMEZONE_FALLBACK;
  return { timezone, today: getDateInTimezone(now, timezone) };
}

/** Names of users, memoized for one call. */
export function userNames(ctx: QueryCtx) {
  const cache = new Map<Id<"users">, string>();
  return async (id: Id<"users">): Promise<string> => {
    const known = cache.get(id);
    if (known !== undefined) return known;
    const name = (await ctx.db.get(id))?.name ?? "Former member";
    cache.set(id, name);
    return name;
  };
}

/** Work category names of the org, memoized for one call (null: none, or not this org's). */
export function categoryNames(ctx: QueryCtx, orgId: string) {
  const cache = new Map<Id<"workCategories">, string | null>();
  return async (id: Id<"workCategories"> | undefined): Promise<string | null> => {
    if (id === undefined) return null;
    if (!cache.has(id)) {
      const category = await ctx.db.get(id);
      cache.set(id, category && category.orgId === orgId ? category.name : null);
    }
    return cache.get(id) ?? null;
  };
}

/**
 * Rich text → markdown with mentions as `@email` (org members only, memoized
 * per call), so a fetched body edited and saved back keeps its mentions.
 * Two reads per distinct mentioned user.
 */
export function richTextMarkdown(ctx: QueryCtx, orgId: string) {
  const emails = new Map<string, string | null>();
  async function load(content: unknown) {
    for (const id of mentionedUserIds(content)) {
      if (emails.has(id)) continue;
      const userId = ctx.db.normalizeId("users", id);
      const user = userId ? await ctx.db.get(userId) : null;
      const memberships = userId
        ? await ctx.db.query("orgMembers").withIndex("by_userId", (q) => q.eq("userId", userId)).take(100)
        : [];
      const member = user && !user.deletedAt && memberships.some((m) => m.orgId === orgId);
      emails.set(id, member ? (user.email ?? null) : null);
    }
  }
  const mentionEmail = (id: string) => emails.get(id) ?? undefined;
  return {
    async content(content: unknown): Promise<string> {
      await load(content);
      return tiptapToMarkdown(content, { mentionEmail });
    },
    /** A stored description (Tiptap JSON string; legacy plain text passes through); null when empty. */
    async description(description: string | undefined): Promise<string | null> {
      if (!description) return null;
      const doc = safeParseDoc(description);
      const text = doc ? await this.content(doc) : description.trim();
      return text === "" ? null : text;
    },
  };
}

/** A project's code and name when it belongs to the org. */
export async function projectSummary(ctx: QueryCtx, orgId: string, projectId: Id<"projects"> | undefined) {
  const project = projectId ? await ctx.db.get(projectId) : null;
  return project && project.orgId === orgId ? { id: project._id, code: project.code, name: project.name } : null;
}

/** A client's name and prefix when it belongs to the org. */
export async function clientSummary(ctx: QueryCtx, orgId: string, clientId: Id<"clients"> | undefined) {
  const client = clientId ? await ctx.db.get(clientId) : null;
  return client && client.orgId === orgId
    ? { id: client._id, name: client.name, prefix: referenceClientPrefix(client) }
    : null;
}

/** A comment preview (search rows): markdown capped at `max`, flagged when cut. */
export function commentPreview(content: unknown, max: number) {
  return capText(tiptapToMarkdown(content), max);
}

/** Whether a task is open and due before today (org timezone). */
export function isOverdue(task: Pick<Doc<"tasks">, "dueDate" | "statusCategory">, today: string): boolean {
  return task.dueDate !== undefined && task.dueDate < today && !isClosedCategory(task.statusCategory);
}

async function taskRecord(
  ctx: QueryCtx,
  auth: AuthContext,
  taskId: Id<"tasks">,
  include: ReadonlySet<FetchInclude>,
  clock: OrgClock,
  file: FileSelection | undefined,
) {
  const found = await getTaskDetailForAuth(ctx, auth, taskId);
  if (!found) return null;
  const { detail, access } = found;
  const { task } = access;
  const markdown = richTextMarkdown(ctx, auth.orgId);
  const description = await markdown.description(task.description);
  // The checklist's next step (D24): the first open sub-task in sort order.
  const next = detail.subtasks.find((s) => s.statusCategory !== null && !isClosedCategory(s.statusCategory));

  const record = {
    type: "task" as const,
    id: task._id,
    identifier: task.identifier,
    title: task.title,
    status: detail.status,
    statusCategory: task.statusCategory,
    priority: detail.priority,
    project: await projectSummary(ctx, auth.orgId, task.projectId),
    client: await clientSummary(ctx, auth.orgId, task.clientId),
    assignees: detail.assignees,
    labels: detail.labels,
    workCategory: detail.workCategory,
    startDate: detail.startDate,
    dueDate: detail.dueDate,
    overdue: isOverdue(task, clock.today),
    estimateMinutes: detail.estimateMinutes,
    trackedMinutes: detail.trackedMinutes,
    billable: detail.billable,
    archived: detail.archived,
    parent: detail.parent,
    createdAt: task.createdAt,
    lastActivityAt: task.lastActivityAt ?? task.updatedAt,
    commentCount: task.commentCount ?? 0,
    subtaskCount: task.subtaskCount ?? 0,
    subtaskDoneCount: task.subtaskDoneCount ?? 0,
    nextStep: next ? { identifier: next.identifier, title: next.title, assignees: next.assignees } : null,
    externalRefs: await listTaskExternalRefs(ctx, auth.orgId, task._id),
    description,
    subtasks: include.has("subtasks")
      ? {
          rows: detail.subtasks.map((s) => ({
            identifier: s.identifier,
            title: s.title,
            status: s.status,
            statusCategory: s.statusCategory,
            assignees: s.assignees,
          })),
          truncated: detail.subtasksTruncated,
        }
      : null,
    comments: include.has("comments") ? await taskComments(ctx, auth, taskId, markdown) : null,
    activity: include.has("activity") ? await taskActivity(ctx, auth, taskId) : null,
    time: include.has("time") ? await taskTime(ctx, auth, taskId) : null,
    plan: include.has("plan") ? await taskPlan(ctx, auth, taskId) : null,
    // attachment_text implies the file list: each file then carries its
    // extracted text (or why there is none).
    files:
      include.has("files") || include.has("attachment_text") || file !== undefined
        ? await taskFiles(ctx, auth, task, include.has("attachment_text"), file)
        : null,
  };
  return record;
}

async function taskComments(
  ctx: QueryCtx,
  auth: AuthContext,
  taskId: Id<"tasks">,
  markdown: ReturnType<typeof richTextMarkdown>,
) {
  const result = await listTaskCommentsForAuth(ctx, auth, taskId);
  if (!result) return { rows: [], total: 0, truncated: false };
  const recent = result.comments.slice(-RECENT_ROWS);
  const rows = [];
  for (const c of recent) {
    rows.push({
      id: c._id,
      author: c.userName,
      createdAt: c.createdAt,
      edited: c.updatedAt > c.createdAt,
      replyTo: c.parentCommentId ? (c.parentUserName ?? null) : null,
      resolved: c.resolvedAt !== undefined,
      text: await markdown.content(c.content),
    });
  }
  return {
    rows,
    /** Comments read (at most the core's cap); `truncated` = more exist. */
    total: result.comments.length,
    truncated: result.truncated,
  };
}

async function taskActivity(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">) {
  const result = await listTaskActivityForAuth(ctx, auth, taskId);
  if (!result) return { rows: [], total: 0, truncated: false };
  return {
    rows: result.events.slice(-RECENT_ROWS).map((e) => ({
      type: e.type,
      userName: e.userName,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    total: result.events.length,
    truncated: result.truncated,
  };
}

async function taskTime(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">) {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
    .take(TASK_TIME_CAP + 1);
  const inOrg = rows.slice(0, TASK_TIME_CAP).filter((e) => e.orgId === auth.orgId);
  const visible = visibleTimeEntries(auth, inOrg).sort(
    (a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt,
  );
  const nameOf = userNames(ctx);
  const categoryOf = categoryNames(ctx, auth.orgId);
  const recent = [];
  for (const e of visible.slice(0, RECENT_ROWS)) recent.push(await timeEntryRow(ctx, auth.orgId, e, nameOf, categoryOf));
  return {
    rows: recent,
    total: visible.length,
    totalMinutes: visible.reduce((sum, e) => sum + e.durationMinutes, 0),
    /** Members see only their own entries, like the app. */
    ownOnly: !auth.isAdmin,
    truncated: rows.length > TASK_TIME_CAP,
  };
}

/**
 * The task's Planner bars, as the drawer's Plan section (`planner.taskSegments`):
 * every org member reads the shared board. Sorted by start, with the part
 * badges the board shows (1/2, 2/2).
 */
async function taskPlan(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">) {
  const segments = await ctx.db
    .query("planSegments")
    .withIndex("by_orgId_taskId", (q) => q.eq("orgId", auth.orgId).eq("taskId", taskId))
    .take(PLAN_ROWS_MAX + 1);
  const shown = segments.slice(0, PLAN_ROWS_MAX);
  const rank = rankTaskSegments(shown);
  const nameOf = userNames(ctx);
  const rows = [];
  for (const s of [...shown].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))) {
    rows.push({
      id: s._id,
      member: await nameOf(s.userId),
      mine: s.userId === auth.userId,
      startDate: s.startDate,
      endDate: s.endDate,
      partIndex: rank.get(s._id)?.partIndex ?? 1,
      partCount: rank.get(s._id)?.partCount ?? 1,
    });
  }
  return { rows, truncated: segments.length > PLAN_ROWS_MAX };
}

/** A single file of a task to read (fetch `file`): by attachment id or file name, from `offset`. */
export type FileSelection = { id?: string; name?: string; offset?: number };

/**
 * What an agent may read of a file (attachmentContents, ported extraction):
 * the status with an honest sentence, one page of the stored text from
 * `offset` (at most ATTACHMENT_TEXT_FETCH_MAX characters, `nextOffset` when
 * more is stored) for PDF / DOCX / text files, the size for images.
 * `status: "not_processed"` = no row (attached before extraction existed).
 */
async function fileText(ctx: QueryCtx, orgId: string, fileId: Id<"_storage">, offset: number) {
  const row = await loadContent(ctx, orgId, fileId);
  const stored = row?.status === "done" && row.text ? row.text : null;
  const page = stored !== null ? pageStoredText(stored, offset, ATTACHMENT_TEXT_FETCH_MAX) : null;
  return {
    status: row?.status ?? ("not_processed" as const),
    message: contentMessage(row),
    /** This page of the stored text; null when none was extracted. */
    text: page?.text ?? null,
    /** Where this page starts in the stored text. */
    offset: page?.offset ?? 0,
    /** Where the next page starts; null at the end of the stored text. */
    nextOffset: page?.nextOffset ?? null,
    /** Characters stored for this file (the extraction keeps at most 50,000). */
    totalChars: stored?.length ?? 0,
    /** The extraction itself stopped at its 50,000-character cap. */
    extractionTruncated: row?.truncated ?? false,
    pageCount: row?.pageCount ?? null,
    width: row?.width ?? null,
    height: row?.height ?? null,
  };
}

type FileEntry = {
  id: string;
  fileId: Id<"_storage">;
  name: string;
  size: number;
  mimeType: string;
  url: string | null;
  commentId: Id<"comments"> | null;
};

/** The one file a `file` selection names on this task, or a model-actionable error. */
function selectFile(entries: readonly FileEntry[], selection: FileSelection, taskKey: string): FileEntry {
  if (selection.id !== undefined) {
    const id = selection.id.trim();
    const byId = entries.find((e) => e.id === id);
    if (!byId) throw new ConvexError(`No file with id ${selection.id} on ${taskKey}. File ids are listed by fetch with include ["files"].`);
    if (selection.name !== undefined && byId.name !== selection.name) {
      throw new ConvexError(`File ${selection.id} on ${taskKey} is named "${byId.name}", not "${selection.name}". Pass id or name.`);
    }
    return byId;
  }
  const wanted = (selection.name ?? "").trim().toLowerCase();
  const matches = entries.filter((e) => e.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const names = entries.map((e) => `"${e.name}"`).slice(0, 20).join(", ");
    throw new ConvexError(`No file named "${selection.name}" on ${taskKey}.${names ? ` Its files: ${names}.` : " It has no files."}`);
  }
  throw new ConvexError(
    `Several files on ${taskKey} are named "${selection.name}": pass file.id — ${matches.map((m) => m.id).join(", ")}.`,
  );
}

async function taskFiles(
  ctx: QueryCtx,
  auth: AuthContext,
  task: { _id: Id<"tasks">; identifier?: string },
  withText: boolean,
  selection: FileSelection | undefined,
) {
  const own = await listTaskAttachmentsForAuth(ctx, auth, task._id, FILES_MAX);
  const onComments = await listCommentAttachmentsForAuth(ctx, auth, task._id, FILES_MAX);
  const all: FileEntry[] = [
    ...(own?.attachments ?? []).map((a) => ({
      id: a._id as string,
      fileId: a.fileId,
      name: a.fileName,
      size: a.fileSize,
      mimeType: a.mimeType,
      url: a.url,
      commentId: null,
    })),
    ...(onComments?.attachments ?? []).map((a) => ({
      id: a._id as string,
      fileId: a.fileId,
      name: a.fileName,
      size: a.fileSize,
      mimeType: a.mimeType,
      url: a.url,
      commentId: a.commentId,
    })),
  ];
  const listTruncated = all.length > FILES_MAX || (own?.truncated ?? false) || (onComments?.truncated ?? false);
  const chosen = selection ? [selectFile(all, selection, task.identifier ?? task._id)] : all.slice(0, FILES_MAX);
  const rows = [];
  for (const { fileId, ...file } of chosen) {
    rows.push({
      ...file,
      onComment: file.commentId !== null,
      text: withText || selection ? await fileText(ctx, auth.orgId, fileId, selection?.offset ?? 0) : null,
    });
  }
  return {
    rows,
    truncated: selection ? false : listTruncated,
    /** include attachment_text (or a file selection): every row carries `text`. */
    withText: withText || selection !== undefined,
    /** A single file was asked for (fetch `file`): `rows` holds only it. */
    selected: selection !== undefined,
  };
}

/** One time entry as a row (no rates or amounts). */
export async function timeEntryRow(
  ctx: QueryCtx,
  orgId: string,
  entry: Doc<"timeEntries">,
  nameOf: (id: Id<"users">) => Promise<string>,
  categoryOf: (id: Id<"workCategories"> | undefined) => Promise<string | null>,
) {
  const task = await ctx.db.get(entry.taskId);
  const note = entry.note ? capText(entry.note.replace(/\s+/g, " ").trim(), NOTE_MAX_CHARS) : null;
  return {
    id: entry._id,
    date: entry.date,
    minutes: entry.durationMinutes,
    member: await nameOf(entry.userId),
    note: note?.text ?? null,
    noteTruncated: note?.truncated ?? false,
    billable: entry.isBillable,
    /** The entry's own billing category (snapshot), not the task's. */
    category: await categoryOf(entry.snapshotCategoryId),
    task: task && task.orgId === orgId ? { identifier: task.identifier, title: task.title } : null,
  };
}

/** A project's team (`teamMembers`, validated org members, so the list is small): names and emails, deleted users skipped. */
async function projectTeam(ctx: QueryCtx, ids: readonly Id<"users">[] | undefined) {
  const team = [];
  for (const id of ids ?? []) {
    const user = await ctx.db.get(id);
    if (user && !user.deletedAt) team.push({ name: user.name, email: user.email ?? null });
  }
  return team;
}

/**
 * The record for a resolved reference. Null only for a task that became
 * unreadable between resolution and load (treated as not found). `include`
 * names task sections; another record says when it was passed
 * (`includeIgnored`) instead of dropping it silently.
 */
export async function buildRecord(
  ctx: QueryCtx,
  auth: AuthContext,
  resolved: Resolved,
  include: ReadonlySet<FetchInclude>,
  clock: OrgClock,
  file?: FileSelection,
) {
  const record = await recordFor(ctx, auth, resolved, include, clock, file);
  if (!record || record.type === "task") return record;
  return { ...record, includeIgnored: include.size > 0 };
}

async function recordFor(
  ctx: QueryCtx,
  auth: AuthContext,
  resolved: Resolved,
  include: ReadonlySet<FetchInclude>,
  clock: OrgClock,
  file: FileSelection | undefined,
) {
  const { orgId } = auth;
  if (file !== undefined && resolved.type !== "task") {
    throw new ConvexError("file selects an attachment of a task: pass a task ref.");
  }
  switch (resolved.type) {
    case "task":
      return await taskRecord(ctx, auth, resolved.access.task._id, include, clock, file);

    case "comment": {
      const { comment, access } = resolved;
      return {
        type: "comment" as const,
        id: comment._id,
        task: { identifier: access.task.identifier, title: access.task.title },
        author: await userNames(ctx)(comment.userId),
        createdAt: comment.createdAt,
        edited: comment.updatedAt > comment.createdAt,
        resolved: comment.resolvedAt !== undefined,
        isReply: comment.parentCommentId !== undefined,
        text: await richTextMarkdown(ctx, orgId).content(comment.content),
      };
    }

    case "time_entry": {
      const row = await timeEntryRow(ctx, orgId, resolved.entry, userNames(ctx), categoryNames(ctx, orgId));
      const project = await projectSummary(ctx, orgId, resolved.entry.projectId);
      return { type: "time_entry" as const, ...row, project };
    }

    case "project": {
      const { project } = resolved;
      return {
        type: "project" as const,
        id: project._id,
        code: project.code,
        name: project.name,
        client: await clientSummary(ctx, orgId, project.clientId),
        team: await projectTeam(ctx, project.teamMembers),
        archived: project.archivedAt !== undefined,
        /** Billing type and terms: admins only (the Settings tab); null for members — no billing data. */
        terms: await projectTermsForAuth(ctx, auth, project._id),
      };
    }

    case "client": {
      const { client } = resolved;
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
        .take(CLIENT_PROJECTS_MAX + 1);
      const inOrg = projects.filter((p) => p.orgId === orgId);
      return {
        type: "client" as const,
        id: client._id,
        name: client.name,
        prefix: referenceClientPrefix(client),
        archived: client.archivedAt !== undefined,
        projects: inOrg.slice(0, CLIENT_PROJECTS_MAX).map((p) => ({
          id: p._id,
          code: p.code,
          name: p.name,
          archived: p.archivedAt !== undefined,
        })),
        projectsTruncated: projects.length > CLIENT_PROJECTS_MAX,
      };
    }

    case "member":
      return {
        type: "member" as const,
        id: resolved.user._id,
        name: resolved.user.name,
        email: resolved.user.email ?? null,
        role: resolved.role,
      };

    case "invoice": {
      // The invoice page's core (admin-only); the resolver already refused members.
      const data = await getInvoiceForAuth(ctx, auth, resolved.invoice._id);
      if (!data) return null;
      const inv = data.invoice;
      const status = invoiceDisplayStatus(inv.status, inv.dueDate, clock.today);
      const categoryNames = new Map(data.categoryGroups.map((g) => [g.categoryId, g.categoryName]));
      return {
        type: "invoice" as const,
        id: inv._id,
        number: invoiceKey(inv),
        status,
        daysOverdue: status === "past_due" && inv.dueDate ? daysPastDue(inv.dueDate, clock.today) : null,
        subject: inv.subject ?? null,
        currency: inv.currency,
        subtotalMinor: inv.subtotalMinor,
        totalMinor: inv.totalMinor,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate ?? null,
        paidAt: inv.paidAt ?? null,
        project: await projectSummary(ctx, orgId, inv.projectId),
        billingType: data.project?.billingType ?? null,
        client: await clientSummary(ctx, orgId, inv.clientId),
        period: data.period
          ? { start: data.period.start, end: data.period.end, label: periodRangeLabel(data.period.start, data.period.end) }
          : null,
        lines: data.lineItems.map((li) => ({
          lineType: li.lineType,
          description: li.description,
          quantity: li.quantity,
          quantityMinutes: li.quantityMinutes ?? null,
          unitPriceMinor: li.unitPriceMinor,
          amountMinor: li.amountMinor,
          category: li.workCategoryId ? (categoryNames.get(li.workCategoryId) ?? null) : null,
        })),
        note: inv.note ?? null,
        messageToClient: inv.messageToClient ?? null,
      };
    }

    case "plan_segment": {
      const { segment } = resolved;
      const task = await ctx.db.get(segment.taskId);
      const rank = rankTaskSegments(
        await ctx.db
          .query("planSegments")
          .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", segment.taskId))
          .take(PLAN_ROWS_MAX),
      ).get(segment._id);
      return {
        type: "plan_segment" as const,
        id: segment._id,
        task: task && task.orgId === orgId ? { identifier: task.identifier ?? task._id, title: task.title } : null,
        member: { id: segment.userId, name: await userNames(ctx)(segment.userId) },
        mine: segment.userId === auth.userId,
        startDate: segment.startDate,
        endDate: segment.endDate,
        partIndex: rank?.partIndex ?? 1,
        partCount: rank?.partCount ?? 1,
      };
    }

    case "daily_note": {
      // The resolver already applied the app's rule (own notes; admins any member's).
      const { note } = resolved;
      const doc = safeParseDoc(note.content);
      return {
        type: "daily_note" as const,
        id: note._id,
        date: note.date,
        member: { id: note.userId, name: await userNames(ctx)(note.userId) },
        own: note.userId === auth.userId,
        updatedAt: note.updatedAt,
        text: doc ? await richTextMarkdown(ctx, orgId).content(doc) : (note.content ?? "").trim(),
      };
    }
  }
}
