import { v, ConvexError } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { closeEmailItem } from "../agentItems";
import { loadTaskForWrite } from "../tasks/access";
import { defaultStatusFor, updateTask } from "../tasks/write";
import { cancelScheduled, RESET_SEND_FIELDS } from "./drafts";
import { requestPlanning, PREPARE_TASK_JOB } from "./prepare";
import { assertDecidable, loadEmailItemForAdmin } from "./items";

/**
 * The small Triage decisions (docs/prd-email-triage.md D32, Q7;
 * implementation plan B6b). Admin-only (role from orgMembers), org-checked,
 * behind the flag — `loadEmailItemForAdmin`.
 *
 *   markApprovalDone     D32: "Réka approved PRG-132" → the task moves to the
 *                        org's default done status through tasks/write.ts
 *                        (the I3 / I9 gates apply); outcome `marked_done`
 *   keepInClientReview   D32: nothing changes on the task; outcome `kept`
 *   convertQuestionToTask Q7: "Make it a task instead" — the reply draft is
 *                        discarded and prepareTask re-runs with a flag that
 *                        forbids a reply-only plan
 */

function assertApproval(item: Doc<"agentItems">): void {
  assertDecidable(item);
  if (item.kind !== "approval") throw new ConvexError("This item is not a client approval.");
}

export async function markApprovalDoneCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; item: Doc<"agentItems">; thread: Doc<"emailThreads"> },
): Promise<null> {
  const { auth, item, thread } = args;
  assertApproval(item);
  if (!item.taskId) throw new ConvexError("This approval has no linked task.");
  const access = await loadTaskForWrite(ctx, item.taskId, auth);
  const done = await defaultStatusFor(ctx, auth.orgId, ["completed"]);
  if (access.task.statusId !== done.status._id) await updateTask(ctx, access, { statusId: done.status._id });
  await ctx.db.patch(thread._id, { waitingOn: "none", updatedAt: Date.now() });
  await closeEmailItem(ctx, item, { outcome: "marked_done", userId: auth.userId });
  return null;
}

export const markApprovalDone = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<null> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    return await markApprovalDoneCore(ctx, { auth, item, thread });
  },
});

export const keepInClientReview = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<null> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    assertApproval(item);
    await ctx.db.patch(thread._id, { waitingOn: "none", updatedAt: Date.now() });
    await closeEmailItem(ctx, item, { outcome: "kept", userId: auth.userId });
    return null;
  },
});

export const convertQuestionToTask = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ result: string }> => {
    const { item } = await loadEmailItemForAdmin(ctx, args.itemId);
    assertDecidable(item);
    if (item.commit) throw new ConvexError("This item was already created.");
    if (item.kind !== "question" && !item.plan?.reply) throw new ConvexError("Only a question with a reply can become a task.");
    const now = Date.now();
    const draft = item.draftId ? await ctx.db.get(item.draftId) : null;
    if (draft && draft.orgId === item.orgId && (draft.status === "draft" || draft.status === "failed" || draft.status === "queued")) {
      await cancelScheduled(ctx, draft.scheduledFnId);
      await ctx.db.patch(draft._id, { ...RESET_SEND_FIELDS, status: "discarded", updatedAt: now });
    }
    await ctx.db.patch(item._id, { forbidReply: true, draftId: undefined, updatedAt: now });
    return { result: await requestPlanning(ctx, item._id, { trigger: "retry", messageIds: [], job: PREPARE_TASK_JOB }) };
  },
});
