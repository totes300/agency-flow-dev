import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { loadContent, requestExtraction } from "../attachmentContents";
import { findLiveItem, joinItem, openAttentions, openItem } from "../agentItems";
import {
  clientRequestConstraintValidator,
  clientRequestIntentValidator,
  clientRequestWarningValidator,
  emailIntentValidator,
  emailSenderScreenValidator,
} from "../lib/validators";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { stripQuoted } from "./model";
import {
  acknowledgeClassification,
  constraintWarnings,
  deterministicLayer,
  hasNewRecipient,
  type ClassificationResult,
  type ClassifyInput,
  type DeterministicLayer,
} from "./classify";
import { applyLedgerRequests } from "./requests";
import { dispatchMessage, isMailboxOwnerAdmin, resolveLinkedTask } from "./triage";
import { isClosedCategory } from "../tasks/model";

/**
 * The inbound stage machine (docs/prd-email-triage.md I5, §5.2 steps 2–7,
 * §5.3). Every inbound message moves
 *
 *   received ──extract──▶ extracted ──classify──▶ classified ──dispatch──▶ handled
 *        └──────────── 3 failed attempts of one stage ────────────▶ failed (+ attention item)
 *
 * `processInboundMessage(messageId)` is THE entry point (B3's ingest
 * schedules it; the dev seed's `process` too). Each call runs the step of
 * the message's CURRENT stage and schedules the next call, so a stage is
 * re-entrant and retried on its own:
 *
 *   received   request extraction for every attachment with a `storageId`
 *              (`attachmentContents.requestExtraction`, idempotent per file);
 *              while one is `pending`, a scheduled re-check after a growing
 *              delay (no busy polling); after the last re-check it advances
 *              anyway — the attachment stays visibly unresolved (I5).
 *   extracted  deterministic layer first (hard triggers, the acknowledge
 *              shortcut — no model call for a pure thank-you); otherwise the
 *              `classify.classifyMessage` action (screenSender →
 *              classifyInbound → checkCompleteness) with a watchdog, whose
 *              result `applyClassification` writes: ledger rows + stage.
 *   classified `triage.dispatchMessage` (§5.3) → handled.
 *
 * Failures: a step that throws is caught (mutation steps run as a nested
 * subtransaction, so their writes roll back) and recorded on `stageError`
 * with the stage's attempt count; attempts 1–2 retry after a backoff, the
 * 3rd marks the message `failed` and opens (or joins) the conversation's
 * `attention` item — `retryStage` restarts the failed stage. The attempt
 * number travels with the model action, so a late report of an attempt that
 * was already counted (e.g. after its watchdog fired) is ignored.
 *
 * Lost work (a crashed action, a dropped schedule): every stage write stamps
 * `stageAt`; the 10-minute `sweepStuckMessages` cron re-kicks a message with
 * no progress for 30 minutes.
 *
 * Idempotent throughout: every write is guarded by the stage it leaves (a
 * re-run of a finished stage is a no-op), ledger rows are keyed by message,
 * items by `messageIds`, notifications deduped. Every entry point checks
 * `emailTriageEnabled` (I14).
 */

export const MAX_STAGE_ATTEMPTS = 3;
/** Backoff before attempt 2 and attempt 3 of a stage. */
export const STAGE_BACKOFF_MS = [30_000, 120_000] as const;
/** The model stage counts as failed when its action has not reported by then. */
export const CLASSIFY_WATCHDOG_MS = 10 * 60_000;
/** Re-checks while an attachment is still being read (≈ 9 min in total). */
export const ATTACHMENT_POLL_MS = [10_000, 20_000, 40_000, 60_000, 120_000, 300_000] as const;

const HISTORY_CAP = 6;
const HISTORY_TEXT_CAP = 1_500;
const MESSAGE_TEXT_CAP = 20_000;
const ATTACHMENT_TEXT_CAP = 4_000;
const ATTACHMENT_TEXT_TOTAL_CAP = 12_000;
const LEDGER_CAP = 40;
const SUBTASK_CAP = 30;

