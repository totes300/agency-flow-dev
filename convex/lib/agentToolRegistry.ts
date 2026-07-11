/**
 * Agent tool registry — the single vetted catalog of what agents CAN do,
 * and the determinism boundary (PRD module 2).
 *
 * Every entry wraps an EXISTING Convex function via `ctx.runQuery` /
 * `ctx.runMutation`, so the wrapped function's own `getAuthContext` /
 * `requireAdmin` enforcement applies with the running user's identity
 * (D6 — permission intersection: the runner action is invoked by the
 * client, so `ctx.auth` inside tool execution IS the running user).
 *
 * Kinds:
 *   - `read`     — returns data verbatim from a deterministic query.
 *   - `propose`  — creates a proposal record, never touches domain tables
 *                  (arrives with the proposal engine, slice 08).
 *   - `connector`— resolves the running user's external connection
 *                  (arrives with the connector framework, slice 10).
 *
 * Scope filtering: `admin`-scoped tools are ABSENT from a member run's
 * tool set (the model can't even attempt them). The wrapped function
 * still enforces its own auth — the registry scope is a UX/safety layer,
 * never the only gate.
 *
 * Agents reference tools by registry name (data, not code). Unknown names
 * are dropped at runtime and reported, never executed.
 */

import { z } from "zod";
import type { Tool } from "ai";
import { createTool } from "@convex-dev/agent";
import { api } from "../_generated/api";

export type AgentToolScope = "member" | "admin";
export type AgentToolKind = "read" | "propose" | "connector";

export type AgentToolEntry = {
  name: string;
  /** Shown in the admin builder's tool checklist (human, not model-facing). */
  humanDescription: string;
  scope: AgentToolScope;
  kind: AgentToolKind;
  tool: Tool;
};

// ─── Read tools (tracer seed) ───────────────────────────────────────────────

const listClientsTool = createTool({
  description:
    "List the organization's clients from the app database. Returns each " +
    "client's id, name, currency and archived state. Use this whenever the " +
    "user asks about clients — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived clients (default false)"),
  }),
  // Return type annotated to avoid TS type cycles through the generated api.
  execute: async (
    ctx,
    input,
  ): Promise<
    Array<{ id: string; name: string; currency: string; archived: boolean }>
  > => {
    const clients = await ctx.runQuery(api.clients.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return clients.map((c) => ({
      id: c._id,
      name: c.name,
      currency: c.currency,
      archived: Boolean(c.archivedAt),
    }));
  },
});

const listProjectsTool = createTool({
  description:
    "List the organization's projects from the app database. Returns each " +
    "project's id, name, client name, billing type and archived state. Use " +
    "this whenever the user asks about projects — never answer from memory.",
  inputSchema: z.object({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also include archived projects (default false)"),
  }),
  execute: async (
    ctx,
    input,
  ): Promise<
    Array<{
      id: string;
      name: string;
      clientName: string;
      billingType: string;
      archived: boolean;
    }>
  > => {
    const projects = await ctx.runQuery(api.projects.list, {
      includeArchived: input.includeArchived ?? false,
    });
    return projects.map((p) => ({
      id: p._id,
      name: p.name,
      clientName: p.clientName,
      billingType: p.billingType,
      archived: Boolean(p.archivedAt),
    }));
  },
});

// ─── Registry ───────────────────────────────────────────────────────────────

export const agentToolRegistry: Record<string, AgentToolEntry> = {
  listClients: {
    name: "listClients",
    humanDescription: "Read the client directory (names, currencies).",
    scope: "member",
    kind: "read",
    tool: listClientsTool,
  },
  listProjects: {
    name: "listProjects",
    humanDescription: "Read the project list (names, clients, billing types).",
    scope: "member",
    kind: "read",
    tool: listProjectsTool,
  },
};

/**
 * Resolve an agent's whitelisted tool names into an AI-SDK tool set for one
 * run. Pure: scope filtering + unknown-name dropping, no I/O.
 *
 * - `admin`-scoped entries are omitted for non-admin runners (tool absent,
 *   not erroring — the model cannot attempt it).
 * - Names missing from the registry are collected in `dropped` so the
 *   runner can surface a system note instead of silently shrinking the set.
 */
export function getToolsForAgent(
  toolNames: string[],
  isAdmin: boolean,
): { tools: Record<string, Tool>; dropped: string[] } {
  const tools: Record<string, Tool> = {};
  const dropped: string[] = [];
  for (const name of toolNames) {
    const entry = agentToolRegistry[name];
    if (!entry) {
      dropped.push(name);
      continue;
    }
    if (entry.scope === "admin" && !isAdmin) continue;
    tools[name] = entry.tool;
  }
  return { tools, dropped };
}
