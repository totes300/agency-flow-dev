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

/** What renderers need besides the data: where the app lives and the org's clock. */
export type RenderContext = { appOrigin: string; timezone?: string };

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

  // Clients without a prefix are referenced by ID (§7).
  parts.push(
    section(
      "Clients (prefix or id · name)",
      data.clients
        .filter((c) => !c.archived)
        .map((c) => `- ${c.prefix ? oneLine(c.prefix) : c.id} · ${oneLine(c.name)}`),
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

/** Indents continuation lines so a multi-line text stays inside its list item. */
function indented(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

function keyed(key: string | null, name: string): string {
  return key ? `${oneLine(key)} · ${oneLine(name)}` : oneLine(name);
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
    row.project,
    row.parent ? `sub-task of ${row.parent}` : null,
  )}`;
}

export function renderProjectRow(row: ProjectPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${row.code}](${projectLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.client ? `client ${keyed(row.client.prefix, row.client.name)}` : "no client",
    row.archived && "archived",
  )}`;
}

export function renderClientRow(row: ClientPage["rows"][number], ctx: RenderContext): string {
  // Clients without a prefix are referenced by ID (§7).
  return `- ${fields(
    `[${row.prefix ? oneLine(row.prefix) : row.id}](${clientLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.archived && "archived",
  )}`;
}

export function renderMemberRow(row: MemberPage["rows"][number], ctx: RenderContext): string {
  return `- ${fields(
    `[${row.email ?? row.id}](${memberLink(ctx.appOrigin, row.id)})`,
    oneLine(row.name),
    row.role,
  )}`;
}

type TimeRow = TimeEntryPage["rows"][number];

function timeTask(row: TimeRow, ctx: RenderContext): string {
  return row.task ? `[${row.task.identifier}](${taskLink(ctx.appOrigin, row.task.identifier)}) ${oneLine(row.task.title)}` : "task not available";
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

/** "(latest 30 of 42)" when a section shows fewer rows than exist. */
function shownOf(shown: number, total: number, truncated: boolean): string {
  if (truncated) return ` (latest ${shown} of more than ${total})`;
  return shown < total ? ` (latest ${shown} of ${total})` : ` (${total})`;
}

function taskSections(record: TaskRecord, ctx: RenderContext): string[] {
  const parts: string[] = [];
  if (record.description) {
    parts.push(
      `### Description\n${record.description.text}${
        record.description.truncated ? "\n\n(Description cut short here. Open the link for the full text.)" : ""
      }`,
    );
  }
  if (record.subtasks) {
    const rows = record.subtasks.rows.map((s) =>
      `- ${fields(
        s.identifier ? `[${s.identifier}](${taskLink(ctx.appOrigin, s.identifier)})` : null,
        oneLine(s.title),
        s.status ? oneLine(s.status) : null,
        s.assignees.length > 0 ? list(s.assignees) : "unassigned",
      )}`,
    );
    const note = record.subtasks.truncated ? "\n(More sub-tasks exist than shown. Open the link for all.)" : "";
    parts.push(`### Sub-tasks (${rows.length})\n${rows.length > 0 ? rows.join("\n") : "none"}${note}`);
  }
  if (record.comments) {
    const { rows, total, truncated } = record.comments;
    const lines = rows.map((c) => {
      const head = fields(
        formatTimestamp(c.createdAt, ctx.timezone),
        oneLine(c.author),
        c.replyTo ? `reply to ${oneLine(c.replyTo)}` : null,
        c.resolved && "resolved",
        c.edited && "edited",
      );
      const text = `${c.text}${c.textTruncated ? " … (cut short; open the link for the full comment)" : ""}`;
      return `- ${head}\n${indented(text || "(no text)")}`;
    });
    parts.push(`### Comments${shownOf(rows.length, total, truncated)}\n${lines.length > 0 ? lines.join("\n") : "none"}`);
  }
  if (record.activity) {
    const { rows, total, truncated } = record.activity;
    const lines = rows.map(
      (e) => `- ${formatTimestamp(e.createdAt, ctx.timezone)} · ${oneLine(e.userName)} ${activityText(e.type, e.metadata)}`,
    );
    parts.push(`### Activity${shownOf(rows.length, total, truncated)}\n${lines.length > 0 ? lines.join("\n") : "none"}`);
  }
  if (record.time) {
    const { rows, total, totalMinutes, ownOnly, truncated } = record.time;
    const scope = ownOnly ? " (your entries only; members see their own time)" : "";
    const sum = `${truncated ? "at least " : ""}${formatDuration(totalMinutes)} over ${total} ${total === 1 ? "entry" : "entries"}`;
    const lines = rows.map((r) =>
      `- ${fields(r.id, r.date, formatDuration(r.minutes), oneLine(r.member), timeNote(r), r.billable ? "billable" : "non-billable")}`,
    );
    const more = rows.length < total ? `\n(Latest ${rows.length} shown. Search time_entry for the rest.)` : "";
    parts.push(`### Time${scope}\nTotal: ${sum}\n${lines.length > 0 ? lines.join("\n") : "none"}${more}`);
  }
  if (record.files) {
    const lines = record.files.rows.map((f) =>
      `- ${fields(
        f.url ? `[${oneLine(f.name)}](${f.url})` : oneLine(f.name),
        formatFileSize(f.size),
        f.mimeType,
        f.onComment && "on a comment",
      )}`,
    );
    const note = record.files.truncated ? "\n(More files exist than shown. Open the link for all.)" : "";
    parts.push(`### Files (${lines.length})\n${lines.length > 0 ? lines.join("\n") : "none"}${note}`);
  }
  if (record.attachmentText) {
    parts.push(
      "### Attachment text\nNot available: Agency Flow does not extract text from attachments yet. Use the file links above.",
    );
  }
  return parts;
}

