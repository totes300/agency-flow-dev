"use client"

import { useSmoothText } from "@convex-dev/agent/react"
import { AgentMarkdown } from "@/components/agents/markdown"

/**
 * `text` block — streamed prose in standard message styling (AI voice),
 * rendered as GFM markdown so the model's tables/headings/lists display
 * with full styling instead of raw syntax.
 */
export function TextBlock({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const [visibleText] = useSmoothText(text, { startStreaming: streaming })
  if (!visibleText) return null
  return <AgentMarkdown text={visibleText} streaming={streaming} />
}
