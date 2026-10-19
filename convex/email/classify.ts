import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { runLlmStep, type LlmStepJob } from "../lib/agentJobs";
import {
  detectUrgency,
  hardTriggers,
  isAcknowledgeCandidate,
  isForwardSubject,
  normalizeSubject,
  type EmailAddress,
} from "./model";
import {
  checkCompletenessJob,
  classifyInboundJob,
  screenSenderJob,
  type CheckCompletenessOutput,
  type ClassifyInboundOutput,
  type Intent,
  type ModelRequest,
  type ScreenSenderOutput,
} from "./jobs";
import type { LedgerRequestInput, LedgerWarning } from "./requests";
import { fakeModelOutputs } from "./fakeClassifier";

/**
 * Classification of one inbound message (docs/prd-email-triage.md §6.3, D4,
 * §6.1 completeness pass). Deterministic first, then the model:
 *
 *   1. `deterministicLayer` — hard triggers (D4) on the quote-stripped text
 *      and the acknowledge shortcut: a short pure thank-you with NO trigger
 *      is `acknowledge` without any model call (`acknowledgeClassification`).
 *   2. otherwise the `classifyMessage` action: `screenSender` first for an
 *      unknown sender in an admin's mailbox (D24), then `classifyInbound`,
 *      then `checkCompleteness` ("anything asked that has no row?"); the
 *      outputs are merged by `mergeModelOutputs` and written by
 *      `pipeline.applyClassification` (ledger + stage `classified`).
 *   3. code-side checks in the write: every constraint value must occur
 *      verbatim (whitespace-normalised) in the request text or the source
 *      email — a miss is a warning on the row, never a dropped row
 *      (`constraintWarnings`).
 */

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** What the classify stage hands to the write (`pipeline.applyClassification`). */
export type ClassificationResult = {
  intents: Intent[];
  reasons: string[];
  urgent: boolean;
  approveAction?: string;
  source: "rules" | "model" | "fake";
  senderScreen?: { possibleClient: boolean; reason: string };
  requests: LedgerRequestInput[];
};

export type DeterministicLayer = {
  triggers: string[];
  acknowledge: boolean;
  urgentPhrase: string | null;
};

// ─── Deterministic layer ──────────────────────────────────────────────────────

/** Addresses on a message that no earlier message of the thread had (D4 "a new recipient"). */
export function hasNewRecipient(
  message: { to: readonly EmailAddress[]; cc: readonly EmailAddress[] },
  history: ReadonlyArray<{ from: EmailAddress; to: readonly EmailAddress[]; cc: readonly EmailAddress[] }>,
  ownAddresses: readonly string[] = [],
): boolean {
  if (history.length === 0) return false;
  const seen = new Set<string>(ownAddresses.map((a) => a.toLowerCase()));
  for (const h of history) {
    for (const a of [h.from, ...h.to, ...h.cc]) seen.add(a.email.toLowerCase());
  }
  return [...message.to, ...message.cc].some((a) => !seen.has(a.email.toLowerCase()));
}

/** The trigger id of a forwarded email (`isForwardSubject`) — never a silent acknowledge. */
export const FORWARD_TRIGGER = "forward";

/**
 * D4 triggers + the §6.3 acknowledge shortcut + the urgency phrase, from code
 * only. Triggers are read from the body AND the subject (normalised, so a
 * "Re:" adds nothing); a forwarded email adds `forward`, so "Köszi!" above an
 * Outlook forward is never acknowledged by the rules.
 */
export function deterministicLayer(args: {
  text: string;
  subject?: string;
  hasAttachment: boolean;
  newRecipient: boolean;
}): DeterministicLayer {
  const triggers = hardTriggers(args.text, {
    hasAttachment: args.hasAttachment,
    newRecipient: args.newRecipient,
  });
  const subject = args.subject ? normalizeSubject(args.subject) : "";
  for (const t of subject ? hardTriggers(subject) : []) if (!triggers.includes(t)) triggers.push(t);
  if (isForwardSubject(args.subject)) triggers.push(FORWARD_TRIGGER);
  return {
    triggers,
    acknowledge: isAcknowledgeCandidate(args.text, triggers),
    urgentPhrase: detectUrgency(args.text) ?? (subject ? detectUrgency(subject) : null),
  };
}

export const ACKNOWLEDGE_REASON = "Only a thank-you — no request, question or change";

