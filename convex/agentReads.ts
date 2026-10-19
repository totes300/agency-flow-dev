import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { AuthContext } from "./lib/auth";
import { filterReadableTasks, loadTaskForReadOrNull } from "./tasks/access";
import { loadSubtasksOf } from "./tasks/read";
import { getTaskDetailForAuth, resolveTaskRef, type AgentTaskDetail } from "./tasks/agent";
import { resolveDefaultAssignee } from "./lib/task_helpers";
import {
  ACTIVITY_LIMIT_DEFAULT,
  ACTIVITY_LIMIT_MAX,
  ACTIVITY_SCAN_CAP,
  BUNDLE_ACTIVITY,
  BUNDLE_COMMENTS,
  BUNDLE_COMMENT_TEXT_MAX,
  BUNDLE_FILES,
  BUNDLE_LINKS,
  COMMENTS_LIMIT_DEFAULT,
  COMMENTS_LIMIT_MAX,
  COMMENT_TEXT_MAX,
  FILES_LIMIT,
  HIDDEN_ACTIVITY_TYPES,
  LINKS_LIMIT,
  LINK_SCAN_COMMENTS,
  SUBTASK_FANOUT_CAP,
  TIME_ENTRIES_LIMIT,
  TIME_ENTRIES_SCAN_CAP,
  clampLimit,
  describeActivity,
  extractLinks,
  extractMentionLabels,
  isoAt,
  newestLast,
  tiptapToPlainText,
} from "../lib/agents/taskReads";
import {
  ATTACHMENT_TEXT_PAGE_MAX,
  contentMessage,
  pageText,
  summarizeContent,
  type AttachmentContentSummary,
  type ContentStatus,
} from "../lib/attachments/contents";
import { loadContent } from "./attachmentContents";

/**
 * Backing reads of the A3 agent read tools (docs/prd-email-triage.md §6.4:
 * T3 getProjectRouting, T9 getTaskComments, T10 getTaskActivity, T11
 * getTaskFiles, T14 getTaskBundle). Called by the actor-path internal
 * queries in `agentActorTools.ts` with a DB-derived AuthContext.
 *
 * Access is NOT new logic — each reader applies the rule of the UI query it
 * mirrors:
 *   - task-scoped reads gate on `loadTaskForReadOrNull(ctx, taskId, auth)`
 *     (tasks/access.ts, T1), exactly like comments.byTask, activityLog.byTask,
 *     attachments.byTask and commentAttachments.byTask; unknown, other-org
 *     and unreadable tasks all return null;
 *   - sub-tasks: whoever reads a parent reads its sub-tasks (§11.5) —
 *     `loadSubtasksOf` + `filterReadableTasks`;
 *   - time entries: members see only their own (timeEntries.listByTask);
 *   - projects: any org member reads an org project (projects.get).
 * Every row read by id or index is re-checked against `auth.orgId`. No money
 * fields: rates, fees and amounts are never selected into the output.
 */

// ─── Shared ──────────────────────────────────────────────────────────────────

export type AgentTaskRef = { id: string; identifier: string | null; title: string };

const taskRef = (t: Doc<"tasks">): AgentTaskRef => ({
  id: t._id,
  identifier: t.identifier ?? null,
  title: t.title,
});

/** Memoized user display names (users carry no orgId; rows were org-checked). */
function userNames(ctx: QueryCtx) {
  const cache = new Map<Id<"users">, string>();
  return async (id: Id<"users"> | undefined, fallback = "Unknown"): Promise<string> => {
    if (!id) return fallback;
    const known = cache.get(id);
    if (known !== undefined) return known;
    const user = await ctx.db.get(id);
    const name = user?.name ?? fallback;
    cache.set(id, name);
    return name;
  };
}

/** A task reference (identifier or id) the caller may read, else null. */
async function loadReadableTask(
  ctx: QueryCtx,
  auth: AuthContext,
  ref: string,
): Promise<Doc<"tasks"> | null> {
  const taskId = await resolveTaskRef(ctx, auth.orgId, ref);
  if (!taskId) return null;
  const access = await loadTaskForReadOrNull(ctx, taskId, auth);
  return access?.task ?? null;
}

type Scope = { tasks: Doc<"tasks">[]; subtasksIncluded: number; subtasksTruncated: boolean };

