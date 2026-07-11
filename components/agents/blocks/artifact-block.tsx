"use client"

import { FileSpreadsheetIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentCanvas } from "@/lib/hooks/use-agent-canvas"
import { cn } from "@/lib/utils"

/**
 * `artifact` block — a compact chip referencing a stored artifact (slice 06).
 * Name + kind meta + Open, which slides the artifact into the docked canvas
 * (URL `?artifact=`). Deliberately quiet: one bordered row, no card stack —
 * the heavy output lives in the canvas, not the message stream.
 */
const KIND_META: Record<string, { label: string }> = {
  timesheet_csv: { label: "CSV spreadsheet" },
}

export function ArtifactBlock({
  artifactId,
  name,
  artifactKind,
}: {
  artifactId: string
  name: string
  artifactKind: string
}) {
  const { openArtifact, artifactId: openId } = useAgentCanvas()
  const isOpen = openId === artifactId
  const meta = KIND_META[artifactKind]?.label ?? "Artifact"

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        isOpen && "border-foreground/25 bg-muted/40",
      )}
    >
      <FileSpreadsheetIcon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{meta}</div>
      </div>
      <Button
        size="sm"
        variant={isOpen ? "secondary" : "outline"}
        onClick={() => openArtifact(artifactId)}
      >
        {isOpen ? "Viewing" : "Open"}
      </Button>
    </div>
  )
}
