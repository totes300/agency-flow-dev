/**
 * Agent job registry (docs/prd-email-triage-implementation-plan.md §3 P2,
 * PRD §5.1, §6, §6.5) — code-defined agent jobs, like the tool registry.
 *
 * Two tiers:
 *
 *   - `llm_step` — ONE structured model call (`generateText` +
 *     `Output.object`), no agent thread, no tool loop. Run with
 *     `runLlmStep` from an internal action: org BYOK key → model →
 *     schema-validated output (one retry on a schema failure) → one light
 *     `agentJobRuns` audit row.
 *   - `agent_run` — a runner run in an anchored thread of a SYSTEM agent
 *     (convex/lib/systemAgents.ts), started or queued through the background
 *     path by `internal.agentJobs.startAgentJob`. The run uses the agent's
 *     base instructions + the job's instructions + platform prompt + skills,
 *     the job's tools (any non-interactive-only tool), `maxSteps` and `model`.
 *     Its stages have ONE source: `JOB_STAGES[name]` (lib/agents/jobStages.ts,
 *     client-safe), read via `getJobStages`; their state is derived from
 *     real tool events.
 *
 * Jobs are looked up BY NAME (`getAgentJob`) wherever a stored run row
 * refers to one (queued runs). Tests extend the lookup through
 * `registerAgentJobForTesting`, which refuses to run outside vitest — no fake
 * job ships in the production registry.
 */

import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import type { z } from "zod";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentToolRegistry } from "./agentToolRegistry";
import { loadAuthContextForActor } from "./auth";
import { getSystemAgentDefinition } from "./systemAgents";
import { resolveModel, WorksheetAiUnavailableError } from "./worksheetAi";
import { parseModelSlug } from "../../lib/agents/modelSlug";
import { JOB_STAGES, type JobStage } from "../../lib/agents/jobStages";
import { EMAIL_AGENT_JOBS, EMAIL_LLM_JOBS } from "../email/jobs";

export type AgentJobAnchor = { type: string; id: string };

export type LlmStepJob<TOutput = unknown> = {
  name: string;
  tier: "llm_step";
  /** The system prompt of the single call. */
  instructions: string;
  /** Validates (and types) the model's structured output. */
  outputSchema: z.ZodType<TOutput>;
  /** Model slug override (lib/agents/modelSlug.ts); platform default when unset. */
  model?: string;
};

export type AgentRunJob = {
  name: string;
  tier: "agent_run";
  /** Key in SYSTEM_AGENTS — the agent whose anchored thread the job runs in. */
  systemAgentKey: string;
  /** `admins`: shared thread, runs as the designated agent actor (E2). `private`: the caller-named owner. */
  visibility: "admins" | "private";
  /** Appended after the system agent's base instructions. */
  instructions: string;
  /** Registry tool names (actor path, A7); interactive-only ones are refused. */
  tools: string[];
  // No `stages` here: the fixed stage list (§6.5) is `JOB_STAGES[name]`
  // (getJobStages) — one source for the registry and the client.
  /** Tool-loop step cap; the runner default (12) when unset. */
  maxSteps?: number;
  /** Model slug override; falls back to the agent's model, then the default. */
  model?: string;
};

export type AgentJob = LlmStepJob<unknown> | AgentRunJob;

/** A job's fixed stages — `JOB_STAGES[name]`, the single source; [] if none. */
export function getJobStages(name: string): readonly JobStage[] {
  return JOB_STAGES[name] ?? [];
}

/**
 * Throws when a job definition is inconsistent — run on every registered job
 * (production at module load, test jobs at registration), so a bad job
 * fails loudly at deploy/test time, never mid-run. `stages` defaults to the
 * job's `JOB_STAGES` entry (tests pass a list to exercise the stage checks).
 */
export function validateAgentJob(
  job: AgentJob,
  stages: readonly JobStage[] = getJobStages(job.name),
): void {
  const where = `Agent job "${job.name}"`;
  if (!job.name.trim()) throw new Error("Agent job without a name");
  if (job.model) parseModelSlug(job.model);
  if (job.tier === "llm_step") {
    if (stages.length > 0) throw new Error(`${where}: an llm_step job has no stages`);
    return;
  }

  if (!getSystemAgentDefinition(job.systemAgentKey)) {
    throw new Error(`${where}: unknown system agent "${job.systemAgentKey}"`);
  }
  for (const name of job.tools) {
    // Every registry tool runs on the actor path (A7); only the explicit
    // `interactiveOnly` gate (connectors) keeps one out of a job's run.
    const entry = agentToolRegistry[name];
    if (!entry) throw new Error(`${where}: unknown tool "${name}"`);
    if (entry.interactiveOnly) {
      throw new Error(`${where}: tool "${name}" is interactive-only`);
    }
  }
  const keys = new Set<string>();
  for (const stage of stages) {
    if (keys.has(stage.key)) throw new Error(`${where}: duplicate stage "${stage.key}"`);
    keys.add(stage.key);
    for (const tool of stage.tools) {
      if (!job.tools.includes(tool)) {
        throw new Error(`${where}: stage "${stage.key}" lists "${tool}", which the job doesn't have`);
      }
    }
  }
  if (job.maxSteps !== undefined && (!Number.isInteger(job.maxSteps) || job.maxSteps < 1)) {
    throw new Error(`${where}: maxSteps must be a positive integer`);
  }
}