/** The task plus (optionally) its non-archived, readable sub-tasks, capped. */
async function loadScope(
  ctx: QueryCtx,
  auth: AuthContext,
  task: Doc<"tasks">,
  includeSubtasks: boolean,
): Promise<Scope> {
  if (!includeSubtasks || task.parentTaskId) {
    return { tasks: [task], subtasksIncluded: 0, subtasksTruncated: false };
  }
  const subs = await loadSubtasksOf(ctx, auth.orgId, task._id, SUBTASK_FANOUT_CAP);
  const readable = await filterReadableTasks(ctx, auth, subs.tasks.filter((s) => !s.archivedAt));
  return { tasks: [task, ...readable], subtasksIncluded: readable.length, subtasksTruncated: subs.truncated };
}

// ─── Comments (T9) ───────────────────────────────────────────────────────────

export type AgentComment = {
  id: string;
  /** Identifier of the task the comment is on (differs for sub-task comments). */
  task: string | null;
  author: string;
  at: string;
  text: string;
  mentions: string[];
  /** Parent comment id when this is a reply. */
  replyTo: string | null;
  replyToAuthor: string | null;
  /** Top-level threads only. */
  resolved: boolean;
  resolvedBy: string | null;
  attachments: Array<{ name: string; mimeType: string; sizeBytes: number }>;
};

type CommentsPart = {
  comments: AgentComment[];
  /** Comments on the tasks read (replies included). */
  totalComments: number;
  /** Older comments not returned. */
  omitted: number;
  truncated: boolean;
};

async function readComments(
  ctx: QueryCtx,
  auth: AuthContext,
  scope: Scope,
  opts: { limit: number; textMax: number },
): Promise<CommentsPart> {
  const nameOf = userNames(ctx);
  const identifierOf = new Map(scope.tasks.map((t) => [t._id, t.identifier ?? null]));
  const rows: Doc<"comments">[] = [];
  let counted = 0;
  for (const t of scope.tasks) {
    const page = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .order("desc")
      .take(opts.limit + 1);
    const inOrg = page.filter((c) => c.orgId === auth.orgId);
    rows.push(...inOrg.slice(0, opts.limit));
    // `commentCount` is the derived total; never report fewer than we saw.
    counted += Math.max(t.commentCount ?? 0, inOrg.length);
  }
  const picked = newestLast(rows, opts.limit);

  const comments: AgentComment[] = [];
  for (const c of picked) {
    let replyToAuthor: string | null = null;
    if (c.parentCommentId) {
      const parent = await ctx.db.get(c.parentCommentId);
      replyToAuthor = parent && parent.orgId === auth.orgId ? await nameOf(parent.userId) : null;
    }
    const attachments = (
      await ctx.db
        .query("commentAttachments")
        .withIndex("by_comment", (q) => q.eq("commentId", c._id))
        .take(10)
    )
      .filter((a) => a.orgId === auth.orgId)
      .map((a) => ({ name: a.fileName, mimeType: a.mimeType, sizeBytes: a.fileSize }));
    comments.push({
      id: c._id,
      task: identifierOf.get(c.taskId) ?? null,
      author: await nameOf(c.userId),
      at: isoAt(c.createdAt),
      text: tiptapToPlainText(c.content, opts.textMax),
      mentions: extractMentionLabels(c.content),
      replyTo: c.parentCommentId ?? null,
      replyToAuthor,
      resolved: c.resolvedAt !== undefined,
      resolvedBy: c.resolvedBy ? await nameOf(c.resolvedBy, "Former member") : null,
      attachments,
    });
  }
  const omitted = Math.max(0, counted - comments.length);
  return { comments, totalComments: counted, omitted, truncated: omitted > 0 };
}

export type AgentTaskComments = CommentsPart & {
  task: AgentTaskRef;
  subtasksIncluded: number;
  /** More sub-tasks exist than were read (SUBTASK_FANOUT_CAP). */
  subtasksTruncated: boolean;
};

export async function getTaskCommentsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { task: string; includeSubtasks?: boolean; limit?: number },
): Promise<AgentTaskComments | null> {
  const task = await loadReadableTask(ctx, auth, args.task);
  if (!task) return null;
  const scope = await loadScope(ctx, auth, task, args.includeSubtasks ?? false);
  const part = await readComments(ctx, auth, scope, {
    limit: clampLimit(args.limit, COMMENTS_LIMIT_DEFAULT, COMMENTS_LIMIT_MAX),
    textMax: COMMENT_TEXT_MAX,
  });
  return {
    task: taskRef(task),
    ...part,
    subtasksIncluded: scope.subtasksIncluded,
    subtasksTruncated: scope.subtasksTruncated,
  };
}

