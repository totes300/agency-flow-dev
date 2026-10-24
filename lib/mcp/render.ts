import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { PRIORITY_LABELS, PRIORITY, TASK_CATEGORIES } from "@/convex/tasks/model";
import { formatFileSize } from "@/lib/attachment";
import { formatDuration } from "@/lib/duration";
import { clientLink, memberLink, projectLink, taskLink } from "./links";

/**
 * Compact markdown renderers for MCP tool results (docs/prd-mcp.md §7, D10).
 * Convex returns data; these turn it into token-efficient text. Archived
 * reference rows are counted, not listed: agents should only write active
 * values. Names are user input and may contain commas, so every value gets
 * its own line; fields within a line are separated by " · ".
 */

export type MeData = FunctionReturnType<typeof api.mcp.fetch.me>;
export type WorkspaceData = FunctionReturnType<typeof api.mcp.fetch.workspace>;
export type RecordsData = FunctionReturnType<typeof api.mcp.fetch.records>;
export type RecordResult = RecordsData["results"][number];
export type FetchedRecord = Extract<RecordResult, { ok: true }>["record"];
export type TaskRecord = Extract<FetchedRecord, { type: "task" }>;
export type RefCandidates = Extract<RecordResult, { ok: false }>["candidates"];

export type TaskPage = FunctionReturnType<typeof api.mcp.search.tasks>;
export type ProjectPage = FunctionReturnType<typeof api.mcp.search.projects>;
export type ClientPage = FunctionReturnType<typeof api.mcp.search.clients>;
export type MemberPage = FunctionReturnType<typeof api.mcp.search.members>;
export type TimeEntryPage = FunctionReturnType<typeof api.mcp.search.timeEntries>;
export type CommentPage = FunctionReturnType<typeof api.mcp.search.comments>;

export type ChangesData = FunctionReturnType<typeof api.mcp.fetch.changes>;
export type SaveTasksData = FunctionReturnType<typeof api.mcp.write.saveTasks>;
export type SaveCommentsData = FunctionReturnType<typeof api.mcp.write.saveComments>;
export type DeleteData = FunctionReturnType<typeof api.mcp.write.remove>;

/** What renderers need besides the data: where the app lives and the org's clock. */
export type RenderContext = {
  appOrigin: string;
  timezone?: string;
  /** Characters a single record may use (task detail shortens its lists to fit). */
  budget?: number;
};

