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
import { visibleTimeEntries } from "../timeEntries";
import type { Resolved } from "./mcpRefs";
import { listTaskExternalRefs } from "./mcpExternalRefs";
import { capText, mentionedUserIds, tiptapToMarkdown } from "../../lib/mcp/tiptap-markdown";
import { safeParseDoc } from "./notificationEvents";
import type { FetchInclude } from "../../lib/mcp/limits";

/**
 * Compact data for MCP `fetch` records (docs/prd-mcp.md §6, §7). Convex
 * returns data, the Next.js route renders markdown. Everything is read
 * through the app's cores with the caller's auth (`*ForAuth`), so a member
 * sees exactly what the app shows them. No money: rates, fees and amounts
 * are never part of a record.
 *
 * Bodies (descriptions, comments) are never cut here: the route fits a
 * result into its size budget by showing fewer list rows, and says so.
 * Lists are bounded; anything not returned is counted and flagged.
 *
 * Read budget per record (Convex: 4,096 index ranges, 32,000 documents per
 * call; the route fetches one ref per call): a task with every include is
 * about 30 ranges plus one per distinct comment author / activity actor /
 * time-entry member, two per distinct mentioned user, and at most ~3,100 documents (comments 501, activity
 * 501, time entries 2,001, files 51 + 51, sub-tasks 201, external refs 51).
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

async function taskRecord(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">, include: ReadonlySet<FetchInclude>, clock: OrgClock) {
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
    files: include.has("files") || include.has("attachment_text") ? await taskFiles(ctx, auth, taskId) : null,
    // The attachment text extraction (attachmentContents) does not exist yet:
    // say so explicitly rather than pretend a file has no text.
    attachmentText: include.has("attachment_text") ? { available: false as const } : null,
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
  const recent = [];
  for (const e of visible.slice(0, RECENT_ROWS)) recent.push(await timeEntryRow(ctx, auth.orgId, e, nameOf));
  return {
    rows: recent,
    total: visible.length,
    totalMinutes: visible.reduce((sum, e) => sum + e.durationMinutes, 0),
    /** Members see only their own entries, like the app. */
    ownOnly: !auth.isAdmin,
    truncated: rows.length > TASK_TIME_CAP,
  };
}

async function taskFiles(ctx: QueryCtx, auth: AuthContext, taskId: Id<"tasks">) {
  const own = await listTaskAttachmentsForAuth(ctx, auth, taskId, FILES_MAX);
  const onComments = await listCommentAttachmentsForAuth(ctx, auth, taskId, FILES_MAX);
  const rows = [
    ...(own?.attachments ?? []).map((a) => ({
      name: a.fileName,
      size: a.fileSize,
      mimeType: a.mimeType,
      url: a.url,
      onComment: false,
    })),
    ...(onComments?.attachments ?? []).map((a) => ({
      name: a.fileName,
      size: a.fileSize,
      mimeType: a.mimeType,
      url: a.url,
      onComment: true,
    })),
  ];
  return {
    rows: rows.slice(0, FILES_MAX),
    truncated: rows.length > FILES_MAX || (own?.truncated ?? false) || (onComments?.truncated ?? false),
  };
}

/** One time entry as a row (no rates or amounts). */
export async function timeEntryRow(
  ctx: QueryCtx,
  orgId: string,
  entry: Doc<"timeEntries">,
  nameOf: (id: Id<"users">) => Promise<string>,
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
    task: task && task.orgId === orgId ? { identifier: task.identifier, title: task.title } : null,
  };
}

/**
 * The record for a resolved reference. Null only for a task that became
 * unreadable between resolution and load (treated as not found).
 */
export async function buildRecord(
  ctx: QueryCtx,
  auth: AuthContext,
  resolved: Resolved,
  include: ReadonlySet<FetchInclude>,
  clock: OrgClock,
) {
  const { orgId } = auth;
  switch (resolved.type) {
    case "task":
      return await taskRecord(ctx, auth, resolved.access.task._id, include, clock);

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
      const row = await timeEntryRow(ctx, orgId, resolved.entry, userNames(ctx));
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
        archived: project.archivedAt !== undefined,
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
  }
}
