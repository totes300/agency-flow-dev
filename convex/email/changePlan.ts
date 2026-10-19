/**
 * A change on a linked task — pure checks (docs/prd-email-triage.md D4, D29,
 * §5.3 linked rows, I12; implementation plan B6b). No Convex, no I/O:
 * unit-tested in email/__tests__/changePlan.test.ts. The Convex side
 * (email/changes.ts) resolves the conversation's ledger and the task's
 * subtasks, then calls these on the `proposeTaskUpdate` input of a
 * prepareChange run (or the dev fake change):
 *
 *   checkChangePlan    ERRORS (unknown / foreign request ids, a row named
 *                      twice, a dismissed row without a reason …) are refused;
 *                      GAPS (an unresolved row the change neither covers,
 *                      cancels nor dispositions; a constraint missing from the
 *                      covering subtask title) get one retry, then the change
 *                      is stored with them marked — like B6a's plan
 *   needsReopen        the proposal reopens the task when it holds the
 *                      admin_review / client_review role or is done
 *   changeCoverage     which row each add / amend / cancel / disposition takes
 *                      (Apply converts the ledger from it)
 */

import {
  containsVerbatim,
  DESCRIPTION_CONSTRAINT_KINDS,
  isUnresolvedRow,
  type PlanCheck,
  type PlanGap,
  type PlanLedgerRow,
} from "./plan";

export type ChangeDisposition = "answered" | "dismissed" | "question_pending";

export type ChangePlanInput = {
  add: ReadonlyArray<{ title: string; requestIds: readonly string[] }>;
  /** `currentTitle`: the subtask's title now (an amend without a title keeps it). */
  amend: ReadonlyArray<{ subtaskId: string; title?: string; currentTitle: string; requestIds: readonly string[] }>;
  cancel: ReadonlyArray<{ subtaskId: string; requestIds: readonly string[] }>;
  dispositions: ReadonlyArray<{ requestId: string; disposition: ChangeDisposition; reason?: string; question?: string }>;
};

export type ChangeCoverage =
  | { requestId: string; by: "add"; index: number }
  | { requestId: string; by: "amend"; subtaskId: string }
  | { requestId: string; by: "cancel"; subtaskId: string }
  | { requestId: string; by: "disposition"; disposition: ChangeDisposition; reason?: string; question?: string };

const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Every row the change names, with what names it (first one wins; duplicates are an error in the check). */
export function changeCoverage(input: ChangePlanInput): ChangeCoverage[] {
  const out: ChangeCoverage[] = [];
  input.add.forEach((a, index) => a.requestIds.forEach((requestId) => out.push({ requestId, by: "add", index })));
  for (const a of input.amend) for (const requestId of a.requestIds) out.push({ requestId, by: "amend", subtaskId: a.subtaskId });
  for (const c of input.cancel) for (const requestId of c.requestIds) out.push({ requestId, by: "cancel", subtaskId: c.subtaskId });
  for (const d of input.dispositions) {
    out.push({ requestId: d.requestId, by: "disposition", disposition: d.disposition, reason: d.reason, question: d.question });
  }
  return out;
}

/**
 * The code checks of a change (I12 on a linked task, D13 titles). Every
 * unresolved row of the conversation must be covered by an added or amended
 * subtask, answered by a cancelled one, or get a disposition.
 */
export function checkChangePlan(input: ChangePlanInput, rows: readonly PlanLedgerRow[]): PlanCheck {
  const errors: string[] = [];
  const gaps: PlanGap[] = [];
  const rowById = new Map(rows.map((r) => [r.id, r] as const));
  const coverage = changeCoverage(input);

  const named = new Map<string, number>();
  for (const c of coverage) {
    if (!rowById.has(c.requestId)) {
      errors.push(`Unknown request "${c.requestId}" — use an id from getThreadRequests.`);
      continue;
    }
    named.set(c.requestId, (named.get(c.requestId) ?? 0) + 1);
  }
  for (const [id, n] of named) {
    if (n > 1) errors.push(`Request ${id} is named ${n} times — give it one place (one subtask or one disposition).`);
  }
  input.add.forEach((a, i) => {
    if (!a.title.trim()) errors.push(`addSubtasks[${i}].title is empty.`);
  });
  input.dispositions.forEach((d, i) => {
    if (d.disposition === "dismissed" && !d.reason?.trim()) errors.push(`dispositions[${i}]: "dismissed" needs a reason (I12).`);
    if (d.disposition === "question_pending" && !d.question?.trim()) {
      errors.push(`dispositions[${i}]: "question_pending" needs the question.`);
    }
  });
  if (errors.length > 0) return { errors, gaps };

  for (const row of rows) {
    if (isUnresolvedRow(row) && !named.has(row.id)) {
      gaps.push({ kind: "missing_disposition", requestId: row.id, detail: `Not covered: "${short(row.text)}"` });
    }
  }
  // Constraints of a row covered by an added / amended subtask go into its title verbatim (D13).
  for (const c of coverage) {
    if (c.by !== "add" && c.by !== "amend") continue;
    const row = rowById.get(c.requestId)!;
    if (!isUnresolvedRow(row)) continue;
    const title =
      c.by === "add"
        ? input.add[c.index].title
        : (() => {
            const a = input.amend.find((x) => x.subtaskId === c.subtaskId)!;
            return a.title ?? a.currentTitle;
          })();
    for (const k of row.constraints) {
      if (DESCRIPTION_CONSTRAINT_KINDS.has(k.kind)) continue; // the change carries no description
      if (!containsVerbatim(title, k.value)) {
        gaps.push({
          kind: "constraint_not_in_title",
          requestId: row.id,
          detail: `${k.kind} "${k.value}" is not in the subtask title "${short(title, 80)}"`,
        });
      }
    }
  }
  return { errors, gaps };
}

/** The model-facing retry message for a change with gaps. */
export function formatChangeGaps(gaps: readonly PlanGap[]): string {
  const lines = gaps.map((g) =>
    g.kind === "missing_disposition"
      ? `- request ${g.requestId} is not covered (${g.detail}) — add or amend a subtask for it (requestIds), cancel one, or give it a disposition`
      : `- request ${g.requestId}: ${g.detail} — put the value in the title exactly as the client wrote it`,
  );
  return "The change was NOT saved — fix these and call proposeTaskUpdate again:\n" + lines.join("\n");
}

/** D4: a change reopens the task when it holds a review role or is done. */
export function needsReopen(args: { workflowRole?: string | null; closed: boolean }): boolean {
  return args.workflowRole === "admin_review" || args.workflowRole === "client_review" || args.closed;
}
