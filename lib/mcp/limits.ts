/**
 * MCP limits and enums shared by the Next.js route (lib/mcp/registry.ts)
 * and Convex (convex/mcp/*, convex/lib/mcp*.ts) — one source, no drift.
 * Pure and dependency-free (Convex imports it relatively).
 */

/** Maximum refs per `fetch` call (docs/prd-mcp.md §6). */
export const MAX_REFS = 25;

/** Search rows per type (docs/prd-mcp.md §7: default 25, max 100). */
export const SEARCH_LIMIT_DEFAULT = 25;
export const SEARCH_LIMIT_MAX = 100;

/** `fetch` include[] sections (docs/prd-mcp.md §6). */
export const FETCH_INCLUDES = ["subtasks", "comments", "activity", "time", "files", "attachment_text"] as const;
export type FetchInclude = (typeof FETCH_INCLUDES)[number];

/**
 * Activity types the changes feed reports and filters on (`fetch("changes")`
 * `types[]`, docs/prd-mcp.md D22): every activity type the app writes
 * (convex/tasks/model.ts activityLogValidator) except the legacy
 * `description_changed`. A test keeps the two lists equal.
 */
export const CHANGE_TYPES = [
  "task_created",
  "subtask_created",
  "subtask_completed",
  "subtask_deleted",
  "status_changed",
  "assignee_added",
  "assignee_removed",
  "label_added",
  "label_removed",
  "title_changed",
  "category_changed",
  "priority_changed",
  "due_date_changed",
  "start_date_changed",
  "estimate_changed",
  "project_changed",
  "billable_changed",
  "identifier_changed",
  "task_archived",
  "task_restored",
  "comment_added",
  "comment_resolved",
  "comment_reopened",
  "time_entry_logged",
  "time_entry_edited",
  "time_entry_deleted",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/** Changes per `fetch("changes")` call (default / max). */
export const CHANGES_LIMIT_DEFAULT = 50;
export const CHANGES_LIMIT_MAX = 100;
/** Comment text shown per `comment_added` change (D29); longer text ends with "…" and the comment ref. */
export const CHANGE_COMMENT_TEXT_MAX = 500;

/** Items (or refs) per batch write call: each item runs a full write path (docs/prd-mcp.md §6). */
export const MCP_BATCH_MAX = 25;
/** `idempotencyKey` length (D23). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** Task priorities as written in `save_tasks` (convex/tasks/model.ts PRIORITY). */
export const PRIORITY_NAMES = ["none", "urgent", "high", "medium", "low"] as const;
export type PriorityName = (typeof PRIORITY_NAMES)[number];

/** Markdown accepted per description or comment body (route schema and Convex). */
export const MARKDOWN_MAX_LENGTH = 50_000;

/**
 * Minutes per `save_time_entries` entry: whole minutes, at most one day (an
 * entry is filed under one date). The app ceils to whole minutes too.
 */
export const TIME_ENTRY_MINUTES_MAX = 24 * 60;
/** Characters per time-entry note (plain text). */
export const TIME_ENTRY_NOTE_MAX = 2_000;
