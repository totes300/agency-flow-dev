import { getISOWeek, getISOWeekYear } from "date-fns";
import { taskPagePath } from "@/lib/task-detail";

/**
 * App deep links for MCP output (docs/prd-mcp.md §7, D10): every entity an
 * MCP result shows carries the URL of its page in the app. The app and /mcp
 * share one origin, so the origin comes from the MCP resource URL. Pure.
 *
 * Routes (app/(dashboard)):
 * - task:    /tasks/ARLO-21 (comment: /tasks/ARLO-21?comment=<id>)
 * - project: /projects/<id>
 * - client:  /clients/<id>
 * - member:  /my-tasks?user=<userId> (the member's My Tasks; the app has no
 *   member page)
 * - reports: the Workday grid (/workday), the task list (/tasks), the
 *   Billing hub (/billing), a retainer statement
 *   (/projects/<id>/reports/YYYY-MM) and a Close workspace
 *   (/billing/close/<projectId>/YYYY-MM)
 * - invoice: /invoices/INV-007 (a never-numbered draft: /invoices/<id>)
 * - planner: /planner?week=2026-W44&users=<userId> (the week of a bar, on
 *   its member's row)
 * - daily note: the My Tasks notes panel (/my-tasks; another member's:
 *   /my-tasks?user=<userId>, admins)
 * Time entries have no page of their own; they link to their task.
 * Projects, clients, billing, invoices and other members' My Tasks are admin pages in the app.
 */

/** The app origin, e.g. `https://localhost:3001`, from the MCP resource URL. */
export function appOriginOf(resourceUrl: string): string {
  return new URL(resourceUrl).origin;
}

export function taskLink(origin: string, identifier: string, commentId?: string | null): string {
  return `${origin}${taskPagePath(identifier, commentId)}`;
}

export function projectLink(origin: string, projectId: string): string {
  return `${origin}/projects/${encodeURIComponent(projectId)}`;
}

export function clientLink(origin: string, clientId: string): string {
  return `${origin}/clients/${encodeURIComponent(clientId)}`;
}

export function memberLink(origin: string, userId: string): string {
  return `${origin}/my-tasks?user=${encodeURIComponent(userId)}`;
}

export function workdayLink(origin: string): string {
  return `${origin}/workday`;
}

export function tasksLink(origin: string): string {
  return `${origin}/tasks`;
}

export function billingLink(origin: string): string {
  return `${origin}/billing`;
}

/** A retainer month's statement page; `month` is YYYY-MM. */
export function statementLink(origin: string, projectId: string, month: string): string {
  return `${origin}/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(month)}`;
}

/** The Close workspace of a project period; `period` is the period's first month, YYYY-MM. */
export function closeWorkspaceLink(origin: string, projectId: string, period: string): string {
  return `${origin}/billing/close/${encodeURIComponent(projectId)}/${encodeURIComponent(period)}`;
}

/** An invoice page; `ref` is its number (INV-007) or, for a never-numbered draft, its ID. */
export function invoiceLink(origin: string, ref: string): string {
  return `${origin}/invoices/${encodeURIComponent(ref)}`;
}

/** The ISO week token the Planner's `week` param takes (`2026-W44`) of a YYYY-MM-DD date. */
export function isoWeekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  return `${getISOWeekYear(day)}-W${String(getISOWeek(day)).padStart(2, "0")}`;
}

/** The Planner at the week of `date` (YYYY-MM-DD), optionally filtered to one member's row. */
export function plannerLink(origin: string, date: string, userId?: string): string {
  const params = new URLSearchParams({ week: isoWeekOf(date) });
  if (userId) params.set("users", userId);
  return `${origin}/planner?${params.toString()}`;
}

/**
 * Where a daily note is read in the app: your My Tasks notes panel, or
 * (admins) another member's — `otherMemberId` names that member.
 */
export function dailyNoteLink(origin: string, otherMemberId?: string): string {
  return otherMemberId ? memberLink(origin, otherMemberId) : `${origin}/my-tasks`;
}
