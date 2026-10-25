import { v, ConvexError, type ObjectType } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertAdmin,
  getAuthContext,
  requireAdmin,
  validateStringLength,
  type AuthContext,
} from "./lib/auth";
import {
  assertClientPrefixAvailable,
  clientPrefixKey,
  effectiveClientPrefix,
  ensureUniquePrefix,
  generateClientPrefix,
  normalizeClientPrefix,
} from "./lib/helpers";
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

const createClientArgs = {
  name: v.string(),
  currency: v.optional(currencyValidator),
  prefix: v.optional(v.string()),
  usePrefix: v.optional(v.boolean()),
  billingName: v.optional(v.string()),
  billingEmail: v.optional(v.string()),
  billingCountry: v.optional(v.string()),
  billingCity: v.optional(v.string()),
  billingZip: v.optional(v.string()),
  billingStreet: v.optional(v.string()),
  billingStreet2: v.optional(v.string()),
  taxId: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export type CreateClientInput = ObjectType<typeof createClientArgs>;

/**
 * Creates a client (admins only) — the client form's Create and the MCP
 * `save_clients` tool (docs/prd-mcp.md §6) share this core.
 */
export async function createClientForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: CreateClientInput,
): Promise<Id<"clients">> {
  assertAdmin(auth);
  const { orgId, userId } = auth;

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

  // Client prefix: a typed prefix must be valid (A–Z/0–9, ≤ 10, saved
  // uppercase) and free (case-insensitive, never rewritten); a generated
  // one is made free with a numeric suffix.
  const typedPrefix = args.prefix?.trim();
  let prefix: string;
  if (typedPrefix) {
    prefix = normalizeClientPrefix(typedPrefix);
    await assertClientPrefixAvailable(ctx, orgId, prefix);
  } else {
    prefix = await ensureUniquePrefix(ctx, orgId, generateClientPrefix(name));
  }

  const now = Date.now();
  return await ctx.db.insert("clients", {
    orgId,
    name,
    currency,
    prefix,
    usePrefix: args.usePrefix,
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
}

export const create = mutation({
  args: createClientArgs,
  handler: async (ctx, args) => {
    return await createClientForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const updateClientArgs = {
  id: v.id("clients"),
  name: v.optional(v.string()),
  // currency is immutable after creation — not accepted in update
  prefix: v.optional(v.string()),
  usePrefix: v.optional(v.boolean()),
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
};

export type UpdateClientInput = ObjectType<typeof updateClientArgs>;

/** Edits a client (admins only): the client form's Save and MCP `save_clients`. */
export async function updateClientForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: UpdateClientInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;
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

  if (args.prefix !== undefined) {
    const pfx = args.prefix.trim();
    if (pfx) {
      // The edit form re-sends the current prefix with every save: an
      // unchanged prefix (case-insensitively) is left as stored and not
      // re-checked, so a legacy duplicate or a legacy format never blocks
      // editing other fields.
      const current = effectiveClientPrefix(client);
      if (current === null || clientPrefixKey(current) !== clientPrefixKey(pfx)) {
        const prefix = normalizeClientPrefix(pfx);
        await assertClientPrefixAvailable(ctx, orgId, prefix, args.id);
        updates.prefix = prefix;
      }
    }
  }

  if (args.usePrefix !== undefined) updates.usePrefix = args.usePrefix;

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
}

export const update = mutation({
  args: updateClientArgs,
  handler: async (ctx, args) => {
    return await updateClientForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const archiveClientArgs = { id: v.id("clients") };

export type ArchiveClientInput = ObjectType<typeof archiveClientArgs>;

/** Archives a client (admins only); does not cascade. */
export async function archiveClientForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: ArchiveClientInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;
  const client = await ctx.db.get(args.id);
  if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

  await ctx.db.patch(args.id, {
    archivedAt: Date.now(),
    updatedAt: Date.now(),
  });

  // TODO Phase 3/5: cascade archive to projects → tasks, stop running timers
}

export const archive = mutation({
  args: archiveClientArgs,
  handler: async (ctx, args) => {
    return await archiveClientForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const restoreClientArgs = { id: v.id("clients") };

export type RestoreClientInput = ObjectType<typeof restoreClientArgs>;

/** Restores an archived client (admins only); projects stay archived. */
export async function restoreClientForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: RestoreClientInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;
  const client = await ctx.db.get(args.id);
  if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

  await ctx.db.patch(args.id, {
    archivedAt: undefined,
    updatedAt: Date.now(),
  });
  // Restore does NOT cascade — projects/tasks stay archived
}

export const restore = mutation({
  args: restoreClientArgs,
  handler: async (ctx, args) => {
    return await restoreClientForAuth(ctx, await getAuthContext(ctx), args);
  },
});

const removeClientArgs = { id: v.id("clients") };

export type RemoveClientInput = ObjectType<typeof removeClientArgs>;

/**
 * Deletes a client and its contacts, projects and estimates (admins only),
 * refused while invoices, logged time or running timers exist on its
 * projects — the app's Delete and MCP `delete`.
 */
export async function removeClientForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  args: RemoveClientInput,
): Promise<void> {
  assertAdmin(auth);
  const { orgId } = auth;
  const client = await ctx.db.get(args.id);
  if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

  // Explicit `orgId` filter on the projects query (defense-in-depth per
  // CLAUDE.md "no exceptions"). The by_clientId index narrows to the
  // client, and the client was already org-checked above, but the filter
  // keeps the query ownable by static audit.
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_clientId", (q) => q.eq("clientId", args.id))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();

  // Block hard-delete when any invoice exists on any of this client's
  // projects. Invoices are legal/financial records and must not be silently
  // orphaned — the Billing hub keeps summing them.
  for (const project of projects) {
    const existingInvoice = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    if (existingInvoice) {
      throw new ConvexError(
        "Cannot delete this client — invoices exist on one or more of its projects. Delete those invoices first.",
      );
    }
  }

  // Block on logged time and running timers across ALL of this client's
  // projects (same two guards as `projects.remove`). Deleting the client
  // cascades away its projects; without these guards the tasks/entries under
  // them would be orphaned from every project-scoped billing surface, and a
  // running timer would dangle — its stop silently discards the measured
  // hours. Delete is destructive, so we block rather than auto-save (entry
  // creation is exactly what the entries guard forbids); archive the client
  // to rescue timers instead.
  const clientTaskIds = new Set<string>();
  for (const project of projects) {
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", project._id))
      .collect();
    for (const task of projectTasks) clientTaskIds.add(task._id.toString());
    const hasEntries = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_projectId_closeId", (q) => q.eq("orgId", orgId).eq("projectId", project._id))
      .first();
    if (hasEntries) {
      throw new ConvexError(
        "Cannot delete a client with time entries on its projects — archive it instead",
      );
    }
  }

  const clientMembers = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  for (const member of clientMembers) {
    if (!member.userId) continue;
    const memberUser = await ctx.db.get(member.userId);
    if (memberUser?.timerTaskId && clientTaskIds.has(memberUser.timerTaskId.toString())) {
      throw new ConvexError(
        `${memberUser.name} has a running timer on one of this client's projects — it must be stopped or discarded first.`,
      );
    }
  }

  // Cascade delete contacts
  const contacts = await ctx.db
    .query("clientContacts")
    .withIndex("by_clientId", (q) => q.eq("clientId", args.id))
    .collect();
  for (const contact of contacts) {
    await ctx.db.delete(contact._id);
  }

  // Cascade delete projects and their estimates
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
}

export const remove = mutation({
  args: removeClientArgs,
  handler: async (ctx, args) => {
    return await removeClientForAuth(ctx, await getAuthContext(ctx), args);
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
