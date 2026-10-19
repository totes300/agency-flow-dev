/**
 * The Triage row state (docs/prd-email-triage.md §7.2, D21, D26; B8b): one
 * label and a dot tone, DERIVED from the item and its linked run, question,
 * plan and draft — never stored (schema comment on `agentItems`).
 *
 *   waiting  amber — it waits on you (a plan, a question, a draft, a fix)
 *   progress grey  — the assistant is on it, or nothing to do right now
 *   done     green — the item's last step is done (D26)
 *
 * Pure — shared by the Convex read model (`email/triageView.ts`) and tests.
 */

export type TriageTone = "waiting" | "progress" | "done"

export type TriageState = {
  label: string
  tone: TriageTone
  /** The assistant is working (the row shows live dots instead of the dot). */
  live: boolean
  /** Not looked at yet (no plan, nothing prepared): the row title is bold. */
  fresh: boolean
}

export type TriageItemKind =
  | "request"
  | "change"
  | "question"
  | "approval"
  | "needs_look"
  | "waiting"
  | "attention"
  | "new_sender"

export type TriageItemStatus = "open" | "snoozed" | "done" | "filtered"

export type TriageOutcome =
  | "created"
  | "merged"
  | "declined"
  | "replied"
  | "replied_in_gmail"
  | "marked_done"
  | "kept"
  | "applied"
  | "not_a_change"

export type TriageDraftStatus = "draft" | "queued" | "dispatching" | "sent" | "failed" | "unknown" | "discarded"

export type TriageStateFacts = {
  status: TriageItemStatus
  kind: TriageItemKind
  outcome?: TriageOutcome | null
  /** The first failed message's reason (an attention, I5). */
  attentionMessage?: string | null
  planIssue?: { kind?: "no_actor" | "start_failed" | "run_incomplete"; message: string } | null
  /** A job start is scheduled, or a run is queued / running on the item's thread. */
  running: boolean
  /** A pending question block waits for an answer. */
  pendingQuestion: boolean
  /** What the owner committed (Create / Merge / Apply) — the kickoff step is due (D21). */
  committed?: "created" | "merged" | "applied" | null
  /** The item's reply / kickoff draft. */
  draftStatus?: TriageDraftStatus | null
  /** Live (pending / failed) plan tasks. */
  planTaskCount: number
  /** The plan is "reply instead of a task". */
  planIsReply: boolean
  /** A change proposal on the linked task is ready. */
  changeReady: boolean
}

export const OUTCOME_LABELS: Record<TriageOutcome, string> = {
  created: "Created",
  merged: "Merged",
  applied: "Applied",
  declined: "Declined",
  replied: "Reply sent",
  replied_in_gmail: "Replied in Gmail",
  marked_done: "Marked done",
  kept: "Kept in Client review",
  not_a_change: "Not a change",
}

const COMMITTED_LABELS = { created: "Created", merged: "Merged", applied: "Applied" } as const

/** Long reasons are cut so a row stays one line (the detail shows the whole text). */
export const STATE_LABEL_MAX = 48

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  // A trailing "— Retry" belongs on the button, not in the label.
  const bare = flat.replace(/\s+[—-]\s+Retry\.?$/i, "")
  return bare.length > STATE_LABEL_MAX ? `${bare.slice(0, STATE_LABEL_MAX - 1)}…` : bare
}

const state = (label: string, tone: TriageTone, extra: Partial<Pick<TriageState, "live" | "fresh">> = {}): TriageState => ({
  label,
  tone,
  live: extra.live ?? false,
  fresh: extra.fresh ?? false,
})

const DRAFT_EDITABLE: ReadonlySet<TriageDraftStatus> = new Set(["draft", "failed", "unknown"])
const DRAFT_SENDING: ReadonlySet<TriageDraftStatus> = new Set(["queued", "dispatching"])

/** The row's label + tone, first match wins (unit-tested row by row). */
export function deriveTriageState(f: TriageStateFacts): TriageState {
  if (f.status === "filtered") return state("Filtered", "progress")
  if (f.status === "done") return state(f.outcome ? OUTCOME_LABELS[f.outcome] : "Done", "done")
  // A failed processing stage blocks every decision until Retry (I5).
  if (f.attentionMessage) return state(clip(f.attentionMessage), "waiting")
  if (f.draftStatus && DRAFT_SENDING.has(f.draftStatus)) return state("Sending…", "progress", { live: true })
  // A live re-plan wins over Snoozed: nothing may be decided on a plan in flight.
  if (f.running) return state("Preparing…", "progress", { live: true })
  if (f.status === "snoozed") return state("Snoozed", "progress")
  if (f.planIssue) {
    return state(f.planIssue.kind === "no_actor" ? "No agent actor set" : clip(f.planIssue.message), "waiting")
  }
  if (f.pendingQuestion) return state("A question for you", "waiting")
  if (f.committed) {
    if (f.draftStatus && DRAFT_EDITABLE.has(f.draftStatus)) return state("Kickoff ready", "waiting")
    return state(COMMITTED_LABELS[f.committed], "progress")
  }
  if (f.kind === "change") return f.changeReady ? state("Change ready", "waiting") : state("New", "progress", { fresh: true })
  if (f.kind === "approval") return state("Client approved", "waiting")
  if (f.kind === "needs_look") return state("Needs a look", "waiting")
  if (f.planIsReply || f.kind === "question") {
    if (f.draftStatus && DRAFT_EDITABLE.has(f.draftStatus)) return state("Reply ready", "waiting")
  }
  if (f.planTaskCount > 0) {
    return state(f.planTaskCount === 1 ? "1 task ready" : `${f.planTaskCount} tasks ready`, "waiting")
  }
  return state(f.kind === "new_sender" ? "New sender" : "New", "progress", { fresh: true })
}

/** "Updated · 2 emails" when later messages joined the item (D25), else null. */
export function updatedLabel(messageCount: number): string | null {
  return messageCount > 1 ? `Updated · ${messageCount} emails` : null
}
