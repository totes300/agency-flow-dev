import { v, ConvexError } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthContext } from "./lib/auth";
import {
  AGENT_TABLE_MARKER,
  isAgentTableOutput,
  type AgentTable,
} from "../lib/agents/table";

/**
 * Artifact store for the canvas (PRD Module 5 · slice 06). A run produces a
 * big code-authored output (Wave 1: the timesheet CSV); this table holds it,
 * the chat carries a lightweight `artifact` block that references it by id,
 * and the docked canvas renders `sheetJson` as a grid + derives the CSV from
 * it at export time (client-side, same format helpers as the grid → matching
 * download). Every field is code-authored from deterministic row data — the
 * model never re-serializes a number (D1).
 *
 * Tenancy: orgId-scoped; read access is the thread OWNER or an org admin
 * (US: artifacts readable by owner + admin). Writes happen only through the
 * internal mutation the timesheet tool calls — never from the client.
 */

// ─── Write (internal — called from the timesheet tool's action) ─────────────

/**
 * Persist an artifact for a component thread. The tool ctx exposes the
 * component thread id (not the app thread), so we resolve the app thread via
 * `by_componentThreadId` and inherit its orgId + owner — the artifact can
 * never be scoped to a different tenant than its thread.
 */
export const createForThread = internalMutation({
  args: {
    componentThreadId: v.string(),
    runId: v.optional(v.id("agentRuns")),
    kind: v.literal("timesheet_csv"),
    name: v.string(),
    sheetJson: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_componentThreadId", (q) =>
        q.eq("componentThreadId", args.componentThreadId),
      )
      .unique();
    if (!thread) throw new ConvexError("Thread not found for artifact");

    return await ctx.db.insert("agentArtifacts", {
      orgId: thread.orgId,
      threadId: thread._id,
      runId: args.runId,
      userId: thread.userId,
      kind: args.kind,
      name: args.name,
      sheetJson: args.sheetJson,
      createdAt: Date.now(),
    });
  },
});

// ─── Reads (owner + admin) ──────────────────────────────────────────────────

/**
 * One artifact for the canvas: parsed sheet + the download-ready CSV. Owner
 * or org admin only; a foreign/garbage id 404s without leaking existence.
 * `threadId` is a plain string (arrives from the URL) → normalized inside.
 */
export const getForCanvas = query({
  args: { artifactId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    _id: string;
    threadId: string;
    name: string;
    kind: "timesheet_csv";
    table: AgentTable;
  } | null> => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentArtifacts", args.artifactId);
    if (!id) return null;
    const artifact = await ctx.db.get(id);
    if (!artifact || artifact.orgId !== auth.orgId) return null;
    // Owner or admin — the chat/canvas are owner surfaces; admins additionally
    // read for the audit view. A member never sees another user's artifact.
    if (artifact.userId !== auth.userId && !auth.isAdmin) return null;

    const parsed = safeParseTable(artifact.sheetJson);
    if (!parsed) return null; // corrupt payload → treat as gone, don't crash

    return {
      _id: artifact._id,
      threadId: artifact.threadId,
      name: artifact.name,
      kind: artifact.kind,
      table: parsed,
    };
  },
});

/**
 * Artifact ids for a thread, oldest-first — the canvas uses this only to
 * detect a freshly-arrived artifact and auto-open it once (it never needs the
 * payloads here). Owner-only, orgId-scoped.
 */
export const listByThread = query({
  args: { threadId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ _id: string; name: string; createdAt: number }>> => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!id) return [];
    const thread = await ctx.db.get(id);
    if (
      !thread ||
      thread.orgId !== auth.orgId ||
      thread.userId !== auth.userId
    ) {
      return [];
    }
    const artifacts = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .collect();
    return artifacts
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((a) => ({ _id: a._id, name: a.name, createdAt: a.createdAt }));
  },
});

/** Parse + structurally guard a stored sheet payload; null if invalid. */
function safeParseTable(sheetJson: string): AgentTable | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sheetJson);
  } catch {
    return null;
  }
  // Reuse the table-block guard: a stored sheet must satisfy the same
  // contract the renderer expects (wrap it in the marker envelope it checks).
  if (isAgentTableOutput({ block: AGENT_TABLE_MARKER, table: parsed })) {
    return parsed as AgentTable;
  }
  return null;
}
