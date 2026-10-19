"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { ProposalCard } from "@/convex/agentProposals"
import type { ProposalPayload } from "@/lib/agents/proposals"
import { toastError } from "@/lib/toast-helpers"

/** Wire shape of an inline edit (the kind's whitelisted fields; "" / [] clear). */
type EditedPayload = { kind: ProposalPayload["kind"] } & Record<string, unknown>

/**
 * The decision chrome every proposal card shares: inline-edit saves, Approve
 * and Discard, all bound to the revision the card shows (I11).
 *
 * Own saves run one at a time, each on the previous one's revision; a
 * refused one toasts "This changed — review it again." When someone else
 * changed the card (another admin's edit, the agent revising its plan),
 * `onExternalChange` runs so the card shows their version — what is on
 * screen is what approve commits.
 */
export function useProposalDecision(
  card: ProposalCard,
  onExternalChange?: () => void,
) {
  const approveMutation = useMutation(api.agentProposals.approve)
  const discardMutation = useMutation(api.agentProposals.discard)
  const updateDraft = useMutation(api.agentProposals.updateDraft)
  const [busy, setBusy] = useState(false)
  const [baseRevision, setBaseRevision] = useState(card.revision)
  const [savesInFlight, setSavesInFlight] = useState(0)
  const baseRef = useRef(card.revision)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    baseRef.current = baseRevision
  }, [baseRevision])

  if (card.revision > baseRevision && savesInFlight === 0) {
    setBaseRevision(card.revision)
    onExternalChange?.()
  }

  /** Persist an inline edit so it survives reloads and Approve-all commits it. */
  const save = (editedPayload: EditedPayload) => {
    setSavesInFlight((n) => n + 1)
    saveChain.current = saveChain.current
      .then(() =>
        updateDraft({
          proposalId: card._id,
          // The server re-validates against the kind's validator.
          editedPayload: editedPayload as Parameters<typeof updateDraft>[0]["editedPayload"],
          revision: baseRef.current,
        }),
      )
      .then(({ revision }) => {
        baseRef.current = revision
        setBaseRevision(revision)
      })
      .catch((err) => toastError(err, "Failed to save edit"))
      .finally(() => setSavesInFlight((n) => n - 1))
  }

  /**
   * Approve after any pending save, so the revision sent is the one on
   * screen. A stale reference flips the card to its inline failed state
   * reactively; an outdated revision toasts and the card shows the new one.
   */
  const approve = (
    options: { editedPayload?: EditedPayload; confirmDestructive?: boolean } = {},
  ) => {
    setBusy(true)
    return saveChain.current
      .then(() =>
        approveMutation({
          proposalId: card._id,
          revision: baseRef.current,
          ...(options.editedPayload
            ? {
                editedPayload: options.editedPayload as Parameters<
                  typeof approveMutation
                >[0]["editedPayload"],
              }
            : {}),
          ...(options.confirmDestructive ? { confirmDestructive: true } : {}),
        }),
      )
      .catch((err) => toastError(err, "Failed to approve proposal"))
      .finally(() => setBusy(false))
  }

  const discard = () => {
    setBusy(true)
    discardMutation({ proposalId: card._id })
      .catch((err) => toastError(err, "Failed to discard proposal"))
      .finally(() => setBusy(false))
  }

  return { busy, save, approve, discard }
}
