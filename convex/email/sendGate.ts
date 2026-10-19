/**
 * The "Approve & send" gate (docs/prd-email-triage.md §6.7 gate table, the
 * "Approve & send" column; D9, I4, I9, I12, §5.5). ONE pure function, used
 * at approve time, again when the dispatch claims the draft (a change during
 * the 15 s window refuses the send) and on Retry:
 *
 *   condition                                         →  result
 *   ───────────────────────────────────────────────────────────────────────
 *   the version shown ≠ the draft's / the draft is stale  block  review_again
 *   a change proposal is pending / failed on the task (I9) block pending_change
 *     ("Discard or retry the pending change on ‹task›")
 *   the sending mailbox is not connected                  block  reconnect
 *   an open ledger row not answered by this draft (I12)   block  open_requests
 *     (completion / reply)   ·   any other kind            warn   open_requests
 *   the approver is not an admin (incl. a member's draft) block  not_admin
 *   no recipient                                          block  no_recipient
 *   an attachment can't be read / is too large            block  attachments
 *   a recipient not on the thread / replyCc (I2)          warn   new_recipient
 *   a pending question in the draft's conversation        warn   pending_question
 *   any pre-send review finding for this version          warn   presend:<key>
 *
 * Warnings never stop a send; the ones shown are recorded with the approval
 * (`approval.warningsAcknowledged`, "choice logged").
 */

export type GateRow = { key: string; text: string };
export type SendGateResult = { blocks: GateRow[]; warnings: GateRow[] };

export type SendGateDraft = {
  kind: string;
  version: number;
  stale?: { reason: string; at: number };
  to: ReadonlyArray<{ email: string; newRecipient?: boolean }>;
  cc: ReadonlyArray<{ email: string; newRecipient?: boolean }>;
  createdBy: string;
};

export type SendGateContext = {
  /** The version the approver saw (D9: approval binds exactly this version). */
  expectedVersion: number;
  approver: { isAdmin: boolean };
  /** The draft was created by a member ("Save draft for …"). */
  createdByMember: boolean;
  /**
   * I9: an `updateTask` proposal is pending — or failed, which is retryable
   * and still undecided — on the draft's task; `task` names it for the fix.
   */
  pendingChange: { task: string } | null;
  /** The sending mailbox (D35). */
  mailbox: { connected: boolean; label: string };
  /**
   * I12: ledger rows of the conversation still `open` and not in the
   * draft's `answersRequestIds` (`covered` / `answered` / `question_pending`
   * / `dismissed` / `superseded` rows never count).
   */
  openRequests: ReadonlyArray<{ id: string; text: string }>;
  pendingQuestion: boolean;
  /** `warn` / `block` results of the presend `agentChecks` row for this version. */
  presendFindings: ReadonlyArray<{ key: string; text: string }>;
  /** Attachment problems found by the caller (missing file, total too large). */
  attachmentProblems: readonly string[];
};

/**
 * Kinds for which an unanswered request blocks the send. A completion or a
 * reply claims to answer the client, so a request it silently skips would be
 * lost (I12). The kickoff (D21) — and the other short kinds (question, nudge,
 * interim, recap, follow_up) — go out while the work is still running: the
 * open rows are the very work the kickoff announces, so they only warn.
 */
export const OPEN_REQUESTS_BLOCK_KINDS: ReadonlySet<string> = new Set(["completion", "reply"]);

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};

export function sendGate(draft: SendGateDraft, ctx: SendGateContext): SendGateResult {
  const blocks: GateRow[] = [];
  const warnings: GateRow[] = [];

  if (ctx.expectedVersion !== draft.version) {
    blocks.push({ key: "review_again", text: `This draft changed (now v${draft.version}) — review it again.` });
  } else if (draft.stale) {
    const reason = draft.stale.reason;
    blocks.push({
      key: "review_again",
      text: /review again$/i.test(reason) ? `${reason}.` : `${reason} — review the draft again.`,
    });
  }
  if (ctx.pendingChange) {
    blocks.push({ key: "pending_change", text: `Discard or retry the pending change on ${ctx.pendingChange.task}.` });
  }
  if (!ctx.mailbox.connected) {
    blocks.push({ key: "reconnect", text: `Reconnect ${ctx.mailbox.label} to send.` });
  }
  if (ctx.openRequests.length > 0) {
    const first = quote(ctx.openRequests[0].text);
    const more = ctx.openRequests.length > 1 ? ` (+${ctx.openRequests.length - 1} more)` : "";
    const row = { key: "open_requests", text: `Not answered yet: "${first}"${more}` };
    if (OPEN_REQUESTS_BLOCK_KINDS.has(draft.kind)) blocks.push(row);
    else warnings.push(row);
  }
  if (!ctx.approver.isAdmin) {
    blocks.push({
      key: "not_admin",
      text: ctx.createdByMember
        ? "Saved for an admin — only an admin can approve and send it."
        : "Only an admin can approve and send email.",
    });
  }
  if (draft.to.length === 0) {
    blocks.push({ key: "no_recipient", text: "Add a recipient." });
  }
  for (const problem of ctx.attachmentProblems) {
    blocks.push({ key: "attachments", text: problem });
  }

  const added = [...draft.to, ...draft.cc].filter((r) => r.newRecipient).map((r) => r.email);
  if (added.length > 0) {
    warnings.push({ key: "new_recipient", text: `Not on this conversation before: ${added.join(", ")}` });
  }
  if (ctx.pendingQuestion) {
    warnings.push({ key: "pending_question", text: "A question in this conversation is still unanswered." });
  }
  for (const f of ctx.presendFindings) {
    warnings.push({ key: `presend:${f.key}`, text: f.text });
  }
  return { blocks, warnings };
}

/** The recorded form of a warning ("key: text") — what `warningsAcknowledged` stores. */
export const warningLabel = (w: GateRow) => `${w.key}: ${w.text}`;
