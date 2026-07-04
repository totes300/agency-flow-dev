/**
 * AI task summarization for worksheet exports (Phase 9 Slice 2).
 *
 * One job: take per-task context (title, plain-text description, subtasks,
 * flattened comment text, included entry notes) and return two client-
 * facing strings — `taskSummary` ("what the task was asking us to do") and
 * `whatWeDid` ("work delivered, past tense, outcome-focused").
 *
 * Routing strategy (PRD §AI model):
 *   - Primary: Vercel AI Gateway via `ai` SDK with the plain provider
 *     string `"anthropic/claude-sonnet-4.6"`. The SDK auto-detects
 *     `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN`; nothing else to wire.
 *   - Fallback: direct Anthropic SDK (`@ai-sdk/anthropic`) when
 *     `AI_GATEWAY_API_KEY` is unset but `ANTHROPIC_API_KEY` is set. This
 *     covers local development without a Vercel project link.
 *
 * Model slug note: the AI Gateway slug convention uses dots for versions
 * (`claude-sonnet-4.6`), not hyphens. The PRD draft pre-dated the slug
 * format change. The dot form is what the gateway accepts today.
 *
 * Concurrency + errors (PRD §Concurrency + errors):
 *   - Per-task failure → return the deterministic fallback for that row.
 *     The action catches and substitutes `[summary unavailable]` so the
 *     export continues with partial data.
 *   - Whole-batch failure (no key at all, network down, every task
 *     errors) → throw `WorksheetAiUnavailableError`. The action surfaces
 *     this as a toast; no CSV is downloaded.
 */

import { generateText } from "ai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { WorksheetAiInput } from "../worksheetsHelpers";

/**
 * Model identifiers — same Claude Sonnet 4.6 model, two transports, two
 * naming conventions that we have to keep straight:
 *
 *   - Vercel AI Gateway uses DOT-versioned slugs:   `anthropic/claude-sonnet-4.6`
 *   - Anthropic's direct API uses HYPHEN model ids: `claude-sonnet-4-6`
 *
 * Mixing them yields a model-not-found error per call, which the bounded-
 * concurrency worker silently swallows into `[summary unavailable]` rows.
 * That's how the BYOK path failed during the 2026-05-25 testing pass before
 * this got fixed.
 */
const GATEWAY_MODEL_SLUG = "anthropic/claude-sonnet-4.6";
const DIRECT_MODEL_ID = "claude-sonnet-4-6";

/** Sentinel thrown when the AI service can't be reached at all. */
export class WorksheetAiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorksheetAiUnavailableError";
  }
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * Compose one user-message string with all the task context. We pass a
 * structured plain-text block instead of a JSON payload — readability for
 * the model (and for any future inspector of the call) is higher than the
 * marginal benefit of strict typing in the prompt. Each section is gated
 * by a non-empty check so empty sections don't bloat the context.
 */
