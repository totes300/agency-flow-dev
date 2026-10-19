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
 * `flush()`: every queued edit is settled. `ok: false` when one of them was
 * refused since the last flush (stale revision, invalid value) — the screen
 * was reset to the server's version, so a decision must NOT proceed.
 */
export type FlushResult = { ok: true; revision: number } | { ok: false }

/**
 * The decision chrome every proposal card shares: inline-edit saves, Approve
 * and Discard, all bound to the revision the card shows (I11).
 *
 * Own saves run one at a time, each on the previous one's revision; a
 * refused one toasts (e.g. "This changed — review it again.") and then
 * `onExternalChange` runs so the screen shows the server's version again.
 * The same happens when someone else changed the card (another admin's edit,
 * the agent revising its plan) — what is on screen is what approve commits.
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
  // A refused save asks for a reset to the server's version once the queue drains.
  const [resetPending, setResetPending] = useState(false)
  // Bumped on every reset to the server's version (forgets the last sent edit).
  const [syncVersion, setSyncVersion] = useState(0)
  const baseRef = useRef(card.revision)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const failedRef = useRef(false)
  const lastSentRef = useRef<string | null>(null)
  useEffect(() => {
    baseRef.current = baseRevision
  }, [baseRevision])
  // The screen now shows the server's version: forget the last sent edit, and a
  // refusal already acted on no longer blocks a decision.
  useEffect(() => {
    lastSentRef.current = null
    failedRef.current = false
  }, [syncVersion])

  if (savesInFlight === 0 && (card.revision > baseRevision || resetPending)) {
    if (card.revision > baseRevision) setBaseRevision(card.revision)
    setResetPending(false)
    setSyncVersion((v) => v + 1)
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
      .catch((err) => {
        failedRef.current = true
        setResetPending(true)
        toastError(err, "Failed to save edit")
      })
      .finally(() => setSavesInFlight((n) => n - 1))
  }

  /**
   * `save` unless the edit is the one last sent — or, right after a load or
   * reset, the server's own version (`baseline`). Compares against what was
   * SENT, so a quick A → B → A still saves A while B is in flight.
   */
  const saveIfChanged = (editedPayload: EditedPayload, baseline: EditedPayload): boolean => {
    const key = JSON.stringify(editedPayload)
    if (key === (lastSentRef.current ?? JSON.stringify(baseline))) return false
    lastSentRef.current = key
    save(editedPayload)
    return true
  }

  /**
   * Wait for every queued edit. `{ ok: true, revision }` — the revision now on
   * the server, what a parent-owned decision (Triage's Create / Apply) must
   * carry; `{ ok: false }` when a queued edit was refused since the last flush.
   */
  const flush = (): Promise<FlushResult> =>
    saveChain.current.then((): FlushResult => {
      const failed = failedRef.current
      failedRef.current = false
      return failed ? { ok: false } : { ok: true, revision: baseRef.current }
    })

  /**
   * Approve after any pending save, so the revision sent is the one on
   * screen; nothing is approved when a queued edit was refused. A stale
   * reference flips the card to its inline failed state reactively; an
   * outdated revision toasts and the card shows the new one.
   */
  const approve = (
    options: { editedPayload?: EditedPayload; confirmDestructive?: boolean } = {},
  ) => {
    setBusy(true)
    return flush()
      .then((flushed) => {
        if (!flushed.ok) return undefined
        return approveMutation({
          proposalId: card._id,
          revision: flushed.revision,
          ...(options.editedPayload
            ? {
                editedPayload: options.editedPayload as Parameters<
                  typeof approveMutation
                >[0]["editedPayload"],
              }
            : {}),
          ...(options.confirmDestructive ? { confirmDestructive: true } : {}),
        })
      })
      .catch((err) => toastError(err, "Failed to approve proposal"))
      .finally(() => setBusy(false))
  }

  const discard = () => {
    setBusy(true)
    discardMutation({ proposalId: card._id })
      .catch((err) => toastError(err, "Failed to discard proposal"))
      .finally(() => setBusy(false))
  }

  return {
    busy,
    saving: savesInFlight > 0,
    revision: baseRevision,
    save,
    saveIfChanged,
    flush,
    approve,
    discard,
  }
}
