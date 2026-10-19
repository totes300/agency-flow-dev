/**
 * Pure block-schema layer for the agent stream (PRD: API contracts › Block
 * vocabulary). Maps the component's UIMessage parts onto the app's block
 * vocabulary and owns every deterministic display string (tool verbs,
 * result summaries, thought labels) so renderers stay presentational.
 *
 * No React, no Convex — unit-tested in blocks.test.ts.
 */

import { isAgentTableOutput, type AgentTable } from "./table";
import { isProposalRefsOutput } from "./proposals";
import { STOP_CONDITION_TOOL_NAME } from "./skills";

/**
 * Determinism visual token (US 19), decided here per the PRD: AI prose
 * renders in standard message styling; deterministic values (counts in
 * tool summaries, table cells from slice 03 on) render with tabular
 * figures so columns of numbers align and read as "machine-produced".
 * Every block renderer must use this class for deterministic values —
 * no per-renderer improvisation.
 */
export const DETERMINISTIC_VALUE_CLASS = "tabular-nums";

/** The renderable subset of the block vocabulary (slices 02–03). */
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
    }
  | {
      kind: "table";
      table: AgentTable;
      /**
       * The stored artifact produced by the same tool call, when there is
       * one — lets the inline sheet's "Open full sheet" affordance open the
       * canvas without depending on the sibling artifact block.
       */
      artifactId: string | null;
    }
  | {
      kind: "artifact";
      artifactId: string;
      name: string;
      artifactKind: string;
    }
  | {
      kind: "proposal";
      /**
       * The batch a single propose-tool call emitted. Cards render from the
       * LIVE proposal records (reactive query), not from this message — so
       * pending cards persist across thread close/reopen and status flips
       * (approved/discarded/failed) update in place (slice 08).
       */
      proposalIds: string[];
    };

/** Reference a tool output carries when it persisted a canvas artifact. */
type ArtifactRef = { artifactId: string; name: string; artifactKind: string };

/** Pull an artifact reference off a tool output, if present + well-formed. */
function extractArtifactRef(output: unknown): ArtifactRef | null {
  if (typeof output !== "object" || output === null) return null;
  const ref = (output as { artifact?: unknown }).artifact;
  if (typeof ref !== "object" || ref === null) return null;
  const r = ref as Record<string, unknown>;
  if (typeof r.artifactId !== "string" || typeof r.name !== "string") {
    return null;
  }
  return {
    artifactId: r.artifactId,
    name: r.name,
    artifactKind:
      typeof r.artifactKind === "string" ? r.artifactKind : "artifact",
  };
}

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

/**
 * All renderable blocks of a message, in part order. A finished tool
 * call whose output carries the table contract expands into TWO blocks:
 * the quiet ghost row, then the table itself — the model never "writes"
 * a table, tools do (D1).
 *
 * Intermediate-fetch rule: within one message, only the LAST table renders
 * inline. Earlier tables are working material the model gathered on the way
 * to its answer (e.g. per-client timesheets feeding a summary sheet) —
 * rendering them all would bury the chat under N grids on an N-client
 * aggregation. They collapse to their ghost row (what was checked, with
 * deterministic counts) + artifact chip (name, period, Open) — every sheet
 * stays one click away in the canvas, the stream stays scannable. A message
 * whose only table IS the answer is unaffected.
 */
export function classifyParts(parts: MessagePartLike[]): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  for (const part of parts) {
    const block = classifyPart(part);
    if (block === null) continue;
    blocks.push(block);
    if (block.kind === "tool" && block.phase === "done") {
      // A finished tool call expands into its result blocks in order: the
      // in-chat table, then the artifact chip that opens the same data in the
      // canvas. The model authors neither — tools do (D1).
      const artifact = extractArtifactRef(block.output);
      if (isAgentTableOutput(block.output)) {
        blocks.push({
          kind: "table",
          table: block.output.table,
          artifactId: artifact?.artifactId ?? null,
        });
      }
      if (artifact) {
        blocks.push({
          kind: "artifact",
          artifactId: artifact.artifactId,
          name: artifact.name,
          artifactKind: artifact.artifactKind,
        });
      }
      // A propose-kind tool's batch expands into ONE proposal block — the
      // cards themselves are live records, referenced by id (slice 08).
      if (isProposalRefsOutput(block.output)) {
        blocks.push({ kind: "proposal", proposalIds: block.output.proposalIds });
      }
    }
  }
  const lastTable = blocks.findLastIndex((b) => b.kind === "table");
  return blocks.filter((b, i) => b.kind !== "table" || i === lastTable);
}

// ─── Tool display (verb + deterministic result summary) ────────────────────

type ToolDisplay = {
  /** Ghost-row verb while the call is in flight ("Reading clients…"). */
  runningLabel: string;
  /** Ghost-row verb once the result landed ("Read client directory"). */
  doneLabel: string;
  /** Deterministic result summary computed from the raw output. */
  summarize: (output: unknown) => string | null;
  /**
   * What the call was about, appended to the verb ("Read comments on
   * ARLO-21"). Derived from the tool's own output (or an identifier-shaped
   * input), never model prose; absent → the bare verb.
   */
  target?: { join: string; of: (input: unknown, output: unknown) => string | null };
};

const IDENTIFIER_SHAPE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** The task a task-addressed read was about: its identifier from the output, else the input ref. */
function taskTarget(input: unknown, output: unknown): string | null {
  const identifier = field(field(output, "task"), "identifier");
  if (typeof identifier === "string" && identifier) return identifier;
  const ref = field(input, "task");
  return typeof ref === "string" && IDENTIFIER_SHAPE.test(ref.trim()) ? ref.trim().toUpperCase() : null;
}

