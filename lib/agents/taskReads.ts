/**
 * Pure shaping for the task read tools of phase A3 (docs/prd-email-triage.md
 * §6.4: T9 getTaskComments, T10 getTaskActivity, T11 getTaskFiles, T14
 * getTaskBundle). The Convex side (`convex/agentReads.ts`) loads rows behind
 * the task access policy; everything here is deterministic and DB-free so it
 * is unit-tested in isolation.
 *
 * Output is model-facing: plain text, human-readable change lines, ISO
 * timestamps, and explicit caps — never raw Tiptap JSON or money.
 */

import { extractPlainText } from "../tiptap-utils";
import { PRIORITY_LABELS, type ActivityEvent, type TaskPriority } from "../../convex/tasks/model";

// ─── Caps ────────────────────────────────────────────────────────────────────

/** getTaskComments: default / max comments returned (newest last). */
export const COMMENTS_LIMIT_DEFAULT = 30;
export const COMMENTS_LIMIT_MAX = 50;
/** Plain-text cap per comment (getTaskComments). */
export const COMMENT_TEXT_MAX = 1000;

/** getTaskActivity: default / max events returned (newest last). */
export const ACTIVITY_LIMIT_DEFAULT = 30;
export const ACTIVITY_LIMIT_MAX = 50;
/** Activity rows scanned per call (newest first) — bounds the omitted count. */
export const ACTIVITY_SCAN_CAP = 200;
/** Time entries returned by getTaskActivity (newest first). */
export const TIME_ENTRIES_LIMIT = 20;
/** Time entries scanned before the member own-entries filter. */
export const TIME_ENTRIES_SCAN_CAP = 200;

/** getTaskFiles: files returned (task + comment attachments, newest first). */
export const FILES_LIMIT = 50;
/** Link previews returned. */
export const LINKS_LIMIT = 20;
/** Comments scanned per task for links. */
export const LINK_SCAN_COMMENTS = 30;

/** Sub-tasks fanned out to when `includeSubtasks` is set. */
export const SUBTASK_FANOUT_CAP = 25;

/** getTaskBundle digest caps. */
export const BUNDLE_COMMENTS = 10;
export const BUNDLE_COMMENT_TEXT_MAX = 280;
export const BUNDLE_ACTIVITY = 15;
export const BUNDLE_FILES = 10;
export const BUNDLE_LINKS = 5;

/** Change values (titles, project names) are cut to this many chars. */
export const CHANGE_VALUE_MAX = 120;

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

// ─── Text ────────────────────────────────────────────────────────────────────

/** Cut to `max` chars with a trailing ellipsis (the ellipsis counts). */
export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

type TiptapNode = {
  type?: string;
  text?: string;
  content?: unknown[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
};

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function blockLines(node: TiptapNode): string[] {
  if (LIST_TYPES.has(node.type ?? "")) {
    return (node.content ?? []).flatMap((item) => {
      const lines = ((item as TiptapNode).content ?? []).flatMap((c) => blockLines(c as TiptapNode));
      return lines.length > 0 ? [`- ${lines[0]}`, ...lines.slice(1).map((l) => `  ${l}`)] : [];
    });
  }
  if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") {
    const text = extractPlainText(node, "\n").trim();
    return text ? [text] : [];
  }
  if (node.type === "blockquote" || node.type === "doc") {
    return (node.content ?? []).flatMap((c) => blockLines(c as TiptapNode));
  }
  const text = extractPlainText(node, "\n").trim();
  return text ? [text] : [];
}

/**
 * Tiptap JSON (object or JSON string) → plain text, one line per block
 * (paragraphs, headings, list items as `- …`), mentions as `@Name`, capped.
 * Unparseable strings pass through as plain text; empty → "".
 */
export function tiptapToPlainText(content: unknown, maxChars: number): string {
  let doc: unknown = content;
  if (typeof content === "string") {
    try {
      doc = JSON.parse(content);
    } catch {
      return truncateText(content.trim(), maxChars);
    }
  }
  if (!doc || typeof doc !== "object") return "";
  const text = blockLines(doc as TiptapNode).join("\n").trim();
  return truncateText(text, maxChars);
}

function walk(node: unknown, visit: (n: TiptapNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as TiptapNode;
  visit(n);
  if (Array.isArray(n.content)) for (const child of n.content) walk(child, visit);
}

/** `@mention` labels in document order, deduped (what the comment shows). */
export function extractMentionLabels(content: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  walk(content, (n) => {
    if (n.type !== "mention") return;
    const label = n.attrs?.label ?? n.attrs?.id;
    if (typeof label === "string" && label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  });
  return labels;
}

/**
 * http(s) links (link marks) in document order, deduped — the same set the
 * comment link preview renders (`components/comment-link-preview.tsx`).
 */
export function extractLinks(content: unknown): Array<{ url: string; domain: string }> {
  let doc: unknown = content;
  if (typeof content === "string") {
    try {
      doc = JSON.parse(content);
    } catch {
      return [];
    }
  }
  const seen = new Set<string>();
  const links: Array<{ url: string; domain: string }> = [];
  walk(doc, (n) => {
    for (const mark of n.marks ?? []) {
      const href = mark.type === "link" ? mark.attrs?.href : undefined;
      if (typeof href !== "string" || seen.has(href)) continue;
      seen.add(href);
      try {
        const url = new URL(href);
        if (url.protocol === "http:" || url.protocol === "https:") {
          links.push({ url: href, domain: url.hostname.replace(/^www\./, "") });
        }
      } catch {
        // invalid URL — skipped, like the UI
      }
    }
  });
  return links;
}

/** Epoch ms → ISO 8601 (UTC) for the model. */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

// ─── Capping ─────────────────────────────────────────────────────────────────

/**
 * Merge rows (any order), keep the newest `limit`, return them oldest first
 * ("newest last" — a conversation reads top to bottom).
 */
export function newestLast<T extends { createdAt: number }>(rows: readonly T[], limit: number): T[] {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).reverse();
}

// ─── Activity ────────────────────────────────────────────────────────────────

export type ActivityLine = {
  type: string;
  /** One human-readable line ("Status: Backlog → In progress"). */
  summary: string;
  before: string | null;
  after: string | null;
};

const clip = (s: string) => truncateText(s, CHANGE_VALUE_MAX);
const orNone = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? "none" : clip(s));
const yesNo = (b: boolean) => (b ? "yes" : "no");
const priority = (p: TaskPriority) => PRIORITY_LABELS[p] ?? String(p);