// ─── Activity (T10) ──────────────────────────────────────────────────────────

export type AgentActivityEvent = {
  at: string;
  actor: string;
  type: string;
  summary: string;
  before: string | null;
  after: string | null;
};

type ActivityPart = {
  events: AgentActivityEvent[];
  /** Older events not returned. */
  omitted: number;
  /** The scan cap was hit: `omitted` is a lower bound. */
  omittedIsLowerBound: boolean;
};

async function readActivity(
  ctx: QueryCtx,
  auth: AuthContext,
  task: Doc<"tasks">,
  limit: number,
): Promise<ActivityPart> {
  const nameOf = userNames(ctx);
  const scanned = await ctx.db
    .query("activityLog")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .order("desc")
    .take(ACTIVITY_SCAN_CAP + 1);
  const visible = scanned
    .slice(0, ACTIVITY_SCAN_CAP)
    // The drawer hides legacy description events (activityLog.byTask).
    .filter((e) => e.orgId === auth.orgId && !HIDDEN_ACTIVITY_TYPES.has(e.type));
  const picked = visible.slice(0, limit).reverse();
  const events: AgentActivityEvent[] = [];
  for (const e of picked) {
    events.push({ at: isoAt(e.createdAt), actor: await nameOf(e.userId), ...describeActivity(e) });
  }
  return {
    events,
    omitted: visible.length - picked.length,
    omittedIsLowerBound: scanned.length > ACTIVITY_SCAN_CAP,
  };
}

export type AgentTimeEntry = {
  date: string;
  person: string;
  minutes: number;
  note: string | null;
  billable: boolean;
};

export type AgentTaskActivity = ActivityPart & {
  task: AgentTaskRef;
  timeEntries: AgentTimeEntry[];
  /** Admins see everyone's entries; members only their own (as in the app). */
  timeEntriesScope: "everyone" | "yours";
  timeEntriesTruncated: boolean;
};

export async function getTaskActivityForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { task: string; limit?: number },
): Promise<AgentTaskActivity | null> {
  const task = await loadReadableTask(ctx, auth, args.task);
  if (!task) return null;
  const activity = await readActivity(
    ctx,
    auth,
    task,
    clampLimit(args.limit, ACTIVITY_LIMIT_DEFAULT, ACTIVITY_LIMIT_MAX),
  );

  const nameOf = userNames(ctx);
  const scanned = await ctx.db
    .query("timeEntries")
    .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
    .order("desc")
    .take(TIME_ENTRIES_SCAN_CAP + 1);
  const inOrg = scanned.slice(0, TIME_ENTRIES_SCAN_CAP).filter((e) => e.orgId === auth.orgId);
  // Member sees only own entries (timeEntries.listByTask).
  const visible = auth.isAdmin ? inOrg : inOrg.filter((e) => e.userId === auth.userId);
  visible.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const timeEntries: AgentTimeEntry[] = [];
  for (const e of visible.slice(0, TIME_ENTRIES_LIMIT)) {
    timeEntries.push({
      date: e.date,
      person: await nameOf(e.userId),
      minutes: e.durationMinutes,
      note: e.note?.trim() ? e.note.trim() : null,
      billable: e.isBillable,
    });
  }
  return {
    task: taskRef(task),
    ...activity,
    timeEntries,
    timeEntriesScope: auth.isAdmin ? "everyone" : "yours",
    timeEntriesTruncated: scanned.length > TIME_ENTRIES_SCAN_CAP || visible.length > TIME_ENTRIES_LIMIT,
  };
}

// ─── Files (T11) ─────────────────────────────────────────────────────────────

export type AgentTaskFile = {
  /**
   * The attachment's id — pass it to getAttachmentText as `attachmentId`
   * (source "task") or `commentAttachmentId` (source "comment").
   */
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  at: string;
  /** Identifier of the task the file is on. */
  task: string | null;
  source: "task" | "comment";
  comment: { id: string; author: string; at: string } | null;
  /**
   * What was read inside the file (A6, `attachmentContents`): status, page
   * count, image width × height and the stored text length — never the text
   * itself (getAttachmentText pages it). Null when the file was never
   * queued for reading (uploaded before A6 and not backfilled).
   */
  extractedText: AttachmentContentSummary | null;
};

export type AgentLinkPreview = {
  url: string;
  domain: string;
  /** OG title from the link-preview cache, when fetched. */
  title: string | null;
  status: "fetched" | "pending" | "failed" | "not_fetched";
  source: "description" | "comment";
  task: string | null;
  commentId: string | null;
};

