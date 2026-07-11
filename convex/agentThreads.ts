import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  createThread as createComponentThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";

/**
 * App-side thread lifecycle. Message storage lives in the @convex-dev/agent
 * component; `agentThreads` rows carry tenancy (orgId), ownership, agent
 * binding, title and status for the rail + audit views.
 */

/** Placeholder until the first user message auto-titles the thread. */
export const UNTITLED_THREAD = "New chat";

/**
 * Owner-only access check shared by every thread-scoped function.
 * Admin-sees-all arrives with the audit view (slice 11) as a SEPARATE
 * query — the rail and chat surfaces are always owner-only (US 51).
 */
export async function requireOwnedThread(
  ctx: QueryCtx,
  auth: AuthContext,
  threadId: Id<"agentThreads">,
): Promise<Doc<"agentThreads">> {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.orgId !== auth.orgId) {
    throw new ConvexError("Thread not found");
  }
  if (thread.userId !== auth.userId) {
    throw new ConvexError("Thread not found"); // don't leak existence
  }
  return thread;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Current user's threads, newest activity first — the rail's Recent list. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    const threads = await ctx.db
      .query("agentThreads")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", auth.orgId).eq("userId", auth.userId),
      )
      .collect();

    // Resolve agent names for the rail rows (agent icon + title + time).
    const agentIds = [...new Set(threads.map((t) => t.agentId))];
    const agents = await Promise.all(agentIds.map((id) => ctx.db.get(id)));
    const agentNameById = new Map(
      agents.filter(Boolean).map((a) => [a!._id.toString(), a!.name]),
    );

    return threads
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((t) => ({
        _id: t._id,
        title: t.title,
        status: t.status,
        agentId: t.agentId,
        agentName: agentNameById.get(t.agentId.toString()) ?? "Agent",
        lastActivityAt: t.lastActivityAt,
      }));
  },
});

/**
 * One thread (owner-only) — the chat pane's header + message source.
 * `threadId` is a plain string (it arrives from the URL); garbage
 * normalizes to null and 404s cleanly.
 */
export const get = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!id) throw new ConvexError("Thread not found");
    const thread = await requireOwnedThread(ctx, auth, id);
    const agent = await ctx.db.get(thread.agentId);

    // The in-flight run, if any — the composer's Stop button target.
    // Newest-first so a stale stuck row can't shadow the live one.
    const activeRun =
      thread.status === "running"
        ? (
            await ctx.db
              .query("agentRuns")
              .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
              .filter((q) => q.eq(q.field("orgId"), auth.orgId))
              .order("desc")
              .collect()
          ).find((r) => r.status === "running")
        : undefined;

    return {
      _id: thread._id,
      componentThreadId: thread.componentThreadId,
      title: thread.title,
      status: thread.status,
      agentId: thread.agentId,
      agentName: agent?.name ?? "Agent",
      activeRun: activeRun
        ? {
            _id: activeRun._id,
            cancelRequested: activeRun.cancelRequested === true,
          }
        : null,
    };
  },
});

/**
 * Run outcomes for one thread — the source of the stream's `error` and
 * `system` blocks (failed → error block with hint, cancelled → "run
 * stopped" line), interleaved with messages by timestamp in the UI.
 */
export const listRuns = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!id) throw new ConvexError("Thread not found");
    const thread = await requireOwnedThread(ctx, auth, id);
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .filter((q) => q.eq(q.field("orgId"), auth.orgId))
      .collect();
    return runs.map((r) => ({
      _id: r._id,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      error: r.error ?? null,
      errorHint: r.errorHint ?? null,
    }));
  },
});

/**
 * Messages + live stream deltas for one thread. Shape follows the
 * component contract consumed by `useUIMessages(…, { stream: true })`.
 */
export const listMessages = query({
  args: {
    // Plain string so the query satisfies the useUIMessages hook contract
    // ({ threadId: string }); normalized + ownership-checked inside.
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!id) throw new ConvexError("Thread not found");
    const thread = await requireOwnedThread(ctx, auth, id);
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: thread.componentThreadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: thread.componentThreadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Start a new conversation with an agent ("New chat" / clicking an agent
 * in the rail). Validates run permission here too, so a member can't even
 * open a thread on an admins-only agent.
 */
export const create = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== auth.orgId || agent.archivedAt) {
      throw new ConvexError("Agent not found");
    }
    if (agent.runPermission === "admins" && !auth.isAdmin) {
      throw new ConvexError("You don't have permission to run this agent");
    }

    const componentThreadId = await createComponentThread(
      ctx,
      components.agent,
      { userId: auth.userId, title: UNTITLED_THREAD },
    );

    const now = Date.now();
    return await ctx.db.insert("agentThreads", {
      orgId: auth.orgId,
      componentThreadId,
      agentId: agent._id,
      userId: auth.userId,
      title: UNTITLED_THREAD,
      status: "idle",
      lastActivityAt: now,
      createdAt: now,
    });
  },
});
