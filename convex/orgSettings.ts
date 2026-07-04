import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthContextOptional, requireAdmin, validateStringLength } from "./lib/auth";
import { currencyValidator, roundingValidator, statusTypeValidator, statusColorValidator, categoryColorValidator } from "./lib/validators";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const authCtx = await getAuthContextOptional(ctx);
    if (!authCtx) return null;

    const row = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", authCtx.orgId))
      .unique();
    if (!row) return null;

    // Phase 9 BYOK: strip every AI-key field before returning to the
    // client. The ciphertext is non-negotiable — leaking it lets a future
    // KEK compromise retroactively recover keys. The mask + audit fields
    // (mask, configured-at/by, removed-at/by) are technically safe to
    // expose, but `orgSettings.get` is called from 15+ member-visible
    // surfaces. The Integrations tab uses the dedicated, admin-gated
    // `api.aiIntegration.getStatus` query for everything it renders, so
    // there's no caller of `orgSettings.get` that needs these fields —
    // stripping them keeps the concerns properly isolated.
    const {
      aiAnthropicKeyCiphertext: _ct,
      aiAnthropicKeyMask: _mask,
      aiKeyConfiguredAt: _cfgAt,
      aiKeyConfiguredBy: _cfgBy,
      aiKeyRemovedAt: _rmAt,
      aiKeyRemovedBy: _rmBy,
      ...safe
    } = row;
    void _ct;
    void _mask;
    void _cfgAt;
    void _cfgBy;
    void _rmAt;
    void _rmBy;
    return safe;
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
        defaultBillRate: v.optional(v.number()),
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
      throw new ConvexError("Organization settings already exist");
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
        throw new ConvexError("Status name is required");
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

    // Insert work categories. Bill rates land in categoryRates only,
    // keyed by the org's default currency (the only currency available
    // during onboarding).
    for (let i = 0; i < args.workCategories.length; i++) {
      const c = args.workCategories[i];
      const trimmedName = c.name.trim();
      if (!trimmedName) {
        throw new ConvexError("Category name is required");
      }
      validateStringLength(trimmedName, 200, "Category name");
      const catId = await ctx.db.insert("workCategories", {
        orgId,
        name: trimmedName,
        color: c.color,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });

      if (c.defaultBillRate !== undefined && c.defaultBillRate >= 0) {
        await ctx.db.insert("categoryRates", {
          orgId,
          workCategoryId: catId,
          currency: args.defaultCurrency,
          defaultBillRate: c.defaultBillRate,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return settingsId;
  },
});

export const update = mutation({
  args: {
    defaultCurrency: v.optional(currencyValidator),
    timezone: v.optional(v.string()),
    roundingMinutes: v.optional(roundingValidator),
    completionDefaultAdminStatusId: v.optional(v.id("statuses")),
    completionDefaultMemberStatusId: v.optional(v.id("statuses")),
    brandName: v.optional(v.string()),
    brandAddress: v.optional(v.string()),
    brandTaxId: v.optional(v.string()),
    brandEmail: v.optional(v.string()),
    brandPhone: v.optional(v.string()),
    // Invoicing
    invoicePrefix: v.optional(v.string()),
    nextInvoiceNumber: v.optional(v.number()),
    defaultPaymentTermsDays: v.optional(v.number()),
    paymentInstructions: v.optional(v.string()),
    invoiceMessageTemplate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!settings) {
      throw new ConvexError("Organization settings not found");
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

    // Validate invoicing fields
    if (args.invoicePrefix !== undefined) {
      const normalizedPrefix = args.invoicePrefix.trim().toUpperCase();
      if (!normalizedPrefix) {
        throw new ConvexError("Invoice prefix cannot be empty");
      }
      validateStringLength(normalizedPrefix, 20, "Invoice prefix");
      args.invoicePrefix = normalizedPrefix;
    }
    if (args.nextInvoiceNumber !== undefined) {
      if (!Number.isInteger(args.nextInvoiceNumber) || args.nextInvoiceNumber < 1) {
        throw new ConvexError("Next invoice number must be a positive integer");
      }
      // Lock the counter once the sequence has started. Invoice numbers are
      // machine-generated and monotonic; editing them retroactively risks
      // duplicates (a legal/tax issue). The counter is only editable during
      // initial setup or migration — before the first invoice is created.
      const anyInvoice = await ctx.db
        .query("invoices")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .first();
      if (anyInvoice) {
        throw new ConvexError(
          "Invoice numbering is locked — the counter cannot be changed after the first invoice is created.",
        );
      }
    }
    if (args.defaultPaymentTermsDays !== undefined) {
      if (!Number.isInteger(args.defaultPaymentTermsDays) || args.defaultPaymentTermsDays < 1 || args.defaultPaymentTermsDays > 365) {
        throw new ConvexError("Payment terms must be between 1 and 365 days");
      }
    }
    if (args.paymentInstructions !== undefined) {
      validateStringLength(args.paymentInstructions, 5000, "Payment instructions");
    }
    if (args.invoiceMessageTemplate !== undefined) {
      validateStringLength(args.invoiceMessageTemplate, 5000, "Invoice message template");
    }

    // Validate completion default status references
    for (const field of ["completionDefaultAdminStatusId", "completionDefaultMemberStatusId"] as const) {
      const statusId = args[field];
      if (statusId !== undefined) {
        const status = await ctx.db.get(statusId);
        if (!status || status.orgId !== orgId) {
          throw new ConvexError("Completion default status not found");
        }
        if (status.archivedAt) {
          throw new ConvexError("Cannot set an archived status as completion default");
        }
        if (status.type !== "done" && status.type !== "review") {
          throw new ConvexError("Completion default must be a done or review status");
        }
      }
    }

    // Build typed patch object with only provided fields
    const patch: Partial<{
      defaultCurrency: typeof args.defaultCurrency;
      timezone: string;
      roundingMinutes: typeof args.roundingMinutes;
      completionDefaultAdminStatusId: typeof args.completionDefaultAdminStatusId;
      completionDefaultMemberStatusId: typeof args.completionDefaultMemberStatusId;
      brandName: string;
      brandAddress: string;
      brandTaxId: string;
      brandEmail: string;
      brandPhone: string;
      invoicePrefix: string;
      nextInvoiceNumber: number;
      defaultPaymentTermsDays: number;
      paymentInstructions: string | undefined;
      invoiceMessageTemplate: string | undefined;
      updatedAt: number;
    }> = { updatedAt: Date.now() };

    if (args.defaultCurrency !== undefined) patch.defaultCurrency = args.defaultCurrency;
    if (args.timezone !== undefined) patch.timezone = args.timezone;
    if (args.roundingMinutes !== undefined) patch.roundingMinutes = args.roundingMinutes;
    if (args.completionDefaultAdminStatusId !== undefined) patch.completionDefaultAdminStatusId = args.completionDefaultAdminStatusId;
    if (args.completionDefaultMemberStatusId !== undefined) patch.completionDefaultMemberStatusId = args.completionDefaultMemberStatusId;
    if (args.brandName !== undefined) patch.brandName = args.brandName;
    if (args.brandAddress !== undefined) patch.brandAddress = args.brandAddress;
    if (args.brandTaxId !== undefined) patch.brandTaxId = args.brandTaxId;
    if (args.brandEmail !== undefined) patch.brandEmail = args.brandEmail;
    if (args.brandPhone !== undefined) patch.brandPhone = args.brandPhone;
    if (args.invoicePrefix !== undefined) patch.invoicePrefix = args.invoicePrefix;
    if (args.nextInvoiceNumber !== undefined) patch.nextInvoiceNumber = args.nextInvoiceNumber;
    if (args.defaultPaymentTermsDays !== undefined) patch.defaultPaymentTermsDays = args.defaultPaymentTermsDays;
    // Empty string clears the field — `ctx.db.patch` deletes a key when given
    // `undefined`, so empty input persists as a missing field rather than "".
    if (args.paymentInstructions !== undefined) {
      patch.paymentInstructions = args.paymentInstructions === "" ? undefined : args.paymentInstructions;
    }
    if (args.invoiceMessageTemplate !== undefined) {
      patch.invoiceMessageTemplate = args.invoiceMessageTemplate === "" ? undefined : args.invoiceMessageTemplate;
    }

    await ctx.db.patch(settings._id, patch);
  },
});

export const updateDefaultMyTasksStatusIds = mutation({
  args: {
    statusIds: v.array(v.id("statuses")),
  },
  handler: async (ctx, { statusIds }) => {
    const { orgId } = await requireAdmin(ctx);

    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .unique();
    if (!settings) {
      throw new ConvexError("Organization settings not found");
    }

    // Validate all status IDs belong to this org and are active
    for (const statusId of statusIds) {
      const status = await ctx.db.get(statusId);
      if (!status || status.orgId !== orgId) {
        throw new ConvexError("Status not found");
      }
      if (status.archivedAt) {
        throw new ConvexError("Cannot set an archived status as default");
      }
    }

    await ctx.db.patch(settings._id, {
      defaultMyTasksStatusIds: statusIds,
      updatedAt: Date.now(),
    });
  },
});