type FilesPart = {
  files: AgentTaskFile[];
  /** Files not returned (newest kept). */
  omittedFiles: number;
  omittedFilesIsLowerBound: boolean;
  links: AgentLinkPreview[];
  linksTruncated: boolean;
};

async function readFiles(
  ctx: QueryCtx,
  auth: AuthContext,
  scope: Scope,
  opts: { limit: number; linksLimit: number },
): Promise<FilesPart> {
  const nameOf = userNames(ctx);
  const identifierOf = new Map(scope.tasks.map((t) => [t._id, t.identifier ?? null]));
  type Raw =
    | { kind: "task"; row: Doc<"attachments"> }
    | { kind: "comment"; row: Doc<"commentAttachments"> };
  const raw: Raw[] = [];
  let overflow = false;
  for (const t of scope.tasks) {
    const own = await ctx.db
      .query("attachments")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .order("desc")
      .take(opts.limit + 1);
    const onComments = await ctx.db
      .query("commentAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .order("desc")
      .take(opts.limit + 1);
    overflow ||= own.length > opts.limit || onComments.length > opts.limit;
    for (const row of own.slice(0, opts.limit)) {
      if (row.orgId === auth.orgId) raw.push({ kind: "task", row });
    }
    for (const row of onComments.slice(0, opts.limit)) {
      if (row.orgId === auth.orgId) raw.push({ kind: "comment", row });
    }
  }
  raw.sort((a, b) => b.row.createdAt - a.row.createdAt);
  const picked = raw.slice(0, opts.limit);

  const files: AgentTaskFile[] = [];
  for (const f of picked) {
    let comment: AgentTaskFile["comment"] = null;
    if (f.kind === "comment") {
      const c = await ctx.db.get(f.row.commentId);
      if (c && c.orgId === auth.orgId && c.taskId === f.row.taskId) {
        comment = { id: c._id, author: await nameOf(c.userId), at: isoAt(c.createdAt) };
      }
    }
    const content = await loadContent(ctx, auth.orgId, f.row.fileId);
    files.push({
      id: f.row._id,
      name: f.row.fileName,
      mimeType: f.row.mimeType,
      sizeBytes: f.row.fileSize,
      uploadedBy: await nameOf(f.row.userId),
      at: isoAt(f.row.createdAt),
      task: identifierOf.get(f.row.taskId) ?? null,
      source: f.kind,
      comment,
      extractedText: summarizeContent(content),
    });
  }

  // Link previews: the app caches OG titles per URL (linkPreviews.by_url)
  // for links in comments; the task description is scanned too.
  type Found = { url: string; domain: string; source: AgentLinkPreview["source"]; task: string | null; commentId: string | null };
  const found: Found[] = [];
  const seen = new Set<string>();
  let moreLinks = false;
  const add = (links: Array<{ url: string; domain: string }>, rest: Omit<Found, "url" | "domain">) => {
    for (const l of links) {
      if (seen.has(l.url)) continue;
      if (found.length >= opts.linksLimit) {
        moreLinks = true;
        return;
      }
      seen.add(l.url);
      found.push({ ...l, ...rest });
    }
  };
  for (const t of scope.tasks) {
    add(extractLinks(t.description), { source: "description", task: t.identifier ?? null, commentId: null });
    const recent = await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", t._id))
      .order("desc")
      .take(LINK_SCAN_COMMENTS);
    for (const c of recent) {
      if (c.orgId !== auth.orgId) continue;
      add(extractLinks(c.content), { source: "comment", task: t.identifier ?? null, commentId: c._id });
    }
  }
  const links: AgentLinkPreview[] = [];
  for (const l of found) {
    const cached = await ctx.db
      .query("linkPreviews")
      .withIndex("by_url", (q) => q.eq("url", l.url))
      .first();
    links.push({
      ...l,
      title: cached?.title ?? null,
      status: cached?.status ?? "not_fetched",
    });
  }

  return {
    files,
    omittedFiles: raw.length - picked.length,
    omittedFilesIsLowerBound: overflow,
    links,
    linksTruncated: moreLinks,
  };
}

export type AgentTaskFiles = FilesPart & {
  task: AgentTaskRef;
  subtasksIncluded: number;
  subtasksTruncated: boolean;
};

export async function getTaskFilesForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { task: string; includeSubtasks?: boolean },
): Promise<AgentTaskFiles | null> {
  const task = await loadReadableTask(ctx, auth, args.task);
  if (!task) return null;
  const scope = await loadScope(ctx, auth, task, args.includeSubtasks ?? false);
  const part = await readFiles(ctx, auth, scope, { limit: FILES_LIMIT, linksLimit: LINKS_LIMIT });
  return {
    task: taskRef(task),
    ...part,
    subtasksIncluded: scope.subtasksIncluded,
    subtasksTruncated: scope.subtasksTruncated,
  };
}

