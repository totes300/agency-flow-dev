import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { statusTypeValidator, statusColorValidator } from "./lib/validators";
import { DEFAULT_STATUSES } from "./lib/constants";
import {
  categoryFromLegacyType,
  categoryOfStatus,
  type TaskCategory,
} from "./tasks/model";
import { syncLegacyStatusType } from "./tasks/write";

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = args.includeArchived
      ? statuses
      : statuses.filter((s) => !s.archivedAt);

    return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    color: statusColorValidator,
    icon: v.optional(v.string()),
    type: statusTypeValidator,
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new ConvexError("Name is required");
    }
    validateStringLength(trimmedName, 200, "Status name");

    // Get the highest sortOrder to append at the end
    const existing = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const maxSort = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1);

    const now = Date.now();
    return await ctx.db.insert("statuses", {
      orgId,
      name: trimmedName,
      color: args.color,
      icon: args.icon,
      type: args.type,
      category: categoryFromLegacyType(args.type),
      isDefault: false,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("statuses"),
    name: v.optional(v.string()),
    color: v.optional(statusColorValidator),
    icon: v.optional(v.string()),
    type: v.optional(statusTypeValidator),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new ConvexError("Status not found");
    }

    // Build typed patch
    const patch: {
      name?: string;
      color?: string;
      icon?: string;
      type?: typeof args.type;
      category?: TaskCategory;
      sortOrder?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new ConvexError("Name is required");
      }
      validateStringLength(trimmedName, 200, "Status name");
      patch.name = trimmedName;
    }
    if (args.color !== undefined) patch.color = args.color;
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;

    // A legacy type change. The category (D3) is what business logic reads:
    // it may only change while no task uses the status (§4.1); otherwise the
    // tasks' legacy `statusType` cache follows the new type (write path, T2).
    let syncTasks = false;
    if (args.type !== undefined && args.type !== status.type) {
      const currentCategory = categoryOfStatus(status);
      const nextCategory = categoryFromLegacyType(args.type);
      if (nextCategory !== currentCategory) {
        const used = await ctx.db
          .query("tasks")
          .withIndex("by_orgId_statusId", (q) => q.eq("orgId", orgId).eq("statusId", args.id))
          .first();
        if (used) {
          throw new ConvexError(
            "This status is used by tasks, so its category can't change. Move its tasks to another status first.",
          );
        }
        patch.category = nextCategory;
      } else {
        patch.category = currentCategory;
        syncTasks = true;
      }
      patch.type = args.type;
    }

    await ctx.db.patch(args.id, patch);
    if (syncTasks) await syncLegacyStatusType(ctx, (await ctx.db.get(args.id))!);
  },
});

export const archive = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new ConvexError("Status not found");
    }

    await ctx.db.patch(args.id, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const restore = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new ConvexError("Status not found");
    }

    await ctx.db.patch(args.id, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new ConvexError("Status not found");
    }

    // Check for task references before allowing hard delete (org-scoped)
    const taskWithStatus = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_statusId", (q) =>
        q.eq("orgId", orgId).eq("statusId", args.id)
      )
      .first();
    if (taskWithStatus) {
      throw new ConvexError("Cannot delete a status that is assigned to tasks. Archive it instead.");
    }

    // Clear any orgSettings references to this status
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (settings) {
      const settingsPatch: Record<string, unknown> = {};
      if (settings.defaultStatusId === args.id) settingsPatch.defaultStatusId = undefined;
      if (settings.completionDefaultAdminStatusId === args.id) settingsPatch.completionDefaultAdminStatusId = undefined;
      if (settings.completionDefaultMemberStatusId === args.id) settingsPatch.completionDefaultMemberStatusId = undefined;
      if (Object.keys(settingsPatch).length > 0) {
        await ctx.db.patch(settings._id, { ...settingsPatch, updatedAt: Date.now() });
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const setDefault = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new ConvexError("Status not found");
    }
    if (status.archivedAt) {
      throw new ConvexError("Cannot set an archived status as default");
    }

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!settings) {
      throw new ConvexError("Organization settings not found");
    }

    await ctx.db.patch(settings._id, {
      defaultStatusId: args.id,
      updatedAt: Date.now(),
    });
  },
});

export const reorder = mutation({
  args: {
    ids: v.array(v.id("statuses")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const now = Date.now();

    for (let i = 0; i < args.ids.length; i++) {
      const status = await ctx.db.get(args.ids[i]);
      if (!status || status.orgId !== orgId) {
        throw new ConvexError("Status not found");
      }
      await ctx.db.patch(args.ids[i], { sortOrder: i, updatedAt: now });
    }
  },
});

// ─── Internal: seed default statuses for a new org ───────────────────────────

/**
 * Seeds the default set of statuses for a newly created organization.
 * Called internally during org setup — not exposed as a public mutation.
 * No-ops if statuses already exist for the org.
 */
export const seed = internalMutation({
  args: {
    orgId: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("statuses")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
    if (existing) return;

    const now = Date.now();
    for (const status of DEFAULT_STATUSES) {
      await ctx.db.insert("statuses", {
        orgId: args.orgId,
        name: status.name,
        color: status.color,
        type: status.type,
        category: categoryOfStatus(status),
        sortOrder: status.sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy: args.createdBy,
      });
    }
  },
});
