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
 * The job → stages map. B6a: prepareTask; B6b: draftReply, prepareChange;
 * later presendReview, handoverQA.
 */
export const JOB_STAGES: Readonly<Record<string, readonly JobStage[]>> = {
  // PRD §6.1 / §6.5 — the Triage run line.
  prepareTask: [
    { key: "read", label: "Read the email", tools: ["getEmailThread", "getAttachmentText", "getThreadRequests"] },
    {
      key: "check",
      label: "Check related work",
      tools: [
        "findSimilarTasksForClient",
        "getTaskBundle",
        "getProjectRouting",
        "listTeamMembers",
        "listWorkCategories",
        "listStatuses",
        "listProjects",
        "listClients",
      ],
    },
    { key: "plan", label: "Prepare the plan", tools: ["submitTriagePlan", "askUser"] },
  ],
  // PRD §6.1 kickoff / Q7 reply (B6b).
  draftReply: [
    { key: "read", label: "Read the conversation", tools: ["getEmailThread", "getThreadRequests", "getReplyTaskBundle", "listTeamMembers"] },
    { key: "draft", label: "Write the email", tools: ["submitDraft"] },
  ],
  // PRD D4 / D29 (B6b).
  prepareChange: [
    { key: "read", label: "Read the email", tools: ["getEmailThread", "getThreadRequests"] },
    { key: "check", label: "Check the task", tools: ["getTaskBundle", "listTeamMembers"] },
    { key: "plan", label: "Prepare the change", tools: ["proposeTaskUpdate", "askUser"] },
  ],
};

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
 * The stage each call belongs to (same order as `toolNames`; -1 = outside
 * every stage). A call is attributed to the EARLIEST stage at or after the
 * furthest one reached that lists the tool; a call to a tool only listed by an
 * earlier stage (re-reading something) belongs to the stage reached so far,
 * so the run never moves backwards. The run line groups its quiet tool rows
 * and its per-stage detail by this.
 */
export function attributeCalls(stages: readonly JobStage[], toolNames: readonly string[]): number[] {
  let current = -1;
  return toolNames.map((name) => {
    const ahead = stages.findIndex((stage, i) => i >= Math.max(current, 0) && stage.tools.includes(name));
    if (ahead > current) current = ahead;
    if (ahead >= 0) return ahead;
    return stages.some((stage) => stage.tools.includes(name)) ? current : -1;
  });
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
  const current = Math.max(-1, ...attributeCalls(stages, toolNames));

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
