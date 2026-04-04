import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { generateInvoicePrefix, ensureUniquePrefix } from "./lib/helpers";
import { currencyValidator } from "./lib/validators";

// ─── Queries ────────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    if (args.includeArchived) return clients;
    return clients.filter((c) => !c.archivedAt);
  },
});

export const listWithContacts = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const filtered = args.includeArchived
      ? clients
      : clients.filter((c) => !c.archivedAt);

    // Batch query: all org projects for activeProjectCount (avoids N+1)
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const projectCountMap = new Map<string, number>();
    for (const p of allProjects) {
      if (!p.archivedAt) {
        const key = p.clientId.toString();
        projectCountMap.set(key, (projectCountMap.get(key) ?? 0) + 1);
      }
    }

    // Enrich each client with primary contact
    const enriched = await Promise.all(
      filtered.map(async (client) => {
        const contacts = await ctx.db
          .query("clientContacts")
          .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
          .collect();

        const primary = contacts.find((c) => c.isPrimary) ?? null;

        // Resolve logo URL from storage
        let logoUrl: string | null = null;
        if (client.logoStorageId) {
          logoUrl = await ctx.storage.getUrl(client.logoStorageId);
        }

        return {
          ...client,
          logoUrl,
          primaryContact: primary
            ? { name: primary.name, email: primary.email }
            : null,
          activeProjectCount: projectCountMap.get(client._id.toString()) ?? 0,
        };
      })
    );

    return enriched;
  },
});

export const get = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) {
      return null;
    }

    // Resolve logo URL from storage
    let logoUrl: string | null = null;
    if (client.logoStorageId) {
      logoUrl = await ctx.storage.getUrl(client.logoStorageId);
    }

    return { ...client, logoUrl };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    currency: v.optional(currencyValidator),
    invoicePrefix: v.optional(v.string()),
    billingName: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingCountry: v.optional(v.string()),
    billingCity: v.optional(v.string()),
    billingZip: v.optional(v.string()),
    billingStreet: v.optional(v.string()),
    billingStreet2: v.optional(v.string()),
    taxId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const name = args.name.trim();
    if (!name) throw new ConvexError("Client name is required");
    validateStringLength(name, 200, "Client name");

    // Unique name per org
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_orgId_name", (q) => q.eq("orgId", orgId).eq("name", name))
      .first();
    if (existing) throw new ConvexError("A client with this name already exists");

    // Currency: default to org's (orgSettings.defaultCurrency is validated at save time)
    let currency: string = args.currency ?? "";
    if (!currency) {
      const orgSettings = await ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .unique();
      currency = orgSettings?.defaultCurrency ?? "USD";
    }

    // Invoice prefix: auto-generate or use provided, then dedup
    const rawPrefix = args.invoicePrefix?.trim() || generateInvoicePrefix(name);
    const invoicePrefix = await ensureUniquePrefix(ctx, orgId, rawPrefix);

    const now = Date.now();
    return await ctx.db.insert("clients", {
      orgId,
      name,
      currency,
      invoicePrefix,
      billingName: args.billingName?.trim() || undefined,
      billingEmail: args.billingEmail?.trim() || undefined,
      billingCountry: args.billingCountry?.trim() || undefined,
      billingCity: args.billingCity?.trim() || undefined,
      billingZip: args.billingZip?.trim() || undefined,
      billingStreet: args.billingStreet?.trim() || undefined,
      billingStreet2: args.billingStreet2?.trim() || undefined,
      taxId: args.taxId?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("clients"),
    name: v.optional(v.string()),
    currency: v.optional(currencyValidator),
    invoicePrefix: v.optional(v.string()),
    billingName: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingCountry: v.optional(v.string()),
    billingCity: v.optional(v.string()),
    billingZip: v.optional(v.string()),
    billingStreet: v.optional(v.string()),
    billingStreet2: v.optional(v.string()),
    taxId: v.optional(v.string()),
    notes: v.optional(v.string()),
    logoStorageId: v.optional(v.union(v.id("_storage"), v.null())),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError("Client name is required");
      validateStringLength(name, 200, "Client name");

      if (name !== client.name) {
        const existing = await ctx.db
          .query("clients")
          .withIndex("by_orgId_name", (q) => q.eq("orgId", orgId).eq("name", name))
          .first();
        if (existing && existing._id !== args.id) {
          throw new ConvexError("A client with this name already exists");
        }
      }
      updates.name = name;
    }

    if (args.currency !== undefined) updates.currency = args.currency;

    if (args.invoicePrefix !== undefined) {
      const prefix = args.invoicePrefix.trim();
      if (prefix) {
        updates.invoicePrefix = await ensureUniquePrefix(
          ctx, orgId, prefix, args.id.toString(),
        );
      }
    }

    // Billing fields — empty string → undefined (clear field)
    const trimOrClear = (val: string | undefined) =>
      val !== undefined ? (val.trim() || undefined) : undefined;

    if (args.billingName !== undefined) updates.billingName = trimOrClear(args.billingName);
    if (args.billingEmail !== undefined) updates.billingEmail = trimOrClear(args.billingEmail);
    if (args.billingCountry !== undefined) updates.billingCountry = trimOrClear(args.billingCountry);
    if (args.billingCity !== undefined) updates.billingCity = trimOrClear(args.billingCity);
    if (args.billingZip !== undefined) updates.billingZip = trimOrClear(args.billingZip);
    if (args.billingStreet !== undefined) updates.billingStreet = trimOrClear(args.billingStreet);
    if (args.billingStreet2 !== undefined) updates.billingStreet2 = trimOrClear(args.billingStreet2);
    if (args.taxId !== undefined) updates.taxId = trimOrClear(args.taxId);
    if (args.notes !== undefined) updates.notes = trimOrClear(args.notes);
    if (args.logoStorageId !== undefined) {
      updates.logoStorageId = args.logoStorageId === null ? undefined : args.logoStorageId;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const archive = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

    await ctx.db.patch(args.id, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // TODO Phase 3/5: cascade archive to projects → tasks, stop running timers
  },
});

export const restore = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

    await ctx.db.patch(args.id, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
    // Restore does NOT cascade — projects/tasks stay archived
  },
});

export const remove = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

    // TODO Phase 7: block if time entries exist on any project of this client

    // Cascade delete contacts
    const contacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.id))
      .collect();
    for (const contact of contacts) {
      await ctx.db.delete(contact._id);
    }

    // Cascade delete projects and their estimates
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.id))
      .collect();
    for (const project of projects) {
      // Delete estimates for this project
      const estimates = await ctx.db
        .query("projectCategoryEstimates")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .collect();
      for (const est of estimates) {
        await ctx.db.delete(est._id);
      }
      // TODO Phase 5: cascade delete tasks
      await ctx.db.delete(project._id);
    }

    // Clean up uploaded logo file
    if (client.logoStorageId) {
      try {
        await ctx.storage.delete(client.logoStorageId);
      } catch {
        // Tolerate storage failures — don't block client deletion
      }
    }

    await ctx.db.delete(args.id);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const removeClientLogo = mutation({
  args: { clientId: v.id("clients"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");
    if (client.logoStorageId !== args.storageId) {
      throw new ConvexError("Storage ID does not belong to this client");
    }
    await ctx.storage.delete(args.storageId);
  },
});