function projectTarget(_input: unknown, output: unknown): string | null {
  const name = field(field(output, "project"), "name");
  return typeof name === "string" && name ? name : null;
}

function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : many}`;
}

function arrayLength(output: unknown, key: string): number | null {
  const value = field(output, key);
  return Array.isArray(value) ? value.length : null;
}

/** found:false outputs of the A3 reads summarize as "not found". */
function notFound(output: unknown): boolean {
  return field(output, "found") === false;
}

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
  collectTimesheetData: {
    runningLabel: "Collecting timesheet data",
    doneLabel: "Collected timesheet data",
    // Counts come from the deterministic tool payload, not model text: the
    // task count from the table, the "summarized N" from the summarize step
    // (slice 05). Both are code-authored numbers.
    summarize: (output) => {
      if (!isAgentTableOutput(output)) return null;
      const taskCount = output.table.rows.length;
      const tasks = `${taskCount} task${taskCount === 1 ? "" : "s"}`;
      const raw = output as unknown as { summarizedCount?: unknown };
      const summarized =
        typeof raw.summarizedCount === "number" ? raw.summarizedCount : null;
      return summarized !== null
        ? `${tasks} · summarized ${summarized}`
        : tasks;
    },
  },
  createSheet: {
    runningLabel: "Creating sheet",
    doneLabel: "Created sheet",
    // Deterministic count from the validated table payload, not model text.
    summarize: (output) => {
      if (!isAgentTableOutput(output)) return null
      const rows = output.table.rows.length
      return `${rows} row${rows === 1 ? "" : "s"}`
    },
  },
  proposeCreateTasks: {
    runningLabel: "Drafting task proposals",
    doneLabel: "Proposed tasks",
    // Count from the deterministic tool payload (batch size), never model text.
    summarize: (output) => {
      if (!isProposalRefsOutput(output)) return null;
      const n = output.proposalIds.length;
      return `${n} proposal${n === 1 ? "" : "s"} awaiting review`;
    },
  },
  proposeArchiveTask: {
    runningLabel: "Drafting archive proposal",
    doneLabel: "Proposed archiving a task",
    summarize: (output) =>
      isProposalRefsOutput(output) ? "awaiting confirmation" : null,
  },
  // A3 read layer — task context & routing. Summaries count the
  // deterministic payload; the target comes from the output.
  getTaskBundle: {
    runningLabel: "Reading task digest",
    doneLabel: "Read task digest",
    target: { join: "for", of: taskTarget },
    summarize: (output) => {
      if (notFound(output)) return "not found";
      const comments = arrayLength(output, "comments");
      const activity = arrayLength(output, "activity");
      const files = arrayLength(output, "files");
      if (comments === null || activity === null || files === null) return null;
      return `${plural(comments, "comment")} · ${plural(activity, "event")} · ${plural(files, "file")}`;
    },
  },
  getTaskComments: {
    runningLabel: "Reading comments",
    doneLabel: "Read comments",
    target: { join: "on", of: taskTarget },
    summarize: (output) => {
      if (notFound(output)) return "not found";
      const n = arrayLength(output, "comments");
      if (n === null) return null;
      const omitted = field(output, "omitted");
      return typeof omitted === "number" && omitted > 0
        ? `${plural(n, "comment")} · ${omitted} older not shown`
        : plural(n, "comment");
    },
  },
  getTaskActivity: {
    runningLabel: "Reading activity",
    doneLabel: "Read activity",
    target: { join: "on", of: taskTarget },
    summarize: (output) => {
      if (notFound(output)) return "not found";
      const events = arrayLength(output, "events");
      const entries = arrayLength(output, "timeEntries");
      if (events === null || entries === null) return null;
      return `${plural(events, "event")} · ${plural(entries, "time entry", "time entries")}`;
    },
  },
  getTaskFiles: {
    runningLabel: "Reading files",
    doneLabel: "Read files",
    target: { join: "on", of: taskTarget },
    summarize: (output) => {
      if (notFound(output)) return "not found";
      const files = arrayLength(output, "files");
      const links = arrayLength(output, "links");
      if (files === null || links === null) return null;
      return links > 0 ? `${plural(files, "file")} · ${plural(links, "link")}` : plural(files, "file");
    },
  },
  getProjectRouting: {
    runningLabel: "Reading project routing",
    doneLabel: "Read routing",
    target: { join: "for", of: projectTarget },
    summarize: (output) => {
      if (notFound(output)) return "not found";
      const n = arrayLength(output, "defaultAssignees");
      return n === null ? null : plural(n, "default assignee");
    },
  },
  // The skill stop-condition tool (slice 04) — when it fires, a skill halted
  // the run. The explanatory block is run-derived; this is just its ghost row.
  [STOP_CONDITION_TOOL_NAME]: {
    runningLabel: "Checking stop-condition",
    doneLabel: "Stop-condition met",
    summarize: () => null,
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

/**
 * Ghost-row verb for a tool call in the given phase. Pass the call's
 * `input` / `output` so task- and project-addressed reads name their
 * target ("Read comments on ARLO-21").
 */
export function toolLabel(
  toolName: string,
  phase: "running" | "done" | "error",
  call?: { input?: unknown; output?: unknown },
): string {
  const display = TOOL_DISPLAY[toolName];
  if (!display) return humanizeToolName(toolName);
  const verb = phase === "running" ? display.runningLabel : display.doneLabel;
  const target = display.target?.of(call?.input, phase === "done" ? call?.output : undefined) ?? null;
  return target ? `${verb} ${display.target!.join} ${target}` : verb;
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