type Stage = Doc<"emailMessages">["stage"];
type WorkStage = "received" | "extracted" | "classified";
const WORK_STAGES: readonly WorkStage[] = ["received", "extracted", "classified"];
const isWorkStage = (s: string | undefined): s is WorkStage => WORK_STAGES.includes(s as WorkStage);

const pipelineArgs = {
  messageId: v.id("emailMessages"),
  // DEV seed only (email/fakeClassifier.ts); ignored for real mailboxes.
  fakeModel: v.optional(v.boolean()),
  // Attachment re-check number (received stage).
  poll: v.optional(v.number()),
};

function sanitize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

/** The message's Retry generation (0 until the first Retry). */
export const generationOf = (message: Pick<Doc<"emailMessages">, "stageGeneration">) => message.stageGeneration ?? 0;

/** The attempt number the message's current stage is on (1-based). */
export function currentAttempt(message: Pick<Doc<"emailMessages">, "stageError">, stage: string): number {
  return (message.stageError?.stage === stage ? message.stageError.attempts : 0) + 1;
}

async function scheduleNext(
  ctx: MutationCtx,
  messageId: Id<"emailMessages">,
  opts: { fakeModel?: boolean; delayMs?: number; poll?: number } = {},
): Promise<void> {
  await ctx.scheduler.runAfter(opts.delayMs ?? 0, internal.email.pipeline.processInboundMessage, {
    messageId,
    fakeModel: opts.fakeModel,
    poll: opts.poll,
  });
}

// ─── Entry points ─────────────────────────────────────────────────────────────

/**
 * Run the current stage's step of an inbound message. Throws when the org
 * does not have the feature (I14); a handled / failed message is a no-op.
 */
export const processInboundMessage = internalMutation({
  args: pipelineArgs,
  handler: async (ctx, args): Promise<{ stage: Stage | null }> => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return { stage: null };
    await requireEmailTriageEnabled(ctx, message.orgId);
    const stage = message.stage;
    if (!isWorkStage(stage)) return { stage };
    try {
      await ctx.runMutation(internal.email.pipeline.runStage, { ...args, stage });
    } catch (err) {
      // The step's writes rolled back; count the failed attempt.
      await failStage(ctx, message, stage, sanitize(err), { fakeModel: args.fakeModel });
    }
    const after = await ctx.db.get(args.messageId);
    return { stage: after?.stage ?? null };
  },
});

/** The step itself — called only by `processInboundMessage` (a nested subtransaction). */
export const runStage = internalMutation({
  args: { ...pipelineArgs, stage: v.union(v.literal("received"), v.literal("extracted"), v.literal("classified")) },
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.stage !== args.stage) return null; // stale call
    await requireEmailTriageEnabled(ctx, message.orgId);
    if (args.stage === "received") await stepReceived(ctx, message, args);
    else if (args.stage === "extracted") await stepExtracted(ctx, message, args);
    else await stepClassified(ctx, message, args);
    return null;
  },
});

/**
 * Retry a `failed` message from the stage that failed (the attention item's
 * Retry, B8). Bumps the message's generation and clears its entry in the
 * item's attentions (other failed messages keep theirs); a later failure adds
 * it again. A message that is not failed is left alone.
 */
export const retryStage = internalMutation({
  args: { messageId: v.id("emailMessages"), fakeModel: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ retried: boolean; stage: Stage }> =>
    await retryStageCore(ctx, args.messageId, { fakeModel: args.fakeModel }),
});

