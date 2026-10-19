import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";

/**
 * Admin audit surface (PRD Permissions/visibility · slice 11 · US 52, 54).
 * A separate, admin-only view over EVERY run in the org — who ran which agent,
 * when, outcome, and token usage — with server-side filters. It never relaxes
 * the owner-only chat/rail surfaces: those stay `listMine`/owner-scoped. From
 * a row an admin opens the thread read-only (`requireReadableThread` grants
 * admins read access; the composer + proposal controls are inert).
 */

const RUN_STATUS = new Set([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "stopped_by_skill",
]);

/** One audit row — the run's accounting joined to human labels. */
export type AuditRunRow = {
  _id: string;
  threadId: string;
  threadTitle: string;
  agentId: string;
  agentName: string;
  userId: string;
  userName: string;
  status: Doc<"agentRuns">["status"];
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  error: string | null;
};

/** Inclusive [from, to] day-bounds in epoch ms from YYYY-MM-DD, or null. */
function dayBoundsMs(
  dateFrom: string | undefined,
  dateTo: string | undefined,
): { min: number; max: number } {
  const min = dateFrom ? Date.parse(`${dateFrom}T00:00:00.000Z`) : NaN;
  const max = dateTo ? Date.parse(`${dateTo}T00:00:00.000Z`) : NaN;
  return {
    min: Number.isNaN(min) ? -Infinity : min,
    // `to` is inclusive of the whole day → add 24h.
    max: Number.isNaN(max) ? Infinity : max + 86_400_000,
  };
}

/** How many org runs to scan before filtering (MVP-scale bound). */
const AUDIT_SCAN_LIMIT = 1000;
/** Cap on rows returned to the client after filtering. */
const AUDIT_RESULT_LIMIT = 500;

/**
 * All org runs, newest first, with optional filters (agent / user / status /
 * date range). Admin-only. Filters are applied server-side after a bounded
 * scan so the client never over-fetches; the audit UI persists the same
 * filters in the URL per repo convention.
 */
export const listRuns = query({
  args: {
    agentId: v.optional(v.string()),
    userId: v.optional(v.string()),
    status: v.optional(v.string()),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AuditRunRow[]> => {
    const auth = await requireAdmin(ctx);

    const agentFilter = args.agentId
      ? ctx.db.normalizeId("agents", args.agentId)
      : null;
    const userFilter = args.userId
      ? ctx.db.normalizeId("users", args.userId)
      : null;
    const statusFilter =
      args.status && RUN_STATUS.has(args.status) ? args.status : null;
    const { min, max } = dayBoundsMs(args.dateFrom, args.dateTo);

    const scanned = await ctx.db
      .query("agentRuns")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .order("desc")
      .take(AUDIT_SCAN_LIMIT);

    const filtered = scanned
      .filter((r) => !agentFilter || r.agentId === agentFilter)
      .filter((r) => !userFilter || r.userId === userFilter)
      .filter((r) => !statusFilter || r.status === statusFilter)
      .filter((r) => r.startedAt >= min && r.startedAt < max)
      .slice(0, AUDIT_RESULT_LIMIT);

    // Batch-resolve the distinct labels (agent name, user name, thread title).
    const agentNames = await resolveNames(
      ctx,
      "agents",
      filtered.map((r) => r.agentId),
      (a) => a.name,
    );
    const userNames = await resolveNames(
      ctx,
      "users",
      filtered.map((r) => r.userId),
      (u) => u.name,
    );
    const threadTitles = await resolveNames(
      ctx,
      "agentThreads",
      filtered.map((r) => r.threadId),
      (t) => t.title,
    );

    return filtered.map((r) => ({
      _id: r._id,
      threadId: r.threadId,
      threadTitle: threadTitles.get(r.threadId) ?? "Untitled thread",
      agentId: r.agentId,
      agentName: agentNames.get(r.agentId) ?? "Agent",
      userId: r.userId,
      userName: userNames.get(r.userId) ?? "Unknown user",
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      durationMs:
        r.finishedAt !== undefined ? r.finishedAt - r.startedAt : null,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      totalTokens: r.totalTokens ?? null,
      error: r.error ?? null,
    }));
  },
});

/**
 * Batch-resolve a set of ids to display strings, one DB read per DISTINCT id.
 * Generic over the small handful of tables the audit rows reference; the
 * `label` picks the display field. Ids already come from org-scoped run rows,
 * so no extra tenancy check is needed here.
 */
async function resolveNames<T extends "agents" | "users" | "agentThreads">(
  ctx: QueryCtx,
  _table: T,
  ids: Id<T>[],
  label: (doc: Doc<T>) => string,
): Promise<Map<Id<T>, string>> {
  const out = new Map<Id<T>, string>();
  const distinct = [...new Set(ids)];
  await Promise.all(
    distinct.map(async (id) => {
      const doc = (await ctx.db.get(id)) as Doc<T> | null;
      if (doc) out.set(id, label(doc));
    }),
  );
  return out;
}
