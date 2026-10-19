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
};

export type MessageStamp = { key: string; role: string; at: number };

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
 * How far after `startedAt` a run's prompt may be stamped: a queued
 * background run saves its prompt in the same transaction that claims it.
 */
export const PROMPT_SLACK_MS = 2_000;

/**
 * The user messages that are a BACKGROUND job's machine prompt (the email
 * the job reads, the facts it drafts from) — the thread shows the job's run
 * line instead of a user turn for them. A person's own turns (an answer run's
 * answer, a typed message) are never hidden. Per job run: the latest user
 * message after the previous run started and at or before this run started;
 * failing that, the first one within PROMPT_SLACK_MS after its start (and
 * before the next run's).
 */
export function backgroundJobPrompts(messages: readonly MessageStamp[], runs: readonly RunWindow[]): Set<string> {
  const hidden = new Set<string>();
  const started = runs.filter(ran).sort((a, b) => a.startedAt - b.startedAt);
  const users = messages.filter((m) => m.role === "user");
  started.forEach((run, i) => {
    if (!run.job || run.via !== "background" || run.answersQuestion) return;
    const after = i > 0 ? started[i - 1].startedAt : -Infinity;
    const before = Math.min(run.startedAt + PROMPT_SLACK_MS, i + 1 < started.length ? started[i + 1].startedAt : Infinity);
    let prompt: MessageStamp | null = null;
    for (const m of users) {
      if (m.at > after && m.at <= run.startedAt && (!prompt || m.at >= prompt.at)) prompt = m;
    }
    if (!prompt) {
      for (const m of users) {
        if (m.at > run.startedAt && m.at < before && (!prompt || m.at < prompt.at)) prompt = m;
      }
    }
    if (prompt) hidden.add(prompt.key);
  });
  return hidden;
}