function buildTaskContextBlock(input: WorksheetAiInput): string {
  const parts: string[] = [];
  parts.push(`Task title: ${input.title}`);
  if (input.descriptionText.trim().length > 0) {
    parts.push(`Task description:\n${input.descriptionText.trim()}`);
  }
  if (input.subtasks.length > 0) {
    const lines = input.subtasks.map(
      (s) => `- [${s.done ? "x" : " "}] ${s.title}`,
    );
    parts.push(`Subtasks:\n${lines.join("\n")}`);
  }
  if (input.commentTexts.length > 0) {
    parts.push(
      `Comments (chronological):\n${input.commentTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    );
  }
  if (input.entryNotes.length > 0) {
    const lines = input.entryNotes.map((n) => {
      const billable = n.isBillable ? "billable" : "non-billable";
      const h = Math.floor(n.minutes / 60);
      const m = n.minutes % 60;
      const dur = `${h}:${String(m).padStart(2, "0")}`;
      return `- ${n.date} (${dur}, ${billable}): ${n.note}`;
    });
    parts.push(`Time entry notes:\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

const SYSTEM_PROMPT = `You write short, client-facing summaries of work an agency did for a client. You receive a structured block of context about ONE task and respond with EXACTLY two lines in this format:

SUMMARY: <one sentence describing what the task was asking us to do>
DELIVERED: <1–3 sentences describing what we delivered, past tense, outcome-focused>

Rules:
- Both lines are client-facing — clear, professional, no internal jargon, no apologies, no teammate names.
- SUMMARY: ~180 chars max, one sentence. Preserve the practical intent of long descriptions WITHOUT dumping the description verbatim.
- DELIVERED: ~280 chars max, 1–3 sentences. Past tense. Use the description, subtasks, comments, and entry notes to ground the answer.
- If a section is missing or empty, infer reasonably from what IS there. If nothing meaningful exists, restate the title as a past-tense outcome.
- Never include the labels in the body (don't write "Summary:" inside the SUMMARY line).
- Never wrap responses in quotes or markdown.`;

// ─── Output normalization ───────────────────────────────────────────────────

/** Trim, collapse internal newlines to spaces, strip wrapping quotes. */
function cleanLine(s: string): string {
  let out = s.trim().replace(/\s+/g, " ");
  // Strip a single leading/trailing matched quote pair if the model wrapped
  // its answer (defensive — the prompt forbids it but models drift).
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith("“") && out.endsWith("”"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

/** Cap to `max` chars, appending `…` if truncated. */
function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Parse the model's two-line response back into `{ taskSummary, whatWeDid }`.
 * Tolerant of:
 *   - Extra whitespace / blank lines between the two lines.
 *   - Bullet/numbered prefixes the model occasionally adds.
 *   - Case differences in the labels.
 *   - Missing one of the two labels — in that case use the other and a
 *     best-effort fallback from the title.
 *
 * Exported for unit tests — keep imports local to the module otherwise.
 */
export function parseResponse(
  raw: string,
  fallbackTitle: string,
): { taskSummary: string; whatWeDid: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let summary = "";
  let delivered = "";
  for (const line of lines) {
    const m = line.match(/^[-*0-9.\s]*?(SUMMARY|DELIVERED)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const value = cleanLine(m[2]);
    if (key === "SUMMARY" && !summary) summary = value;
    else if (key === "DELIVERED" && !delivered) delivered = value;
  }

  // Salvage path: model returned plain text without labels. Treat the first
  // sentence as the summary and the rest as the delivered block.
  if (!summary && !delivered && lines.length > 0) {
    const joined = cleanLine(lines.join(" "));
    const firstStop = joined.match(/^(.+?[.!?])\s+(.+)$/);
    if (firstStop) {
      summary = firstStop[1];
      delivered = firstStop[2];
    } else {
      summary = joined;
      delivered = joined;
    }
  }

  if (!summary) summary = `${fallbackTitle}.`;
  if (!delivered) delivered = `Worked on ${fallbackTitle}.`;

  return {
    taskSummary: capLength(summary, 220),
    whatWeDid: capLength(delivered, 320),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a model handle the `ai` SDK can consume.
 *
 * Priority order (Phase 9 BYOK):
 *   1. Caller-supplied `apiKey` — the customer's per-org Anthropic key
 *      loaded from `orgSettings.aiAnthropicKeyCiphertext` and decrypted in
 *      the worksheet action. This is the CUSTOMER path: their key, their
 *      bill, their rate limits.
 *   2. `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN` — operator's Vercel AI
 *      Gateway. Dev/staff fallback.
 *   3. `ANTHROPIC_API_KEY` env — operator's direct Anthropic key. Dev/staff
 *      fallback.
 *   4. None of the above → `WorksheetAiUnavailableError` ("configure AI in
 *      Settings → Integrations" message bubbles up).
 *
 * The customer-key path uses `createAnthropic({ apiKey })` so the SDK
 * scopes the call to that explicit key — no chance of accidentally
 * reading the operator's env-var key when a customer key is set.
 */
function resolveModel(apiKey?: string | null): string | ReturnType<typeof anthropic> {
  if (apiKey) {
    return createAnthropic({ apiKey })(DIRECT_MODEL_ID);
  }
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    return GATEWAY_MODEL_SLUG;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic(DIRECT_MODEL_ID);
  }
  throw new WorksheetAiUnavailableError(
    "No AI key configured for this organization. Set one in Settings → Integrations.",
  );
}

/**
 * Sanitize an error message for log output. Strips `sk-ant-…` fragments
 * defensively and caps length so a malformed provider response can't tile
 * Convex's log viewer.
 */
function sanitizeForLog(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

/**
 * Decide whether an error is transient enough to retry. We retry exactly
 * once with a small backoff — common SDK / provider hiccups (timeouts,
 * 429s, 5xx) recover; auth / model / billing errors are permanent and not
 * worth retrying.
 */
function isTransientAiError(err: unknown): boolean {
  if (err instanceof WorksheetAiUnavailableError) return false;
  const msg = sanitizeForLog(err).toLowerCase();
  if (msg.includes("429")) return true; // rate-limited
  if (msg.includes("503") || msg.includes("502") || msg.includes("504")) return true;
  if (msg.includes("timeout") || msg.includes("etimedout")) return true;
  if (msg.includes("fetch failed") || msg.includes("network")) return true;
  return false;
}

/**
 * Summarize ONE task. The caller is responsible for bounded concurrency.
 *
 * `apiKey` is the org's BYOK plaintext Anthropic key (already decrypted
 * by `internal.aiIntegration.loadDecryptedKey`). Pass `null`/`undefined`
 * to fall back to operator env-var keys.
 *
 * Retries: a single retry with ~500ms backoff for transient errors
 * (429/5xx/timeout/network). Permanent errors (auth, model id, billing)
 * are not retried — they'd just waste tokens and slow the export.
 */
export async function summarizeTaskWithAI(
  input: WorksheetAiInput,
  apiKey?: string | null,
): Promise<{ taskSummary: string; whatWeDid: string }> {
  const model = resolveModel(apiKey);
  const context = buildTaskContextBlock(input);

  async function call(): Promise<string> {
    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: context,
      // Output cap — well above ~280+~180 chars even with label overhead,
      // so the model doesn't get truncated mid-sentence. Cheap on Sonnet.
      maxOutputTokens: 400,
      // Mild temperature for varied phrasing across tasks, not so high
      // that outputs drift from the structured context.
      temperature: 0.4,
    });
    return text;
  }

  try {
    return parseResponse(await call(), input.title);
  } catch (err) {
    if (!isTransientAiError(err)) throw err;
    // Backoff before the retry. The 400-600ms range covers most 429 cooldowns
    // without ballooning a 30-task export's wall clock.
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
    return parseResponse(await call(), input.title);
  }
}

/**
 * Summarize an array of tasks. Two-phase to make whole-batch failure
 * detection sound:
 *
 *   1. **Probe**: run the FIRST input alone. If it throws
 *      `WorksheetAiUnavailableError`, the whole batch is doomed (no key,
 *      no encryption, etc.) — rethrow so the action can toast and skip
 *      the CSV download. If it throws anything else, treat that one task
 *      as a per-row failure and continue.
 *   2. **Fan out**: parallelize the remaining inputs with bounded workers.
 *      Per-task failures here become `null` results (which the caller
 *      substitutes with `[summary unavailable]`).
 *
 * Why probe-then-fanout vs the previous `i === 0` heuristic: with a shared
 * `nextIndex++`, "index 0" was just whichever worker happened to start
 * first, not "the first call to fail." Probing once gives a clean signal.
 *
 * Concurrency = 4: low enough to stay under provider per-key rate limits,
 * high enough that a 30-task export finishes well under the 5 s budget.
 */
export async function summarizeTasksWithBoundedConcurrency(
  inputs: WorksheetAiInput[],
  options: { apiKey?: string | null; concurrency?: number } = {},
): Promise<Array<{ taskSummary: string; whatWeDid: string } | null>> {
  if (inputs.length === 0) return [];

  const { apiKey, concurrency = 4 } = options;
  const results: Array<{ taskSummary: string; whatWeDid: string } | null> =
    new Array(inputs.length).fill(null);

  // ─── Phase 1: probe ───────────────────────────────────────────────────────
  try {
    results[0] = await summarizeTaskWithAI(inputs[0], apiKey);
  } catch (err) {
    if (err instanceof WorksheetAiUnavailableError) throw err;
    console.warn(
      `[worksheetAi] probe failed (title: ${inputs[0].title.slice(0, 60)}): ${sanitizeForLog(err)}`,
    );
    // results[0] stays null — caller substitutes fallback for that row.
  }

  if (inputs.length === 1) return results;

  // ─── Phase 2: bounded fan-out for the rest ────────────────────────────────
  let nextIndex = 1;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= inputs.length) return;
      try {
        results[i] = await summarizeTaskWithAI(inputs[i], apiKey);
      } catch (err) {
        console.warn(
          `[worksheetAi] task ${i} (title: ${inputs[i].title.slice(0, 60)}): ${sanitizeForLog(err)}`,
        );
        results[i] = null;
      }
    }
  }

  const workerCount = Math.min(concurrency, inputs.length - 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
