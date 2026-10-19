"use client"

import type { ReactNode } from "react"
import { CircleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOpenProposal } from "@/components/task-detail/use-open-proposal"

/**
 * Shared chrome of the proposal cards (`proposal-block.tsx`,
 * `proposal-change-cards.tsx`): the inline failure note and the footer with
 * the quiet Discard + the one dark Approve.
 */

export function FailureNote({ reason }: { reason: string }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-xs text-destructive">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{reason}</span>
    </div>
  )
}

export function ProposalFooter({
  failed,
  failureReason,
  note,
  busy,
  onDiscard,
  onApprove,
  canApprove = true,
}: {
  failed: boolean
  failureReason: string | null
  /** Shown when nothing failed (e.g. "nothing changes until you approve"). */
  note: ReactNode
  busy: boolean
  onDiscard: () => void
  onApprove: () => void
  /** False hides Approve (an admin-scoped kind seen by a member). */
  canApprove?: boolean
}) {
  return (
    <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
      {failed && failureReason ? (
        <FailureNote reason={failureReason} />
      ) : (
        <span className="text-xs text-muted-foreground/60">{note}</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground"
          disabled={busy}
          onClick={onDiscard}
        >
          Discard
        </Button>
        {canApprove && (
          <Button size="sm" className="h-7" disabled={busy} onClick={onApprove}>
            {failed ? "Retry" : "Approve"}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * "Open" — the proposal in the task drawer (email-triage B7): a Draft for a
 * `createTask`, the task with the change in place for an `updateTask`.
 * Edits there persist into the same proposal, so this card follows.
 */
export function OpenInDrawerButton({
  kind,
  proposalId,
}: {
  kind: "draft" | "change"
  proposalId: string
}) {
  const open = useOpenProposal()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="shrink-0 text-muted-foreground"
      onClick={() => open({ kind, proposalId })}
    >
      Open
    </Button>
  )
}
