/**
 * The email `llm_step` jobs (docs/prd-email-triage.md §5.1, §6, §6.3, D24;
 * implementation plan §2 S1, §3 P2). Registered in the production job
 * registry (`convex/lib/agentJobs.ts` AGENT_JOBS) and run with `runLlmStep`
 * from the classify action (email/classify.ts).
 *
 * All four use the cheap Claude tier: one short structured call each, no
 * tools, no thread. `EMAIL_TRIAGE_MODEL` must stay in the allowlist
 * (lib/agents/modelSlug.ts) — `validateAgentJob` checks it at load time.
 *
 * Structured-output schemas use `nullable` (never `optional`) for absent
 * values: every field is always present, which keeps provider JSON schemas
 * strict.
 */

import { z } from "zod";
import type { AgentRunJob, LlmStepJob } from "../lib/agentJobs";
import { DRAFT_REPLY_TOOLS, PREPARE_CHANGE_TOOLS, PREPARE_TASK_TOOLS } from "../lib/systemAgents";
import {
  DRAFT_REPLY_INSTRUCTIONS,
  PREPARE_CHANGE_INSTRUCTIONS,
  PREPARE_TASK_INSTRUCTIONS,
  CHECK_COMPLETENESS_INSTRUCTIONS,
  CLASSIFY_INBOUND_INSTRUCTIONS,
  EXTRACT_PROMISES_INSTRUCTIONS,
  SCREEN_SENDER_INSTRUCTIONS,
} from "./prompts";

/** Claude Haiku 4.5 — the cheapest allowlisted model; enough for classification. */
export const EMAIL_TRIAGE_MODEL = "anthropic/claude-haiku-4.5";

export const INTENTS = ["add", "clarify", "replace", "cancel", "approve", "ask", "acknowledge"] as const;
export const REQUEST_INTENTS = ["add", "clarify", "replace", "cancel", "approve", "ask"] as const;
export type Intent = (typeof INTENTS)[number];
export type RequestIntent = (typeof REQUEST_INTENTS)[number];

const constraintSchema = z.object({
  kind: z.string().min(1).max(40),
  value: z.string().min(1).max(300),
});

export const requestSchema = z.object({
  text: z.string().min(1).max(2000),
  constraints: z.array(constraintSchema).max(20),
  intent: z.enum(REQUEST_INTENTS),
  refersToRequestId: z.string().max(64).nullable(),
});
export type ModelRequest = z.infer<typeof requestSchema>;

export const classifyInboundSchema = z.object({
  intents: z.array(z.enum(INTENTS)).max(7),
  requests: z.array(requestSchema).max(40),
  approveHasAction: z.object({
    hasAction: z.boolean(),
    action: z.string().max(200).nullable(),
  }),
  reasons: z.array(z.string().max(200)).max(4),
  urgent: z.boolean(),
});
export type ClassifyInboundOutput = z.infer<typeof classifyInboundSchema>;

export const checkCompletenessSchema = z.object({
  missing: z.array(requestSchema).max(20),
});
export type CheckCompletenessOutput = z.infer<typeof checkCompletenessSchema>;

export const screenSenderSchema = z.object({
  possibleClient: z.boolean(),
  reason: z.string().max(200),
});
export type ScreenSenderOutput = z.infer<typeof screenSenderSchema>;

export const classifyInboundJob: LlmStepJob<ClassifyInboundOutput> = {
  name: "classifyInbound",
  tier: "llm_step",
  instructions: CLASSIFY_INBOUND_INSTRUCTIONS,
  outputSchema: classifyInboundSchema,
  model: EMAIL_TRIAGE_MODEL,
};

export const checkCompletenessJob: LlmStepJob<CheckCompletenessOutput> = {
  name: "checkCompleteness",
  tier: "llm_step",
  instructions: CHECK_COMPLETENESS_INSTRUCTIONS,
  outputSchema: checkCompletenessSchema,
  model: EMAIL_TRIAGE_MODEL,
};

