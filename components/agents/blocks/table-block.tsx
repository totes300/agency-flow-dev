"use client"

import { SheetGrid } from "@/components/agents/sheet/sheet-grid"
import type { AgentTable } from "@/lib/agents/table"

/**
 * `table` block — the in-chat rendering of a deterministic tool table.
 * Thin wrapper over the shared SheetGrid's compact inline variant (design
 * locked 2026-07-11): column subset, first rows, "+N more rows", and a
 * footer with the grand total, flag count, and "Open full sheet" when the
 * same tool call stored a canvas artifact.
 */
export function TableBlock({
  table,
  artifactId = null,
}: {
  table: AgentTable
  artifactId?: string | null
}) {
  return (
    <div className="my-1">
      <SheetGrid variant="inline" table={table} artifactId={artifactId} />
    </div>
  )
}