/**
 * The production registry. The email jobs live in convex/email/jobs.ts:
 * `llm_step` classifyInbound, checkCompleteness, screenSender,
 * extractPromises (B4/B5) and `agent_run` prepareTask (B6a); draftReply,
 * presendReview and handoverQA are added there too.
 */
export const AGENT_JOBS: Readonly<Record<string, AgentJob>> = {
  ...EMAIL_LLM_JOBS,
  ...EMAIL_AGENT_JOBS,
};
for (const job of Object.values(AGENT_JOBS)) validateAgentJob(job);
for (const name of Object.keys(JOB_STAGES)) {
  if (AGENT_JOBS[name]?.tier !== "agent_run") {
    throw new Error(`JOB_STAGES lists "${name}", which is not an agent_run job`);
  }
}

const testJobs = new Map<string, AgentJob>();

/**
 * Register a job for the current test run; returns its unregister. Throws
 * outside vitest, so production code can never add jobs at runtime.
 */
export function registerAgentJobForTesting(job: AgentJob): () => void {
  const isTest = typeof process !== "undefined" && Boolean(process.env.VITEST);
  if (!isTest) throw new Error("registerAgentJobForTesting is test-only");
  if (job.name in AGENT_JOBS) throw new Error(`Job "${job.name}" is a production job`);
  validateAgentJob(job);
  testJobs.set(job.name, job);
  return () => {
    testJobs.delete(job.name);
  };
}

/** A job by name — production first, then test-registered; null if unknown. */
export function getAgentJob(name: string): AgentJob | null {
  return AGENT_JOBS[name] ?? testJobs.get(name) ?? null;
}

/** An `agent_run` job by name, or null (unknown name or other tier). */
export function getAgentRunJob(name: string): AgentRunJob | null {
  const job = getAgentJob(name);
  return job?.tier === "agent_run" ? job : null;
}

// ─── Job actor (E2) ──────────────────────────────────────────────────────────

/** The fail-closed message when no valid designated agent actor exists (E2). */
export const NO_AGENT_ACTOR_MESSAGE =
  "No agent actor configured — set one in Settings";

export type JobActorResolution =
  | { ok: true; userId: Id<"users"> }
  | { ok: false; error: string };

/**
 * Who an `agent_run` job acts as — shared by the job start
 * (`prepareAgentJob`) and every later point a job run (re)starts
 * (`beginBackgroundRun`, the queued-run claim), so a queued job never runs
 * as an actor that was replaced or cleared meanwhile:
 *   - `admins` job → the org's designated agent actor, re-checked NOW as a
 *     current member AND admin (as in A1); unset / removed / demoted → fail
 *     closed with NO_AGENT_ACTOR_MESSAGE.
 *   - `private` job → `ownerUserId` (the thread owner the caller named),
 *     re-checked as a current member.
 */
export async function resolveJobActor(
  ctx: QueryCtx,
  job: AgentRunJob,
  orgId: string,
  ownerUserId: Id<"users"> | undefined,
): Promise<JobActorResolution> {
  if (job.visibility === "private") {
    if (!ownerUserId) return { ok: false, error: "A private job needs its thread owner" };
    try {
      const auth = await loadAuthContextForActor(ctx, { orgId, userId: ownerUserId });
      return { ok: true, userId: auth.userId };
    } catch {
      return { ok: false, error: "The thread owner is not a member of this organization" };
    }
  }
  const settings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  const userId = settings?.agentActorUserId;
  if (!userId) return { ok: false, error: NO_AGENT_ACTOR_MESSAGE };
  try {
    const auth = await loadAuthContextForActor(ctx, { orgId, userId });
    if (auth.isAdmin) return { ok: true, userId: auth.userId };
  } catch {
    // not a current member — same fail-closed outcome
  }
  return {
    ok: false,
    error: `${NO_AGENT_ACTOR_MESSAGE} (the designated user is no longer an admin of this organization)`,
  };
}

// ─── llm_step ────────────────────────────────────────────────────────────────

