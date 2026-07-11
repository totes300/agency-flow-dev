import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import { agentToolRegistry } from "./lib/agentToolRegistry";

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Agents the current user may run — powers the rail's Agents section.
 * Members only see `runPermission: "everyone"` agents (US 6: admin-only
 * agents don't appear for them at all); archived agents disappear for
 * everyone (their threads survive).
 */
export const listRunnable = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect();
    return agents
      .filter((a) => !a.archivedAt)
      .filter((a) => auth.isAdmin || a.runPermission === "everyone")
      .map((a) => ({
        _id: a._id,
        name: a.name,
        description: a.description,
      }));
  },
});

/**
 * One runnable agent — the new-chat empty state (identity line +
 * example-prompt chips). Same visibility rules as `listRunnable`.
 * Returns null (not an error) for unknown/forbidden ids so a stale
 * `?agent=` URL degrades to the generic empty state instead of crashing.
 */
export const get = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    // Plain string — arrives from the URL (?agent=); garbage → null.
    const id = ctx.db.normalizeId("agents", args.agentId);
    if (!id) return null;
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== auth.orgId || agent.archivedAt) {
      return null;
    }
    if (agent.runPermission === "admins" && !auth.isAdmin) {
      return null; // don't leak existence
    }
    return {
      _id: agent._id,
      name: agent.name,
      description: agent.description,
      examplePrompts: agent.examplePrompts ?? [],
    };
  },
});

// ─── Dev seed ───────────────────────────────────────────────────────────────

/**
 * DEV-ONLY seed for the slice-01 tracer: one test agent wired to the two
 * read tools, runnable by everyone. Idempotent (upsert by name).
 *
 * Run:  npx convex run agents:devSeedTracerAgent '{"email":"you@example.com"}'
 *
 * The REAL seeded agent (Timesheet Generator) arrives in its own slice —
 * this one exists to prove the spine and is safe to archive afterwards.
 */
export const devSeedTracerAgent = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db.query("users").collect();
    const creator = users.find((u) => u.email === email && !u.deletedAt);
    if (!creator) throw new Error(`No user with email ${email}`);
    const membership = (await ctx.db.query("orgMembers").collect()).find(
      (m) => m.userId === creator._id,
    );
    if (!membership) throw new Error(`No org membership for ${email}`);
    const orgId = membership.orgId;

    const name = "Flow Assistant";
    const config = {
      description: "Answers questions about the org's clients and projects.",
      instructions:
        "You are Flow Assistant, a helpful agent inside Agency Flow — a " +
        "project management tool for digital agencies. Answer questions " +
        "about the organization's operational data using the provided " +
        "tools. Always call a tool for facts; never invent or recall " +
        "clients, projects, names or numbers from memory. Keep answers " +
        "short and concrete.",
      tools: Object.keys(agentToolRegistry),
      runPermission: "everyone" as const,
      examplePrompts: [
        "Which clients do we have?",
        "List our active projects",
        "Which projects are retainers?",
        "Do we have any archived clients?",
      ],
      trigger: "manual" as const,
    };

    const existing = (
      await ctx.db
        .query("agents")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect()
    ).find((a) => a.name === name);

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...config, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("agents", {
      orgId,
      name,
      ...config,
      createdBy: creator._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});
