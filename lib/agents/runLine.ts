/**
 * The run line of a job run (email-triage B8a; PRD §6.5, §7.1 "run line";
 * memory: agent progress UI). Pure view model over the job's fixed stages
 * (`JOB_STAGES`) and the run's REAL tool calls — never a script, never the
 * model reporting progress:
 *
 *   running   a step list (done / working / pending) + a live
 *             "‹current stage›… · 4s" line;
 *   finished  ONE line: what was read, with the duration
 *             ("Read the email, 2 attachments and ARL-57 · 6s").
 *
 * Every string is computed from tool names, inputs and outputs (D1). No
 * React, no Convex — unit-tested in runLine.test.ts.
 */

import { toolResultSummary } from "./blocks";
import {
  attributeCalls,
  computeStageStates,
  type JobStage,
  type JobStageState,
  type StageRunStatus,
} from "./jobStages";

/** One tool call of the run, as the classifier sees it. */
export type RunToolCall = {
  toolName: string;
  phase: "running" | "done" | "error";
  input: unknown;
  output: unknown;
};

export type RunLineStep = {
  key: string;
  label: string;
  state: JobStageState;
  /** Deterministic result summaries of the stage's finished calls ("5 requests · 2 messages"). */
  detail: string | null;
};

export type RunLineView = {
  steps: RunLineStep[];
  /** The live line's stage while the run is live, else null. */
  current: string | null;
  /** The collapsed one-liner, without the duration. */
  summary: string;
  live: boolean;
  /** Tool calls that failed — the summary says so and the line starts expanded. */
  failed: number;
};

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

const TASK_READS = new Set([
  "getTaskBundle",
  "getReplyTaskBundle",
  "getTaskDetail",
  "getTaskComments",
  "getTaskActivity",
  "getTaskFiles",
]);

/** The task a task read was about: its identifier (else id) from the output, else the input ref. */
function taskOf(call: RunToolCall): string | null {
  const task = field(call.output, "task");
  const identifier = field(task, "identifier");
  if (typeof identifier === "string" && identifier) return identifier;
  const id = field(task, "id");
  if (typeof id === "string" && id) return id;
  const ref = field(call.input, "task");
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

/** "a", "a and b", "a, b and c". */
export function joinPhrases(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What the run read, as one phrase list in first-seen order: the email, N
 * attachments, one task by its identifier or "N related tasks", similar
 * work (canvas v7: "Read the email, 2 attachments and 3 related tasks").
 * The request ledger is part of the email; setup reads (team, routing,
 * clients, projects, categories, statuses) and writes are not "read" — their
 * results show on the steps. Failed calls count as nothing; found:false task
 * reads too.
 */
export function readPhrases(calls: readonly RunToolCall[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const files = new Set<string>();
  const tasks = new Set<string>();
  const mark = (slot: string) => {
    if (!seen.has(slot)) {
      seen.add(slot);
      order.push(slot);
    }
  };
  for (const call of calls) {
    if (call.phase !== "done") continue;
    if (call.toolName === "getEmailThread") mark("email");
    else if (call.toolName === "getAttachmentText") {
      const name = field(field(call.output, "file"), "name");
      files.add(typeof name === "string" ? name : JSON.stringify(call.input ?? null));
      mark("files");
    } else if (TASK_READS.has(call.toolName)) {
      if (field(call.output, "found") === false) continue;
      const task = taskOf(call);
      if (task) tasks.add(task);
      mark("tasks");
    } else if (call.toolName === "findSimilarTasksForClient") mark("similar");
  }
  return order.map((slot) => {
    switch (slot) {
      case "email":
        return "the email";
      case "files":
        return `${files.size} attachment${files.size === 1 ? "" : "s"}`;
      case "tasks": {
        const [only] = [...tasks];
        if (tasks.size === 1 && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(only)) return only.toUpperCase();
        return `${tasks.size} related task${tasks.size === 1 ? "" : "s"}`;
      }
      default:
        return "similar work";
    }
  });
}

/** "6s" · "1m 4s" · "2m" — the run line's duration and elapsed timer. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const DETAIL_PARTS_MAX = 3;

/**
 * The run line of one job run. While the run is live and no stage is
 * `working` yet (before its first tool, or between a stage's last call and
 * the next stage's first one when that stage has no tools), the first pending
 * stage shows as working — the live line always names a real stage.
 */
export function runLineView(
  stages: readonly JobStage[],
  calls: readonly RunToolCall[],
  status: StageRunStatus,
): RunLineView {
  const names = calls.map((c) => c.toolName);
  const states = computeStageStates(stages, names, status);
  const live = status === "running" || status === "queued";
  if (live && !states.some((s) => s.state === "working")) {
    const firstPending = states.findIndex((s) => s.state === "pending");
    if (firstPending >= 0) states[firstPending] = { ...states[firstPending], state: "working" };
  }

  const owners = attributeCalls(stages, names);
  const steps: RunLineStep[] = states.map((s, i) => {
    const parts: string[] = [];
    calls.forEach((call, c) => {
      if (owners[c] !== i || call.phase !== "done") return;
      const summary = toolResultSummary(call.toolName, call.output);
      if (summary && !parts.includes(summary)) parts.push(summary);
    });
    return {
      ...s,
      detail: parts.length > 0 ? parts.slice(0, DETAIL_PARTS_MAX).join(" · ") : null,
    };
  });

  const current = live ? (steps.find((s) => s.state === "working")?.label ?? null) : null;
  const phrases = readPhrases(calls);
  let summary: string;
  if (phrases.length > 0) summary = `Read ${joinPhrases(phrases)}`;
  else {
    const reached = [...steps].reverse().find((s) => s.state === "done" || s.state === "stopped");
    summary = reached?.label ?? stages[0]?.label ?? "Worked";
  }
  if (!live && status !== "succeeded") {
    const stoppedAt = steps.find((s) => s.state === "stopped");
    summary = stoppedAt ? `${summary} · stopped at “${stoppedAt.label}”` : `${summary} · stopped`;
  }
  const failed = calls.filter((c) => c.phase === "error").length;
  if (failed > 0) summary = `${summary} · ${failed} failed`;
  return { steps, current, summary, live, failed };
}
