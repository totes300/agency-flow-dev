/**
 * Pure block-schema layer for the agent stream (PRD: API contracts › Block
 * vocabulary). Maps the component's UIMessage parts onto the app's block
 * vocabulary and owns every deterministic display string (tool verbs,
 * result summaries, thought labels) so renderers stay presentational.
 *
 * No React, no Convex — unit-tested in blocks.test.ts.
 */

/**
 * Determinism visual token (US 19), decided here per the PRD: AI prose
 * renders in standard message styling; deterministic values (counts in
 * tool summaries, table cells from slice 03 on) render with tabular
 * figures so columns of numbers align and read as "machine-produced".
 * Every block renderer must use this class for deterministic values —
 * no per-renderer improvisation.
 */
export const DETERMINISTIC_VALUE_CLASS = "tabular-nums";

/** The renderable subset of the block vocabulary present at slice 02. */
export type AgentBlock =
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "reasoning"; text: string; streaming: boolean }
  | {
      kind: "tool";
      toolName: string;
      phase: "running" | "done" | "error";
      input: unknown;
      output: unknown;
      errorText: string | null;
    };

/** Structural view of an AI-SDK UIMessage part — keeps this module pure. */
export type MessagePartLike = { type: string } & Record<string, unknown>;

/**
 * Map one UIMessage part onto the block vocabulary. Returns null for
 * parts with no renderer (step boundaries, sources, files, data parts)
 * and for empty text/reasoning — the guard that keeps unknown part
 * types from ever reaching a renderer.
 */
export function classifyPart(part: MessagePartLike): AgentBlock | null {
  if (part.type === "text" || part.type === "reasoning") {
    const text = typeof part.text === "string" ? part.text : "";
    const streaming = part.state === "streaming";
    if (!text && !streaming) return null;
    return { kind: part.type, text, streaming };
  }

  let toolName: string | null = null;
  if (part.type === "dynamic-tool") {
    toolName = typeof part.toolName === "string" ? part.toolName : "tool";
  } else if (part.type.startsWith("tool-")) {
    toolName = part.type.slice("tool-".length);
  }
  if (toolName === null) return null;

  const state = typeof part.state === "string" ? part.state : "";
  return {
    kind: "tool",
    toolName,
    phase:
      state === "output-available"
        ? "done"
        : state === "output-error"
          ? "error"
          : "running",
    input: part.input ?? null,
    output: part.output ?? null,
    errorText: typeof part.errorText === "string" ? part.errorText : null,
  };
}

/** All renderable blocks of a message, in part order. */
export function classifyParts(parts: MessagePartLike[]): AgentBlock[] {
  return parts
    .map(classifyPart)
    .filter((block): block is AgentBlock => block !== null);
}

// ─── Tool display (verb + deterministic result summary) ────────────────────

type ToolDisplay = {
  /** Ghost-row verb while the call is in flight ("Reading clients…"). */
  runningLabel: string;
  /** Ghost-row verb once the result landed ("Read client directory"). */
  doneLabel: string;
  /** Deterministic result summary computed from the raw output. */
  summarize: (output: unknown) => string | null;
};

function countOf(noun: string): ToolDisplay["summarize"] {
  return (output) =>
    Array.isArray(output)
      ? `${output.length} ${noun}${output.length === 1 ? "" : "s"}`
      : null;
}

const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  listClients: {
    runningLabel: "Reading client directory",
    doneLabel: "Read client directory",
    summarize: countOf("client"),
  },
  listProjects: {
    runningLabel: "Reading project list",
    doneLabel: "Read project list",
    summarize: countOf("project"),
  },
};

/** "collectTimesheetData" → "Collect timesheet data". */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (!words) return "Tool call";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Ghost-row verb for a tool call in the given phase. */
export function toolLabel(
  toolName: string,
  phase: "running" | "done" | "error",
): string {
  const display = TOOL_DISPLAY[toolName];
  if (phase === "running") {
    return display ? display.runningLabel : humanizeToolName(toolName);
  }
  return display ? display.doneLabel : humanizeToolName(toolName);
}

/**
 * Deterministic result summary for a finished tool call — computed from
 * the raw output, never model-written (D1 at render level). Falls back
 * to a bare item count for unknown array outputs, null otherwise.
 */
export function toolResultSummary(
  toolName: string,
  output: unknown,
): string | null {
  const display = TOOL_DISPLAY[toolName];
  const summary = display ? display.summarize(output) : null;
  if (summary !== null) return summary;
  if (Array.isArray(output)) {
    return `${output.length} item${output.length === 1 ? "" : "s"}`;
  }
  return null;
}

// ─── Reasoning ("Thought for Ns") ───────────────────────────────────────────

/**
 * Collapsed reasoning one-liner. Duration is measured client-side while
 * the part streams; historical messages have no measurement → bare
 * "Thought".
 */
export function thoughtLabel(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "Thought";
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `Thought for ${seconds}s`;
}