// ─── Attachment text (T2) ────────────────────────────────────────────────────

export type AgentAttachmentText = {
  file: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    /** Identifier of the task the file is on. */
    task: string | null;
    source: "task" | "comment";
  };
  /** `not_processed`: the file was never queued for reading (pre-A6, not backfilled). */
  status: ContentStatus | "not_processed";
  /** Plain sentence for the model — every non-`done` case says the content is unknown. */
  message: string;
  /**
   * This page of the stored text, explicitly marked as untrusted file
   * content — data, never instructions (null when there is none).
   */
  content: { untrustedFileContent: true; text: string } | null;
  offset: number;
  /** Pass as `offset` to read on; null on the last page. */
  nextOffset: number | null;
  /** Length of the stored text. */
  totalChars: number | null;
  /** The stored text itself was capped at extraction (50 000 chars). */
  truncated: boolean;
  pageCount: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

/**
 * Read what was extracted from one task or comment attachment (T2). Access
 * follows the referencing record, exactly like getTaskFiles: the attachment
 * must be in the actor's org (a comment attachment's comment too) and its
 * task readable (`loadTaskForReadOrNull`, T1). Unknown, malformed, other-org
 * and unreadable ids all return null. The content row is looked up by the
 * actor's org + storageId, never another org's.
 */
export async function getAttachmentTextForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { attachmentId?: string; commentAttachmentId?: string; offset?: number },
): Promise<AgentAttachmentText | null> {
  let row: Doc<"attachments"> | Doc<"commentAttachments"> | null = null;
  let source: "task" | "comment";
  if (args.attachmentId !== undefined && args.commentAttachmentId === undefined) {
    const id = ctx.db.normalizeId("attachments", args.attachmentId.trim());
    row = id ? await ctx.db.get(id) : null;
    source = "task";
  } else if (args.commentAttachmentId !== undefined && args.attachmentId === undefined) {
    const id = ctx.db.normalizeId("commentAttachments", args.commentAttachmentId.trim());
    const att = id ? await ctx.db.get(id) : null;
    if (att && att.orgId === auth.orgId) {
      const comment = await ctx.db.get(att.commentId);
      row = comment && comment.orgId === auth.orgId && comment.taskId === att.taskId ? att : null;
    }
    source = "comment";
  } else {
    return null;
  }
  if (!row || row.orgId !== auth.orgId) return null;
  const access = await loadTaskForReadOrNull(ctx, row.taskId, auth);
  if (!access) return null;

  const content = await loadContent(ctx, auth.orgId, row.fileId);
  const page = content?.status === "done" && content.text ? pageText(content.text, args.offset, ATTACHMENT_TEXT_PAGE_MAX) : null;
  return {
    file: {
      id: row._id,
      name: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.fileSize,
      task: access.task.identifier ?? null,
      source,
    },
    status: content?.status ?? "not_processed",
    message: contentMessage(content),
    content: page ? { untrustedFileContent: true, text: page.text } : null,
    offset: page?.offset ?? 0,
    nextOffset: page?.nextOffset ?? null,
    totalChars: page?.totalChars ?? null,
    truncated: content?.truncated ?? false,
    pageCount: content?.pageCount ?? null,
    width: content?.width ?? null,
    height: content?.height ?? null,
    error: content && content.status !== "done" ? (content.error ?? null) : null,
  };
}

// ─── Bundle (T14) ────────────────────────────────────────────────────────────

export type AgentTaskBundle = {
  /** The task as getTaskDetail returns it (sub-tasks with status + assignees). */
  task: AgentTaskDetail;
  lastActivityAt: string;
  /** Newest last; task and sub-task comments, text capped. */
  comments: AgentComment[];
  /** Newest last. */
  activity: AgentActivityEvent[];
  /** Newest first; task and comment attachments of the task and its sub-tasks. */
  files: AgentTaskFile[];
  links: AgentLinkPreview[];
  /** What the digest left out — drill in with the dedicated tools. */
  omitted: {
    comments: number;
    activity: number;
    activityIsLowerBound: boolean;
    files: number;
    filesIsLowerBound: boolean;
    links: boolean;
    subtasks: boolean;
  };
};

