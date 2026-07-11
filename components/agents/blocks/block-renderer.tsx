"use client"

import type { AgentBlock } from "@/lib/agents/blocks"
import { TextBlock } from "@/components/agents/blocks/text-block"
import { ReasoningBlock } from "@/components/agents/blocks/reasoning-block"
import { ToolCallBlock } from "@/components/agents/blocks/tool-call-block"
import { TableBlock } from "@/components/agents/blocks/table-block"

/**
 * The block vocabulary's single dispatch point (PRD renderer contract):
 * every block type has exactly one renderer, shared by all agents.
 * `error`/`system` blocks are run-derived (not message parts) and render
 * directly in the thread timeline.
 */
export function BlockRenderer({ block }: { block: AgentBlock }) {
  switch (block.kind) {
    case "text":
      return <TextBlock text={block.text} streaming={block.streaming} />
    case "reasoning":
      return <ReasoningBlock text={block.text} streaming={block.streaming} />
    case "tool":
      return (
        <ToolCallBlock
          toolName={block.toolName}
          phase={block.phase}
          input={block.input}
          output={block.output}
          errorText={block.errorText}
        />
      )
    case "table":
      return <TableBlock table={block.table} />
  }
}