/** The body of `retryStage` — also Triage's Retry on an attention (email/triageView.ts). */
export async function retryStageCore(
  ctx: MutationCtx,
  messageId: Id<"emailMessages">,
  opts: { fakeModel?: boolean } = {},
): Promise<{ retried: boolean; stage: Stage }> {
  const message = await ctx.db.get(messageId);
  if (!message) throw new ConvexError("Message not found");
  await requireEmailTriageEnabled(ctx, message.orgId);
  if (message.stage !== "failed") return { retried: false, stage: message.stage };
  const stage: WorkStage = isWorkStage(message.stageError?.stage) ? message.stageError.stage : "received";
  // A new generation: watchdogs and late reports of the failed attempts are void.
  await ctx.db.patch(message._id, {
    stage,
    stageError: undefined,
    stageAt: Date.now(),
    stageGeneration: generationOf(message) + 1,
  });
  // Clear only THIS message's attention; other failed messages stay open.
  const live = await findLiveItem(ctx, message.orgId, { type: "emailThread", id: message.threadId });
  const attentions = live ? openAttentions(live) : [];
  if (live && attentions.some((a) => a.messageId === message._id)) {
    const rest = attentions.filter((a) => a.messageId !== message._id);
    await ctx.db.patch(live._id, { attentions: rest.length > 0 ? rest : undefined, updatedAt: Date.now() });
  }
  await scheduleNext(ctx, message._id, { fakeModel: opts.fakeModel });
  return { retried: true, stage };
}

/** A failed attempt reported by the model action (stale attempts are ignored). */
export const recordStageFailure = internalMutation({
  args: {
    messageId: v.id("emailMessages"),
    stage: v.string(),
    attempt: v.optional(v.number()),
    generation: v.optional(v.number()),
    error: v.string(),
    fakeModel: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || !(await isEmailTriageEnabled(ctx, message.orgId))) return null;
    await failStage(ctx, message, args.stage, args.error, {
      attempt: args.attempt,
      generation: args.generation,
      fakeModel: args.fakeModel,
    });
    return null;
  },
});

/** The model attempt never reported (crash, timeout): count it as failed. */
export const stageWatchdog = internalMutation({
  args: {
    messageId: v.id("emailMessages"),
    stage: v.string(),
    attempt: v.number(),
    generation: v.optional(v.number()),
    fakeModel: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || !(await isEmailTriageEnabled(ctx, message.orgId))) return null;
    await failStage(ctx, message, args.stage, "The classification did not finish in time", {
      attempt: args.attempt,
      generation: args.generation ?? 0,
      fakeModel: args.fakeModel,
    });
    return null;
  },
});

// ─── Stuck-stage sweep (cron) ─────────────────────────────────────────────────

/** A message in a work stage with no progress for this long is re-kicked. */
export const STUCK_AFTER_MS = 30 * 60_000;
/** Messages re-kicked per sweep run (the next run, 10 min later, takes the rest). */
export const SWEEP_BATCH = 100;
const SWEEP_ORGS_CAP = 100;

/**
 * Every 10 minutes (convex/crons.ts): an inbound message still in
 * `received` / `extracted` / `classified` whose last progress (`stageAt`,
 * else `createdAt` on rows from before the field) is older than 30 minutes
 * lost its scheduled work (a crashed action, a dropped schedule) —
 * `processInboundMessage` is scheduled for it again. Safe because every step
 * is guarded by its stage; `stageAt` is stamped on the re-kick, so a message
 * is re-kicked at most once per 30 minutes. Orgs without the flag are never
 * read (I14), every read is an index range, the batch is capped. A stuck
 * outbound message goes straight to `handled`; dev-seed messages are only
 * stamped (they are driven by `devSeedEmail:process`) — both leave the window.
 */
