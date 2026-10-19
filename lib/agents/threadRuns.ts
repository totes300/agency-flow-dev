/**
 * Which run a thread message belongs to (email-triage B8a) — the grouping
 * the thread view needs to render a JOB run as one run line plus its
 * deliverable. Runs of one thread never overlap (per-thread run lock, I11),
 * so a message belongs to the run whose window contains its creation time.
 *
 * Pure — no React, no Convex; unit-tested in threadRuns.test.ts.
 */

export type RunWindow = {
  id: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  job: string | null;
  via: "user" | "background";
  /** Started by a question answer (A5) — its prompt IS the user's answer. */
  answersQuestion: boolean;
  /**
   * The run actually started (`listRuns.started`): false for a still-queued
   * row, one cancelled while queued and one refused at claim — they own no
   * messages and must never capture another run's.
   */
  started: boolean;
  /** The message this run saved as its prompt (`agentRuns.promptMessageId`). */
  promptMessageId: string | null;
};

/** A run that actually ran (not a still-queued, cancelled-before-start or refused-at-claim row). */
function ran(run: RunWindow): boolean {
  return run.started && run.status !== "queued";
}

/**
 * The run a message was written in: the latest run that started at or before
 * it and had not finished before it. Null for messages outside every run
 * (code-posted messages such as event lines between runs).
 */
export function runAt(runs: readonly RunWindow[], at: number): RunWindow | null {
  let best: RunWindow | null = null;
  for (const run of runs) {
    if (!ran(run) || run.startedAt > at) continue;
    if (run.finishedAt !== null && at > run.finishedAt) continue;
    if (!best || run.startedAt > best.startedAt) best = run;
  }
  return best;
}

/**
 * The prompt messages to hide: a BACKGROUND job run's machine prompt (the
 * email the job reads, the facts it drafts from) — the thread shows the job's
 * run line instead of a user turn for it. Keyed on the exact message id each
 * run recorded when it saved its prompt (`agentRuns.promptMessageId`) — never
 * on timestamps, which don't order reliably against `startedAt`. A person's
 * own turns are never hidden: a typed message (`via: "user"`), an answer
 * run's prompt (it IS the user's answer, A5).
 */
export function backgroundJobPrompts(runs: readonly RunWindow[]): Set<string> {
  const hidden = new Set<string>();
  for (const run of runs) {
    if (!run.promptMessageId || !run.job || run.via !== "background" || run.answersQuestion) continue;
    hidden.add(run.promptMessageId);
  }
  return hidden;
}

/**
 * Where a run's own timeline lines (run line, "skill loaded" notes) sort: its
 * start, or its prompt message when that was stamped later — so a shown
 * prompt (a typed turn, an answer) always sits above the run it started.
 */
export function runAnchor(run: Pick<RunWindow, "startedAt" | "promptMessageId">, promptTimes: ReadonlyMap<string, number>): number {
  const promptAt = run.promptMessageId ? promptTimes.get(run.promptMessageId) : undefined;
  return promptAt === undefined ? run.startedAt : Math.max(run.startedAt, promptAt);
}