export const screenSenderJob: LlmStepJob<ScreenSenderOutput> = {
  name: "screenSender",
  tier: "llm_step",
  instructions: SCREEN_SENDER_INSTRUCTIONS,
  outputSchema: screenSenderSchema,
  model: EMAIL_TRIAGE_MODEL,
};

/** B5 (I8): dated commitments in a SENT email — never a draft, never inbound mail. */
export const extractPromisesSchema = z.object({
  promises: z
    .array(
      z.object({
        quote: z.string().min(1).max(300),
        workingDays: z.number().int().min(0).max(60).nullable(),
        calendarDays: z.number().int().min(0).max(120).nullable(),
        date: z.string().max(10).nullable(),
      }),
    )
    .max(10),
});
export type ExtractPromisesOutput = z.infer<typeof extractPromisesSchema>;

export const extractPromisesJob: LlmStepJob<ExtractPromisesOutput> = {
  name: "extractPromises",
  tier: "llm_step",
  instructions: EXTRACT_PROMISES_INSTRUCTIONS,
  outputSchema: extractPromisesSchema,
  model: EMAIL_TRIAGE_MODEL,
};

/** Registered in AGENT_JOBS (convex/lib/agentJobs.ts). */
export const EMAIL_LLM_JOBS = {
  classifyInbound: classifyInboundJob,
  checkCompleteness: checkCompletenessJob,
  screenSender: screenSenderJob,
  extractPromises: extractPromisesJob,
} as const;

// ─── agent_run jobs (B6a) ─────────────────────────────────────────────────────

/**
 * prepareTask (PRD §6.1): the Email assistant reads the conversation and
 * submits the Triage plan (`submitTriagePlan`). Runs in the shared admin
 * conversation of the email thread as the designated agent actor (E2);
 * stages: lib/agents/jobStages.ts. Started by dispatch (email/prepare.ts).
 */
export const prepareTaskJob: AgentRunJob = {
  name: "prepareTask",
  tier: "agent_run",
  systemAgentKey: "email_assistant",
  visibility: "admins",
  instructions: PREPARE_TASK_INSTRUCTIONS,
  tools: PREPARE_TASK_TOOLS,
};

/**
 * draftReply (PRD §6.1 kickoff, D21; Q7 reply — B6b): the kickoff reply
 * after Create / Merge / Apply, or the reply to a question item, submitted
 * with `submitDraft`. Same shared admin conversation (email/reply.ts).
 */
export const draftReplyJob: AgentRunJob = {
  name: "draftReply",
  tier: "agent_run",
  systemAgentKey: "email_assistant",
  visibility: "admins",
  instructions: DRAFT_REPLY_INSTRUCTIONS,
  tools: DRAFT_REPLY_TOOLS,
};

/**
 * prepareChange (PRD D4, D29 — B6b): a client email on a linked task (or a
 * Merge) becomes ONE `updateTask` proposal with an email source, through
 * `proposeTaskUpdate` (email/changes.ts).
 */
export const prepareChangeJob: AgentRunJob = {
  name: "prepareChange",
  tier: "agent_run",
  systemAgentKey: "email_assistant",
  visibility: "admins",
  instructions: PREPARE_CHANGE_INSTRUCTIONS,
  tools: PREPARE_CHANGE_TOOLS,
};

export const PREPARE_TASK_JOB_NAME = prepareTaskJob.name;
export const DRAFT_REPLY_JOB = draftReplyJob.name;
export const PREPARE_CHANGE_JOB = prepareChangeJob.name;

/** Registered in AGENT_JOBS (convex/lib/agentJobs.ts). */
export const EMAIL_AGENT_JOBS = {
  prepareTask: prepareTaskJob,
  draftReply: draftReplyJob,
  prepareChange: prepareChangeJob,
} as const;