export const sweepStuckMessages = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ touched: number; rescheduled: number }> => {
    const now = Date.now();
    const cutoff = now - STUCK_AFTER_MS;
    const orgs = await ctx.db
      .query("orgSettings")
      .withIndex("by_emailTriageEnabled", (q) => q.eq("emailTriageEnabled", true))
      .take(SWEEP_ORGS_CAP);
    const devSeed = new Map<Id<"connectors">, boolean>();
    const isDevSeed = async (connectorId: Id<"connectors">) => {
      if (!devSeed.has(connectorId)) devSeed.set(connectorId, (await ctx.db.get(connectorId))?.devSeed === true);
      return devSeed.get(connectorId)!;
    };
    let touched = 0;
    let rescheduled = 0;
    for (const org of orgs) {
      for (const stage of WORK_STAGES) {
        const left = SWEEP_BATCH - touched;
        if (left <= 0) return { touched, rescheduled };
        // Rows without `stageAt` (written before it existed) sort first: judge them by createdAt.
        const legacy = (
          await ctx.db
            .query("emailMessages")
            .withIndex("by_orgId_stage_stageAt", (q) =>
              q.eq("orgId", org.orgId).eq("stage", stage).eq("stageAt", undefined),
            )
            .take(left)
        ).filter((m) => m.createdAt < cutoff);
        const stale = await ctx.db
          .query("emailMessages")
          .withIndex("by_orgId_stage_stageAt", (q) =>
            q.eq("orgId", org.orgId).eq("stage", stage).gt("stageAt", 0).lt("stageAt", cutoff),
          )
          .take(left);
        for (const message of [...legacy, ...stale].slice(0, left)) {
          touched++; // every touched row counts against the batch
          if (message.direction === "outbound") {
            // Our own mail needs no processing (the received step would do the same).
            await ctx.db.patch(message._id, { stage: "handled", stageError: undefined, stageAt: now });
            continue;
          }
          // Stamped either way, so a skipped row leaves the window and never starves the batch.
          await ctx.db.patch(message._id, { stageAt: now });
          if (await isDevSeed(message.connectorId)) continue;
          await scheduleNext(ctx, message._id);
          rescheduled++;
        }
      }
    }
    return { touched, rescheduled };
  },
});

// ─── Failure handling ─────────────────────────────────────────────────────────

