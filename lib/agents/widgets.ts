/**
 * Markers of the live widget blocks and the event line (email-triage B8a,
 * PRD §7.1 "Widgets", implementation plan §3 P6).
 *
 * A widget is a fixed component filled from a read tool's result: the tool
 * output carries ONLY a reference (a task id, an email / agent thread id) next
 * to its normal payload, the classifier (`lib/agents/blocks.ts`) turns it into
 * a block, and the block renders through a reactive Convex query with the
 * viewer's access — never from the message (platform law D1: the model never
 * types a figure). The event line is the one exception that carries text: it
 * is written by server code only (never a model tool), as a historical record
 * ("Created PRG-132 · Frances notified").
 *
 * Pure and client-safe — no React, no Convex imports.
 */

/** `getTaskBundle` (T14) → the task status card. */
export const AGENT_TASK_CARD_MARKER = "agency-flow/task-card@1";

/** `getThreadRequests` (T15) → the request checklist. */
export const AGENT_REQUEST_CHECKLIST_MARKER = "agency-flow/request-checklist@1";

/** A code-written event line (`convex/agentEvents.ts`). */
export const AGENT_EVENT_MARKER = "agency-flow/event@1";

/** The synthetic tool name the event-line messages use (no registry entry, never a model tool). */
export const EVENT_LINE_TOOL_NAME = "recordEvent";

export type TaskCardRefOutput = { block: typeof AGENT_TASK_CARD_MARKER; taskId: string };

export type RequestChecklistRef = { threadId: string } | { agentThreadId: string };

export type RequestChecklistRefOutput = {
  block: typeof AGENT_REQUEST_CHECKLIST_MARKER;
  ref: RequestChecklistRef;
};

export type EventLineOutput = { block: typeof AGENT_EVENT_MARKER; text: string };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function isTaskCardRefOutput(output: unknown): output is TaskCardRefOutput {
  const o = record(output);
  return o !== null && o.block === AGENT_TASK_CARD_MARKER && nonEmpty(o.taskId);
}

export function isRequestChecklistRefOutput(output: unknown): output is RequestChecklistRefOutput {
  const o = record(output);
  if (o === null || o.block !== AGENT_REQUEST_CHECKLIST_MARKER) return false;
  const ref = record(o.ref);
  if (ref === null) return false;
  // Exactly one of the two references.
  return nonEmpty(ref.threadId) !== nonEmpty(ref.agentThreadId);
}

export function isEventLineOutput(output: unknown): output is EventLineOutput {
  const o = record(output);
  return o !== null && o.block === AGENT_EVENT_MARKER && nonEmpty(o.text);
}

/** The request-checklist reference of a tool input (`getThreadRequests`), or null. */
export function requestChecklistRef(input: { threadId?: string; agentThreadId?: string }): RequestChecklistRef | null {
  if (input.threadId !== undefined && input.agentThreadId === undefined) return { threadId: input.threadId };
  if (input.agentThreadId !== undefined && input.threadId === undefined) return { agentThreadId: input.agentThreadId };
  return null;
}

/** Event-line text cap (one sentence). */
export const EVENT_LINE_MAX = 300;

/** Normalise an event sentence: one line, trimmed, capped. */
export function eventLineText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EVENT_LINE_MAX ? `${flat.slice(0, EVENT_LINE_MAX - 1)}…` : flat;
}
