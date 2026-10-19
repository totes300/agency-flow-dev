/**
 * AI-provider failures → a clean, user-facing run error + hint.
 *
 * A failed run settles as an in-thread error block (`agentRuns.error` /
 * `errorHint`, rendered by components/agents/blocks/error-block.tsx). The raw
 * error of a provider rejection is useless there — "Uncaught Error: Your
 * credit balance is too low to access the Anthropic API… at
 * node_modules/ai/…" — so every failure is classified here first and only the
 * classified text is stored or shown. Stack frames never reach the UI.
 *
 * Only MODEL-CALL failures are classified (`isModelCallError`: provider /
 * gateway API errors, and errors captured from the model stream); tool and
 * app errors keep their own message (`genericRunError`). Display never
 * re-classifies — it only runs `cleanErrorText`.
 *
 * Pure (no React, no Convex, no `ai` import — the SDK's error markers are
 * read by symbol): used by convex/agentRunner.ts when it settles a run, and
 * by the thread view (`cleanErrorText` only).
 */

export type ProviderErrorKind =
  | "credit_balance"
  | "invalid_key"
  | "rate_limit"
  | "overloaded"
  | "generic";

export type RunErrorDisplay = {
  kind: ProviderErrorKind;
  /** One sentence, no stack, no provider JSON. */
  message: string;
  /** The actionable next step shown under the message. */
  hint: string;
};

/** Where the BYOK key lives in the app (components/settings/settings-integrations.tsx). */
export const AI_SETTINGS_LOCATION = "Settings › Integrations › AI";

const RETRY_HINT = "You can send a follow-up message in this thread to retry.";

const DISPLAY: Record<Exclude<ProviderErrorKind, "generic">, Omit<RunErrorDisplay, "kind">> = {
  credit_balance: {
    message: "The AI provider has no credit left.",
    hint: `Top up the key in ${AI_SETTINGS_LOCATION} (or the gateway account), then send a follow-up message to retry.`,
  },
  invalid_key: {
    message: "The AI provider rejected the API key.",
    hint: `Check or replace the key in ${AI_SETTINGS_LOCATION}, then send a follow-up message to retry.`,
  },
  rate_limit: {
    message: "The AI provider is rate-limiting requests right now.",
    hint: "Wait a minute, then send a follow-up message to retry.",
  },
  overloaded: {
    message: "The AI provider is overloaded right now.",
    hint: "This is usually brief — try again in a few minutes.",
  },
};

const GENERIC_MESSAGE_MAX = 300;

// Matched against the folded (lower-case) text of every message, body and
// cause the error carries.
const PATTERNS: ReadonlyArray<{ kind: Exclude<ProviderErrorKind, "generic">; re: RegExp }> = [
  {
    kind: "credit_balance",
    re: /credit balance is too low|insufficient[_ ](?:funds|credits?|balance|quota)|out of credits?|payment required|billing (?:hard )?limit|exceeded your current quota/,
  },
  {
    kind: "invalid_key",
    re: /invalid x-api-key|invalid api[_ -]?key|incorrect api key|authentication[_ ]error|authentication failed|api key (?:is )?(?:invalid|revoked|expired|not valid)|invalid (?:bearer )?token|permission[_ ]error/,
  },
  { kind: "rate_limit", re: /rate[_ -]?limit|too many requests/ },
  { kind: "overloaded", re: /overloaded|service unavailable|temporarily unavailable/ },
];

function statusKind(status: number): Exclude<ProviderErrorKind, "generic"> | null {
  if (status === 402) return "credit_balance";
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limit";
  if (status === 503 || status === 529) return "overloaded";
  return null;
}

/** Every text and HTTP status an error carries (its cause chain, retry errors, response body). */
function collect(err: unknown, texts: string[], statuses: number[], depth = 0): void {
  if (err == null || depth > 4) return;
  if (typeof err === "string") {
    texts.push(err);
    return;
  }
  if (typeof err !== "object") return;
  const e = err as Record<string, unknown>;
  for (const key of ["message", "responseBody", "name", "type", "code"]) {
    if (typeof e[key] === "string") texts.push(e[key] as string);
  }
  for (const key of ["statusCode", "status"]) {
    if (typeof e[key] === "number") statuses.push(e[key] as number);
  }
  if (e.data !== undefined && typeof e.data === "object") {
    try {
      texts.push(JSON.stringify(e.data));
    } catch {
      // unserialisable data: ignore
    }
  } else if (typeof e.data === "string") {
    texts.push(e.data);
  }
  collect(e.cause, texts, statuses, depth + 1);
  collect(e.lastError, texts, statuses, depth + 1);
  if (Array.isArray(e.errors)) for (const inner of e.errors.slice(-3)) collect(inner, texts, statuses, depth + 1);
}

