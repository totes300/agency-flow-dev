"use client"

import { FlagIcon } from "lucide-react"
import {
  classifyProseCell,
  type AgentTableColumn,
  type AgentTableRowValues,
} from "@/lib/agents/table"
import { formatMinutes, formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Cell-level rendering for the SheetGrid (locked v2 design). Deterministic
 * cells format through the shared helpers — the same ones `agentTableToCsv`
 * uses, so the sheet and the export can never disagree (D1 at render level).
 */

/** Display string for a deterministic (non-prose) cell. */
export function deterministicCellText(
  col: AgentTableColumn,
  value: AgentTableRowValues[string] | undefined,
): string {
  if (value === null || value === undefined || value === "") return ""
  if (col.kind === "minutes") {
    return typeof value === "number" ? formatMinutes(value) : String(value)
  }
  if (col.kind === "date") {
    return typeof value === "string" ? formatShortDate(value) : String(value)
  }
  return String(value)
}

/**
 * AI-written cell (prose kind). Normal prose styling — no tabular-nums — so
 * the model's columns read as prose next to the deterministic figures.
 * Flagged renders an amber flag (never invented text); unavailable renders
 * muted italic. Real prose clamps to keep row heights uniform; the full text
 * is available via the native title tooltip and the row expand.
 */
export function ProseCellContent({
  value,
  clamp,
}: {
  value: AgentTableRowValues[string] | undefined
  clamp: 1 | 2 | "none"
}) {
  const { text, tone } = classifyProseCell(value)
  if (!text) return null
  if (tone === "flagged") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-amber-600 dark:text-amber-500">
        <FlagIcon className="size-3 shrink-0" strokeWidth={1.5} />
        {text}
      </span>
    )
  }
  if (tone === "unavailable") {
    return (
      <span className="text-xs italic text-muted-foreground/70">{text}</span>
    )
  }
  return (
    <span
      title={clamp === "none" ? undefined : text}
      className={cn(
        "text-[13px] leading-relaxed text-foreground",
        clamp === 1 && "line-clamp-1",
        clamp === 2 && "line-clamp-2",
      )}
    >
      {text}
    </span>
  )
}
