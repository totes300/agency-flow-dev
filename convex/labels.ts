import { v, ConvexError } from "convex/values";
import { generateKeyBetween } from "fractional-indexing";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, validateStringLength } from "./lib/auth";
import { statusColorValidator } from "./lib/validators";
import { loadTaskForWrite } from "./tasks/access";
import { updateTask } from "./tasks/write";

/**
 * Label settings (docs/prd-tasks-refactor.md §4.2, D8, §5.3): org-level,
 * multi-value, non-billing. Admin-only CRUD, reorder and archive. Labels use
 * the status colour palette. Tasks reach labels only through
 * `tasks/write.ts` (T2/T6): an archived label stays on the tasks that have
 * it but can't be added; deleting a label removes it from its tasks through
 * the write path (bounded).
 */

const NAME_MAX_LENGTH = 40;
/** Labels per org — settings render them all. */
const LABEL_CAP = 500;
/** Usage shown in settings is counted up to this many tasks ("99+"). */
const USAGE_CAP = 99;
/** A delete detaches the label from at most this many tasks in one transaction. */
const DELETE_DETACH_CAP = 200;

type LabelCtx = QueryCtx | MutationCtx;

async function loadLabels(ctx: LabelCtx, orgId: string): Promise<Doc<"labels">[]> {
  return await ctx.db
    .query("labels")
    .withIndex("by_orgId_position", (q) => q.eq("orgId", orgId))
    .take(LABEL_CAP);
}

async function loadOwnLabel(ctx: LabelCtx, orgId: string, id: Id<"labels">): Promise<Doc<"labels">> {
  const label = await ctx.db.get(id);
  if (!label || label.orgId !== orgId) throw new ConvexError("Label not found");
  return label;
}

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ConvexError("Name is required");
  validateStringLength(name, NAME_MAX_LENGTH, "Label name");
  return name;
}

function assertUniqueName(labels: readonly Doc<"labels">[], name: string, self?: Id<"labels">): void {
  if (labels.some((l) => l._id !== self && l.name.toLowerCase() === name.toLowerCase())) {
    throw new ConvexError(`A label named "${name}" already exists`);
  }
}

export type LabelSettingsRow = {
  _id: Id<"labels">;
  name: string;
  color: string;
  position: string;
  archived: boolean;
  /** Tasks carrying the label, counted up to `usageCapped`. */
  usage: number;
  usageCapped: boolean;
};

/** The settings list: every label (archived included) in position order, with usage. Admin-only. */
export const listForSettings = query({
  args: {},
  handler: async (ctx): Promise<LabelSettingsRow[]> => {
    const { orgId } = await requireAdmin(ctx);
    const labels = await loadLabels(ctx, orgId);
    const rows: LabelSettingsRow[] = [];
    for (const label of labels) {
      const edges = await ctx.db
        .query("taskLabels")
        .withIndex("by_orgId_labelId", (q) => q.eq("orgId", orgId).eq("labelId", label._id))
        .take(USAGE_CAP + 1);
      rows.push({
        _id: label._id,
        name: label.name,
        color: label.color,
        position: label.position,
        archived: label.archivedAt !== undefined,
        usage: Math.min(edges.length, USAGE_CAP),
        usageCapped: edges.length > USAGE_CAP,
      });
    }
    return rows;
  },
});

export const create = mutation({
  args: { name: v.string(), color: statusColorValidator },
  handler: async (ctx, args): Promise<Id<"labels">> => {
    const { orgId } = await requireAdmin(ctx);
    const name = normalizeName(args.name);
    const labels = await loadLabels(ctx, orgId);
    assertUniqueName(labels, name);
    if (labels.length >= LABEL_CAP) throw new ConvexError(`At most ${LABEL_CAP} labels`);
    const last = labels.reduce<string | null>((max, l) => (max === null || l.position > max ? l.position : max), null);
    return await ctx.db.insert("labels", {
      orgId,
      name,
      color: args.color,
      position: generateKeyBetween(last, null),
    });
  },
});

export const update = mutation({
  args: { id: v.id("labels"), name: v.optional(v.string()), color: v.optional(statusColorValidator) },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const label = await loadOwnLabel(ctx, orgId, args.id);
    const patch: Partial<Doc<"labels">> = {};
    if (args.name !== undefined) {
      const name = normalizeName(args.name);
      if (name !== label.name) {
        assertUniqueName(await loadLabels(ctx, orgId), name, label._id);
        patch.name = name;
      }
    }
    if (args.color !== undefined && args.color !== label.color) patch.color = args.color;
    if (Object.keys(patch).length > 0) await ctx.db.patch(label._id, patch);
    return null;
  },
});

/** Moves a label right after `afterId`, or first when null. */
export const move = mutation({
  args: { id: v.id("labels"), afterId: v.union(v.id("labels"), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const label = await loadOwnLabel(ctx, orgId, args.id);
    const others = (await loadLabels(ctx, orgId)).filter((l) => l._id !== label._id);
    let before: string | null = null;
    let after: string | null = others[0]?.position ?? null;
    if (args.afterId !== null) {
      const index = others.findIndex((l) => l._id === args.afterId);
      if (index === -1) throw new ConvexError("Label not found");
      before = others[index].position;
      after = others[index + 1]?.position ?? null;
    }
    await ctx.db.patch(label._id, { position: generateKeyBetween(before, after) });
    return null;
  },
});

/** Hides a label from pickers; tasks that have it keep it. */
export const archive = mutation({
  args: { id: v.id("labels") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const label = await loadOwnLabel(ctx, orgId, args.id);
    if (!label.archivedAt) await ctx.db.patch(label._id, { archivedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id("labels") },
  handler: async (ctx, args): Promise<null> => {
    const { orgId } = await requireAdmin(ctx);
    const label = await loadOwnLabel(ctx, orgId, args.id);
    if (label.archivedAt) await ctx.db.patch(label._id, { archivedAt: undefined });
    return null;
  },
});

/**
 * Deletes a label and removes it from every task that has it, through the
 * task write path (activity "label removed", caches and edges in step, T6).
 * A label on more tasks than one transaction can detach must be archived.
 */
export const remove = mutation({
  args: { id: v.id("labels") },
  handler: async (ctx, args): Promise<{ detached: number }> => {
    const auth = await requireAdmin(ctx);
    const label = await loadOwnLabel(ctx, auth.orgId, args.id);
    const edges = await ctx.db
      .query("taskLabels")
      .withIndex("by_orgId_labelId", (q) => q.eq("orgId", auth.orgId).eq("labelId", label._id))
      .take(DELETE_DETACH_CAP + 1);
    if (edges.length > DELETE_DETACH_CAP) {
      throw new ConvexError(`This label is on more than ${DELETE_DETACH_CAP} tasks. Archive it instead.`);
    }
    const taskIds = [...new Set(edges.map((e) => e.taskId))];
    for (const taskId of taskIds) {
      const access = await loadTaskForWrite(ctx, taskId, auth);
      const next = (access.task.labelIds ?? []).filter((id) => id !== label._id);
      await updateTask(ctx, access, { labelIds: next });
    }
    await ctx.db.delete(label._id);
    return { detached: taskIds.length };
  },
});
