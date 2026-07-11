"use client"

import type { RefObject } from "react"
import { BotIcon, Loader2Icon, SendIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Presentational composer shared by the thread view and the new-chat
 * empty state (PRD run-state ergonomics): non-editable agent chip above
 * the input (the agent is fixed per thread), and the send button swaps
 * in-place to Stop while a run is active — the composer itself stays
 * visible and typable throughout.
 */
export function AgentComposer({
  agentName,
  value,
  onChange,
  onSend,
  running,
  onStop,
  stopDisabled,
  textareaRef,
}: {
  agentName: string
  value: string
  onChange: (value: string) => void
  onSend: () => void
  /** A run is active — send swaps to Stop. */
  running: boolean
  onStop?: () => void
  /** Stop already requested (or no run id yet) — Stop shows as settling. */
  stopDisabled?: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const canSend = !running && value.trim().length > 0

  return (
    <div className="shrink-0 border-t p-4">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <BotIcon className="size-3.5" />
          <span>{agentName}</span>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if (canSend) onSend()
              }
            }}
            placeholder={
              running ? `${agentName} is working…` : `Message ${agentName}…`
            }
            rows={3}
            className="max-h-40 resize-none"
          />
          {running ? (
            <Button
              type="button"
              size="icon"
              onClick={onStop}
              disabled={stopDisabled || !onStop}
              aria-label="Stop"
            >
              {stopDisabled ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SquareIcon className="size-4 fill-current" />
              )}
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send"
            >
              <SendIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
