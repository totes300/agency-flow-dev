import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";

// ─── Queries ────────────────────────────────────────────────────────────────────

export const list = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify client belongs to org
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) {
      throw new Error("Client not found");
    }

    return await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) throw new Error("Client not found");

    const name = args.name.trim();
    if (!name) throw new Error("Contact name is required");
    validateStringLength(name, 200, "Contact name");

    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("Contact email is required");

    // Email uniqueness within org
    const existingEmail = await ctx.db
      .query("clientContacts")
      .withIndex("by_orgId_email", (q) => q.eq("orgId", orgId).eq("email", email))
      .first();
    if (existingEmail) {
      // Find the client name for the error message
      const otherClient = await ctx.db.get(existingEmail.clientId);
      const otherName = otherClient?.name ?? "another client";
      throw new Error(`This email is already assigned to ${otherName}`);
    }

    // Check if this is the first contact for the client
    const existingContacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();

    const isPrimary = existingContacts.length === 0 ? true : (args.isPrimary ?? false);

    // If setting as primary, unset existing primary
    if (isPrimary && existingContacts.length > 0) {
      const currentPrimary = existingContacts.find((c) => c.isPrimary);
      if (currentPrimary) {
        await ctx.db.patch(currentPrimary._id, { isPrimary: false, updatedAt: Date.now() });
      }
    }

    const now = Date.now();
    return await ctx.db.insert("clientContacts", {
      orgId,
      clientId: args.clientId,
      name,
      email,
      phone: args.phone?.trim() || undefined,
      isPrimary,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("clientContacts"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const contact = await ctx.db.get(args.id);
    if (!contact || contact.orgId !== orgId) throw new Error("Contact not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Contact name is required");
      validateStringLength(name, 200, "Contact name");
      updates.name = name;
    }

    if (args.email !== undefined) {
      const email = args.email.trim().toLowerCase();
      if (!email) throw new Error("Contact email is required");

      if (email !== contact.email) {
        const existing = await ctx.db
          .query("clientContacts")
          .withIndex("by_orgId_email", (q) => q.eq("orgId", orgId).eq("email", email))
          .first();
        if (existing && existing._id !== args.id) {
          const otherClient = await ctx.db.get(existing.clientId);
          throw new Error(`This email is already assigned to ${otherClient?.name ?? "another client"}`);
        }
      }
      updates.email = email;
    }

    if (args.phone !== undefined) {
      updates.phone = args.phone.trim() || undefined;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("clientContacts") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const contact = await ctx.db.get(args.id);
    if (!contact || contact.orgId !== orgId) throw new Error("Contact not found");

    const wasPrimary = contact.isPrimary;
    await ctx.db.delete(args.id);

    // If removed contact was primary, promote the oldest remaining
    if (wasPrimary) {
      const remaining = await ctx.db
        .query("clientContacts")
        .withIndex("by_clientId", (q) => q.eq("clientId", contact.clientId))
        .collect();

      if (remaining.length > 0) {
        // Sort by createdAt ascending, pick oldest
        remaining.sort((a, b) => a.createdAt - b.createdAt);
        await ctx.db.patch(remaining[0]._id, {
          isPrimary: true,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

export const setPrimary = mutation({
  args: { id: v.id("clientContacts") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);

    const contact = await ctx.db.get(args.id);
    if (!contact || contact.orgId !== orgId) throw new Error("Contact not found");

    if (contact.isPrimary) return; // Already primary

    // Unset current primary
    const contacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", contact.clientId))
      .collect();

    const currentPrimary = contacts.find((c) => c.isPrimary);
    if (currentPrimary) {
      await ctx.db.patch(currentPrimary._id, { isPrimary: false, updatedAt: Date.now() });
    }

    await ctx.db.patch(args.id, { isPrimary: true, updatedAt: Date.now() });
  },
});
