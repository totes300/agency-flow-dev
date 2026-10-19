import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import type { Doc, Id } from "./_generated/dataModel";
import { filterReadableTasks } from "./tasks/access";
import { isClosedCategory } from "./tasks/model";
import { SEARCH_CAP, loadAssignedTo } from "./tasks/read";
import { resolveTaskRef } from "./tasks/agent";

/**
 * Data source for the composer's @-mention picker (slice 07): the four
 * mentionable domain entities — tasks, projects, clients, people — org-scoped
 * from the authed session. Everyone can run permitted agents, so this is not
 * admin-gated; it returns only lightweight display fields (id + label + a bit
 * of context), never rates or financials.
 *
 * Users, projects and clients ship whole and the client filters them
 * in-memory. Tasks never scan the org (docs/prd-tasks-refactor.md §7, T7):
 * `list` carries the caller's recent open tasks from their own assignee
 * edges, and `searchTasks` answers the typed query from the `search_title`
 * index (plus an exact identifier match). Both are access-filtered (T1) and
 * capped; `tasksTruncated` lets the picker hint that a search may help.
 */

/** Recent tasks shipped with `list` (the empty-query suggestions). */
const TASK_MENTION_CAP = 50;
/** Edges read for the recent list; a bounded slice of the caller's work. */
const TASK_MENTION_EDGE_CAP = 500;
/** Hits returned by `searchTasks`. */
const TASK_SEARCH_LIMIT = 20;

type MentionEntity = {
  id: string;
  label: string;
  /** Secondary line in the picker (identifier/project context), when available. */
  sublabel?: string;
};

/** Task mention: title as the label, `ARLO-21 · Project` as context. */
async function toTaskEntities(ctx: QueryCtx, orgId: string, tasks: readonly Doc<"tasks">[]): Promise<MentionEntity[]> {
  const projectNames = new Map<Id<"projects">, string | null>();
  const out: MentionEntity[] = [];
  for (const t of tasks) {
    let project: string | null = null;
    if (t.projectId) {
      if (!projectNames.has(t.projectId)) {
        const doc = await ctx.db.get(t.projectId);
        projectNames.set(t.projectId, doc && doc.orgId === orgId ? doc.name : null);
      }
      project = projectNames.get(t.projectId) ?? null;
    }
    const context = [t.identifier, project].filter(Boolean).join(" · ");
    out.push({ id: t._id, label: t.title, sublabel: context || undefined });
  }
  return out;
}

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
    const auth = await getAuthContext(ctx);
    const { orgId } = auth;

    const [memberships, projects, clients, assigned] = await Promise.all([
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
      loadAssignedTo(ctx, orgId, auth.userId, TASK_MENTION_EDGE_CAP),
    ]);

    const clientById = new Map(clients.map((c) => [c._id.toString(), c]));

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

    // ─── Tasks (the caller's recent open work, capped) ───────────────────────
    const readable = await filterReadableTasks(ctx, auth, assigned.tasks);
    const recent = readable
      .filter((t) => !t.archivedAt && !(t.statusCategory && isClosedCategory(t.statusCategory)))
      .sort((a, b) => (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt));
    const tasksTruncated = assigned.truncated || recent.length > TASK_MENTION_CAP;

    return {
      users: sortByLabel(users),
      projects: sortByLabel(projectEntities),
      clients: sortByLabel(clientEntities),
      // Tasks stay in recency order (the cap is recency-based); label-sorting
      // would hide the "recent tasks surface first" intent.
      tasks: await toTaskEntities(ctx, orgId, recent.slice(0, TASK_MENTION_CAP)),
      tasksTruncated,
    };
  },
});

/**
 * Tasks matching the picker's typed query: an exact identifier (`arlo-21`,
 * aliases resolve) first, then `search_title` hits in relevance order —
 * readable by the caller, non-archived, capped at `TASK_SEARCH_LIMIT`.
 */
export const searchTasks = query({
  args: { search: v.string() },
  handler: async (ctx, args): Promise<{ tasks: MentionEntity[] }> => {
    const auth = await getAuthContext(ctx);
    const { orgId } = auth;
    const search = args.search.trim();
    if (!search) return { tasks: [] };

    const candidates: Doc<"tasks">[] = [];
    const exactId = await resolveTaskRef(ctx, orgId, search);
    if (exactId) {
      const exact = await ctx.db.get(exactId);
      if (exact && exact.orgId === orgId) candidates.push(exact);
    }
    const hits = await ctx.db
      .query("tasks")
      .withSearchIndex("search_title", (q) => q.search("title", search).eq("orgId", orgId))
      .take(SEARCH_CAP);
    for (const hit of hits) if (hit._id !== exactId) candidates.push(hit);

    const readable = await filterReadableTasks(
      ctx,
      auth,
      candidates.filter((t) => !t.archivedAt),
    );
    return { tasks: await toTaskEntities(ctx, orgId, readable.slice(0, TASK_SEARCH_LIMIT)) };
  },
});

function sortByLabel(items: MentionEntity[]): MentionEntity[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

/** Kept for callers that need the id type without importing the full Doc. */
export type MentionEntityId = Id<"tasks" | "projects" | "clients" | "users">;
