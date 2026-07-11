"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { useSmoothText } from "@convex-dev/agent/react"
import { thoughtLabel } from "@/lib/agents/blocks"
import { cn } from "@/lib/utils"

/**
 * `reasoning` block — streams as muted live text, then auto-collapses to a
 * one-line "Thought for Ns" summary (re-expandable on click). Duration is
 * measured while the part streams; historical messages show bare "Thought".
 */
export function ReasoningBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [visibleText] = useSmoothText(text, { startStreaming: streaming })

  // Wall-clock measurement of the streaming window (external system: the
  // clock) — captured once when streaming flips off.
  const startedAtRef = useRef<number | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  useEffect(() => {
    if (streaming) {
      startedAtRef.current ??= Date.now()
    } else if (startedAtRef.current !== null) {
      setDurationMs((d) => d ?? Date.now() - (startedAtRef.current ?? 0))
    }
  }, [streaming])

  if (streaming) {
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
        {visibleText}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        {thoughtLabel(durationMs)}
      </button>
      {expanded && (
        <div className="mt-1.5 whitespace-pre-wrap border-l pl-3 text-sm leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  )
}