/** The model-free result of a pure thank-you. */
export function acknowledgeClassification(): ClassificationResult {
  return { intents: ["acknowledge"], reasons: [ACKNOWLEDGE_REASON], urgent: false, source: "rules", requests: [] };
}

/** An unknown sender the screen turned away (D24 → Filtered) — no classify call. */
export function screenedOutClassification(
  screen: { possibleClient: boolean; reason: string },
  source: "rules" | "model" | "fake",
): ClassificationResult {
  return {
    intents: [],
    reasons: [screen.reason || "Not a work request"],
    urgent: false,
    source,
    senderScreen: screen,
    requests: [],
  };
}

// ─── Merge (model outputs → one result) ───────────────────────────────────────

const collapse = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

function toLedgerRequest(r: ModelRequest): LedgerRequestInput {
  return {
    text: collapse(r.text),
    constraints: r.constraints
      .map((c) => ({ kind: collapse(c.kind).toLowerCase(), value: collapse(c.value) }))
      .filter((c) => c.kind && c.value),
    intent: r.intent,
    refersToRequestId: r.refersToRequestId,
  };
}

/**
 * classifyInbound + checkCompleteness → one result. Completeness rows are
 * appended (exact duplicates of an extracted text dropped); an approve with
 * an action becomes a ledger row when the model did not list one; the
 * request intents are folded into `intents`; urgency is the model's OR the
 * deterministic phrase (§6.1).
 */
export function mergeModelOutputs(args: {
  classify: ClassifyInboundOutput;
  completeness: CheckCompletenessOutput | null;
  urgentPhrase: string | null;
  source: "model" | "fake";
  senderScreen?: { possibleClient: boolean; reason: string };
}): ClassificationResult {
  const requests = args.classify.requests.map(toLedgerRequest).filter((r) => r.text);
  const seen = new Set(requests.map((r) => r.text.toLowerCase()));
  for (const extra of args.completeness?.missing ?? []) {
    const r = toLedgerRequest({ ...extra, refersToRequestId: null });
    if (!r.text || seen.has(r.text.toLowerCase())) continue;
    seen.add(r.text.toLowerCase());
    requests.push(r);
  }

  const approveRow = requests.find((r) => r.intent === "approve");
  const actionLabel = args.classify.approveHasAction.hasAction
    ? collapse(args.classify.approveHasAction.action ?? "") || approveRow?.text
    : approveRow?.text;
  if (args.classify.approveHasAction.hasAction && !approveRow && actionLabel) {
    requests.push({ text: actionLabel, constraints: [], intent: "approve" });
  }

  const intents: Intent[] = [];
  const addIntent = (i: Intent) => {
    if (!intents.includes(i)) intents.push(i);
  };
  for (const i of args.classify.intents) addIntent(i);
  for (const r of requests) addIntent(r.intent);
  if (actionLabel) addIntent("approve");

  const reasons = args.classify.reasons.map(collapse).filter(Boolean).slice(0, 3);
  return {
    intents,
    reasons: reasons.length > 0 ? reasons : [requests.length > 0 ? `${requests.length} request(s)` : "No clear intent"],
    urgent: args.classify.urgent || args.urgentPhrase !== null,
    approveAction: actionLabel || undefined,
    source: args.source,
    senderScreen: args.senderScreen,
    requests,
  };
}

// ─── Constraint verbatim check ────────────────────────────────────────────────

/** Whitespace-normalised, NFC — the only normalisation the verbatim check allows. */
export function normalizeForMatch(text: string): string {
  return collapse(text);
}

/**
 * Every constraint value must occur verbatim (whitespace-normalised) in the
 * request text or in the source email; each miss is one warning. The row is
 * kept either way.
 */
export function constraintWarnings(
  request: { text: string; constraints: ReadonlyArray<{ kind: string; value: string }> },
  sourceText: string,
): LedgerWarning[] {
  const haystacks = [normalizeForMatch(request.text), normalizeForMatch(sourceText)];
  const out: LedgerWarning[] = [];
  for (const c of request.constraints) {
    const needle = normalizeForMatch(c.value);
    if (!needle) continue;
    if (!haystacks.some((h) => h.includes(needle))) {
      out.push({ kind: "constraint_not_verbatim", detail: `${c.kind}: ${c.value}`.slice(0, 300) });
    }
  }
  return out;
}