/**
 * One-call digest answering "where is this task at?": the getTaskDetail
 * payload plus the latest comments (task + sub-tasks), activity and files,
 * each capped well under the model context, with omitted counts.
 */
export async function getTaskBundleForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { task: string },
): Promise<AgentTaskBundle | null> {
  const task = await loadReadableTask(ctx, auth, args.task);
  if (!task) return null;
  const detail = await getTaskDetailForAuth(ctx, auth, { task: task._id });
  if (!detail) return null;
  const scope = await loadScope(ctx, auth, task, true);
  const comments = await readComments(ctx, auth, scope, {
    limit: BUNDLE_COMMENTS,
    textMax: BUNDLE_COMMENT_TEXT_MAX,
  });
  const activity = await readActivity(ctx, auth, task, BUNDLE_ACTIVITY);
  const files = await readFiles(ctx, auth, scope, { limit: BUNDLE_FILES, linksLimit: BUNDLE_LINKS });
  return {
    task: detail,
    lastActivityAt: isoAt(task.lastActivityAt),
    comments: comments.comments,
    activity: activity.events,
    files: files.files,
    links: files.links,
    omitted: {
      comments: comments.omitted,
      activity: activity.omitted,
      activityIsLowerBound: activity.omittedIsLowerBound,
      files: files.omittedFiles,
      filesIsLowerBound: files.omittedFilesIsLowerBound,
      links: files.linksTruncated,
      subtasks: detail.subtasksTruncated || scope.subtasksTruncated,
    },
  };
}

// ─── Project routing (T3) ────────────────────────────────────────────────────

export type AgentProjectRouting = {
  project: { id: string; name: string; code: string; billingType: string; archived: boolean };
  client: { id: string; name: string; archived: boolean } | null;
  teamMembers: Array<{ id: string; name: string }>;
  /** Per work category: who a new task in that category is assigned to. */
  defaultAssignees: Array<{
    workCategoryId: string;
    workCategory: string | null;
    workCategoryArchived: boolean;
    assigneeId: string;
    assignee: string;
    /** False when the person left the org — task creation then skips the default. */
    active: boolean;
  }>;
  // TODO(B2): client email defaults (contacts / routing rules per sender)
  // land with the email domain; null until then.
  clientDefaults: null;
};

/**
 * A project's routing: default assignees per work category (resolved like
 * task creation does, `resolveDefaultAssignee`), the team and the client.
 * Any org member may read an org project (projects.get); no money fields.
 */
export async function getProjectRoutingForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { projectId: string },
): Promise<AgentProjectRouting | null> {
  const projectId = ctx.db.normalizeId("projects", args.projectId.trim());
  const project = projectId ? await ctx.db.get(projectId) : null;
  if (!project || project.orgId !== auth.orgId) return null;

  const nameOf = userNames(ctx);
  const clientDoc = await ctx.db.get(project.clientId);
  const client =
    clientDoc && clientDoc.orgId === auth.orgId
      ? { id: clientDoc._id, name: clientDoc.name, archived: clientDoc.archivedAt !== undefined }
      : null;

  const teamMembers: AgentProjectRouting["teamMembers"] = [];
  for (const userId of project.teamMembers ?? []) {
    const user = await ctx.db.get(userId);
    if (user && !user.deletedAt) teamMembers.push({ id: user._id, name: user.name });
  }

  const defaultAssignees: AgentProjectRouting["defaultAssignees"] = [];
  for (const da of project.defaultAssignees ?? []) {
    const category = await ctx.db.get(da.workCategoryId);
    const inOrg = category && category.orgId === auth.orgId ? category : null;
    const effective = await resolveDefaultAssignee(ctx, auth.orgId, project._id, da.workCategoryId);
    defaultAssignees.push({
      workCategoryId: da.workCategoryId,
      workCategory: inOrg?.name ?? null,
      workCategoryArchived: inOrg?.archivedAt !== undefined,
      assigneeId: da.userId,
      assignee: await nameOf(da.userId, "Former member"),
      active: effective === da.userId,
    });
  }

  return {
    project: {
      id: project._id,
      name: project.name,
      code: project.code,
      billingType: project.billingType,
      archived: project.archivedAt !== undefined,
    },
    client,
    teamMembers,
    defaultAssignees,
    clientDefaults: null,
  };
}
