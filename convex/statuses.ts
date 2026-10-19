import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, validateStringLength } from "./lib/auth";
import { statusColorValidator } from "./lib/validators";
import {
  DEFAULT_STATUS_SEED,
  TASK_CATEGORIES,
  categoryOfStatus,
  statusIconFor,
  taskCategoryValidator,
  workflowRoleValidator,
  WORKFLOW_ROLE_LABELS,
  WORKFLOW_ROLES,
  type StatusIcon,
  type TaskCategory,
  type WorkflowRole,
} from "./tasks/model";

/**
 * Status settings (docs/prd-tasks-refactor.md §4.1, D3, §5.3): admin-only,
 * Linear's model. Statuses are org-defined inside the five fixed categories;
 * business logic reads the category only (T3).
 *
 * Invariants kept here:
 * - every category keeps at least one non-archived status;
 * - exactly one default per category, never archived;
 * - a status's category is immutable once a task uses it (§4.1) — moving
 *   tasks between categories is a task write, not a settings change;
 * - order inside a category is a fractional `position` key;
 * - at most one active status per `workflowRole` per org; archiving a
 *   status clears its role (email-triage PRD §4.2 / §11 O7).
 *
 * No task row is written here: task status changes go through
 * `tasks/write.ts` (T2), which also refuses archived statuses.
 */

const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 200;
/** Statuses per category; orgs have a handful. */
const CATEGORY_CAP = 50;

type StatusCtx = QueryCtx | MutationCtx;

async function loadCategory(ctx: StatusCtx, orgId: string, category: TaskCategory): Promise<Doc<"statuses">[]> {
  return await ctx.db
    .query("statuses")
    .withIndex("by_orgId_category_position", (q) => q.eq("orgId", orgId).eq("category", category))
    .take(CATEGORY_CAP);
}

async function loadOwnStatus(ctx: StatusCtx, orgId: string, id: Id<"statuses">): Promise<Doc<"statuses">> {
  const status = await ctx.db.get(id);
  if (!status || status.orgId !== orgId) throw new ConvexError("Status not found");
  return status;
}

async function statusInUse(ctx: StatusCtx, orgId: string, id: Id<"statuses">): Promise<boolean> {
  const task = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_statusId", (q) => q.eq("orgId", orgId).eq("statusId", id))
    .first();
  return task !== null;
}

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ConvexError("Name is required");
  validateStringLength(name, NAME_MAX_LENGTH, "Status name");
  return name;
}

function normalizeDescription(raw: string | null | undefined): string | undefined {
  const description = raw?.trim();
  if (!description) return undefined;
  validateStringLength(description, DESCRIPTION_MAX_LENGTH, "Description");
  return description;
}

function assertUniqueName(siblings: readonly Doc<"statuses">[], name: string, self?: Id<"statuses">): void {
  if (siblings.some((s) => s._id !== self && s.name.toLowerCase() === name.toLowerCase())) {
    throw new ConvexError(`A status named "${name}" already exists`);
  }
}

/** Every status of the org, for the duplicate-name check (names are unique org-wide). */
async function loadAll(ctx: StatusCtx, orgId: string): Promise<Doc<"statuses">[]> {
  const all: Doc<"statuses">[] = [];
  for (const category of TASK_CATEGORIES) all.push(...(await loadCategory(ctx, orgId, category)));
  return all;
}

/** At most one ACTIVE status per workflow role per org (PRD §4.2). */
function assertRoleFree(all: readonly Doc<"statuses">[], role: WorkflowRole, self?: Id<"statuses">): void {
  const holder = all.find((s) => s._id !== self && !s.archivedAt && s.workflowRole === role);
  if (holder) {
    throw new ConvexError(
      `"${holder.name}" already has the ${WORKFLOW_ROLE_LABELS[role]} role. Clear it there first.`,
    );
  }
}

function positionAfterLast(statuses: readonly Doc<"statuses">[]): string {
  let last: string | null = null;
  for (const s of statuses) if (s.position !== undefined && (last === null || s.position > last)) last = s.position;
  return generateKeyBetween(last, null);
}

// ─── Query ───────────────────────────────────────────────────────────────────

export type StatusSettingsRow = {
  _id: Id<"statuses">;
  name: string;
  description: string | null;
  color: string;
  category: TaskCategory;
  position: string;
  isDefault: boolean;
  archived: boolean;
  icon: StatusIcon;
  workflowRole: WorkflowRole | null;
  /** A task uses the status: its category is locked and it can't be deleted. */
  inUse: boolean;
};

/**
 * The settings list: every status (archived included) in category order,
 * then position, with whether a task uses it. Admin-only; task surfaces read
 * statuses from `workspaceRefs.get`.
 */
