import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  createThread as createComponentThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getAuthContext,
  loadAuthContextForActor,
  type AuthContext,
} from "./lib/auth";

/**
 * App-side thread lifecycle. Message storage lives in the @convex-dev/agent
 * component; `agentThreads` rows carry tenancy (orgId), ownership, agent
 * binding, title and status for the rail + audit views.
 */

/** Placeholder until the first user message auto-titles the thread. */
export const UNTITLED_THREAD = "New chat";

export type ThreadVisibility = "private" | "admins";
export type ThreadAccessMode = "read" | "write";

/**
 * THE thread access policy (A2a; PRD §4.2, §5.5, I10) — every thread-scoped
 * read and write goes through it:
 *
 * | visibility          | read                  | write (send, stop, decide) |
 * |---------------------|-----------------------|----------------------------|
 * | private (or unset)  | owner, any org admin  | owner only                 |
 * | admins              | any org admin         | any org admin              |
 *
 * A private thread's admin read is the audit view (US 52): the transcript
 * is visible, the composer + proposal controls are inert. Members never
 * reach an `admins` thread. Pure — `auth` must already be resolved for the
 * thread's org (role from the JWT for queries, from `orgMembers` for runs).
 */
export function threadAccess(
  thread: Doc<"agentThreads">,
  auth: Pick<AuthContext, "orgId" | "userId" | "isAdmin">,
): { canRead: boolean; canWrite: boolean } {
  if (thread.orgId !== auth.orgId) return { canRead: false, canWrite: false };
  if (thread.visibility === "admins") {
    return { canRead: auth.isAdmin, canWrite: auth.isAdmin };
  }
  const isOwner = thread.userId === auth.userId;
  return { canRead: isOwner || auth.isAdmin, canWrite: isOwner };
}

/**
 * Load a thread and require `mode` access under `threadAccess`. A missing,
 * foreign-tenant or forbidden thread all 404 the same way ("Thread not
 * found") so existence never leaks. Returns `canWrite` so read callers can
 * gate interactivity.
 */
