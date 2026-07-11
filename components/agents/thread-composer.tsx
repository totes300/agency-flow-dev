"use client"

import { useState } from "react"
import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { AgentComposer } from "@/components/agents/composer"
import { toastError } from "@/lib/toast-helpers"

/**
 * Thread-mode composer wiring: send → startRun on the bound thread,
 * Stop → stopRun on the active run. Post-start failures settle as
 * in-thread error blocks (the action resolves), so only pre-start
 * validation errors toast + restore the draft.
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
  const [message, setMessage] = useState("")
  // Covers the gap between the action call and the thread's reactive
  // status flip to "running".
  const [sending, setSending] = useState(false)
  const startRun = useAction(api.agentRunner.startRun)
  const stopRun = useMutation(api.agentRunner.stopRun)

  const busy = isRunning || sending

  function send() {
    const text = message.trim()
    if (!text || busy) return
    setMessage("")
    setSending(true)
    void startRun({ threadId, message: text })
      .catch((err) => {
        toastError(err, "The agent run failed")
        setMessage(text) // give the user their message back
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
      agentName={agentName}
      value={message}
      onChange={setMessage}
      onSend={send}
      running={busy}
      onStop={stop}
      // No run row yet (action still settling) or stop already requested.
      stopDisabled={!activeRun || activeRun.cancelRequested}
    />
  )
}
