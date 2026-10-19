"use client"

import { useEffect, type RefObject } from "react"
import type { ProposalDrawerFooterContext } from "@/components/task-detail/proposal-drawer"
import type { DrawerFlush } from "@/components/triage/use-triage-actions"

/**
 * The drawer footer Triage gives the B7 `ProposalDrawer` (B8b). The decision
 * itself lives in the conversation (Create / Apply change, ⌘↵ — one dark
 * primary per screen); the footer registers the drawer's `flush` so that
 * decision first waits for the edits typed here (B7 contract: decide only on
 * `{ ok: true }`, with its revision), and says where the decision is.
 */
export function TriageDrawerFooter({
  ctx,
  registryRef,
}: {
  ctx: ProposalDrawerFooterContext
  registryRef: RefObject<DrawerFlush | null>
}) {
  const proposalId = ctx.card._id
  // The latest flush every render (it closes over the drawer's current edits).
  useEffect(() => {
    registryRef.current = { proposalId, flush: ctx.flush }
  })
  useEffect(
    () => () => {
      if (registryRef.current?.proposalId === proposalId) registryRef.current = null
    },
    [registryRef, proposalId],
  )
  const text = ctx.readOnly
    ? "View only."
    : ctx.mode === "draft"
      ? "Nothing is created until you press Create in the conversation."
      : "Nothing changes until you apply it in the conversation."
  return <div className="flex items-center border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">{text}</div>
}