export function renderTaskRecord(record: TaskRecord, ctx: RenderContext): string {
  const priority = record.priority === PRIORITY_LABELS[PRIORITY.none] ? null : record.priority;
  const effort = fields(
    record.estimateMinutes !== null ? `Estimate: ${formatDuration(record.estimateMinutes)}` : null,
    `Tracked: ${formatDuration(record.trackedMinutes)}`,
  );
  const lines = [
    `## ${record.identifier} · ${oneLine(record.title)}`,
    `- Link: ${taskLink(ctx.appOrigin, record.identifier)}`,
    `- Status: ${record.status ? oneLine(record.status) : "unknown"} (${record.statusCategory})`,
    priority && `- Priority: ${priority}`,
    `- Project: ${record.project ? keyed(record.project.code, record.project.name) : "none"}`,
    record.client && `- Client: ${keyed(record.client.prefix, record.client.name)}`,
    `- Assignees: ${list(record.assignees)}`,
    record.labels.length > 0 && `- Labels: ${list(record.labels)}`,
    record.workCategory && `- Work category: ${oneLine(record.workCategory)}`,
    record.startDate && `- Start: ${record.startDate}`,
    record.dueDate && `- Due: ${record.dueDate}${record.overdue ? " (overdue)" : ""}`,
    `- ${effort}`,
    `- Billable: ${record.billable ? "yes" : "no"}`,
    record.parent && `- Parent: ${record.parent.identifier ?? "?"} · ${oneLine(record.parent.title)}`,
    record.subtaskCount > 0 && `- Sub-tasks: ${record.subtaskDoneCount}/${record.subtaskCount} done`,
    record.commentCount > 0 && `- Comments: ${record.commentCount}`,
    record.archived && "- Archived: yes",
    `- Created: ${formatTimestamp(record.createdAt, ctx.timezone)} · Last activity: ${formatTimestamp(record.lastActivityAt, ctx.timezone)}`,
  ].filter((line): line is string => typeof line === "string");
  return [lines.join("\n"), ...taskSections(record, ctx)].join("\n\n");
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
        `${record.text || "(no text)"}${record.textTruncated ? "\n\n(Comment cut short here. Open the link for the full text.)" : ""}`,
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
        record.note ? `- Note: ${record.note}${record.noteTruncated ? "…" : ""}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
    case "project":
      return [
        `## Project ${record.code} · ${oneLine(record.name)}`,
        `- Link: ${projectLink(ctx.appOrigin, record.id)}`,
        `- Code: ${record.code} (task keys ${record.code}-N)`,
        `- Client: ${record.client ? keyed(record.client.prefix, record.client.name) : "none"}`,
        `- Archived: ${record.archived ? "yes" : "no"}`,
      ].join("\n");
    case "client": {
      const projects = record.projects.map(
        (p) => `- [${p.code}](${projectLink(ctx.appOrigin, p.id)}) · ${oneLine(p.name)}${p.archived ? " · archived" : ""}`,
      );
      const more = record.projectsTruncated ? "\n(More projects exist than shown. Search project with this client.)" : "";
      return [
        [
          `## Client ${record.prefix ? `${oneLine(record.prefix)} · ` : ""}${oneLine(record.name)}`,
          `- Link: ${clientLink(ctx.appOrigin, record.id)}`,
          `- Prefix: ${record.prefix ? oneLine(record.prefix) : `none (reference by ID ${record.id})`}`,
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
    return `- ${fields(c.type, c.key ? oneLine(c.key) : null, oneLine(c.name), `ref ${c.id}`, link)}`;
  });
  return [`Error fetching "${input}": ${message}`, ...lines].join("\n");
}

