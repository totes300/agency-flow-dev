import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { statusTypeValidator, statusColorValidator } from "./lib/validators";
import { DEFAULT_STATUSES } from "./lib/constants";

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
      throw new Error("Name is required");
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
      throw new Error("Status not found");
    }

    // Build typed patch
    const patch: {
      name?: string;
      color?: string;
      icon?: string;
      type?: typeof args.type;
      sortOrder?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new Error("Name is required");
      }
      validateStringLength(trimmedName, 200, "Status name");
      patch.name = trimmedName;
    }
    if (args.color !== undefined) patch.color = args.color;
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.type !== undefined) patch.type = args.type;
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;

    await ctx.db.patch(args.id, patch);
  },
});

export const archive = mutation({
  args: { id: v.id("statuses") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const status = await ctx.db.get(args.id);
    if (!status || status.orgId !== orgId) {
      throw new Error("Status not found");
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
      throw new Error("Status not found");
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
      throw new Error("Status not found");
    }

    // TODO(Phase 5): Check for task references before allowing hard delete

    // Clear defaultStatusId in orgSettings if this status was default
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (settings?.defaultStatusId === args.id) {
      await ctx.db.patch(settings._id, {
        defaultStatusId: undefined,
        updatedAt: Date.now(),
      });
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
      throw new Error("Status not found");
    }
    if (status.archivedAt) {
      throw new Error("Cannot set an archived status as default");
    }

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!settings) {
      throw new Error("Organization settings not found");
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
        throw new Error("Status not found");
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
    // Check if statuses already exist for this org
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
        sortOrder: status.sortOrder,
        createdAt: now,
        updatedAt: now,
        createdBy: args.createdBy,
      });
    }
  },
});