/** Names are user input: keep every list item on one line. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function archivedNote(rows: readonly { archived: boolean }[]): string {
  const archived = rows.filter((r) => r.archived).length;
  return archived > 0 ? ` (+${archived} archived)` : "";
}

function section(title: string, lines: string[], note = ""): string {
  const body = lines.length > 0 ? lines.join("\n") : "none";
  return `### ${title}${note}\n${body}`;
}

export function renderMe(data: MeData): string {
  const user = data.user.email
    ? `${oneLine(data.user.name)} <${data.user.email}>`
    : oneLine(data.user.name);
  const org = data.org.name ? `${oneLine(data.org.name)} (${data.org.id})` : data.org.id;
  return ["## Me", `- User: ${user}`, `- Org: ${org}`, `- Role: ${data.role}`].join("\n");
}

export function renderWorkspace(data: WorkspaceData): string {
  const parts: string[] = ["## Workspace"];

  if (data.orgTaskKey) {
    parts.push(`Task key for tasks without a project: ${data.orgTaskKey}`);
  }

  // Category order (TASK_CATEGORIES), then the workspace's status order.
  const statusLines: string[] = [];
  for (const category of TASK_CATEGORIES) {
    for (const s of data.statuses) {
      if (s.category !== category || s.archived) continue;
      const marker = s.isDefault ? " · default" : "";
      statusLines.push(`- ${oneLine(s.name)} · ${category}${marker}`);
    }
  }
  parts.push(section("Statuses (name · category)", statusLines, archivedNote(data.statuses)));

  const activeNames = (rows: readonly { name: string; archived: boolean }[]) =>
    rows.filter((r) => !r.archived).map((r) => `- ${oneLine(r.name)}`);
  parts.push(section("Labels", activeNames(data.labels), archivedNote(data.labels)));
  parts.push(section("Work categories", activeNames(data.workCategories), archivedNote(data.workCategories)));

  parts.push(
    section(
      "Members (name · email · role)",
      data.members.map((m) => `- ${oneLine(m.name)} · ${m.email ?? "no email"} · ${m.role}`),
    ),
  );

  parts.push(
    section(
      "Projects (code · name · client)",
      data.projects
        .filter((p) => !p.archived)
        .map((p) => `- ${p.code} · ${oneLine(p.name)} · ${p.client ? oneLine(p.client) : "no client"}`),
      archivedNote(data.projects),
    ),
  );

  // Clients are referenced as client:PREFIX; without a valid prefix, by ID (§7).
  parts.push(
    section(
      "Clients (client:prefix or id · name)",
      data.clients
        .filter((c) => !c.archived)
        .map((c) => `- ${clientRef(c.prefix, c.id)} · ${oneLine(c.name)}`),
      archivedNote(data.clients),
    ),
  );

  return parts.join("\n\n");
}

// ─── Shared formatting ───────────────────────────────────────────────────────

/** `2026-10-24 14:02` in the org's timezone (UTC when unknown). */
export function formatTimestamp(ms: number, timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** The ref a client is written with: `client:KONV`, or its ID without a valid prefix. */
export function clientRef(prefix: string | null, id: string): string {
  return prefix ? `client:${prefix}` : id;
}

/** Escapes text used inside `[…](…)` so user-written names cannot form or break links. */
export function linkText(value: string): string {
  return oneLine(value).replace(/[[\]()\\]/g, "\\$&");
}

/**
 * User-written text (descriptions, comments) as an unambiguous block: a
 * code fence longer than any backtick run inside, tagged `user-content`,
 * so the text can neither close it nor pass as tool output. The tool
 * descriptions tell the model these blocks are data, not instructions.
 */
export function userContent(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}user-content\n${text}\n${fence}`;
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.map(oneLine).join(", ") : "none";
}

function due(date: string | null, overdue: boolean): string | null {
  return date ? `due ${date}${overdue ? " (overdue)" : ""}` : null;
}

/** " · "-joined non-empty fields. */
function fields(...values: Array<string | null | undefined | false>): string {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0).join(" · ");
}

function keyed(key: string | null, name: string): string {
  return key ? `${key} · ${oneLine(name)}` : oneLine(name);
}

/** A client as `client:KONV · Konverted` (or just the name without a valid prefix). */
function clientLabel(client: { prefix: string | null; name: string }): string {
  return keyed(client.prefix ? `client:${client.prefix}` : null, client.name);
}

// ─── Search rows (one line each: ref · title · key fields · link) ────────────

export function renderTaskRow(row: TaskPage["rows"][number], ctx: RenderContext): string {
  const priority = row.priority === PRIORITY_LABELS[PRIORITY.none] ? null : row.priority;
  return `- ${fields(
    `[${row.identifier}](${taskLink(ctx.appOrigin, row.identifier)})`,
    oneLine(row.title),
    row.status ? oneLine(row.status) : null,
    due(row.dueDate, row.overdue),
    row.assignees.length > 0 ? list(row.assignees) : "unassigned",
    priority,
    row.parent ? `sub-task of ${row.parent}` : null,
  )}`;
}

export function renderProjectRow(row: ProjectPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${row.code}](${projectLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.client ? clientLabel(row.client) : "no client",
    row.archived && "archived",
  )}`;
}

export function renderClientRow(row: ClientPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${linkText(clientRef(row.prefix, row.id))}](${clientLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.archived && "archived",
  )}`;
}

export function renderMemberRow(row: MemberPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${linkText(row.email ?? row.id)}](${memberLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.role,
  )}`;
}

type TimeRow = TimeEntryPage["rows"][number];