/** An llm_step that did not produce a valid result (clear, logged, audited). */
export class LlmStepError extends Error {
  constructor(
    message: string,
    readonly jobRunId: Id<"agentJobRuns">,
  ) {
    super(message);
    this.name = "LlmStepError";
  }
}

/** Model calls an llm_step makes at most (one retry on a schema failure). */
const LLM_STEP_MAX_ATTEMPTS = 2;

function isSchemaFailure(err: unknown): boolean {
  return NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err);
}

/** Hitting the output token cap is not retried: the same call would truncate again. */
const OUTPUT_TOO_LONG =
  "the model's output was too long (it hit the output token limit) — no retry";

function sanitize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/**
 * Run one `llm_step` job for an org (internal actions only — the org is
 * decided by server code, never by a client). Loads the org's BYOK key,
 * resolves the model (`job.model` or the platform default), calls the model
 * with the job's output schema, validates, retries ONCE on a schema failure,
 * records one `agentJobRuns` row, then returns the typed output — or throws
 * `LlmStepError` (no key, bad model slug, schema failure twice, output too
 * long, provider error) after recording the failed row.
 *
 * The SDK's own retries are off (`maxRetries: 0`): our single schema retry is
 * the only one, so `attempts` and token counts are the real calls. An output
 * cut off at the token limit (`finishReason: "length"`) fails at once.
 *
 * `input` is the prompt: a string as-is, anything else as pretty JSON.
 */
export async function runLlmStep<TOutput>(
  ctx: ActionCtx,
  args: {
    job: LlmStepJob<TOutput>;
    orgId: string;
    input: unknown;
    anchor?: AgentJobAnchor;
  },
): Promise<TOutput> {
  const { job, orgId } = args;
  const startedAt = Date.now();
  const usage: Required<Usage> = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const addUsage = (u: Usage | undefined) => {
    usage.inputTokens += u?.inputTokens ?? 0;
    usage.outputTokens += u?.outputTokens ?? 0;
    usage.totalTokens += u?.totalTokens ?? 0;
  };
  let attempts = 0;

  const record = async (
    outcome: { status: "succeeded" } | { status: "failed"; error: string },
  ): Promise<Id<"agentJobRuns">> =>
    await ctx.runMutation(internal.agentJobs.recordJobRun, {
      orgId,
      job: job.name,
      tier: "llm_step",
      anchor: args.anchor,
      status: outcome.status,
      startedAt,
      attempts,
      ...usage,
      error: outcome.status === "failed" ? outcome.error : undefined,
    });

  const fail = async (message: string): Promise<never> => {
    const jobRunId = await record({ status: "failed", error: message.slice(0, 500) });
    throw new LlmStepError(`Agent job "${job.name}" failed: ${message}`, jobRunId);
  };

  let model: ReturnType<typeof resolveModel>;
  try {
    const apiKey: string | null = await ctx.runQuery(
      internal.aiIntegration.loadDecryptedKeyForOrg,
      { orgId },
    );
    model = resolveModel(apiKey, job.model);
  } catch (err) {
    return await fail(
      err instanceof WorksheetAiUnavailableError
        ? "No AI key is configured for this organization."
        : sanitize(err),
    );
  }

  const prompt =
    typeof args.input === "string" ? args.input : JSON.stringify(args.input, null, 2);
  let lastSchemaError = "";
  while (attempts < LLM_STEP_MAX_ATTEMPTS) {
    attempts++;
    try {
      const result = await generateText({
        model,
        system: job.instructions,
        prompt,
        output: Output.object({ schema: job.outputSchema }),
        maxRetries: 0,
      });
      addUsage(result.totalUsage);
      if (result.finishReason === "length") return await fail(OUTPUT_TOO_LONG);
      // Output.object already validated; parse again so the returned value
      // is exactly the schema's output type (transforms/defaults applied).
      // (`result.output` throws NoOutputGeneratedError when nothing parsed —
      // handled as a schema failure below.)
      const parsed = job.outputSchema.safeParse(result.output);
      if (!parsed.success) {
        lastSchemaError = parsed.error.message;
        continue;
      }
      await record({ status: "succeeded" });
      return parsed.data;
    } catch (err) {
      if (err instanceof LlmStepError) throw err;
      if (isSchemaFailure(err)) {
        const failure = err as { usage?: Usage; finishReason?: string };
        addUsage(failure.usage);
        if (failure.finishReason === "length") return await fail(OUTPUT_TOO_LONG);
        lastSchemaError = sanitize(err);
        continue;
      }
      return await fail(sanitize(err));
    }
  }
  return await fail(
    `the model's output did not match the job's schema after ${attempts} attempts (${lastSchemaError})`,
  );
}
