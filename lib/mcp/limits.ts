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
export const FETCH_INCLUDES = ["subtasks", "comments", "activity", "time", "plan", "files", "attachment_text"] as const;
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
  "task_deleted",
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

/** Inbox items per `fetch("inbox")` page (default / max). */
export const INBOX_LIMIT_DEFAULT = 25;
export const INBOX_LIMIT_MAX = 100;

/** Items (or refs) per batch write call: each item runs a full write path (docs/prd-mcp.md §6). */
export const MCP_BATCH_MAX = 25;
/** `idempotencyKey` length (D23). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** Task priorities as written in `save_tasks` (convex/tasks/model.ts PRIORITY). */
export const PRIORITY_NAMES = ["none", "urgent", "high", "medium", "low"] as const;
export type PriorityName = (typeof PRIORITY_NAMES)[number];

/**
 * Files (docs/prd-mcp.md §10, D18). Size and count limits are the app's own
 * (lib/attachment.ts, convex/attachments.ts, convex/commentAttachments.ts).
 * `attach_file` inline text is capped at 200 KiB of UTF-8, matching Notion.
 */
export const INLINE_TEXT_MAX_BYTES = 200 * 1024;
/** A Convex upload URL works for 1 hour after create_upload. */
export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;
/** An upload must be attached within 24 hours of its create_upload. */
export const UPLOAD_ATTACH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Upload rows are kept 25 hours (past the attach window), then cleaned up with any unattached blob. */
export const UPLOAD_ROW_TTL_MS = 25 * 60 * 60 * 1000;

/**
 * `invite_members` (docs/prd-mcp.md D-INVITE): the two Clerk organization
 * roles the app knows (`orgMembers.role`), and the longest email accepted.
 */
export const INVITE_ROLES = ["admin", "member"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];
export const INVITE_EMAIL_MAX_LENGTH = 254;

/** Markdown accepted per description or comment body (route schema and Convex). */
export const MARKDOWN_MAX_LENGTH = 50_000;

/**
 * Minutes per `save_time_entries` entry: whole minutes, at most one day (an
 * entry is filed under one date). The app ceils to whole minutes too.
 */
export const TIME_ENTRY_MINUTES_MAX = 24 * 60;
/** Characters per time-entry note (plain text). */
export const TIME_ENTRY_NOTE_MAX = 2_000;

/**
 * `report` kinds (docs/prd-mcp.md §8): each runs one deterministic Convex
 * core and returns rows the route renders as a markdown table (D1).
 */
export const REPORT_KINDS = [
  "timesheet",
  "time_by_member",
  "client_monthly",
  "missing_time",
  "project_overview",
  "project_monthly",
  "retainer_statement",
  "retainer_health",
  "close_queue",
  "invoice_metrics",
  "org_finance",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * `billing_preview` actions (docs/prd-mcp.md D5, §9): the app's own period
 * and invoice actions, one each (docs/prd-project-billing-redesign.md
 * §5.2–§5.4). convex/lib/mcpBillingResults.ts maps each to its write path.
 */
export const BILLING_ACTIONS = [
  "close_period",
  "reopen_period",
  "create_fixed_invoice",
  "mark_invoiced",
  "mark_paid",
  "mark_unpaid",
  "revert_to_draft",
  "void_invoice",
  "delete_draft",
] as const;
export type BillingAction = (typeof BILLING_ACTIONS)[number];

/** Actions on a project period (`project` + `period`). */
export const PERIOD_ACTIONS = ["close_period", "reopen_period"] as const satisfies readonly BillingAction[];
/** Actions on a project (`project`). */
export const PROJECT_ACTIONS = ["create_fixed_invoice"] as const satisfies readonly BillingAction[];
/** Actions on an invoice (`invoice`). */
export const INVOICE_ACTIONS = [
  "mark_invoiced",
  "mark_paid",
  "mark_unpaid",
  "revert_to_draft",
  "void_invoice",
  "delete_draft",
] as const satisfies readonly BillingAction[];

/**
 * Invoice search `status` values: the Invoices views' statuses
 * (docs/prd-project-billing-redesign.md §5.2) — `invoiced` is issued and not
 * yet past due, so it excludes `past_due` — plus `outstanding` = invoiced +
 * past due (the redesign's "Outstanding").
 */
export const INVOICE_SEARCH_STATUSES = ["draft", "invoiced", "past_due", "outstanding", "paid", "void"] as const;
export type InvoiceSearchStatus = (typeof INVOICE_SEARCH_STATUSES)[number];

/**
 * Connected apps (docs/prd-mcp.md D17): a connection's "last used" is stamped
 * at most this often — by the /mcp route per server instance and again by
 * convex/lib/mcpConnections.ts across instances; the page rounds to it.
 */
export const CONNECTION_LAST_USED_INTERVAL_MS = 60 * 60 * 1000;