function timeTask(row: TimeRow, ctx: RenderContext): string {
  return row.task
    ? `[${row.task.identifier}](${taskLink(ctx.appOrigin, row.task.identifier)}) ${oneLine(row.task.title)}`
    : "task not available";
}

function timeNote(row: TimeRow): string | null {
  return row.note ? `"${row.note}${row.noteTruncated ? "…" : ""}"` : null;
}

export function renderTimeEntryRow(row: TimeRow, ctx: RenderContext): string {
  return `- ${fields(
    row.id,
    row.date,
    formatDuration(row.minutes),
    oneLine(row.member),
    timeTask(row, ctx),
    timeNote(row),
    row.billable ? "billable" : "non-billable",
  )}`;
}

export function renderCommentRow(row: CommentPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${row.id}](${taskLink(ctx.appOrigin, row.task.identifier, row.id)})`,
    `on ${row.task.identifier} ${oneLine(row.task.title)}`,
    oneLine(row.author),
    formatTimestamp(row.createdAt, ctx.timezone),
    `"${row.text}${row.textTruncated ? "…" : ""}"`,
  )}`;
}

// ─── Fetch records ───────────────────────────────────────────────────────────

const ACTIVITY_TEXT: Record<string, (m: Record<string, unknown>) => string> = {
  task_created: () => "created the task",
  subtask_created: (m) => `added sub-task "${m.title}"`,
  subtask_completed: (m) => `completed sub-task "${m.title}"`,
  subtask_deleted: (m) => `deleted sub-task "${m.title}"`,
  status_changed: (m) => `changed status ${m.from} → ${m.to}`,
  assignee_added: (m) => `assigned ${m.userName}`,
  assignee_removed: (m) => `unassigned ${m.userName}`,
  label_added: (m) => `added label ${m.labelName}`,
  label_removed: (m) => `removed label ${m.labelName}`,
  title_changed: (m) => `renamed "${m.from}" → "${m.to}"`,
  category_changed: (m) => `changed work category ${m.from} → ${m.to}`,
  priority_changed: (m) =>
    `changed priority ${PRIORITY_LABELS[m.from as keyof typeof PRIORITY_LABELS] ?? m.from} → ${PRIORITY_LABELS[m.to as keyof typeof PRIORITY_LABELS] ?? m.to}`,
  due_date_changed: (m) => (m.to ? `set due date ${m.to}` : "removed the due date"),
  start_date_changed: (m) => (m.to ? `set start date ${m.to}` : "removed the start date"),
  estimate_changed: (m) =>
    typeof m.to === "number" ? `set estimate ${formatDuration(m.to)}` : "removed the estimate",
  project_changed: (m) => (m.to ? `moved to project ${m.to}` : "removed the project"),
  billable_changed: (m) => `marked ${m.to ? "billable" : "non-billable"}`,
  identifier_changed: (m) => `changed the task key ${m.from ?? "none"} → ${m.to}`,
  task_archived: () => "archived the task",
  task_restored: () => "restored the task",
  comment_added: () => "commented",
  comment_resolved: () => "resolved a comment",
  comment_reopened: () => "re-opened a comment",
  time_entry_logged: (m) => `logged ${m.duration}`,
  time_entry_edited: (m) => `edited a time entry ${m.oldDuration} → ${m.newDuration}`,
  time_entry_deleted: (m) => `deleted a time entry (${m.duration})`,
};

function activityText(type: string, metadata: unknown): string {
  const format = ACTIVITY_TEXT[type];
  const m = (metadata ?? {}) as Record<string, unknown>;
  return format ? format(m) : type.replace(/_/g, " ");
}

/** How many rows of each list a task detail shows (the rest is named, never dropped silently). */
type ShownCounts = { subtasks: number; comments: number; activity: number; time: number; files: number };

/** A search call that lists the rest, as the model should write it. */
function searchHint(type: "comment" | "time_entry", identifier: string): string {
  return `search {"types": ["${type}"], "task": "${identifier}"}`;
}

