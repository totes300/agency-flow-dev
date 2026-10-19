"use client"

import { useRef, useState, type RefObject } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { TriageItemDetail } from "@/convex/email/triageView"
import type { FlushResult } from "@/components/agents/blocks/use-proposal-decision"
import { toastError } from "@/lib/toast-helpers"
import { formatSnoozeUntil } from "@/components/triage/format"
import type { TriageSnoozeChoice } from "@/components/triage/triage-snooze-menu"
import type { TriagePrimary } from "@/components/triage/triage-model"

/** The open drawer's pending-edit flush (B7 contract), registered by the drawer footer. */
export type DrawerFlush = { proposalId: string; flush: () => Promise<FlushResult> }

/** D30: the Create toast lasts the undo window (the server's `undoMs`; this only if it is missing). */
export const CREATE_TOAST_FALLBACK_MS = 10_000

/**
 * Every Triage decision, bound to the open item (B8b). Each calls its gated
 * mutation with the revision the owner saw (I11); a refusal from a gate shows
 * as a quiet toast with the server's message. `onLeave` runs after a decision
 * that takes the item off the list (the screen moves to the next one).
 */
export function useTriageActions({
  detail,
  drawerFlush,
  onLeave,
  onReturn,
  onCloseDrawer,
}: {
  detail: TriageItemDetail | null | undefined
  drawerFlush: RefObject<DrawerFlush | null>
  onLeave: () => void
  /** Select the item again (after an Undo brought it back). */
  onReturn: (itemId: string) => void
  onCloseDrawer: () => void
}) {
  const createFromTriage = useMutation(api.email.create.createFromTriage)
  const undoCreate = useMutation(api.email.create.undoCreate)
  const applyChange = useMutation(api.email.changes.applyChange)
  const notAChange = useMutation(api.email.changes.notAChange)
  const mergeInto = useMutation(api.email.changes.mergeInto)
  const markApprovalDone = useMutation(api.email.decisions.markApprovalDone)
  const keepInClientReview = useMutation(api.email.decisions.keepInClientReview)
  const convertQuestionToTask = useMutation(api.email.decisions.convertQuestionToTask)
  const declineItem = useMutation(api.email.triage.declineItem)
  const undoDecline = useMutation(api.email.triage.undoDecline)
  const snoozeItem = useMutation(api.agentItems.snoozeItem)
  const wakeItem = useMutation(api.agentItems.wakeItem)
  const retryPlanning = useMutation(api.email.prepare.retryPlanning)
  const retryAttention = useMutation(api.email.triageView.retryAttention)
  const planNeedsLook = useMutation(api.email.triageView.planNeedsLook)
  const promoteFiltered = useMutation(api.email.triageView.promoteFiltered)

  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  /** One decision at a time; errors become the server's message in a toast. */
  async function run(fallback: string, fn: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toastError(err, fallback)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** Waits for the drawer's queued edits to `proposalId`; null = a refused edit (do nothing). */
  async function flushDrawer(proposalIds: readonly string[]): Promise<Map<string, number> | null> {
    const open = drawerFlush.current
    const revisions = new Map<string, number>()
    if (!open || !proposalIds.includes(open.proposalId)) return revisions
    const flushed = await open.flush()
    if (!flushed.ok) return null
    revisions.set(open.proposalId, flushed.revision)
    return revisions
  }

  const itemId = detail?._id as Id<"agentItems"> | undefined

  const create = () =>
    run("Couldn't create the tasks", async () => {
      if (!itemId || !detail?.plan) return
      const tasks = detail.plan.tasks
      const flushed = await flushDrawer(tasks.map((t) => t.proposalId))
      if (!flushed) return
      const result = await createFromTriage({
        itemId,
        proposals: tasks.map((t) => ({
          proposalId: t.proposalId as Id<"agentProposals">,
          revision: flushed.get(t.proposalId) ?? t.revision,
        })),
      })
      onCloseDrawer()
      // D30: "Created PRG-132 · Undo" for what is left of the undo window by
      // the server's clock; when it ends the conversation shows the event line
      // and the kickoff draft.
      toast(`Created ${result.identifiers.join(", ")}`, {
        id: `triage-create-${itemId}`,
        duration: result.undoMs > 0 ? result.undoMs : CREATE_TOAST_FALLBACK_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void undoCreate({ itemId }).catch((err) => toastError(err, "Too late to undo"))
          },
        },
      })
    })

  const apply = () =>
    run("Couldn't apply the change", async () => {
      if (!itemId || !detail?.change) return
      const flushed = await flushDrawer([detail.change.proposalId])
      if (!flushed) return
      await applyChange({
        itemId,
        proposalId: detail.change.proposalId as Id<"agentProposals">,
        revision: flushed.get(detail.change.proposalId) ?? detail.change.revision,
      })
      onCloseDrawer()
    })

  const rejectChange = () =>
    run("Couldn't dismiss the change", async () => {
      if (!itemId) return
      await notAChange({ itemId })
      onCloseDrawer()
      onLeave()
    })

  const merge = (task: { _id: Id<"tasks">; identifier: string }) =>
    run("Couldn't merge", async () => {
      if (!itemId) return
      await mergeInto({ itemId, taskId: task._id })
      toast(`Merging into ${task.identifier} — the change is being prepared`)
    })

  const markDone = () =>
    run("Couldn't mark it done", async () => {
      if (!itemId) return
      await markApprovalDone({ itemId })
      onLeave()
    })

  const keep = () =>
    run("Couldn't keep it in Client review", async () => {
      if (!itemId) return
      await keepInClientReview({ itemId })
      onLeave()
    })

  const toTask = () =>
    run("Couldn't make it a task", async () => {
      if (!itemId) return
      await convertQuestionToTask({ itemId })
    })

  const decline = () =>
    run("Couldn't decline", async () => {
      if (!itemId) return
      const { undoMs } = await declineItem({ itemId })
      onCloseDrawer()
      // A short Undo backed by the server (`undoDecline`), when the decline can be put back.
      toast("Declined · nothing was created", {
        id: `triage-decline-${itemId}`,
        ...(undoMs > 0
          ? {
              duration: undoMs,
              action: {
                label: "Undo",
                onClick: () => {
                  void undoDecline({ itemId })
                    .then(() => onReturn(itemId))
                    .catch((err) => toastError(err, "Couldn't undo the decline"))
                },
              },
            }
          : {}),
      })
      onLeave()
    })

  const snooze = (choice: TriageSnoozeChoice) =>
    run("Couldn't snooze", async () => {
      if (!itemId) return
      const { snoozedUntil } = await snoozeItem({ itemId, ...choice })
      onCloseDrawer()
      toast(`Snoozed until ${formatSnoozeUntil(snoozedUntil)}`, {
        id: `triage-snooze-${itemId}`,
        action: {
          label: "Undo",
          onClick: () => {
            void wakeItem({ itemId }).catch((err) => toastError(err, "Couldn't undo the snooze"))
          },
        },
      })
      onLeave()
    })

  const wake = () =>
    run("Couldn't unsnooze", async () => {
      if (!itemId) return
      await wakeItem({ itemId })
    })

  const retry = () =>
    run("Couldn't retry", async () => {
      if (!itemId) return
      const { retried } = await retryAttention({ itemId })
      if (retried === 0) toast("Nothing to retry")
    })

  const replan = () =>
    run("Couldn't retry", async () => {
      if (!itemId) return
      await retryPlanning({ itemId })
    })

  const planIt = () =>
    run("Couldn't plan it", async () => {
      if (!itemId) return
      await planNeedsLook({ itemId })
    })

  const promote = (id?: string) =>
    run("Couldn't move it to Triage", async () => {
      const target = (id ?? itemId) as Id<"agentItems"> | undefined
      if (!target) return
      await promoteFiltered({ itemId: target })
      toast("Moved to Triage — the assistant is preparing it")
    })

  /** The email block's own Send (the block owns the version / warning logic). */
  const send = () => {
    const draftId = detail?.draftId
    if (!draftId) return
    const button = document.querySelector<HTMLButtonElement>(`[data-email-primary="${CSS.escape(draftId)}"]`)
    if (!button || button.disabled) {
      toast("The email can't be sent yet — check the draft")
      return
    }
    button.click()
  }

  const runPrimary = (primary: TriagePrimary | null) => {
    switch (primary) {
      case "create":
        return void create()
      case "send":
        return send()
      case "apply":
        return void apply()
      case "markDone":
        return void markDone()
      case "retry":
        return void retry()
      case "retryPlanning":
        return void replan()
      case "planIt":
        return void planIt()
      case "promote":
        return void promote()
      default:
        return
    }
  }

  return {
    busy,
    create,
    apply,
    rejectChange,
    merge,
    markDone,
    keep,
    toTask,
    decline,
    snooze,
    wake,
    retry,
    replan,
    planIt,
    promote,
    send,
    runPrimary,
  }
}

export type TriageActions = ReturnType<typeof useTriageActions>
