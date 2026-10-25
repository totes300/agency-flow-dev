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
export const REF_CAP = 2000;

/** Tables `getWorkspaceRefsForAuth` reads under `REF_CAP`. */
export type WorkspaceRefTable =
  | "statuses"
  | "labels"
  | "projects"
  | "clients"
  | "orgMembers"
  | "workCategories";

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

export const get = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    return (await getWorkspaceRefsForAuth(ctx, auth)).refs;
  },
});

/**
 * The workspace reference data for an already-authorized caller; shared by
 * the UI query above and the MCP `workspace` fetch. `truncated` names every
 * table that hit `REF_CAP`, so a caller that must never clip silently (MCP,
 * docs/prd-mcp.md §7) can say so. The UI keeps its capped behaviour.
 */
export async function getWorkspaceRefsForAuth(
  ctx: QueryCtx,
  auth: Pick<AuthContext, "orgId" | "userId">,
) {
  const { orgId, userId } = auth;
  const truncated: WorkspaceRefTable[] = [];
  // Read one past the cap to detect clipping, then drop the extra row.
  const capped = <T>(table: WorkspaceRefTable, rows: T[]): T[] => {
    if (rows.length <= REF_CAP) return rows;
    truncated.push(table);
    return rows.slice(0, REF_CAP);
  };

  const [statusDocs, labelDocs, projectDocs, clientDocs, memberships, categoryDocs, settings] =
    await Promise.all([
      ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("statuses", rows)),
      ctx.db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("labels", rows)),
      ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("projects", rows)),
      ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("clients", rows)),
      ctx.db.query("orgMembers").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("orgMembers", rows)),
      ctx.db.query("workCategories").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).take(REF_CAP + 1)
        .then((rows) => capped("workCategories", rows)),
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

  const refs = {
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
  return { refs, truncated };
}