// ─── Search sections ─────────────────────────────────────────────────────────

type AnyPage = { rows: readonly unknown[]; total: number; offset: number; incomplete: boolean; notes: string[] };

/**
 * One result type's section: a header with the shown range and total, the
 * notes, then one row per line. `incomplete` (a capped load) is always
 * spelled out, so a clipped set never reads as complete.
 */
function searchSection(label: string, page: AnyPage, rows: string[], extra: string[] = []): string {
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
      "Incomplete: the search reads a bounded number of records and more may match than are listed. Narrow it with filters (project, assignee, status, a date range) for a complete list.",
    );
  }
  return [header, ...notes, ...rows].join("\n");
}

export function renderTaskSection(page: TaskPage, ctx: RenderContext): string {
  const today = page.rows.some((r) => r.dueDate) ? [`Today: ${page.today} (org timezone)`] : [];
  return searchSection("Tasks", page, page.rows.map((r) => renderTaskRow(r, ctx)), today);
}

export function renderProjectSection(page: ProjectPage, ctx: RenderContext): string {
  return searchSection("Projects", page, page.rows.map((r) => renderProjectRow(r, ctx)));
}

export function renderClientSection(page: ClientPage, ctx: RenderContext): string {
  return searchSection("Clients", page, page.rows.map((r) => renderClientRow(r, ctx)));
}

export function renderMemberSection(page: MemberPage, ctx: RenderContext): string {
  return searchSection("Members", page, page.rows.map((r) => renderMemberRow(r, ctx)));
}

export function renderTimeEntrySection(page: TimeEntryPage, ctx: RenderContext): string {
  const total =
    page.total > 0
      ? [`Total of all ${page.total} matching entries: ${page.incomplete ? "at least " : ""}${formatDuration(page.totalMinutes)}`]
      : [];
  return searchSection("Time entries", page, page.rows.map((r) => renderTimeEntryRow(r, ctx)), total);
}

export function renderCommentSection(page: CommentPage, ctx: RenderContext): string {
  return searchSection("Comments", page, page.rows.map((r) => renderCommentRow(r, { ...ctx, timezone: page.timezone })));
}
