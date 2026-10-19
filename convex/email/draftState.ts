import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Draft send-state helpers with no imports of their own (B6b), so the
 * attention queue (agentItems.ts) can discard an item's unsent draft when it
 * closes without importing the draft module. Re-exported by email/drafts.ts.
 */

/**
 * The fields that take a draft back to `draft` with no approval (D9): an
 * edit, Undo, a stale message, a refused dispatch. Cancels nothing itself.
 */
export const RESET_SEND_FIELDS = {
  status: "draft",
  approval: undefined,
  sendAt: undefined,
  scheduledFnId: undefined,
  messageIdHeader: undefined,
  sendAttempts: undefined,
  dispatchingAt: undefined,
  unknownSince: undefined,
  autoRetryAt: undefined,
  failure: undefined,
} as const;

/** Cancel a scheduled dispatch / retry; a finished or missing job is fine. */
export async function cancelScheduled(ctx: MutationCtx, id: Id<"_scheduled_functions"> | undefined): Promise<void> {
  if (!id) return;
  try {
    await ctx.scheduler.cancel(id);
  } catch {
    // Already ran / cancelled — the claim's identity check refuses it anyway.
  }
}

/** Draft states not yet handed to Gmail — an unsent draft that may still be discarded. */
export const UNSENT_DRAFT_STATES: ReadonlySet<string> = new Set(["draft", "queued", "failed"]);

/** Discard an unsent draft (cancelling its scheduled send); anything else is left alone. Returns whether it did. */
export async function discardUnsentDraft(ctx: MutationCtx, draftId: Id<"emailDrafts"> | undefined): Promise<boolean> {
  const draft = draftId ? await ctx.db.get(draftId) : null;
  if (!draft || !UNSENT_DRAFT_STATES.has(draft.status)) return false;
  await cancelScheduled(ctx, draft.scheduledFnId);
  await ctx.db.patch(draft._id, { ...RESET_SEND_FIELDS, status: "discarded", updatedAt: Date.now() });
  return true;
}
