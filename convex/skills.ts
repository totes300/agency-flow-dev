import { v, ConvexError } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin, validateStringLength } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

/**
 * Skills (PRD D2, Module 7) — plain-English SOPs, global or per-client,
 * attached to agents. This module owns their admin CRUD; ordering / scoping /
 * prompt assembly is the pure `lib/agents/skills.ts`, consumed by the runner.
 *
 * Every function is admin-gated: members can neither read nor author skills
 * (US 48 — "admins build"). All are orgId-scoped.
 */

const NAME_MAX = 80;
const INSTRUCTION_MAX = 2000;

const scopeValidator = v.union(v.literal("global"), v.literal("client"));

/**
 * Validate the scope ↔ clientId pairing and, for client skills, that the
 * client exists in this org. Returns the normalized clientId to store
 * (undefined for global skills — a global skill never carries a client).
 */
async function resolveScopeClient(
  ctx: MutationCtx,
  orgId: string,
  scope: "global" | "client",
  clientId: Id<"clients"> | undefined,
): Promise<Id<"clients"> | undefined> {
  if (scope === "global") {
    if (clientId) throw new ConvexError("A global skill cannot target a client");
    return undefined;
  }
  if (!clientId) throw new ConvexError("A client skill needs a client");
  const client = await ctx.db.get(clientId);
  if (!client || client.orgId !== orgId) {
    throw new ConvexError("Client not found");
  }
  return clientId;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * All active skills for the org (admin-only), with client names resolved for
 * the editing surface. Newest first.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAdmin(ctx);
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect();

    const active = skills.filter((s) => !s.archivedAt);
    const clientIds = [
      ...new Set(active.map((s) => s.clientId).filter(Boolean)),
    ] as Id<"clients">[];
    const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
    const clientNameById = new Map(
      clients.filter(Boolean).map((c) => [c!._id.toString(), c!.name]),
    );

    return active
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        _id: s._id,
        name: s.name,
        instruction: s.instruction,
        scope: s.scope,
        clientId: s.clientId ?? null,
        clientName: s.clientId
          ? (clientNameById.get(s.clientId.toString()) ?? "Unknown client")
          : null,
        isStopCondition: s.isStopCondition,
        createdAt: s.createdAt,
      }));
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    instruction: v.string(),
    scope: scopeValidator,
    clientId: v.optional(v.id("clients")),
    isStopCondition: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx);
    const name = args.name.trim();
    const instruction = args.instruction.trim();
    if (!name) throw new ConvexError("Name is required");
    if (!instruction) throw new ConvexError("Instruction is required");
    validateStringLength(name, NAME_MAX, "Name");
    validateStringLength(instruction, INSTRUCTION_MAX, "Instruction");

    const clientId = await resolveScopeClient(
      ctx,
      auth.orgId,
      args.scope,
      args.clientId,
    );

    const now = Date.now();
    return await ctx.db.insert("skills", {
      orgId: auth.orgId,
      name,
      instruction,
      scope: args.scope,
      clientId,
      isStopCondition: args.isStopCondition,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    skillId: v.id("skills"),
    name: v.string(),
    instruction: v.string(),
    scope: scopeValidator,
    clientId: v.optional(v.id("clients")),
    isStopCondition: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== auth.orgId || skill.archivedAt) {
      throw new ConvexError("Skill not found");
    }
    const name = args.name.trim();
    const instruction = args.instruction.trim();
    if (!name) throw new ConvexError("Name is required");
    if (!instruction) throw new ConvexError("Instruction is required");
    validateStringLength(name, NAME_MAX, "Name");
    validateStringLength(instruction, INSTRUCTION_MAX, "Instruction");

    const clientId = await resolveScopeClient(
      ctx,
      auth.orgId,
      args.scope,
      args.clientId,
    );

    await ctx.db.patch(args.skillId, {
      name,
      instruction,
      scope: args.scope,
      // Clear the client link when switching to global (patch with undefined
      // removes the field).
      clientId,
      isStopCondition: args.isStopCondition,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Archive a skill: it stops loading into runs and disappears from the editor.
 * Also detach it from every agent so no agent references a dead skill (the
 * runner would skip it anyway, but attachments should stay truthful).
 */
export const archive = mutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== auth.orgId || skill.archivedAt) {
      throw new ConvexError("Skill not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.skillId, { archivedAt: now, updatedAt: now });

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect();
    for (const agent of agents) {
      if (agent.skillIds?.some((id) => id === args.skillId)) {
        await ctx.db.patch(agent._id, {
          skillIds: agent.skillIds.filter((id) => id !== args.skillId),
          updatedAt: now,
        });
      }
    }
    return null;
  },
});
