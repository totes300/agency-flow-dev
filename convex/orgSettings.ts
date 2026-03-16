import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContextOptional, requireAdmin, validateStringLength } from "./lib/auth";
import { currencyValidator, roundingValidator, statusTypeValidator, statusColorValidator, categoryColorValidator } from "./lib/validators";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const authCtx = await getAuthContextOptional(ctx);
    if (!authCtx) return null;

    return await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", authCtx.orgId))
      .unique();
  },
});

export const create = mutation({
  args: {
    defaultCurrency: currencyValidator,
    timezone: v.string(),
    roundingMinutes: roundingValidator,
    statuses: v.array(
      v.object({
        name: v.string(),
        color: statusColorValidator,
        type: statusTypeValidator,
      })
    ),
    workCategories: v.array(
      v.object({
        name: v.string(),
        color: categoryColorValidator,
        defaultCostRate: v.optional(v.number()),
        defaultBillRate: v.optional(v.number()),
        currency: currencyValidator,
      })
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    // Validate timezone
    validateStringLength(args.timezone, 100, "Timezone");

    // Prevent duplicate creation
    const existing = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (existing) {
      throw new Error("Organization settings already exist");
    }

    const now = Date.now();
    const settingsId = await ctx.db.insert("orgSettings", {
      orgId,
      defaultCurrency: args.defaultCurrency,
      timezone: args.timezone,
      roundingMinutes: args.roundingMinutes,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    // Insert statuses
    for (let i = 0; i < args.statuses.length; i++) {
      const s = args.statuses[i];
      const trimmedName = s.name.trim();
      if (!trimmedName) {
        throw new Error("Status name is required");
      }
      validateStringLength(trimmedName, 200, "Status name");
      await ctx.db.insert("statuses", {
        orgId,
        name: trimmedName,
        color: s.color,
        type: s.type,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
    }

    // Insert work categories
    for (let i = 0; i < args.workCategories.length; i++) {
      const c = args.workCategories[i];
      const trimmedName = c.name.trim();
      if (!trimmedName) {
        throw new Error("Category name is required");
      }
      validateStringLength(trimmedName, 200, "Category name");
      await ctx.db.insert("workCategories", {
        orgId,
        name: trimmedName,
        color: c.color,
        defaultCostRate: c.defaultCostRate,
        defaultBillRate: c.defaultBillRate,
        currency: c.currency,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
    }

    return settingsId;
  },
});

export const update = mutation({
  args: {
    defaultCurrency: v.optional(currencyValidator),
    timezone: v.optional(v.string()),
    roundingMinutes: v.optional(roundingValidator),
    brandName: v.optional(v.string()),
    brandAddress: v.optional(v.string()),
    brandTaxId: v.optional(v.string()),
    brandEmail: v.optional(v.string()),
    brandPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!settings) {
      throw new Error("Organization settings not found");
    }

    // Validate string lengths
    if (args.timezone !== undefined) {
      validateStringLength(args.timezone, 100, "Timezone");
    }
    if (args.brandName !== undefined) {
      validateStringLength(args.brandName, 500, "Brand name");
    }
    if (args.brandAddress !== undefined) {
      validateStringLength(args.brandAddress, 500, "Brand address");
    }
    if (args.brandTaxId !== undefined) {
      validateStringLength(args.brandTaxId, 500, "Brand tax ID");
    }
    if (args.brandEmail !== undefined) {
      validateStringLength(args.brandEmail, 500, "Brand email");
    }
    if (args.brandPhone !== undefined) {
      validateStringLength(args.brandPhone, 500, "Brand phone");
    }

    // Build typed patch object with only provided fields
    const patch: Partial<{
      defaultCurrency: typeof args.defaultCurrency;
      timezone: string;
      roundingMinutes: typeof args.roundingMinutes;
      brandName: string;
      brandAddress: string;
      brandTaxId: string;
      brandEmail: string;
      brandPhone: string;
      updatedAt: number;
    }> = { updatedAt: Date.now() };

    if (args.defaultCurrency !== undefined) patch.defaultCurrency = args.defaultCurrency;
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.roundingMinutes !== undefined) patch.roundingMinutes = args.roundingMinutes;
    if (args.brandName !== undefined) patch.brandName = args.brandName;
    if (args.brandAddress !== undefined) patch.brandAddress = args.brandAddress;
    if (args.brandTaxId !== undefined) patch.brandTaxId = args.brandTaxId;
    if (args.brandEmail !== undefined) patch.brandEmail = args.brandEmail;
    if (args.brandPhone !== undefined) patch.brandPhone = args.brandPhone;

    await ctx.db.patch(settings._id, patch);
  },
});