export async function requireThreadAccess(
  ctx: QueryCtx,
  auth: AuthContext,
  threadId: Id<"agentThreads">,
  mode: ThreadAccessMode,
): Promise<{ thread: Doc<"agentThreads">; canWrite: boolean }> {
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new ConvexError("Thread not found");
  const access = threadAccess(thread, auth);
  if (mode === "write" ? !access.canWrite : !access.canRead) {
    throw new ConvexError("Thread not found"); // don't leak existence
  }
  return { thread, canWrite: access.canWrite };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Current user's threads, newest activity first — the rail's Recent list.
 * Threads the viewer OWNS and can still read: a demoted owner of an
 * `admins` thread no longer lists it. Other admins' shared threads never
 * appear here — they get their own surfaces (e.g. Triage). Threads of a
 * SYSTEM agent (agent jobs, A2b) never list here either, even for their
 * nominal owner (the designated agent actor) — same reason.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    const owned = (
      await ctx.db
        .query("agentThreads")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", auth.orgId).eq("userId", auth.userId),
        )
        .collect()
    ).filter((t) => threadAccess(t, auth).canRead);

    // Resolve agent names for the rail rows (agent icon + title + time).
    const agentIds = [...new Set(owned.map((t) => t.agentId))];
    const agents = await Promise.all(agentIds.map((id) => ctx.db.get(id)));
    const agentNameById = new Map(
      agents.filter(Boolean).map((a) => [a!._id.toString(), a!.name]),
    );
    const systemAgentIds = new Set(
      agents.filter((a) => a?.systemKey).map((a) => a!._id.toString()),
    );
    const threads = owned.filter(
      (t) => !systemAgentIds.has(t.agentId.toString()),
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
 * One thread (readable per `threadAccess`) — the chat pane's header + message source.
 * `threadId` is a plain string (it arrives from the URL); garbage
 * normalizes to null and 404s cleanly.
 */
export const get = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!id) throw new ConvexError("Thread not found");
    const { thread, canWrite } = await requireThreadAccess(ctx, auth, id, "read");
    const agent = await ctx.db.get(thread.agentId);
    const visibility: ThreadVisibility = thread.visibility ?? "private";

    // The in-flight run, if any — the composer's Stop button target.
    // Newest-first so a stale stuck row can't shadow the live one.
    const activeRun =
      thread.status === "running"
        ? (
            await ctx.db
              .query("agentRuns")
              .withIndex("by_threadId_status", (q) =>
                q.eq("threadId", thread._id).eq("status", "running"),
              )
              .order("desc")
              .take(1)
          )[0]
        : undefined;

    // Shared threads show who wrote each user turn. User messages carry the
    // sender's userId (saveMessage in beginRunCore); the names come from the
    // thread's run actors — exactly the set of users who can have sent one.
    const authors: { userId: Id<"users">; name: string }[] = [];
    if (visibility === "admins") {
      const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
        .take(500);
      const userIds = [...new Set(runs.map((r) => r.userId))];
      for (const userId of userIds) {
        const user = await ctx.db.get(userId);
        if (user) authors.push({ userId, name: user.name });
      }
    }

    return {
      _id: thread._id,
      componentThreadId: thread.componentThreadId,
      title: thread.title,
      status: thread.status,
      agentId: thread.agentId,
      agentName: agent?.name ?? "Agent",
      visibility,
      anchor: thread.anchor ?? null,
      // Without write access (an admin auditing a member's private thread)
      // the UI hides the composer and renders proposal cards inert. Every
      // write path re-checks `threadAccess` server-side.
      viewerCanWrite: canWrite,
      viewerIsOwner: thread.userId === auth.userId,
      authors,
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
    const { thread } = await requireThreadAccess(ctx, auth, id, "read");
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .filter((q) => q.eq(q.field("orgId"), auth.orgId))
      .collect();
    return runs.map((r) => ({
      _id: r._id,
      status: r.status,
      // A queued background run (A2a) has no outcome yet — a quiet line.
      queuedAt: r.status === "queued" ? (r.queuedAt ?? r.startedAt) : null,
      // Cancelled while still queued (stopRun) — it never ran; its message
      // was never posted.
      cancelledBeforeStart:
        r.status === "cancelled" && r.queuedMessage !== undefined,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      error: r.error ?? null,
      errorHint: r.errorHint ?? null,
      // "Skill loaded" notes (slice 04), shown at run start.
      loadedSkills: r.loadedSkills ?? [],
      // Set when a skill stop-condition halted the run — its explanatory block.
      stoppedBySkill: r.stoppedBySkill ?? null,
      // Stale tool refs dropped at runtime (slice 09) → a "system" block.
      droppedTools: r.droppedTools ?? [],
      // The agent job this run executed (A2b) — keys its stage line (B8).
      job: r.job ?? null,
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
    const { thread } = await requireThreadAccess(ctx, auth, id, "read");
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
    // System agents (A2b) are not pickable: their threads are created by
    // agent jobs only (ensureAnchoredThread).
    if (
      !agent ||
      agent.orgId !== auth.orgId ||
      agent.archivedAt ||
      agent.systemKey
    ) {
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

export const threadVisibilityValidator = v.union(
  v.literal("private"),
  v.literal("admins"),
);
export const threadAnchorValidator = v.object({
  type: v.string(),
  id: v.string(),
});

/**
 * "The one thread for this anchor" (A2a) — e.g. the shared admin
 * conversation of one email thread. Idempotent: returns the existing thread
 * for the same (org, anchor, agent, visibility[, owner when private]) or
 * creates it, component thread included. The owner is part of the key only
 * for private threads, so each member gets their own task-anchored private
 * thread (I10) while an `admins` anchor has exactly one.
 *
 * Concurrent calls are safe: both read the same index range, so Convex OCC
 * serializes them and the loser re-runs and finds the winner's row. The
 * agent's runPermission must fit the owner's role (an admins-only agent never
 * gets a member-owned thread).
 *
 * INTERNAL: server code (job registry, email pipeline) decides anchors. The
 * owner must be a current org member; an `admins` thread's owner must be an
 * admin (it is the nominal owner — any admin may act in it).
 */
export const ensureAnchoredThread = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    anchor: threadAnchorValidator,
    visibility: threadVisibilityValidator,
    ownerUserId: v.id("users"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"agentThreads">> =>
    await ensureAnchoredThreadCore(ctx, args),
});

/**
 * The body of `ensureAnchoredThread`, callable inside another mutation (the
 * agent job start, convex/agentJobs.ts) so the thread lands in the same
 * transaction as the actor check.
 */
export async function ensureAnchoredThreadCore(
  ctx: MutationCtx,
  args: {
    orgId: string;
    agentId: Id<"agents">;
    anchor: { type: string; id: string };
    visibility: ThreadVisibility;
    ownerUserId: Id<"users">;
    title?: string;
  },
): Promise<Id<"agentThreads">> {
  const agent = await ctx.db.get(args.agentId);
  if (!agent || agent.orgId !== args.orgId || agent.archivedAt) {
    throw new ConvexError("Agent not found");
  }
  const owner = await loadAuthContextForActor(ctx, {
    orgId: args.orgId,
    userId: args.ownerUserId,
  });
  if (args.visibility === "admins" && !owner.isAdmin) {
    throw new ConvexError("An admins thread must be owned by an admin");
  }
  if (agent.runPermission === "admins" && !owner.isAdmin) {
    throw new ConvexError("This agent can only run in an admin's thread");
  }

  // Exact key through the index: (org, anchor, agent, visibility) for an
  // `admins` thread, plus the owner for a private one.
  const byKey = ctx.db
    .query("agentThreads")
    .withIndex("by_orgId_anchorType_anchorId_agentId_visibility_userId", (q) => {
      const prefix = q
        .eq("orgId", args.orgId)
        .eq("anchor.type", args.anchor.type)
        .eq("anchor.id", args.anchor.id)
        .eq("agentId", args.agentId)
        .eq("visibility", args.visibility);
      return args.visibility === "private"
        ? prefix.eq("userId", args.ownerUserId)
        : prefix;
    });
  const existing = await byKey.first();
  if (existing) return existing._id;

  const title = args.title?.trim().slice(0, 120) || UNTITLED_THREAD;
  const componentThreadId = await createComponentThread(
    ctx,
    components.agent,
    { userId: args.ownerUserId, title },
  );
  const now = Date.now();
  return await ctx.db.insert("agentThreads", {
    orgId: args.orgId,
    componentThreadId,
    agentId: agent._id,
    userId: args.ownerUserId,
    title,
    status: "idle",
    lastActivityAt: now,
    createdAt: now,
    visibility: args.visibility,
    anchor: { type: args.anchor.type, id: args.anchor.id },
  });
}
