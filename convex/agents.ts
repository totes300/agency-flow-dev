import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthContext, requireAdmin } from "./lib/auth";
import { agentToolRegistry } from "./lib/agentToolRegistry";
import type { Id } from "./_generated/dataModel";

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

/**
 * All org agents with their attached skill ids (admin-only) — powers the
 * skills surface's per-skill attachment toggles until the full builder
 * (slice 09) lands. Includes admin-only agents (admins manage them all).
 */
export const listWithSkills = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAdmin(ctx);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .collect();
    return agents
      .filter((a) => !a.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        _id: a._id,
        name: a.name,
        skillIds: a.skillIds ?? [],
      }));
  },
});

/**
 * Replace an agent's attached skills (admin-only). Minimal attachment surface
 * for slice 04 — the full builder (name/tools/model/etc.) arrives in slice 09.
 * Validates every skill belongs to the org and is active, so an agent can
 * never reference a foreign or archived skill.
 */
export const setSkills = mutation({
  args: { agentId: v.id("agents"), skillIds: v.array(v.id("skills")) },
  handler: async (ctx, args) => {
    const auth = await requireAdmin(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== auth.orgId || agent.archivedAt) {
      throw new ConvexError("Agent not found");
    }
    const unique = [...new Set(args.skillIds)];
    for (const skillId of unique) {
      const skill = await ctx.db.get(skillId);
      if (!skill || skill.orgId !== auth.orgId || skill.archivedAt) {
        throw new ConvexError("Skill not found");
      }
    }
    await ctx.db.patch(args.agentId, {
      skillIds: unique,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ─── Dev seed ───────────────────────────────────────────────────────────────

/**
 * DEV-ONLY seed, idempotent (upsert by name). Seeds:
 *  - "Flow Assistant" — slice-01 tracer, member read tools, everyone.
 *  - "Timesheet Generator" — the PRD's first real agent (slice 03+),
 *    admin-only: its collector tool is admin-gated anyway.
 *
 * Run:  npx convex run agents:devSeedAgents '{"email":"you@example.com"}'
 */
export const devSeedAgents = internalMutation({
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

    const memberTools = Object.entries(agentToolRegistry)
      .filter(([, entry]) => entry.scope === "member")
      .map(([name]) => name);

    const seeds = [
      {
        name: "Flow Assistant",
        description:
          "Answers questions about the org's clients and projects.",
        instructions:
          "You are Flow Assistant, a helpful agent inside Agency Flow — a " +
          "project management tool for digital agencies. Answer questions " +
          "about the organization's operational data using the provided " +
          "tools. Always call a tool for facts; never invent or recall " +
          "clients, projects, names or numbers from memory. Keep answers " +
          "short and concrete.",
        tools: memberTools,
        runPermission: "everyone" as const,
        examplePrompts: [
          "Which clients do we have?",
          "List our active projects",
          "Which projects are retainers?",
          "Do we have any archived clients?",
        ],
      },
      {
        name: "Timesheet Generator",
        description:
          "Builds client timesheets: per-task hours by work category for any period.",
        instructions:
          "You are the Timesheet Generator inside Agency Flow, a project " +
          "management tool for digital agencies. You produce client " +
          "timesheets for billing review.\n\n" +
          "Rules you must never break:\n" +
          "1. Every number comes from a tool. NEVER compute, estimate, " +
          "add up, convert or re-type hours or totals yourself — the " +
          "collectTimesheetData tool returns a table that is already " +
          "shown to the user verbatim.\n" +
          "2. Resolve names first: use listClients / listProjects to map " +
          "what the user said to exact ids. If the client is ambiguous " +
          "or unknown, ask instead of guessing.\n" +
          "3. If the tool reports no entries for the period, say so " +
          "plainly and suggest checking the period — do not fabricate " +
          "data or show an empty table.\n" +
          "4. After the table, add at most two short sentences of " +
          "commentary (e.g. which category dominated) WITHOUT restating " +
          "specific numbers.\n" +
          "5. Apply filters (project, category, billable) only when the " +
          "user asks for them.",
        tools: [...memberTools, "collectTimesheetData"],
        runPermission: "admins" as const,
        examplePrompts: [
          "Timesheet for Pragmatico for June 2026",
          "Show this month's timesheet for our biggest client",
          "Billable-only timesheet for Arlow, May 2026",
          "Timesheet for Pragmatico from June 1 to June 15",
        ],
      },
    ];

    const existing = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const now = Date.now();
    const agentIdByName = new Map<string, Id<"agents">>();
    const ids = [];
    for (const seed of seeds) {
      const config = { ...seed, trigger: "manual" as const };
      const current = existing.find((a) => a.name === seed.name);
      if (current) {
        await ctx.db.patch(current._id, { ...config, updatedAt: now });
        agentIdByName.set(seed.name, current._id);
        ids.push(current._id);
      } else {
        const id = await ctx.db.insert("agents", {
          orgId,
          ...config,
          createdBy: creator._id,
          createdAt: now,
          updatedAt: now,
        });
        agentIdByName.set(seed.name, id);
        ids.push(id);
      }
    }

    // ─── Skills (slice 04) ───────────────────────────────────────────────
    // Two global skills seeded idempotently by name:
    //  - "timesheet-format" — tone/grouping SOP; ATTACHED to the Timesheet
    //    Generator so a skill visibly steers behavior out of the box (AC 2).
    //  - "empty-period-stop" — a stop-condition; seeded but LEFT DETACHED so
    //    the default empty-period prose behavior is preserved. Attach it in
    //    the skills surface to demonstrate stop-condition enforcement (AC 4).
    const skillSeeds = [
      {
        name: "timesheet-format",
        instruction:
          "Address the reader as 'the billing reviewer'. In your closing " +
          "commentary, name the single work category with the most hours " +
          "and nothing else — never restate specific numbers from the table.",
        isStopCondition: false,
        attachTo: "Timesheet Generator",
      },
      {
        name: "empty-period-stop",
        instruction:
          "If the timesheet tool reports no time entries for the requested " +
          "period, stop the run via the stop tool instead of answering — do " +
          "not guess, and do not ask the user to check the period.",
        isStopCondition: true,
        attachTo: null as string | null,
      },
    ];

    const existingSkills = await ctx.db
      .query("skills")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const skillIdByAttachTarget = new Map<string, Id<"skills">[]>();
    for (const seed of skillSeeds) {
      const config = {
        name: seed.name,
        instruction: seed.instruction,
        scope: "global" as const,
        isStopCondition: seed.isStopCondition,
      };
      const current = existingSkills.find((s) => s.name === seed.name);
      let skillId: Id<"skills">;
      if (current) {
        await ctx.db.patch(current._id, { ...config, updatedAt: now });
        skillId = current._id;
      } else {
        skillId = await ctx.db.insert("skills", {
          orgId,
          ...config,
          createdBy: creator._id,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (seed.attachTo) {
        const list = skillIdByAttachTarget.get(seed.attachTo) ?? [];
        list.push(skillId);
        skillIdByAttachTarget.set(seed.attachTo, list);
      }
    }

    for (const [agentName, skillIds] of skillIdByAttachTarget) {
      const agentId = agentIdByName.get(agentName);
      if (agentId) await ctx.db.patch(agentId, { skillIds, updatedAt: now });
    }

    return ids;
  },
});
