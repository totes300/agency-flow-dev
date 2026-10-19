/**
 * The email-draft block (email-triage B6b marker, B8a component). The
 * `submitDraft` tool returns `{ block: AGENT_EMAIL_DRAFT_MARKER, draftId,
 * version }`; the conversation renders the draft from the live `emailDrafts`
 * record (`email/drafts.getDraft`), never from the message. This module also
 * owns the component's pure display rules (labels, countdown, the fix for a
 * failed send, recipient text) so they are unit-tested without React.
 *
 * Client-safe (no Convex imports).
 */
export const AGENT_EMAIL_DRAFT_MARKER = "agency-flow/email-draft@1";

export type EmailDraftRefOutput = { block: typeof AGENT_EMAIL_DRAFT_MARKER; draftId: string };

export function isEmailDraftRefOutput(output: unknown): output is EmailDraftRefOutput {
  if (typeof output !== "object" || output === null) return false;
  const o = output as Record<string, unknown>;
  return o.block === AGENT_EMAIL_DRAFT_MARKER && typeof o.draftId === "string" && o.draftId.length > 0;
}

/** The undo window the send pipeline holds a queued email for (mirrors `email/send.ts` UNDO_WINDOW_MS). */
export const UNDO_WINDOW_SECONDS = 15;

/** The Connectors view, where a mailbox is reconnected. */
export const RECONNECT_HREF = "/agents?view=connectors";

/** Whole seconds left until `sendAt` (rounded up, never below 0). */
export function secondsUntil(sendAt: number, now: number): number {
  return Math.max(0, Math.ceil((sendAt - now) / 1000));
}

/** Who made the version shown — the header's suffix. */
export type DraftLastEdit = { by: "agent" } | { by: "user"; isViewer: boolean; name: string | null } | null;

/** "v1" · "v2 · rewritten" · "v3 · edited by you" · "v3 · edited by Anna". */
export function draftVersionLabel(version: number, lastEdit: DraftLastEdit): string {
  const v = `v${version}`;
  if (version <= 1 || !lastEdit) return v;
  if (lastEdit.by === "agent") return `${v} · rewritten`;
  if (lastEdit.isViewer) return `${v} · edited by you`;
  return lastEdit.name ? `${v} · edited by ${lastEdit.name}` : `${v} · edited`;
}

/** The one primary action: a completion is approved as an exact version (D9), the rest are sent. */
export function sendButtonLabel(kind: string, version: number): string {
  return kind === "completion" ? `Approve & send v${version}` : "Send";
}

/** "Needs your approval" · "Needs your approval · 1 warning". */
export function approvalLabel(warningCount: number): string {
  if (warningCount <= 0) return "Needs your approval";
  return `Needs your approval · ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
}

/** "Sent in Kovács Réka's thread" — the first recipient's name (or address); a new conversation: "Sent". */
export function sentLabel(inThread: boolean, to: ReadonlyArray<{ name?: string; email: string }>): string {
  const first = to[0];
  if (!inThread || !first) return "Sent";
  const who = first.name?.trim() || first.email;
  return `Sent in ${who}’s thread`;
}

/** The fix a failed send offers (§5.4, D9: Reconnect only when the mailbox is disconnected). */
export type FailureFix = "reconnect" | "retry" | "recipients";

export function failureFix(kind: string): FailureFix {
  if (kind === "disconnected" || kind === "permission") return "reconnect";
  if (kind === "recipient") return "recipients";
  return "retry"; // quota, transient, unknown
}

/**
 * The primary action of a FAILED draft (B8a): `retry` while its approval
 * still binds it (`getDraft.retryable`), `approve` — a fresh "Approve & send
 * vN" — once it no longer does (the mailbox was reconnected or changed), and
 * none while the fix is the person's (reconnect first, edit the recipients).
 */
export function failedPrimary(args: {
  kind: string | null;
  mailboxConnected: boolean;
  retryable: boolean;
}): "retry" | "approve" | null {
  const fix = args.kind ? failureFix(args.kind) : "retry";
  if (fix === "recipients") return null;
  if (fix === "reconnect" && !args.mailboxConnected) return null;
  return args.retryable ? "retry" : "approve";
}

/** The re-approval label of a failed draft: always an exact version (D9). */
export function reapproveLabel(version: number): string {
  return `Approve & send v${version}`;
}

export type Recipient = { name?: string; email: string; newRecipient?: boolean };

/** The editable To / Cc text: addresses, comma-separated. */
export function formatRecipients(list: ReadonlyArray<Recipient>): string {
  return list.map((r) => r.email).join(", ");
}

/**
 * Parse the To / Cc text back into recipients: split on commas, semicolons
 * and whitespace, drop empties and duplicates (case-insensitive), keep the
 * known name of an address that was already there. `<…>` wrappers are
 * stripped ("Réka <reka@x.hu>" keeps only the address). The server validates
 * the addresses and flags new ones (I2).
 */
export function parseRecipients(text: string, existing: ReadonlyArray<Recipient>): Array<{ name?: string; email: string }> {
  const known = new Map(existing.map((r) => [r.email.toLowerCase(), r]));
  const out: Array<{ name?: string; email: string }> = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\s]+/)) {
    const email = raw.replace(/^<|>$/g, "").trim();
    if (!email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = known.get(key);
    out.push(prior?.name ? { name: prior.name, email: prior.email } : { email: prior?.email ?? email });
  }
  return out;
}

/** True when the parsed recipients equal the current list (order and addresses). */
export function sameRecipients(a: ReadonlyArray<{ email: string }>, b: ReadonlyArray<{ email: string }>): boolean {
  return a.length === b.length && a.every((r, i) => r.email.toLowerCase() === b[i].email.toLowerCase());
}