/**
 * The header suffix and the "how to get the rest" line of a list: `shown`
 * rows of `returned` (what Convex sent) of `total` (what exists; `more` =
 * more than `total`).
 */
function listMeta(
  shown: number,
  returned: number,
  total: number,
  more: boolean,
  rest: string,
): { suffix: string; note: string | null } {
  if (shown >= total && !more) return { suffix: ` (${total})`, note: null };
  const of = more ? `more than ${total}` : `${total}`;
  const shortened = shown < returned ? "Shortened to keep this result small. " : "";
  return { suffix: ` (latest ${shown} of ${of})`, note: `${shortened}${rest}` };
}

function taskSections(record: TaskRecord, ctx: RenderContext, shown: ShownCounts, withDescription: boolean): string[] {
  const parts: string[] = [];
  if (record.description !== null) {
    parts.push(
      withDescription
        ? `### Description\n${userContent(record.description)}`
        : `### Description\nNot shown: the description is ${record.description.length} characters, more than fits in one result. Open the link to read it in the app.`,
    );
  }
  if (record.subtasks) {
    const rows = record.subtasks.rows.slice(0, shown.subtasks).map((s) =>
      `- ${fields(
        s.identifier ? `[${s.identifier}](${taskLink(ctx.appOrigin, s.identifier)})` : null,
        oneLine(s.title),
        s.status ? oneLine(s.status) : null,
        s.assignees.length > 0 ? list(s.assignees) : "unassigned",
      )}`,
    );
    const total = record.subtasks.rows.length;
    const missing = shown.subtasks < total || record.subtasks.truncated;
    const note = missing
      ? `\n(${rows.length} of ${record.subtasks.truncated ? "more than " : ""}${total} shown. Open the link for every sub-task, or fetch them by key.)`
      : "";
    parts.push(`### Sub-tasks (${total}${record.subtasks.truncated ? "+" : ""})\n${rows.length > 0 ? rows.join("\n") : "none"}${note}`);
  }
  if (record.comments) {
    const { rows, total, truncated } = record.comments;
    const visible = rows.slice(rows.length - Math.min(shown.comments, rows.length));
    const meta = listMeta(visible.length, rows.length, total, truncated, `For all comments: ${searchHint("comment", record.identifier)}.`);
    const blocks = visible.map((c) => {
      const head = fields(
        `[${c.id}](${taskLink(ctx.appOrigin, record.identifier, c.id)})`,
        formatTimestamp(c.createdAt, ctx.timezone),
        oneLine(c.author),
        c.replyTo ? `reply to ${oneLine(c.replyTo)}` : null,
        c.resolved && "resolved",
        c.edited && "edited",
      );
      return `- ${head}\n${userContent(c.text || "(no text)")}`;
    });
    parts.push(
      [`### Comments${meta.suffix}`, meta.note, blocks.length > 0 ? blocks.join("\n") : "none"]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }
  if (record.activity) {
    const { rows, total, truncated } = record.activity;
    const visible = rows.slice(rows.length - Math.min(shown.activity, rows.length));
    const meta = listMeta(visible.length, rows.length, total, truncated, "Open the link for the full activity.");
    const lines = visible.map(
      (e) => `- ${formatTimestamp(e.createdAt, ctx.timezone)} · ${oneLine(e.userName)} ${activityText(e.type, e.metadata)}`,
    );
    parts.push(
      [`### Activity${meta.suffix}`, meta.note, lines.length > 0 ? lines.join("\n") : "none"]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }
  if (record.time) {
    const { rows, total, totalMinutes, ownOnly, truncated } = record.time;
    const scope = ownOnly ? " · your entries only (members see their own time)" : "";
    const sum = truncated
      ? `Total of the ${total} entries read: ${formatDuration(totalMinutes)} (more exist)`
      : `Total of all ${total} ${total === 1 ? "entry" : "entries"}: ${formatDuration(totalMinutes)}`;
    const visible = rows.slice(0, shown.time);
    const meta = listMeta(visible.length, rows.length, total, truncated, `For all entries: ${searchHint("time_entry", record.identifier)}.`);
    const lines = visible.map((r) =>
      `- ${fields(r.id, r.date, formatDuration(r.minutes), oneLine(r.member), timeNote(r), r.billable ? "billable" : "non-billable")}`,
    );
    parts.push(
      [`### Time${meta.suffix}${scope}`, sum, meta.note, lines.length > 0 ? lines.join("\n") : "none"]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }
  if (record.files) {
    const all = record.files.rows;
    const visible = all.slice(0, shown.files);
    const lines = visible.map((f) =>
      `- ${fields(
        f.url ? `[${linkText(f.name)}](${f.url})` : oneLine(f.name),
        formatFileSize(f.size),
        f.mimeType,
        f.onComment && "on a comment",
      )}`,
    );
    const missing = visible.length < all.length || record.files.truncated;
    const note = missing
      ? `\n(${visible.length} of ${record.files.truncated ? "more than " : ""}${all.length} shown. Open the link for every file.)`
      : "";
    parts.push(`### Files (${all.length}${record.files.truncated ? "+" : ""})\n${lines.length > 0 ? lines.join("\n") : "none"}${note}`);
  }
  if (record.attachmentText) {
    parts.push("### Attachment text\nText extraction from attachments is not available yet. Use the file links instead.");
  }
  return parts;
}

function taskHeader(record: TaskRecord, ctx: RenderContext): string {
  const priority = record.priority === PRIORITY_LABELS[PRIORITY.none] ? null : record.priority;
  const effort = fields(
    record.estimateMinutes !== null ? `Estimate: ${formatDuration(record.estimateMinutes)}` : null,
    `Tracked: ${formatDuration(record.trackedMinutes)}`,
  );
  return [
    `## ${record.identifier} · ${oneLine(record.title)}`,
    `- Link: ${taskLink(ctx.appOrigin, record.identifier)}`,
    `- Status: ${record.status ? oneLine(record.status) : "unknown"} (${record.statusCategory})`,
    priority && `- Priority: ${priority}`,
    `- Project: ${record.project ? keyed(record.project.code, record.project.name) : "none"}`,
    record.client && `- Client: ${clientLabel(record.client)}`,
    `- Assignees: ${list(record.assignees)}`,
    record.labels.length > 0 && `- Labels: ${list(record.labels)}`,
    record.workCategory && `- Work category: ${oneLine(record.workCategory)}`,
    record.startDate && `- Start: ${record.startDate}`,
    record.dueDate && `- Due: ${record.dueDate}${record.overdue ? " (overdue)" : ""}`,
    `- ${effort}`,
    `- Billable: ${record.billable ? "yes" : "no"}`,
    record.parent && `- Parent: ${record.parent.identifier ?? "?"} · ${oneLine(record.parent.title)}`,
    record.subtaskCount > 0 && `- Sub-tasks: ${record.subtaskDoneCount}/${record.subtaskCount} done`,
    record.nextStep &&
      `- Next step: ${fields(
        record.nextStep.identifier,
        oneLine(record.nextStep.title),
        record.nextStep.assignees.length > 0 ? list(record.nextStep.assignees) : "unassigned",
      )}`,
    record.externalRefs.refs.length > 0 &&
      `- External refs: ${record.externalRefs.refs.join(", ")}${record.externalRefs.truncated ? " (more exist)" : ""}`,
    record.commentCount > 0 && `- Comments: ${record.commentCount}`,
    record.archived && "- Archived: yes",
    `- Created: ${formatTimestamp(record.createdAt, ctx.timezone)} · Last activity: ${formatTimestamp(record.lastActivityAt, ctx.timezone)}`,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

/** Lists shortened first, least useful first; the description is never cut, only left out whole. */
const SHORTEN_ORDER: ReadonlyArray<keyof ShownCounts> = ["activity", "files", "time", "comments", "subtasks"];

/**
 * A task in full: heading, fields, the description and the included
 * sections. Over `ctx.budget`, lists are shortened (each says how many it
 * shows and how to get the rest); a description that alone does not fit is
 * left out with its size, never cut.
 */
export function renderTaskRecord(record: TaskRecord, ctx: RenderContext): string {
  const budget = ctx.budget ?? Number.POSITIVE_INFINITY;
  const shown: ShownCounts = {
    subtasks: record.subtasks?.rows.length ?? 0,
    comments: record.comments?.rows.length ?? 0,
    activity: record.activity?.rows.length ?? 0,
    time: record.time?.rows.length ?? 0,
    files: record.files?.rows.length ?? 0,
  };
  const render = (withDescription: boolean) =>
    [taskHeader(record, ctx), ...taskSections(record, ctx, shown, withDescription)].join("\n\n");
  let text = render(true);
  for (const list of SHORTEN_ORDER) {
    while (text.length > budget && shown[list] > 0) {
      shown[list] = Math.floor(shown[list] / 2);
      text = render(true);
    }
  }
  return text.length > budget ? render(false) : text;
}

export function renderRecord(record: FetchedRecord, ctx: RenderContext): string {
  switch (record.type) {
    case "task":
      return renderTaskRecord(record, ctx);
    case "comment":
      return [
        `## Comment on ${record.task.identifier} · ${oneLine(record.task.title)}`,
        `- Link: ${taskLink(ctx.appOrigin, record.task.identifier, record.id)}`,
        `- Ref: ${record.id}`,
        `- Author: ${oneLine(record.author)}`,
        `- Written: ${formatTimestamp(record.createdAt, ctx.timezone)}${record.edited ? " (edited)" : ""}`,
        record.isReply ? "- Reply: yes" : null,
        record.resolved ? "- Resolved: yes" : null,
        "",
        userContent(record.text || "(no text)"),
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    case "time_entry":
      return [
        `## Time entry ${record.id}`,
        record.task ? `- Link: ${taskLink(ctx.appOrigin, record.task.identifier)} (the entry's task)` : null,
        `- Date: ${record.date}`,
        `- Duration: ${formatDuration(record.minutes)}`,
        `- Member: ${oneLine(record.member)}`,
        `- Task: ${record.task ? `${record.task.identifier} · ${oneLine(record.task.title)}` : "not available"}`,
        `- Project: ${record.project ? keyed(record.project.code, record.project.name) : "none"}`,
        `- Billable: ${record.billable ? "yes" : "no"}`,
        record.note ? `- Note: "${record.note}${record.noteTruncated ? "…" : ""}"` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    case "project":
      return [
        `## Project ${record.code} · ${oneLine(record.name)}`,
        `- Link: ${projectLink(ctx.appOrigin, record.id)}`,
        `- Code: ${record.code} (task keys ${record.code}-N)`,
        `- Client: ${record.client ? clientLabel(record.client) : "none"}`,
        `- Archived: ${record.archived ? "yes" : "no"}`,
      ].join("\n");
    case "client": {
      const projects = record.projects.map(
        (p) => `- [${p.code}](${projectLink(ctx.appOrigin, p.id)}) · ${oneLine(p.name)}${p.archived ? " · archived" : ""}`,
      );
      const more = record.projectsTruncated ? "\n(More projects exist than shown. Search project with this client.)" : "";
      return [
        [
          `## Client ${oneLine(record.name)}`,
          `- Link: ${clientLink(ctx.appOrigin, record.id)}`,
          `- Ref: ${clientRef(record.prefix, record.id)}`,
          `- Archived: ${record.archived ? "yes" : "no"}`,
        ].join("\n"),
        `### Projects (${projects.length})\n${projects.length > 0 ? projects.join("\n") : "none"}${more}`,
      ].join("\n\n");
    }
    case "member":
      return [
        `## Member ${oneLine(record.name)}`,
        `- Link: ${memberLink(ctx.appOrigin, record.id)}`,
        `- Email: ${record.email ?? "none"}`,
        `- Role: ${record.role}`,
        `- Ref: ${record.email ?? record.id}`,
      ].join("\n");
  }
}

/** A failed ref: the model-actionable message, plus each candidate with its link. */
export function renderRefError(input: string, message: string, candidates: RefCandidates, ctx: RenderContext): string {
  const lines = candidates.map((c) => {
    const link =
      c.type === "project"
        ? projectLink(ctx.appOrigin, c.id)
        : c.type === "client"
          ? clientLink(ctx.appOrigin, c.id)
          : c.type === "member"
            ? memberLink(ctx.appOrigin, c.id)
            : null;
    const key = c.key ? (c.type === "client" ? `client:${c.key}` : c.key) : null;
    return `- ${fields(c.type, key, oneLine(c.name), `ref ${c.id}`, link)}`;
  });
  return [`Error fetching "${input}": ${message}`, ...lines].join("\n");
}

// ─── Search sections ─────────────────────────────────────────────────────────

type AnyPage = { rows: readonly unknown[]; total: number; offset: number; incomplete: boolean; notes: string[] };

/**
 * One result type's section: a header with the shown range and total, the
 * notes, then one row per line. `incomplete` (a capped load) is always
 * spelled out with the filters that type accepts, so a clipped set never
 * reads as complete.
 */
function searchSection(label: string, narrowWith: string, page: AnyPage, rows: string[], extra: string[] = []): string {
  const shown = page.rows.length;
  const total = `${page.incomplete ? "at least " : ""}${page.total}`;
  const header =
    page.total === 0 && !page.incomplete
      ? `### ${label} · no matches`
      : shown === 0
        ? `### ${label} · no more matches (${total} in total)`
        : `### ${label} · ${page.offset + 1}–${page.offset + shown} of ${total}`;
  const notes = [...extra, ...page.notes];
  if (page.incomplete) {
    notes.push(
      `Incomplete: the search reads a bounded number of records and more may match than are listed. Narrow it with ${narrowWith} for a complete list.`,
    );
  }
  return [header, ...notes, ...rows].join("\n");
}

export function renderTaskSection(page: TaskPage, ctx: RenderContext): string {
  const today = page.rows.some((r) => r.dueDate) ? [`Today: ${page.today} (org timezone)`] : [];
  return searchSection(
    "Tasks",
    "project, assignee, status, label or a due date range",
    page,
    page.rows.map((r) => renderTaskRow(r, ctx)),
    today,
  );
}

export function renderProjectSection(page: ProjectPage, ctx: RenderContext): string {
  return searchSection("Projects", "query or client", page, page.rows.map((r) => renderProjectRow(r, ctx)));
}

export function renderClientSection(page: ClientPage, ctx: RenderContext): string {
  return searchSection("Clients", "query", page, page.rows.map((r) => renderClientRow(r, ctx)));
}

export function renderMemberSection(page: MemberPage, ctx: RenderContext): string {
  return searchSection("Members", "query", page, page.rows.map((r) => renderMemberRow(r, ctx)));
}

export function renderTimeEntrySection(page: TimeEntryPage, ctx: RenderContext): string {
  const total =
    page.total === 0
      ? []
      : page.incomplete
        ? [`Total of the ${page.total} entries found: ${formatDuration(page.totalMinutes)} (more may exist)`]
        : [`Total of all ${page.total} matching ${page.total === 1 ? "entry" : "entries"}: ${formatDuration(page.totalMinutes)}`];
  return searchSection(
    "Time entries",
    "task, project, assignee or a tracked date range",
    page,
    page.rows.map((r) => renderTimeEntryRow(r, ctx)),
    total,
  );
}

export function renderCommentSection(page: CommentPage, ctx: RenderContext): string {
  return searchSection(
    "Comments",
    "task, project, assignee or an updated date range",
    page,
    page.rows.map((r) => renderCommentRow(r, { ...ctx, timezone: page.timezone })),
  );
}

// ─── Changes feed (fetch("changes"), D22, D29) ───────────────────────────────

/** Checklist wording for sub-task events on the parent (D24). */
const CHANGE_TEXT: Record<string, (m: Record<string, unknown>) => string> = {
  subtask_created: (m) => `checklist + "${m.title}"`,
  subtask_completed: (m) => `checklist "${m.title}" ✓`,
  subtask_deleted: (m) => `checklist − "${m.title}"`,
};

function changeText(type: string, metadata: unknown): string {
  const format = CHANGE_TEXT[type];
  return oneLine(format ? format((metadata ?? {}) as Record<string, unknown>) : activityText(type, metadata));
}

/**
 * One line per change, oldest first: time · task · actor · what changed
 * (· via client). Comment text (D29) follows as a user-content block. The
 * cursor line says how to continue; it is always present.
 */
export function renderChanges(data: ChangesData, ctx: RenderContext): string {
  const timezone = data.timezone;
  const header =
    data.changes.length === 0
      ? "## Changes · none new"
      : `## Changes · ${data.changes.length} (oldest first, times in ${timezone})`;
  const lines = data.changes.map((c) => {
    const head = `- ${fields(
      formatTimestamp(c.at, timezone),
      `[${c.task.identifier}](${taskLink(ctx.appOrigin, c.task.identifier)})`,
      oneLine(c.actor),
      changeText(c.type, c.metadata),
      c.comment ? `comment ${c.comment.id}` : null,
      c.via ? `via ${oneLine(c.via)}` : null,
    )}`;
    if (!c.comment) return head;
    if (c.comment.deleted) return `${head}\n(The comment has since been deleted.)`;
    if (c.comment.text === null) return head;
    const more = c.comment.truncated ? `\n(Shortened to 500 characters… fetch ${c.comment.id} for the full comment.)` : "";
    return `${head}\n${userContent(c.comment.text || "(no text)")}${more}`;
  });
  const next = data.more
    ? `More changes are waiting: call fetch with refs ["changes"] and changes.cursor "${data.cursor}" now.`
    : `Up to date. Next time, call fetch with refs ["changes"] and changes.cursor "${data.cursor}" to get only what changed since.`;
  return [header, ...lines, next].join("\n");
}

// ─── Write results (affected refs and links only, §6) ────────────────────────

const REPLAYED =
  "Replayed: this idempotencyKey was already used, so nothing was written again. The first call's result:";

function writeHeader(title: string, replayed: boolean): string {
  return replayed ? `## ${title}\n${REPLAYED}` : `## ${title}`;
}

const SAVE_ACTION: Record<"created" | "updated" | "unchanged", string> = {
  created: "created",
  updated: "updated",
  unchanged: "no change",
};

export function renderSaveTasks(data: SaveTasksData, ctx: RenderContext): string {
  const lines = data.items.map(
    (i) => `- ${fields(`[${i.identifier}](${taskLink(ctx.appOrigin, i.identifier)})`, oneLine(i.title), SAVE_ACTION[i.action])}`,
  );
  return [writeHeader(`Saved ${data.items.length} ${data.items.length === 1 ? "task" : "tasks"}`, data.replayed), ...lines].join("\n");
}

export function renderSaveComments(data: SaveCommentsData, ctx: RenderContext): string {
  const lines = data.items.map(
    (i) =>
      `- ${fields(`[comment ${i.commentId}](${taskLink(ctx.appOrigin, i.task, i.commentId)})`, `on ${i.task}`, SAVE_ACTION[i.action])}`,
  );
  return [
    writeHeader(`Saved ${data.items.length} ${data.items.length === 1 ? "comment" : "comments"}`, data.replayed),
    ...lines,
  ].join("\n");
}

export function renderDelete(data: DeleteData): string {
  const lines = data.items.map(
    (i) => `- ${fields(oneLine(i.label), i.action === "deleted" ? "deleted" : "already deleted with an earlier ref")}`,
  );
  return [writeHeader(`Deleted ${data.items.filter((i) => i.action === "deleted").length}`, data.replayed), ...lines].join("\n");
}
