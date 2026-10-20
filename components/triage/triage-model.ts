import type { TriageItemDetail } from "@/convex/email/triageView"
import type { ComposerSuggestion } from "@/components/agents/composer"
import type { ProposalRef } from "@/lib/task-detail"

/**
 * Pure decisions of the Triage screen (B8b, docs/prd-email-triage.md §7.2,
 * §7.7): the item's ONE primary action (the dark button, ⌘↵), the composer
 * suggestions for its state, and what the panel toggle opens.
 */

export type TriagePrimary =
  | "create" // request / new sender: Create the plan's tasks
  | "send" // the kickoff or reply email: its Send (the email block's own button)
  | "apply" // a change on a linked task
  | "markDone" // a client approval
  | "retry" // a failed processing stage (attention)
  | "retryPlanning" // the plan could not be prepared
  | "planIt" // needs a look → plan it
  | "promote" // Filtered → Move to Triage

export const PRIMARY_LABELS: Record<TriagePrimary, string> = {
  create: "Create",
  send: "Send",
  apply: "Apply change",
  markDone: "Mark done",
  retry: "Retry",
  retryPlanning: "Retry",
  planIt: "Plan it",
  promote: "Move to Triage",
}

type Detail = Pick<
  TriageItemDetail,
  "kind" | "status" | "state" | "plan" | "change" | "commit" | "draftId" | "planIssue" | "attentions"
> & { mailboxIssue?: TriageItemDetail["mailboxIssue"] }

export function primaryAction(d: Detail): TriagePrimary | null {
  // B3: "Mailbox not syncing" has only Reconnect / Resync — no ⌘↵ decision.
  if (d.mailboxIssue) return null
  if (d.status === "filtered") return "promote"
  if (d.status === "done") return null
  if (d.attentions.length > 0) return "retry"
  if (d.state.live) return null
  if (d.planIssue) return d.planIssue.kind === "no_actor" ? null : "retryPlanning"
  if (d.commit) return d.draftId ? "send" : null
  if (d.kind === "change") return d.change ? "apply" : null
  if (d.kind === "approval") return "markDone"
  if (d.kind === "needs_look") return "planIt"
  if ((d.plan?.isReply || d.kind === "question") && d.draftId) return "send"
  if (d.plan && !d.plan.isReply && d.plan.tasks.length > 0) return "create"
  return null
}

/** Whether the item can still be declined / merged / snoozed (open, not committed). */
export function canTriage(
  d: Pick<TriageItemDetail, "status" | "commit" | "attentions"> & { mailboxIssue?: TriageItemDetail["mailboxIssue"] },
): boolean {
  // B3: a failing mailbox is not an email decision — no Decline / Merge / Snooze (it closes itself).
  if (d.mailboxIssue) return false
  return (d.status === "open" || d.status === "snoozed") && !d.commit && d.attentions.length === 0
}

/** Merge needs a client and a fresh email item (not already about a task). */
export function canMerge(
  d: Pick<TriageItemDetail, "status" | "commit" | "attentions" | "kind" | "clientId"> & {
    mailboxIssue?: TriageItemDetail["mailboxIssue"]
  },
): boolean {
  return canTriage(d) && d.kind !== "change" && d.kind !== "approval" && d.clientId !== null
}

const s = (label: string): ComposerSuggestion => ({ label })

/** 2–3 composer chips for the item's state (§7.1 "composer"). */
export function suggestionsFor(
  d: Pick<TriageItemDetail, "kind" | "status" | "state" | "plan" | "change" | "commit" | "draftId">,
): ComposerSuggestion[] {
  if (d.status === "done" || d.status === "filtered" || d.state.live) return []
  if (d.state.label === "A question for you") return []
  if (d.commit) {
    return d.draftId ? [s("Make the reply shorter"), s("Make it more formal"), s("What did the client ask for?")] : []
  }
  if (d.kind === "change") return d.change ? [s("What exactly changes?"), s("Add it as a new subtask instead")] : []
  if (d.kind === "approval") return [s("Where does the task stand?")]
  if (d.kind === "needs_look") return [s("What does the client want?"), s("Is there any work in this email?")]
  if ((d.plan?.isReply || d.kind === "question") && d.draftId) return [s("Make the reply shorter"), s("Make it more formal")]
  const tasks = d.plan && !d.plan.isReply ? d.plan.tasks.length : 0
  if (tasks === 1) return [s("Split it into two tasks"), s("Who should do this?"), s("Why these due dates?")]
  if (tasks > 1) return [s("Make it one task"), s("Who should do this?")]
  return []
}

export type DrawerTarget =
  | { kind: "proposal"; ref: ProposalRef }
  | { kind: "task"; task: { id: string; identifier: string } }

/**
 * What the panel toggle opens: the proposed change (`?change=`), else the
 * plan's first task as a Draft (`?draft=`), else the linked task (`?task=`).
 */
export function drawerTarget(d: Pick<TriageItemDetail, "change" | "plan" | "linkedTask" | "commit">): DrawerTarget | null {
  if (d.change) return { kind: "proposal", ref: { kind: "change", proposalId: d.change.proposalId } }
  const first = !d.commit && d.plan && !d.plan.isReply ? d.plan.tasks[0] : undefined
  if (first) return { kind: "proposal", ref: { kind: "draft", proposalId: first.proposalId } }
  if (d.linkedTask) return { kind: "task", task: { id: d.linkedTask._id, identifier: d.linkedTask.identifier } }
  return null
}