async function failStage(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  stage: string,
  error: string,
  opts: { attempt?: number; generation?: number; fakeModel?: boolean },
): Promise<void> {
  const fresh = await ctx.db.get(message._id);
  if (!fresh || fresh.stage !== stage) return; // moved on meanwhile
  if (opts.generation !== undefined && opts.generation !== generationOf(fresh)) return; // before a Retry
  const attempt = currentAttempt(fresh, stage);
  if (opts.attempt !== undefined && opts.attempt !== attempt) return; // already counted
  const stageError = { stage, message: error.slice(0, 500) || "Unknown error", attempts: attempt };
  if (attempt < MAX_STAGE_ATTEMPTS) {
    await ctx.db.patch(fresh._id, { stageError, stageAt: Date.now() });
    await scheduleNext(ctx, fresh._id, { fakeModel: opts.fakeModel, delayMs: STAGE_BACKOFF_MS[attempt - 1] });
    return;
  }
  await ctx.db.patch(fresh._id, { stage: "failed", stageError, stageAt: Date.now() });
  // I5: never dropped — the conversation's item says which stage failed (Retry).
  const attention = { messageId: fresh._id, ...stageError, at: Date.now() };
  const anchor = { type: "emailThread", id: fresh.threadId as string };
  const live = await findLiveItem(ctx, fresh.orgId, anchor);
  if (live) {
    const attentions = [...openAttentions(live).filter((a) => a.messageId !== fresh._id), attention];
    await joinItem(ctx, live, { messageId: fresh._id, replan: false, patch: { attentions } });
  } else {
    await openItem(ctx, {
      orgId: fresh.orgId,
      source: "email",
      anchor,
      kind: "attention",
      status: "open",
      messageIds: [fresh._id],
      attentions: [attention],
    });
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

/** Minimal HTML → text for a body that arrived without a plain-text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function stepReceived(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  args: { fakeModel?: boolean; poll?: number },
): Promise<void> {
  if (message.direction === "outbound") {
    // Our own mail is history, not something to triage.
    await ctx.db.patch(message._id, { stage: "handled", stageError: undefined, stageAt: Date.now() });
    return;
  }
  if (!message.bodyText.trim() && message.bodyHtml) {
    const text = stripQuoted(htmlToText(message.bodyHtml), { subject: message.subject }).text;
    await ctx.db.patch(message._id, { bodyText: text });
  }
  let pending = false;
  for (const att of message.attachments) {
    if (!att.storageId) continue; // not downloaded — nothing to read (stays unresolved)
    await requestExtraction(ctx, { orgId: message.orgId, storageId: att.storageId, mimeType: att.mime, name: att.name });
    const content = await loadContent(ctx, message.orgId, att.storageId);
    if (content?.status === "pending") pending = true;
  }
  const poll = args.poll ?? 0;
  if (pending && poll < ATTACHMENT_POLL_MS.length) {
    await scheduleNext(ctx, message._id, { fakeModel: args.fakeModel, delayMs: ATTACHMENT_POLL_MS[poll], poll: poll + 1 });
    return;
  }
  await ctx.db.patch(message._id, { stage: "extracted", stageError: undefined, stageAt: Date.now() });
  await scheduleNext(ctx, message._id, { fakeModel: args.fakeModel });
}

async function stepExtracted(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  args: { fakeModel?: boolean },
): Promise<void> {
  if (await copyClassificationOfDuplicate(ctx, message, args)) return;
  const layer = await deterministicFor(ctx, message);
  if (layer.acknowledge) {
    // §6.3: a short pure thank-you with no trigger — no model call.
    await writeClassification(ctx, message, acknowledgeClassification(), layer, args);
    return;
  }
  const attempt = currentAttempt(message, "extracted");
  const generation = generationOf(message);
  await ctx.scheduler.runAfter(0, internal.email.classify.classifyMessage, {
    messageId: message._id,
    attempt,
    generation,
    fakeModel: args.fakeModel,
  });
  await ctx.scheduler.runAfter(CLASSIFY_WATCHDOG_MS, internal.email.pipeline.stageWatchdog, {
    messageId: message._id,
    stage: "extracted",
    attempt,
    generation,
    fakeModel: args.fakeModel,
  });
}

async function stepClassified(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  args: { fakeModel?: boolean },
): Promise<void> {
  // `fakeModel` reaches the planner too (B6a: canned plans for seed mailboxes).
  await dispatchMessage(ctx, message, { fakeModel: args.fakeModel });
  await ctx.db.patch(message._id, { stage: "handled", stageError: undefined, stageAt: Date.now() });
}

// ─── Classification write ─────────────────────────────────────────────────────

const classificationResultValidator = v.object({
  intents: v.array(emailIntentValidator),
  reasons: v.array(v.string()),
  urgent: v.boolean(),
  approveAction: v.optional(v.string()),
  source: v.union(v.literal("rules"), v.literal("model"), v.literal("fake")),
  senderScreen: v.optional(emailSenderScreenValidator),
  requests: v.array(
    v.object({
      text: v.string(),
      constraints: v.array(clientRequestConstraintValidator),
      intent: clientRequestIntentValidator,
      refersToRequestId: v.optional(v.union(v.string(), v.null())),
      warnings: v.optional(v.array(clientRequestWarningValidator)),
    }),
  ),
});

/** The model action's result → ledger + classification + stage `classified`. */
export const applyClassification = internalMutation({
  args: {
    messageId: v.id("emailMessages"),
    result: classificationResultValidator,
    generation: v.optional(v.number()),
    fakeModel: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.stage !== "extracted") return { applied: false }; // already written
    // A result from before a Retry: the current generation's attempt writes instead.
    if (args.generation !== undefined && args.generation !== generationOf(message)) return { applied: false };
    await requireEmailTriageEnabled(ctx, message.orgId);
    if (await copyClassificationOfDuplicate(ctx, message, args)) return { applied: true };
    await writeClassification(ctx, message, args.result, await deterministicFor(ctx, message), args);
    return { applied: true };
  },
});

async function writeClassification(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  result: ClassificationResult,
  layer: DeterministicLayer,
  args: { fakeModel?: boolean },
): Promise<void> {
  const thread = await ctx.db.get(message.threadId);
  if (!thread || thread.orgId !== message.orgId) throw new ConvexError("Conversation not found");
  // The verbatim haystack: subject, body and the extracted attachment texts.
  const attachmentTexts: string[] = [];
  for (const att of message.attachments) {
    if (!att.storageId) continue;
    const content = await loadContent(ctx, message.orgId, att.storageId);
    if (content?.status === "done" && content.text) attachmentTexts.push(content.text);
  }
  const sourceText = [message.subject, message.bodyText, ...attachmentTexts].join("\n");
  const requests = result.requests.map((r) => ({
    ...r,
    warnings: [...(r.warnings ?? []), ...constraintWarnings(r, sourceText)],
  }));
  if (requests.length > 0) {
    await applyLedgerRequests(ctx, {
      orgId: message.orgId,
      clientId: thread.clientId,
      threadId: thread._id,
      messageId: message._id,
      requests,
    });
  }
  await ctx.db.patch(message._id, {
    classification: {
      intents: result.intents,
      triggers: layer.triggers,
      reasons: result.reasons,
      urgent: result.urgent || layer.urgentPhrase !== null,
      approveAction: result.approveAction,
      source: result.source,
      senderScreen: result.senderScreen,
    },
    stage: "classified",
    stageError: undefined,
    stageAt: Date.now(),
  });
  await scheduleNext(ctx, message._id, { fakeModel: args.fakeModel });
}

/**
 * I1: the same email in a colleague's mailbox (same `rfcMessageId`) is one
 * item — when another copy is already classified, reuse it (no model call,
 * no ledger rows) and let dispatch skip it.
 */
async function copyClassificationOfDuplicate(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  args: { fakeModel?: boolean },
): Promise<boolean> {
  const copies = await ctx.db
    .query("emailMessages")
    .withIndex("by_orgId_rfcMessageId", (q) => q.eq("orgId", message.orgId).eq("rfcMessageId", message.rfcMessageId))
    .take(10);
  const original = copies.find(
    (c) => c._id !== message._id && c.classification && !c.classification.duplicateOf,
  );
  if (!original?.classification) return false;
  await ctx.db.patch(message._id, {
    classification: { ...original.classification, duplicateOf: original._id },
    stage: "classified",
    stageError: undefined,
    stageAt: Date.now(),
  });
  await scheduleNext(ctx, message._id, { fakeModel: args.fakeModel });
  return true;
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

/** Earlier messages of the conversation, oldest first (bounded). */
async function previousMessages(
  ctx: QueryCtx,
  message: Doc<"emailMessages">,
  limit: number,
): Promise<Doc<"emailMessages">[]> {
  const rows = await ctx.db
    .query("emailMessages")
    .withIndex("by_orgId_threadId_sentAt", (q) =>
      q.eq("orgId", message.orgId).eq("threadId", message.threadId).lt("sentAt", message.sentAt),
    )
    .order("desc")
    .take(limit);
  return rows.reverse();
}

async function deterministicFor(ctx: QueryCtx, message: Doc<"emailMessages">): Promise<DeterministicLayer> {
  const history = await previousMessages(ctx, message, 20);
  return deterministicLayer({
    text: message.bodyText,
    subject: message.subject,
    hasAttachment: message.attachments.length > 0,
    newRecipient: hasNewRecipient(message, history),
  });
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function attachmentSummary(content: Doc<"attachmentContents"> | null): string | null {
  if (!content) return "not downloaded";
  switch (content.status) {
    case "pending":
      return "still being read";
    case "unsupported":
    case "failed":
      return `unreadable (${content.error ?? content.status})`;
    case "done": {
      const parts: string[] = [];
      if (content.pageCount) parts.push(`${content.pageCount} pages`);
      if (content.width && content.height) parts.push(`image ${content.width}×${content.height}`);
      if (content.truncated) parts.push("text truncated");
      return parts.length > 0 ? parts.join(", ") : null;
    }
  }
}

/** Everything the model stage reads, or null when there is nothing to do. */
export const loadClassifyInput = internalQuery({
  args: { messageId: v.id("emailMessages") },
  handler: async (ctx, args): Promise<ClassifyInput | null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.stage !== "extracted") return null;
    if (!(await isEmailTriageEnabled(ctx, message.orgId))) return null;
    const thread = await ctx.db.get(message.threadId);
    if (!thread || thread.orgId !== message.orgId) return null;
    const connector = await ctx.db.get(thread.connectorId);
    const linked = await resolveLinkedTask(ctx, thread, [thread.subject, message.subject]);
    const needsScreen = !thread.clientId && !linked && (await isMailboxOwnerAdmin(ctx, thread));
    const client = thread.clientId ? await ctx.db.get(thread.clientId) : null;

    let linkedTask: ClassifyInput["prompt"]["linkedTask"] = null;
    if (linked) {
      const status = await ctx.db.get(linked.task.statusId);
      const subtasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", message.orgId).eq("parentTaskId", linked.task._id))
        .take(SUBTASK_CAP);
      linkedTask = {
        identifier: linked.task.identifier,
        title: linked.task.title,
        status: status?.name ?? "",
        subtasks: subtasks
          .filter((s) => !s.archivedAt)
          .map((s) => ({ title: s.title, done: isClosedCategory(s.statusCategory) })),
      };
    }

    const ledger = (
      await ctx.db
        .query("clientRequests")
        .withIndex("by_orgId_threadId", (q) => q.eq("orgId", message.orgId).eq("threadId", thread._id))
        .take(LEDGER_CAP * 2)
    )
      .filter((r) => r.disposition !== "superseded" && r.disposition !== "dismissed")
      .slice(-LEDGER_CAP)
      .map((r) => ({ id: r._id as string, text: r.text, constraints: r.constraints ?? [], disposition: r.disposition }));

    let budget = ATTACHMENT_TEXT_TOTAL_CAP;
    const attachments: ClassifyInput["prompt"]["message"]["attachments"] = [];
    for (const att of message.attachments) {
      const content = att.storageId ? await loadContent(ctx, message.orgId, att.storageId) : null;
      let text: string | null = null;
      if (content?.status === "done" && content.text && budget > 0) {
        text = cap(content.text, Math.min(ATTACHMENT_TEXT_CAP, budget));
        budget -= text.length;
      }
      attachments.push({ name: att.name, mime: att.mime, summary: attachmentSummary(content), text });
    }

    const history = await previousMessages(ctx, message, HISTORY_CAP);
    const layer = await deterministicFor(ctx, message);
    return {
      orgId: message.orgId,
      threadId: thread._id,
      gmailMessageId: message.gmailMessageId,
      devSeed: connector?.devSeed === true,
      needsScreen,
      urgentPhrase: layer.urgentPhrase,
      prompt: {
        clientName: client && client.orgId === message.orgId ? client.name : null,
        message: {
          from: message.from,
          subject: message.subject,
          sentAt: new Date(message.sentAt).toISOString(),
          text: cap(message.bodyText, MESSAGE_TEXT_CAP),
          attachments,
        },
        threadHistory: history.map((h) => ({
          direction: h.direction,
          from: h.from.name ? `${h.from.name} <${h.from.email}>` : h.from.email,
          sentAt: new Date(h.sentAt).toISOString(),
          text: cap(h.bodyText, HISTORY_TEXT_CAP),
        })),
        linkedTask,
        ledger,
        hardTriggers: layer.triggers,
      },
    };
  },
});
