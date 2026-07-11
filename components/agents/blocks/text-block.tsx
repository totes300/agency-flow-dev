"use client"

import { useSmoothText } from "@convex-dev/agent/react"

/** `text` block — streamed prose in standard message styling (AI voice). */
export function TextBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const [visibleText] = useSmoothText(text, { startStreaming: streaming })
  if (!visibleText) return null
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {visibleText}
    </div>
  )
}