/**
 * Strip what must never reach the UI from an error string: the Convex
 * wrapper ("[CONVEX A(…)] [Request ID: …] Server Error", "Uncaught Error:"),
 * stack frames ("    at fn (node_modules/ai/…)"), and trailing JSON
 * bodies; capped to one short paragraph. Empty → "Something went wrong."
 */
export function cleanErrorText(text: string): string {
  let out = text.replace(/\r\n?/g, "\n");
  // Stack frames and everything after the first one.
  out = out.replace(/\n\s*at\s[\s\S]*$/, "");
  out = out
    .split("\n")
    .filter((line) => !/^\s*at\s+\S/.test(line))
    .join(" ");
  // Inline frames on one line: " at fn (path:line:col)", " at path:line:col".
  out = out.replace(/\s+at\s+(?:async\s+)?(?:[^\s()]+\s+)?\(?[^\s()]+:\d+:\d+\)?/g, "");
  out = out
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/g, "")
    .replace(/^\s*Server Error\s*/i, "")
    .replace(/^\s*(?:Uncaught\s+)?(?:[A-Z][A-Za-z]*)?Error:\s*/, "")
    .replace(/^\s*Uncaught\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > GENERIC_MESSAGE_MAX) out = `${out.slice(0, GENERIC_MESSAGE_MAX - 1).trimEnd()}…`;
  return out || "Something went wrong.";
}

/**
 * Classify a MODEL-CALL failure (callers check `isModelCallError`, or the
 * error came from the model stream). Provider rejections (credit, key, rate
 * limit, overload) get a fixed message + hint; an unrecognised model error
 * keeps its own message, cleaned, with the retry hint.
 */
export function classifyProviderError(err: unknown): RunErrorDisplay {
  const texts: string[] = [];
  const statuses: number[] = [];
  collect(err, texts, statuses);
  const haystack = texts.join("\n").toLowerCase();
  for (const { kind, re } of PATTERNS) {
    if (re.test(haystack)) return { kind, ...DISPLAY[kind] };
  }
  for (const status of statuses) {
    const kind = statusKind(status);
    if (kind) return { kind, ...DISPLAY[kind] };
  }
  return genericRunError(err);
}

/** A non-model failure (tool, bookkeeping, app error): its own message, cleaned. */
export function genericRunError(err: unknown): RunErrorDisplay {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown } | null)?.message === "string"
          ? (err as { message: string }).message
          : "Unknown error";
  return { kind: "generic", message: cleanErrorText(message), hint: RETRY_HINT };
}

// AI SDK error markers (`AISDKError.hasMarker`): `error[Symbol.for(marker)] === true`.
const MODEL_CALL_MARKERS = [
  "vercel.ai.error.AI_APICallError",
  "vercel.ai.error.AI_RetryError",
  "vercel.ai.error.AI_LoadAPIKeyError",
  "vercel.ai.gateway.error",
].map((marker) => Symbol.for(marker));

/** A provider / gateway API error (incl. the SDK's RetryError around one). */
export function isModelCallError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const marked = err as Record<symbol, unknown>;
  return MODEL_CALL_MARKERS.some((symbol) => marked[symbol] === true);
}

/**
 * The raw model-call error for the SERVER log: name, message, status,
 * response body and cause — never the request body (the prompt holds client
 * email content), with API keys redacted, capped.
 */
export function describeErrorForLog(err: unknown): string {
  const e = (err ?? {}) as Record<string, unknown>;
  const parts = [
    typeof e.name === "string" ? e.name : undefined,
    typeof e.statusCode === "number" ? `status ${e.statusCode}` : undefined,
    err instanceof Error ? err.message : typeof err === "string" ? err : undefined,
    typeof e.responseBody === "string" ? `body: ${e.responseBody}` : undefined,
    e.cause instanceof Error ? `cause: ${e.cause.message}` : undefined,
    err instanceof Error && err.stack ? err.stack : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.join(" | ").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 4000);
}
