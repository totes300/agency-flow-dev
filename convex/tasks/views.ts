import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext, type AuthContext } from "../lib/auth";
import {
  MAX_VIEWS_PER_SCOPE,
  SYSTEM_VIEWS,
  normalizeViewName,
  normalizeViewSpec,
  systemDefaultSpec,
  taskViewSpecValidator,
  taskViewSurfaceValidator,
  type ListViewSurface,
  type TaskViewSpec,
  type TaskViewSurface,
} from "./model";

/**
 * Saved task views and "Set default for everyone" (docs/prd-tasks-refactor.md
 * §4.4, U5, U6, §5.3).
 *
 * - A view is **personal** (`ownerId` = its creator, visible to them only) or
 *   **workspace** (`ownerId` absent, visible to the whole org, created and
 *   changed by admins only).
 * - Org and role come from the Clerk JWT (`getAuthContext`). Every id-based
 *   read checks the org and the owner before anything is returned or changed;
 *   another user's personal view reads as "not found", even for an admin.
 * - Tabs order: system views (code constants), then workspace views, then the
 *   caller's personal views; `position` orders views inside their scope.
 * - `viewDefaults` overrides a system view's display settings for the org.
 *   The system view's filters stay the code constant (they define the view).
 */

export type ViewScope = "personal" | "workspace";

export type SavedViewDTO = {
  _id: Id<"taskViews">;
  name: string;
  scope: ViewScope;
  position: string;
  spec: TaskViewSpec;
  /** The caller may rename, re-save, reorder and delete it. */
  canEdit: boolean;
};

type ReadCtx = QueryCtx | MutationCtx;

const scopeOf = (view: Doc<"taskViews">): ViewScope => (view.ownerId ? "personal" : "workspace");

function byPosition(a: Doc<"taskViews">, b: Doc<"taskViews">): number {
  if (a.position === b.position) return a._creationTime - b._creationTime;
  return a.position < b.position ? -1 : 1;
}

/** One scope's views on a surface, ordered by position. Bounded by the per-scope cap. */
async function loadScope(
  ctx: ReadCtx,
  orgId: string,
  surface: TaskViewSurface,
  ownerId: Id<"users"> | undefined,
): Promise<Doc<"taskViews">[]> {
  const rows = await ctx.db
    .query("taskViews")
    .withIndex("by_orgId_ownerId_surface", (q) =>
      q.eq("orgId", orgId).eq("ownerId", ownerId).eq("surface", surface),
    )
    .take(MAX_VIEWS_PER_SCOPE + 1);
  return rows.sort(byPosition);
}

function canEditView(view: Doc<"taskViews">, auth: AuthContext): boolean {
  return view.ownerId ? view.ownerId === auth.userId : auth.isAdmin;
}

/**
 * Loads a view the caller may change: same org, and their own personal view
 * or (admins) a workspace view. Anything else is "not found".
 */
async function loadViewForWrite(
  ctx: MutationCtx,
  auth: AuthContext,
  viewId: Id<"taskViews">,
): Promise<Doc<"taskViews">> {
  const view = await ctx.db.get(viewId);
  if (!view || view.orgId !== auth.orgId) throw new ConvexError("View not found");
  if (view.ownerId && view.ownerId !== auth.userId) throw new ConvexError("View not found");
  if (!view.ownerId && !auth.isAdmin) throw new ConvexError("Only admins can change workspace views");
  return view;
}

function validSpec(spec: TaskViewSpec): TaskViewSpec {
  const result = normalizeViewSpec(spec);
  if ("error" in result) throw new ConvexError(result.error);
  return result.spec;
}

function validName(name: string): string {
  const result = normalizeViewName(name);
  if ("error" in result) throw new ConvexError(result.error);
  return result.name;
}

function toDTO(view: Doc<"taskViews">, auth: AuthContext): SavedViewDTO {
  return {
    _id: view._id,
    name: view.name,
    scope: scopeOf(view),
    position: view.position,
    spec: view.spec,
    canEdit: canEditView(view, auth),
  };
}

function systemViewOf(surface: TaskViewSurface, key: string) {
  const view = Object.prototype.hasOwnProperty.call(SYSTEM_VIEWS[surface], key)
    ? SYSTEM_VIEWS[surface][key]
    : undefined;
  if (!view) throw new ConvexError(`Unknown view "${key}"`);
  return view;
}

/**
 * The effective spec of a system view for the org: its `viewDefaults` row
 * when an admin set one, else the code constant. The Planner has no
 * defaults. Filters always come from the code constant.
 */
