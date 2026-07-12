"use client"

import { useRef, useState } from "react"
import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  AgentComposer,
  type AgentComposerHandle,
  type ComposerSubmission,
} from "@/components/agents/composer"
import { toastError } from "@/lib/toast-helpers"

/**
 * Thread-mode composer wiring: send → startRun on the bound thread with the
 * composer's text + typed mentions + attachments (slice 07). Stop → stopRun on
 * the active run. Post-start failures settle as in-thread error blocks (the
 * action resolves), so only pre-start validation errors toast + restore the
 * draft into the composer.
 */
export function ThreadComposer({
  threadId,
  agentName,
  isRunning,
  activeRun,
}: {
  threadId: string
  agentName: string
  isRunning: boolean
  activeRun: { _id: Id<"agentRuns">; cancelRequested: boolean } | null
}) {
  // Covers the gap between the action call and the thread's reactive status
  // flip to "running".
  const [sending, setSending] = useState(false)
  const composerRef = useRef<AgentComposerHandle>(null)
  const startRun = useAction(api.agentRunner.startRun)
  const stopRun = useMutation(api.agentRunner.stopRun)

  const busy = isRunning || sending

  function send(submission: ComposerSubmission) {
    if (busy) return
    setSending(true)
    void startRun({
      threadId,
      message: submission.text,
      mentions: submission.mentions.length > 0 ? submission.mentions : undefined,
      attachments:
        submission.attachments.length > 0
          ? submission.attachments.map((a) => ({
              storageId: a.storageId as Id<"_storage">,
              name: a.name,
              mimeType: a.mimeType,
              size: a.size,
            }))
          : undefined,
    })
      .catch((err) => {
        toastError(err, "The agent run failed")
        composerRef.current?.prefill(submission.text) // give the draft back
      })
      .finally(() => setSending(false))
  }

  function stop() {
    if (!activeRun || activeRun.cancelRequested) return
    void stopRun({ runId: activeRun._id }).catch((err) =>
      toastError(err, "Couldn't stop the run"),
    )
  }

  return (
    <AgentComposer
      ref={composerRef}
      agentName={agentName}
      onSend={send}
      running={busy}
      onStop={stop}
      // No run row yet (action still settling) or stop already requested.
      stopDisabled={!activeRun || activeRun.cancelRequested}
    />
  )
}
