import { query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

/**
 * Data source for the composer's @-mention picker (slice 07): the four
 * mentionable domain entities — tasks, projects, clients, people — org-scoped
 * from the authed session. Everyone can run permitted agents, so this is not
 * admin-gated; it returns only lightweight display fields (id + label + a bit
 * of context), never rates or financials.
 *
 * The client filters in-memory (matches the existing task-comment mention
 * pattern). Tasks are capped to the most recently touched non-archived set so
 * a large board can't bloat the payload; the cap is surfaced so the picker can
 * hint when a search may be incomplete.
 */

/** Upper bound on tasks shipped to the picker (most-recently-updated first). */
const TASK_MENTION_CAP = 400;

type MentionEntity = {
  id: string;
  label: string;
  /** Secondary line in the picker (project/client context), when available. */
  sublabel?: string;
};

export const list = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    users: MentionEntity[];
    projects: MentionEntity[];
    clients: MentionEntity[];
    tasks: MentionEntity[];
    tasksTruncated: boolean;
  }> => {
    const { orgId } = await getAuthContext(ctx);

    const [memberships, projects, clients, allTasks] = await Promise.all([
      ctx.db
        .query("orgMembers")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("clients")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect(),
    ]);

    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));
    const projectById = new Map(projects.map((p) => [p._id.toString(), p]));

    // ─── Users (resolved org members) ────────────────────────────────────────
    const users: MentionEntity[] = [];
    for (const m of memberships) {
      if (!m.userId) continue;
      const user = await ctx.db.get(m.userId);
      if (!user || user.deletedAt) continue;
      users.push({
        id: user._id,
        label: user.name,
        sublabel: user.email ?? undefined,
      });
    }

    // ─── Projects (with client context) ──────────────────────────────────────
    const activeProjects = projects.filter((p) => !p.archivedAt);
    const projectEntities: MentionEntity[] = activeProjects.map((p) => {
      const client = clientById.get(p.clientId.toString());
      return {
        id: p._id,
        label: p.name,
        sublabel: client?.name ?? undefined,
      };
    });

    // ─── Clients ─────────────────────────────────────────────────────────────
    const clientEntities: MentionEntity[] = clients
      .filter((c) => !c.archivedAt)
      .map((c) => ({ id: c._id, label: c.name, sublabel: c.prefix }));

    // ─── Tasks (recent, capped) ──────────────────────────────────────────────
    const activeTasks = allTasks
      .filter((t) => !t.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const tasksTruncated = activeTasks.length > TASK_MENTION_CAP;
    const taskEntities: MentionEntity[] = activeTasks
      .slice(0, TASK_MENTION_CAP)
      .map((t) => {
        const project = t.projectId
          ? projectById.get(t.projectId.toString())
          : undefined;
        const client = project
          ? clientById.get(project.clientId.toString())
          : undefined;
        const context = [client?.name, project?.name]
          .filter(Boolean)
          .join(" · ");
        return {
          id: t._id,
          label: t.title,
          sublabel: context || undefined,
        };
      });

    return {
      users: sortByLabel(users),
      projects: sortByLabel(projectEntities),
      clients: sortByLabel(clientEntities),
      // Tasks stay in recency order (the cap is recency-based); label-sorting
      // would hide the "recent tasks surface first" intent.
      tasks: taskEntities,
      tasksTruncated,
    };
  },
});

function sortByLabel(items: MentionEntity[]): MentionEntity[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

/** Kept for callers that need the id type without importing the full Doc. */
export type MentionEntityId = Id<"tasks" | "projects" | "clients" | "users">;