export async function resolveSystemViewSpec(
  ctx: ReadCtx,
  orgId: string,
  surface: ListViewSurface,
  key: string,
): Promise<TaskViewSpec | null> {
  const system = Object.prototype.hasOwnProperty.call(SYSTEM_VIEWS[surface], key)
    ? SYSTEM_VIEWS[surface][key]
    : undefined;
  if (!system) return null;
  if (surface === "planner") return system.spec;
  const row = await ctx.db
    .query("viewDefaults")
    .withIndex("by_orgId_surface_systemViewKey", (q) =>
      q.eq("orgId", orgId).eq("surface", surface).eq("systemViewKey", key),
    )
    .first();
  return row ? systemDefaultSpec(system.spec, row.spec) : system.spec;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * The saved views of a surface the caller can see (workspace views, then
 * their own personal views) plus the org's system-view defaults.
 */
export const list = query({
  args: { surface: taskViewSurfaceValidator },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const workspace = await loadScope(ctx, auth.orgId, args.surface, undefined);
    const personal = await loadScope(ctx, auth.orgId, args.surface, auth.userId);

    const systemKeys = Object.keys(SYSTEM_VIEWS[args.surface]);
    const rows = await ctx.db
      .query("viewDefaults")
      .withIndex("by_orgId_surface_systemViewKey", (q) => q.eq("orgId", auth.orgId).eq("surface", args.surface))
      .take(systemKeys.length + 1);
    const rowByKey = new Map(rows.map((row) => [row.systemViewKey, row]));
    const defaults: Record<string, TaskViewSpec> = {};
    for (const key of systemKeys) {
      const system = SYSTEM_VIEWS[args.surface][key];
      const row = rowByKey.get(key);
      defaults[key] = row ? systemDefaultSpec(system.spec, row.spec) : system.spec;
    }

    return {
      views: [...workspace, ...personal].map((view) => toDTO(view, auth)),
      /** Effective spec of every system view (defaults applied). */
      defaults,
      /** System views whose display settings an admin changed for everyone. */
      customizedDefaults: systemKeys.filter((key) => rowByKey.has(key)),
      canManageWorkspace: auth.isAdmin,
    };
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Creates a view at the end of its scope. Workspace views are admin-only. */
export const create = mutation({
  args: {
    surface: taskViewSurfaceValidator,
    name: v.string(),
    scope: v.union(v.literal("personal"), v.literal("workspace")),
    spec: taskViewSpecValidator,
  },
  handler: async (ctx, args): Promise<Id<"taskViews">> => {
    const auth = await getAuthContext(ctx);
    if (args.scope === "workspace" && !auth.isAdmin) {
      throw new ConvexError("Only admins can create workspace views");
    }
    const name = validName(args.name);
    const spec = validSpec(args.spec);
    const ownerId = args.scope === "personal" ? auth.userId : undefined;
    const siblings = await loadScope(ctx, auth.orgId, args.surface, ownerId);
    if (siblings.length >= MAX_VIEWS_PER_SCOPE) {
      throw new ConvexError(`At most ${MAX_VIEWS_PER_SCOPE} views here`);
    }
    const last = siblings.at(-1)?.position ?? null;
    const now = Date.now();
    return await ctx.db.insert("taskViews", {
      orgId: auth.orgId,
      ownerId,
      surface: args.surface,
      name,
      position: generateKeyBetween(last, null),
      spec,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Renames a view and/or saves a new spec into it. */
export const update = mutation({
  args: {
    viewId: v.id("taskViews"),
    name: v.optional(v.string()),
    spec: v.optional(taskViewSpecValidator),
  },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    const view = await loadViewForWrite(ctx, auth, args.viewId);
    const patch: Partial<Doc<"taskViews">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = validName(args.name);
    if (args.spec !== undefined) patch.spec = validSpec(args.spec);
    await ctx.db.patch(view._id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { viewId: v.id("taskViews") },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    const view = await loadViewForWrite(ctx, auth, args.viewId);
    await ctx.db.delete(view._id);
    return null;
  },
});

/**
 * Moves a view inside its scope: right after `afterId` (same scope), or to
 * the front when `afterId` is null.
 */
export const reorder = mutation({
  args: {
    viewId: v.id("taskViews"),
    afterId: v.union(v.id("taskViews"), v.null()),
  },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    const view = await loadViewForWrite(ctx, auth, args.viewId);
    if (args.afterId === view._id) return null;
    const siblings = (await loadScope(ctx, auth.orgId, view.surface, view.ownerId)).filter(
      (s) => s._id !== view._id,
    );
    let index = 0;
    if (args.afterId !== null) {
      const at = siblings.findIndex((s) => s._id === args.afterId);
      if (at === -1) throw new ConvexError("Views can only be reordered within their own group");
      index = at + 1;
    }
    const before = siblings[index - 1]?.position ?? null;
    const after = siblings[index]?.position ?? null;
    // Equal neighbour keys (legacy/duplicate) cannot be split; place after both.
    const position = before !== null && after !== null && before >= after
      ? generateKeyBetween(before, null)
      : generateKeyBetween(before, after);
    await ctx.db.patch(view._id, { position, updatedAt: Date.now() });
    return null;
  },
});

/** "Set default for everyone" on a system view (admin). Display settings only. */
export const setDefault = mutation({
  args: {
    surface: taskViewSurfaceValidator,
    systemViewKey: v.string(),
    spec: taskViewSpecValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    if (!auth.isAdmin) throw new ConvexError("Only admins can set defaults for everyone");
    const system = systemViewOf(args.surface, args.systemViewKey);
    const spec = systemDefaultSpec(system.spec, validSpec(args.spec));
    const existing = await ctx.db
      .query("viewDefaults")
      .withIndex("by_orgId_surface_systemViewKey", (q) =>
        q.eq("orgId", auth.orgId).eq("surface", args.surface).eq("systemViewKey", args.systemViewKey),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { spec });
    else {
      await ctx.db.insert("viewDefaults", {
        orgId: auth.orgId,
        surface: args.surface,
        systemViewKey: args.systemViewKey,
        spec,
      });
    }
    return null;
  },
});

/** Restores a system view's built-in display settings for the org (admin). */
export const resetDefault = mutation({
  args: { surface: taskViewSurfaceValidator, systemViewKey: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    if (!auth.isAdmin) throw new ConvexError("Only admins can reset defaults for everyone");
    systemViewOf(args.surface, args.systemViewKey);
    const existing = await ctx.db
      .query("viewDefaults")
      .withIndex("by_orgId_surface_systemViewKey", (q) =>
        q.eq("orgId", auth.orgId).eq("surface", args.surface).eq("systemViewKey", args.systemViewKey),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
