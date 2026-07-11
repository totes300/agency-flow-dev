"use client"

import { useState } from "react"
import {
  FolderIcon,
  Loader2Icon,
  TableIcon,
  UsersIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"
import {
  DETERMINISTIC_VALUE_CLASS,
  toolLabel,
  toolResultSummary,
} from "@/lib/agents/blocks"
import { cn } from "@/lib/utils"

/**
 * Per-tool icon (Linear-style filled where the glyph stays legible as a
 * silhouette; line icons like grids keep their strokes). Registry names,
 * wrench fallback.
 */
const TOOL_ICONS: Record<string, { Icon: LucideIcon; filled: boolean }> = {
  listClients: { Icon: UsersIcon, filled: true },
  listProjects: { Icon: FolderIcon, filled: true },
  collectTimesheetData: { Icon: TableIcon, filled: false },
}

/**
 * `tool-call` block — a single quiet ghost row: filled icon + verb +
 * deterministic result summary. No card, no border, no pill. Click
 * expands to the raw arguments/result.
 */
export function ToolCallBlock({
  toolName,
  phase,
  input,
  output,
  errorText,
}: {
  toolName: string
  phase: "running" | "done" | "error"
  input: unknown
  output: unknown
  errorText: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const { Icon, filled } = TOOL_ICONS[toolName] ?? {
    Icon: WrenchIcon,
    filled: true,
  }
  const summary = phase === "done" ? toolResultSummary(toolName, output) : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {phase === "running" ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              filled && "fill-current",
              phase === "error" && "text-destructive",
            )}
            strokeWidth={1.5}
          />
        )}
        <span>
          {toolLabel(toolName, phase)}
          {phase === "running" && "…"}
        </span>
        {summary && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className={DETERMINISTIC_VALUE_CLASS}>{summary}</span>
          </>
        )}
        {phase === "error" && <span className="text-destructive">failed</span>}
      </button>
      {expanded && (
        <div className="mt-1 space-y-2 border-l pl-3">
          <RawValue label="Arguments" value={input} />
          {phase === "error" ? (
            <RawValue label="Error" value={errorText} />
          ) : (
            <RawValue label="Result" value={output} />
          )}
        </div>
      )}
    </div>
  )
}

function RawValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
        {label}
      </div>
      <pre className="mt-0.5 overflow-x-auto rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
        {JSON.stringify(value, null, 2) ?? "—"}
      </pre>
    </div>
  )
}
