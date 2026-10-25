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
 * Time entries have no page of their own; they link to their task.
 * Projects, clients, billing and other members' My Tasks are admin pages in the app.
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