export const listForSettings = query({
  args: {},
  handler: async (ctx): Promise<StatusSettingsRow[]> => {
    const { orgId } = await requireAdmin(ctx);
    const rows: StatusSettingsRow[] = [];
    for (const category of TASK_CATEGORIES) {
      const inCategory = await loadCategory(ctx, orgId, category);
      const active = inCategory.filter((s) => !s.archivedAt);
      for (const s of inCategory) {
        const index = active.indexOf(s);
        rows.push({
          _id: s._id,
          name: s.name,
          description: s.description ?? null,
          color: s.color,
          category,
          position: s.position ?? "",
          isDefault: s.isDefault === true,
          archived: s.archivedAt !== undefined,
          icon: statusIconFor(category, index === -1 ? active.length - 1 : index, active.length),
          workflowRole: s.workflowRole ?? null,
          inUse: await statusInUse(ctx, orgId, s._id),
        });
      }
    }
    return rows;
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    category: taskCategoryValidator,
    name: v.string(),
    color: statusColorValidator,
    description: v.optional(v.string()),
    workflowRole: v.optional(workflowRoleValidator),
  },
  handler: async (ctx, args): Promise<Id<"statuses">> => {
    const { orgId, userId } = await requireAdmin(ctx);
    const name = normalizeName(args.name);
    const all = await loadAll(ctx, orgId);
    assertUniqueName(all, name);
    if (args.workflowRole) assertRoleFree(all, args.workflowRole);
    const inCategory = await loadCategory(ctx, orgId, args.category);
    if (inCategory.length >= CATEGORY_CAP) throw new ConvexError(`At most ${CATEGORY_CAP} statuses per category`);
    const now = Date.now();
    return await ctx.db.insert("statuses", {
      orgId,
      name,
      description: normalizeDescription(args.description),
      color: args.color,
      category: args.category,
      position: positionAfterLast(inCategory),
      workflowRole: args.workflowRole,
      // The first status of an empty category becomes its default.
      isDefault: !inCategory.some((s) => !s.archivedAt && s.isDefault === true),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

/**
 * Rename / recolor / describe, set or clear (null) its workflow role, and —
 * only while no task uses the status — change its category (it then lands at
 * the end of the new category). A category's default and its last active
 * status cannot leave it.
 */
export const update = mutation({
  args: {
    id: v.id("statuses"),
    name: v.optional(v.string()),
    color: v.optional(statusColorValidator),
    description: v.optional(v.union(v.string(), v.null())),
    category: v.optional(taskCategoryValidator),
    workflowRole: v.optional(v.union(workflowRoleValidator, v.null())),
  },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    const patch: Partial<Doc<"statuses">> = {};

    if (args.workflowRole !== undefined && (args.workflowRole ?? undefined) !== status.workflowRole) {
      if (args.workflowRole !== null) assertRoleFree(await loadAll(ctx, orgId), args.workflowRole, status._id);
      patch.workflowRole = args.workflowRole ?? undefined;
    }

    if (args.name !== undefined) {
      const name = normalizeName(args.name);
      if (name !== status.name) {
        assertUniqueName(await loadAll(ctx, orgId), name, status._id);
        patch.name = name;
      }
    }
    if (args.color !== undefined && args.color !== status.color) patch.color = args.color;
    if (args.description !== undefined) {
      const description = normalizeDescription(args.description);
      if (description !== status.description) patch.description = description;
    }
    if (args.category !== undefined && args.category !== categoryOfStatus(status)) {
      if (await statusInUse(ctx, orgId, status._id)) {
        throw new ConvexError(
          "Tasks use this status, so its category can't change. Move those tasks to another status first.",
        );
      }
      if (status.isDefault) {
        throw new ConvexError("Make another status the default for this category first");
      }
      const target = await loadCategory(ctx, orgId, args.category);
      if (target.length >= CATEGORY_CAP) throw new ConvexError(`At most ${CATEGORY_CAP} statuses per category`);
      patch.category = args.category;
      patch.position = positionAfterLast(target);
      if (!status.archivedAt && !target.some((s) => !s.archivedAt && s.isDefault === true)) patch.isDefault = true;
    }

    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(status._id, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

/** Moves a status inside its category: right after `afterId`, or first when null. */
export const move = mutation({
  args: { id: v.id("statuses"), afterId: v.union(v.id("statuses"), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    const siblings = (await loadCategory(ctx, orgId, categoryOfStatus(status))).filter((s) => s._id !== status._id);
    let before: string | null = null;
    let after: string | null = siblings[0]?.position ?? null;
    if (args.afterId !== null) {
      const index = siblings.findIndex((s) => s._id === args.afterId);
      if (index === -1) throw new ConvexError("Statuses can only be reordered inside their category");
      before = siblings[index].position ?? null;
      after = siblings[index + 1]?.position ?? null;
    }
    const position = generateKeyBetween(before, after);
    await ctx.db.patch(status._id, { position, updatedAt: Date.now() });
    return null;
  },
});

/** Makes the status its category's default (new tasks in that category land here). */
export const setDefault = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    if (status.archivedAt) throw new ConvexError("An archived status can't be the default");
    const now = Date.now();
    for (const s of await loadCategory(ctx, orgId, categoryOfStatus(status))) {
      const isDefault = s._id === status._id;
      if (s.isDefault !== isDefault) await ctx.db.patch(s._id, { isDefault, updatedAt: now });
    }
    return null;
  },
});

/**
 * Hides a status from pickers. Tasks keep it (it renders as archived) until
 * moved; the category's default and its last active status stay.
 */
export const archive = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    if (status.archivedAt) return null;
    if (status.isDefault) throw new ConvexError("Make another status the default for this category first");
    const active = (await loadCategory(ctx, orgId, categoryOfStatus(status))).filter((s) => !s.archivedAt);
    if (active.length <= 1) throw new ConvexError("Every category needs at least one active status");
    // An archived status can't be entered, so it can't hold a workflow role.
    await ctx.db.patch(status._id, { archivedAt: Date.now(), workflowRole: undefined, updatedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    if (!status.archivedAt) return null;
    // A role kept from before archiving cleared roles must not duplicate an active holder.
    const role = status.workflowRole;
    const roleTaken =
      role !== undefined &&
      (await loadAll(ctx, orgId)).some((s) => s._id !== status._id && !s.archivedAt && s.workflowRole === role);
    await ctx.db.patch(status._id, {
      archivedAt: undefined,
      ...(roleTaken ? { workflowRole: undefined } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Deletes a status no task uses (otherwise archive it). Same guards as archive. */
export const remove = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const status = await loadOwnStatus(ctx, orgId, args.id);
    if (await statusInUse(ctx, orgId, status._id)) {
      throw new ConvexError("Tasks use this status. Archive it instead, or move its tasks first.");
    }
    if (status.isDefault) throw new ConvexError("Make another status the default for this category first");
    if (!status.archivedAt) {
      const active = (await loadCategory(ctx, orgId, categoryOfStatus(status))).filter((s) => !s.archivedAt);
      if (active.length <= 1) throw new ConvexError("Every category needs at least one active status");
    }
    await ctx.db.delete(status._id);
    return null;
  },
});

// ─── New orgs ────────────────────────────────────────────────────────────────

/**
 * Inserts an org's starting statuses (onboarding). `drafts` default to the
 * §4.1 seed; every category must get at least one, and the first status of
 * each category becomes its default. No-op when the org has statuses.
 */
export async function seedOrgStatuses(
  ctx: MutationCtx,
  input: {
    orgId: string;
    createdBy: Id<"users">;
    drafts?: ReadonlyArray<{ name: string; color: string; category: TaskCategory; workflowRole?: WorkflowRole }>;
  },
): Promise<number> {
  const existing = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", input.orgId))
    .first();
  if (existing) return 0;
  const drafts = input.drafts ?? DEFAULT_STATUS_SEED;
  for (const category of TASK_CATEGORIES) {
    if (!drafts.some((d) => d.category === category)) {
      throw new ConvexError(`Add at least one ${category} status`);
    }
  }
  const names = new Set<string>();
  const roles = new Set<WorkflowRole>();
  const last = new Map<TaskCategory, string>();
  const now = Date.now();
  for (const draft of drafts) {
    const name = normalizeName(draft.name);
    if (names.has(name.toLowerCase())) throw new ConvexError(`A status named "${name}" already exists`);
    names.add(name.toLowerCase());
    if (draft.workflowRole) {
      if (roles.has(draft.workflowRole)) {
        throw new ConvexError(`Only one status can have the ${WORKFLOW_ROLE_LABELS[draft.workflowRole]} role`);
      }
      roles.add(draft.workflowRole);
    }
    const position = generateKeyBetween(last.get(draft.category) ?? null, null);
    await ctx.db.insert("statuses", {
      orgId: input.orgId,
      name,
      color: draft.color,
      category: draft.category,
      position,
      isDefault: !last.has(draft.category),
      workflowRole: draft.workflowRole,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    });
    last.set(draft.category, position);
  }
  return drafts.length;
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

/**
 * One-off backfill (email-triage PRD §11 O7, MVP dummy data): gives existing
 * orgs the seeded workflow roles by matching the seed's status NAMES once —
 * the only place a status name decides anything. Only active statuses take
 * or hold a role. Idempotent: a role an org already holds is never moved,
 * and a name that matches nothing is skipped.
 *
 * Run:  npx convex run statuses:backfillWorkflowRoles '{}'
 */
export const backfillWorkflowRoles = internalMutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ orgs: number; assigned: number }> => {
    const byOrg = new Map<string, Doc<"statuses">[]>();
    const rows = args.orgId
      ? ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", args.orgId!))
      : ctx.db.query("statuses");
    for await (const status of rows) {
      const list = byOrg.get(status.orgId) ?? [];
      list.push(status);
      byOrg.set(status.orgId, list);
    }
    let assigned = 0;
    const now = Date.now();
    for (const statuses of byOrg.values()) {
      for (const role of WORKFLOW_ROLES) {
        const active = statuses.filter((s) => !s.archivedAt);
        if (active.some((s) => s.workflowRole === role)) continue;
        const seedName = DEFAULT_STATUS_SEED.find((d) => d.workflowRole === role)?.name.toLowerCase();
        const match = active.find((s) => !s.workflowRole && s.name.toLowerCase() === seedName);
        if (!match) continue;
        await ctx.db.patch(match._id, { workflowRole: role, updatedAt: now });
        match.workflowRole = role;
        assigned++;
      }
    }
    return { orgs: byOrg.size, assigned };
  },
});