// ─── Prompt inputs (JSON documents, every string untrusted) ───────────────────

export type ClassifyInput = {
  orgId: string;
  threadId: Id<"emailThreads">;
  gmailMessageId: string;
  devSeed: boolean;
  needsScreen: boolean;
  urgentPhrase: string | null;
  prompt: {
    clientName: string | null;
    message: {
      from: EmailAddress;
      subject: string;
      sentAt: string;
      text: string;
      attachments: Array<{ name: string; mime: string; summary: string | null; text: string | null }>;
    };
    threadHistory: Array<{ direction: "inbound" | "outbound"; from: string; sentAt: string; text: string }>;
    linkedTask: { identifier: string; title: string; status: string; subtasks: Array<{ title: string; done: boolean }> } | null;
    ledger: Array<{ id: string; text: string; constraints: Array<{ kind: string; value: string }>; disposition: string }>;
    hardTriggers: string[];
  };
};

function completenessPrompt(input: ClassifyInput, classify: ClassifyInboundOutput) {
  return {
    message: {
      subject: input.prompt.message.subject,
      text: input.prompt.message.text,
      attachments: input.prompt.message.attachments.map((a) => a.name),
    },
    extracted: classify.requests.map((r) => ({ text: r.text, constraints: r.constraints, intent: r.intent })),
  };
}

function screenPrompt(input: ClassifyInput) {
  const m = input.prompt.message;
  return { message: { from: m.from, subject: m.subject, text: m.text, attachments: m.attachments.map((a) => a.name) } };
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

// ─── The model stage ──────────────────────────────────────────────────────────

/**
 * The model part of the `extracted → classified` stage (I5). Scheduled by
 * `pipeline.runStage` with the stage's attempt number; a failure is reported
 * back with that number (`pipeline.recordStageFailure` ignores a stale one),
 * a crash or timeout is caught by the stage watchdog.
 *
 * `fakeModel` (dev seed only): canned outputs per seeded message
 * (email/fakeClassifier.ts) instead of model calls — honoured ONLY for a
 * message in a `devSeed` mailbox; a real message always uses the model.
 */
export const classifyMessage = internalAction({
  args: {
    messageId: v.id("emailMessages"),
    attempt: v.number(),
    // Retry generation the attempt belongs to (pipeline.generationOf).
    generation: v.optional(v.number()),
    fakeModel: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const input: ClassifyInput | null = await ctx.runQuery(internal.email.pipeline.loadClassifyInput, {
        messageId: args.messageId,
      });
      if (!input) return null; // stage moved on, message gone, or feature off
      const fake = args.fakeModel === true && input.devSeed ? fakeModelOutputs(input.gmailMessageId) : null;
      const source = fake ? "fake" : "model";
      const anchor = { type: "emailThread", id: input.threadId as string };
      const step = async <T>(job: LlmStepJob<T>, prompt: unknown): Promise<T> =>
        await runLlmStep(ctx, { job, orgId: input.orgId, input: prompt, anchor });

      let senderScreen: ScreenSenderOutput | undefined;
      if (input.needsScreen) {
        senderScreen = fake ? fake.screen : await step(screenSenderJob, screenPrompt(input));
        if (!senderScreen.possibleClient) {
          await ctx.runMutation(internal.email.pipeline.applyClassification, {
            messageId: args.messageId,
            generation: args.generation,
            result: screenedOutClassification(senderScreen, source),
          });
          return null;
        }
      }
      const classify = fake ? fake.classify : await step(classifyInboundJob, input.prompt);
      const completeness = fake ? fake.completeness : await step(checkCompletenessJob, completenessPrompt(input, classify));
      const result = mergeModelOutputs({
        classify,
        completeness,
        urgentPhrase: input.urgentPhrase,
        source,
        senderScreen,
      });
      await ctx.runMutation(internal.email.pipeline.applyClassification, {
        messageId: args.messageId,
        generation: args.generation,
        result,
      });
    } catch (err) {
      await ctx.runMutation(internal.email.pipeline.recordStageFailure, {
        messageId: args.messageId,
        stage: "extracted",
        attempt: args.attempt,
        generation: args.generation ?? 0,
        error: sanitizeError(err),
        fakeModel: args.fakeModel,
      });
    }
    return null;
  },
});
