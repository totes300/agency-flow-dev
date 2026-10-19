import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
import { categoryOfStatus, statusIconFor, TASK_CATEGORIES, type StatusIcon, type TaskCategory } from "./tasks/model";

/**
 * The reference data every task surface renders rows with
 * (docs/prd-tasks-refactor.md §5.1, §5.4): `TaskRowDTO` carries ids only and
 * the client resolves names, colours, avatars and status icons from this one
 * query, subscribed once per page.
 *
 * Readable by every org member. It carries display fields only: no project
 * rates, budgets, fees or other billing data, no client billing details, no
 * org secrets. Archived statuses/labels/projects/categories are included
 * (flagged) so old tasks still render; pickers hide them.
 */

/** Per-table bound; orgs have tens of these, not thousands. */
const REF_CAP = 2000;

export type WorkspaceStatusRef = {
  _id: Id<"statuses">;
  name: string;
  description: string | null;
  color: string;
  category: TaskCategory;
  position: string;
  isDefault: boolean;
  icon: StatusIcon;
  archived: boolean;
};

/**
 * Shared core of `get` — also run by the agent actor path
 * (`convex/agentActorTools.ts`) with a DB-derived AuthContext.
 */
export async function getWorkspaceRefsForAuth(ctx: QueryCtx, auth: AuthContext) {
  const { orgId, userId } = auth;

  const [statusDocs, labelDocs, projectDocs, clientDocs, memberships, categoryDocs, settings] =
    await Promise.all([
      ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("workCategories").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP),
      ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).first(),
    ]);

  // Statuses: category order, then position; the icon is derived from the
  // index among the category's active statuses (§4.1).
  const withCategory = statusDocs.map((s) => ({ doc: s, category: categoryOfStatus(s) }));
  const position = (s: (typeof withCategory)[number]) => s.doc.position ?? "";
  withCategory.sort(
    (a, b) =>
      TASK_CATEGORIES.indexOf(a.category) - TASK_CATEGORIES.indexOf(b.category) ||
      (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0),
  );
  const statuses: WorkspaceStatusRef[] = [];
  for (const category of TASK_CATEGORIES) {
    const inCategory = withCategory.filter((s) => s.category === category);
    const active = inCategory.filter((s) => !s.doc.archivedAt);
    for (const s of inCategory) {
      const index = active.indexOf(s);
      statuses.push({
        _id: s.doc._id,
        name: s.doc.name,
        description: s.doc.description ?? null,
        color: s.doc.color,
        category,
        position: position(s),
        isDefault: s.doc.isDefault === true,
        icon: statusIconFor(category, index === -1 ? active.length - 1 : index, active.length),
        archived: s.doc.archivedAt !== undefined,
      });
    }
  }

  const members = (
    await Promise.all(
      memberships.map(async (m) => {
        if (!m.userId) return null;
        const user = await ctx.db.get(m.userId);
        if (!user || user.deletedAt) return null;
        return {
          _id: user._id,
          name: user.name,
          email: user.email ?? null,
          imageUrl: user.imageUrl ?? null,
          role: m.role,
        };
      }),
    )
  ).filter((m) => m !== null);

  return {
    me: userId,
    orgTaskKey: settings?.taskKey ?? null,
    statuses,
    labels: labelDocs.map((l) => ({
      _id: l._id,
      name: l.name,
      color: l.color,
      position: l.position,
      archived: l.archivedAt !== undefined,
    })),
    projects: projectDocs.map((p) => ({
      _id: p._id,
      name: p.name,
      code: p.code,
      clientId: p.clientId,
      archived: p.archivedAt !== undefined,
    })),
    clients: clientDocs.map((c) => ({
      _id: c._id,
      name: c.name,
      prefix: c.prefix ?? c.invoicePrefix ?? null,
      usePrefix: c.usePrefix === true,
      archived: c.archivedAt !== undefined,
    })),
    members,
    workCategories: categoryDocs
      .map((c) => ({
        _id: c._id,
        name: c.name,
        color: c.color,
        sortOrder: c.sortOrder,
        archived: c.archivedAt !== undefined,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** The workspace reference payload (statuses, labels, projects, …). */
export type WorkspaceRefs = Awaited<ReturnType<typeof getWorkspaceRefsForAuth>>;

export const get = query({
  args: {},
  handler: async (ctx): Promise<WorkspaceRefs> => {
    return await getWorkspaceRefsForAuth(ctx, await getAuthContext(ctx));
  },
});
