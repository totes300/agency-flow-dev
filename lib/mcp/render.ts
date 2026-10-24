import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS, TASK_CATEGORIES } from "@/convex/tasks/model";

/**
 * Compact markdown renderers for MCP tool results (docs/prd-mcp.md §7, D10).
 * Convex returns data; these turn it into token-efficient text. Archived
 * reference rows are counted, not listed: agents should only write active
 * values. Nothing is ever clipped silently.
 */

export type MeData = FunctionReturnType<typeof api.mcp.fetch.me>;
export type WorkspaceData = FunctionReturnType<typeof api.mcp.fetch.workspace>;

const WORKSPACE_TABLE_LABELS: Record<WorkspaceData["truncated"][number], string> = {
  statuses: "statuses",
  labels: "labels",
  projects: "projects",
  clients: "clients",
  orgMembers: "members",
  workCategories: "work categories",
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

  if (data.truncated.length > 0) {
    const tables = data.truncated.map((t) => WORKSPACE_TABLE_LABELS[t]).join(", ");
    parts.push(
      `> Truncated: the ${tables} ${data.truncated.length > 1 ? "lists exceed" : "list exceeds"} the read limit; only the first rows are shown.`,
    );
  }

  if (data.orgTaskKey) {
    parts.push(`Task key for tasks without a project: ${data.orgTaskKey}`);
  }

  const statusLines: string[] = [];
  for (const category of TASK_CATEGORIES) {
    const names = data.statuses
      .filter((s) => s.category === category && !s.archived)
      .map((s) => (s.isDefault ? `${oneLine(s.name)} (default)` : oneLine(s.name)));
    if (names.length > 0) statusLines.push(`- ${CATEGORY_LABELS[category]}: ${names.join(", ")}`);
  }
  parts.push(section("Statuses", statusLines, archivedNote(data.statuses)));

  const activeNames = (rows: readonly { name: string; archived: boolean }[]) => {
    const names = rows.filter((r) => !r.archived).map((r) => oneLine(r.name));
    return names.length > 0 ? [names.join(", ")] : [];
  };
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
