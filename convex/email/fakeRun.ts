import { saveMessages } from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuthContext } from "../lib/auth";

/**
 * DEV seed path (B6a/B6b canned outputs, B8a): post a canned job turn — the
 * machine prompt, the tool calls with their markers, the summary — AND the
 * `agentRuns` row a real background job run would have (`job`, `via:
 * "background"`, `devFake`). The thread view keys on that row exactly as on a
 * real run: the prompt is a background job's input, never a user turn, and
 * the turn renders as the job's run line plus its deliverable.
 *
 * The row is written `succeeded` and its window is set to the saved
 * messages' creation times, so every message of the turn falls inside it.
 * The canned prompt's message id is recorded as `promptMessageId` — the
 * thread view hides exactly that message. It never looks like a live run to
 * the code that checks for one (re-plan in flight, the asking run).
 */
export async function saveFakeJobTurn(
  ctx: MutationCtx,
  args: { thread: Doc<"agentThreads">; auth: AuthContext; job: string; messages: ModelMessage[] },
): Promise<void> {
  const now = Date.now();
  const runId = await ctx.db.insert("agentRuns", {
    orgId: args.thread.orgId,
    threadId: args.thread._id,
    agentId: args.thread.agentId,
    userId: args.auth.userId,
    actorIsAdmin: args.auth.isAdmin,
    via: "background",
    job: args.job,
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    devFake: true,
  });
  const { messages } = await saveMessages(ctx, components.agent, {
    threadId: args.thread.componentThreadId,
    userId: args.auth.userId,
    agentName: "Email assistant",
    messages: args.messages,
  });
  const times = messages.map((m) => m._creationTime);
  const prompt = messages.find((m) => m.message?.role === "user");
  await ctx.db.patch(runId, {
    startedAt: Math.min(now, ...times),
    finishedAt: Math.max(now, ...times),
    ...(prompt ? { promptMessageId: prompt._id } : {}),
  });
}
