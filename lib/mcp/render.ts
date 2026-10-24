import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { TASK_CATEGORIES } from "@/convex/tasks/model";

/**
 * Compact markdown renderers for MCP tool results (docs/prd-mcp.md §7, D10).
 * Convex returns data; these turn it into token-efficient text. Archived
 * reference rows are counted, not listed: agents should only write active
 * values. Names are user input and may contain commas, so every value gets
 * its own line; fields within a line are separated by " · ".
 */

export type MeData = FunctionReturnType<typeof api.mcp.fetch.me>;
export type WorkspaceData = FunctionReturnType<typeof api.mcp.fetch.workspace>;

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
