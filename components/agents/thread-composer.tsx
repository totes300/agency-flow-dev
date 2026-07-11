"use client"

import { useState } from "react"
import { useAction } from "convex/react"
import { SendIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toastError } from "@/lib/toast-helpers"

/**
 * Bare tracer composer (plain textarea). The Tiptap composer with paste/
 * upload/mentions replaces this in slice 07; Stop-button run ergonomics
 * arrive in slice 02.
 */
export function ThreadComposer({
  threadId,
  agentName,
  isRunning,
}: {
  threadId: string
  agentName: string
  isRunning: boolean
}) {
  const [message, setMessage] = useState("")
  // Covers the gap between the action call and the thread's reactive
  // status flip to "running".
  const [sending, setSending] = useState(false)
  const startRun = useAction(api.agentRunner.startRun)

  const busy = isRunning || sending
  const canSend = !busy && message.trim().length > 0

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

  return (
    <div className="shrink-0 border-t p-4">
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={
            busy ? `${agentName} is working…` : `Message ${agentName}…`
          }
          rows={3}
          className="max-h-40 resize-none"
        />
        <Button
          type="button"
          size="icon"
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
        >
          <SendIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