function minutesText(m: number | null): string {
  if (m === null) return "none";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h > 0 ? `${h}h${rest > 0 ? ` ${rest}m` : ""}` : `${rest}m`;
}

function change(type: string, label: string, before: string, after: string): ActivityLine {
  return { type, summary: `${label}: ${before} → ${after}`, before, after };
}

function plain(type: string, summary: string): ActivityLine {
  return { type, summary, before: null, after: null };
}

/**
 * One typed activity event (`convex/tasks/model.ts` activityLogValidator) as
 * a readable line, with before → after where the metadata carries them.
 * Unknown types fall back to the humanized type name.
 */
export function describeActivity(event: ActivityEvent): ActivityLine {
  switch (event.type) {
    case "task_created":
      return plain(event.type, event.metadata.duplicatedFrom ? "Created the task (duplicated)" : "Created the task");
    case "subtask_created":
      return plain(event.type, `Added sub-task "${clip(event.metadata.title)}"`);
    case "subtask_completed":
      return plain(event.type, `Completed sub-task "${clip(event.metadata.title)}"`);
    case "subtask_deleted":
      return plain(event.type, `Deleted sub-task "${clip(event.metadata.title)}"`);
    case "status_changed":
      return change(event.type, "Status", clip(event.metadata.from), clip(event.metadata.to));
    case "assignee_added": {
      const why =
        event.metadata.reason === "default_assignee"
          ? ` (project default${event.metadata.categoryName ? ` for ${event.metadata.categoryName}` : ""})`
          : "";
      return { type: event.type, summary: `Assigned ${event.metadata.userName}${why}`, before: null, after: event.metadata.userName };
    }
    case "assignee_removed":
      return { type: event.type, summary: `Unassigned ${event.metadata.userName}`, before: event.metadata.userName, after: null };
    case "label_added":
      return { type: event.type, summary: `Added label ${event.metadata.labelName}`, before: null, after: event.metadata.labelName };
    case "label_removed":
      return { type: event.type, summary: `Removed label ${event.metadata.labelName}`, before: event.metadata.labelName, after: null };
    case "title_changed":
      return change(event.type, "Title", clip(event.metadata.from), clip(event.metadata.to));
    case "category_changed":
      return change(event.type, "Work category", orNone(event.metadata.from), orNone(event.metadata.to));
    case "priority_changed":
      return change(event.type, "Priority", priority(event.metadata.from), priority(event.metadata.to));
    case "due_date_changed":
      return change(event.type, "Due date", orNone(event.metadata.from), orNone(event.metadata.to));
    case "start_date_changed":
      return change(event.type, "Start date", orNone(event.metadata.from), orNone(event.metadata.to));
    case "estimate_changed":
      return change(event.type, "Estimate", minutesText(event.metadata.from), minutesText(event.metadata.to));
    case "project_changed":
      return change(event.type, "Project", orNone(event.metadata.from), orNone(event.metadata.to));
    case "billable_changed":
      return change(event.type, "Billable", yesNo(event.metadata.from), yesNo(event.metadata.to));
    case "identifier_changed":
      return change(event.type, "Identifier", orNone(event.metadata.from), event.metadata.to);
    case "task_archived":
      return plain(event.type, event.metadata.viaParent ? "Archived (with its parent)" : "Archived the task");
    case "task_restored":
      return plain(event.type, event.metadata.viaParent ? "Restored (with its parent)" : "Restored the task");
    case "comment_added":
      return plain(event.type, "Commented");
    case "comment_resolved":
      return plain(event.type, "Resolved a comment thread");
    case "comment_reopened":
      return plain(event.type, "Re-opened a comment thread");
    case "time_entry_logged": {
      const note = event.metadata.note ? ` — "${clip(event.metadata.note)}"` : "";
      return { type: event.type, summary: `Logged ${event.metadata.duration}${note}`, before: null, after: event.metadata.duration };
    }
    case "time_entry_edited":
      return change(event.type, "Time entry", event.metadata.oldDuration, event.metadata.newDuration);
    case "time_entry_deleted":
      return { type: event.type, summary: `Deleted a ${event.metadata.duration} time entry`, before: event.metadata.duration, after: null };
    case "description_changed":
      return plain(event.type, "Edited the description");
    default: {
      const type = (event as { type: string }).type;
      return plain(type, type.replace(/_/g, " "));
    }
  }
}

/** Activity types the task drawer hides (legacy noise) — mirrored here. */
export const HIDDEN_ACTIVITY_TYPES: ReadonlySet<string> = new Set(["description_changed"]);
