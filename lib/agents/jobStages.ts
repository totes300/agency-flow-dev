/**
 * Fixed run stages of `agent_run` jobs (PRD §6.5; implementation plan §3 P2).
 *
 * Pure and client-safe: the job registry (convex/lib/agentJobs.ts) takes each
 * job's `stages` from `JOB_STAGES`, and the run line (B8) renders the same
 * list. Stage state is DERIVED from the run's real tool events — never from
 * a script, never from the model reporting progress:
 *
 *   - `pending`  no tool of the stage has run yet;
 *   - `working`  the stage is the furthest one reached and the run is live
 *                (one of its tools is in flight, or the model is between
 *                that stage's calls);
 *   - `done`     a LATER stage's tool has run, or the run succeeded;
 *   - `stopped`  the furthest stage reached when the run ended without
 *                succeeding (failed / cancelled / stopped by a skill).
 *
 * A stage with no tools (a pure "write the answer" stage) is never reached
 * by a tool event; it reads `pending` until the run succeeds.
 */

export type JobStage = {
  /** Stable key (code), e.g. `"gather"`. */
  key: string;
  /** Human label the run line shows, e.g. `"Reading the thread"`. */
  label: string;
  /** Registry tool names whose calls belong to this stage. */
  tools: readonly string[];
};

export type JobStageState = "pending" | "working" | "done" | "stopped";

export type JobStageView = { key: string; label: string; state: JobStageState };

/**
 * The job → stages map. Filled by the B-phase jobs (prepareTask, draftReply,
 * presendReview, handoverQA); empty until then.
 */
export const JOB_STAGES: Readonly<Record<string, readonly JobStage[]>> = {};

/** Run outcome as the stage line needs it (mirrors `agentRuns.status`). */
export type StageRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stopped_by_skill";

/** The minimal shape of a UI message part this module reads. */
export type ToolPartLike = { type: string; toolName?: string };

/**
 * Tool names, in call order, from a run's UI message parts: static tool
 * parts (`tool-<name>`) and dynamic ones (`dynamic-tool` + `toolName`).
 * Every other part (text, reasoning, step-start, …) is ignored.
 */
export function toolNamesFromParts(parts: readonly ToolPartLike[]): string[] {
  const names: string[] = [];
  for (const part of parts) {
    if (part.type === "dynamic-tool") {
      if (part.toolName) names.push(part.toolName);
    } else if (part.type.startsWith("tool-")) {
      names.push(part.type.slice("tool-".length));
    }
  }
  return names;
}

/**
 * Stage states for one run from its tool calls (in order) and its status.
 *
 * A call is attributed to the EARLIEST stage at or after the current one
 * that lists the tool — so a tool shared by two stages does not jump ahead,
 * and a later stage's tool advances the run. A call to a tool only listed by
 * an earlier stage (re-reading something) never moves the run backwards.
 * Tools outside every stage are ignored.
 */
export function computeStageStates(
  stages: readonly JobStage[],
  toolNames: readonly string[],
  status: StageRunStatus,
): JobStageView[] {
  let current = -1;
  for (const name of toolNames) {
    const ahead = stages.findIndex(
      (stage, i) => i >= Math.max(current, 0) && stage.tools.includes(name),
    );
    if (ahead > current) current = ahead;
  }

  const live = status === "running" || status === "queued";
  return stages.map((stage, i) => {
    let state: JobStageState;
    if (status === "succeeded") state = "done";
    else if (i < current) state = "done";
    else if (i === current) state = live ? "working" : "stopped";
    else state = "pending";
    return { key: stage.key, label: stage.label, state };
  });
}
