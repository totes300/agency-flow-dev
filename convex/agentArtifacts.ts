import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { threadAccess } from "./agentThreads";
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
 * Tenancy: orgId-scoped; read access follows the artifact's THREAD under the
 * thread policy (`threadAccess`): owner or admin on a private thread, any
 * admin on an `admins` thread. Writes happen only through the actor-path
 * internal mutation the artifact tools call — never from the client.
 */

// ─── Write (called from artifact tools via the actor path) ───────────────────

export type ArtifactKind = "timesheet_csv" | "sheet_csv";

/**
 * Persist an artifact for a thread — the core behind
 * `agentActorTools.createArtifact` (the timesheet + sheet tools). The tool
 * ctx exposes the component thread id (not the app thread); the caller
 * resolves the app thread and checks the actor's write access, and the
 * artifact inherits its orgId + owner — it can never be scoped to a
 * different tenant than its thread.
 */
export async function insertArtifactForThread(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  args: { kind: ArtifactKind; name: string; sheetJson: string },
): Promise<Id<"agentArtifacts">> {
  return await ctx.db.insert("agentArtifacts", {
    orgId: thread.orgId,
    threadId: thread._id,
    userId: thread.userId,
    kind: args.kind,
    name: args.name,
    sheetJson: args.sheetJson,
    createdAt: Date.now(),
  });
}

// ─── Reads (thread read access) ─────────────────────────────────────────────

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
    kind: "timesheet_csv" | "sheet_csv";
    table: AgentTable;
  } | null> => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentArtifacts", args.artifactId);
    if (!id) return null;
    const artifact = await ctx.db.get(id);
    if (!artifact || artifact.orgId !== auth.orgId) return null;
    // Readable exactly when its thread is (threadAccess) — never via the
    // artifact's own userId, so a shared thread's artifacts follow the thread.
    const thread = await ctx.db.get(artifact.threadId);
    if (!thread || !threadAccess(thread, auth).canRead) return null;

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
 * payloads here). Thread read access (`threadAccess`), orgId-scoped.
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
    if (!thread || !threadAccess(thread, auth).canRead) return [];
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
