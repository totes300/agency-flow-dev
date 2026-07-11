"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  AgentTable,
  AgentTableColumn,
  AgentTableRowValues,
} from "@/lib/agents/table"
import { formatMinutes, formatShortDate } from "@/lib/format"
import { CELL_KEY, CELL_PRIMARY, CELL_SECONDARY, TABLE_HEAD } from "@/lib/table-tokens"
import { cn } from "@/lib/utils"

/**
 * `table` block — a read-only in-chat grid over the app's table tokens.
 * Cells arrive RAW from the deterministic tool (minutes as numbers,
 * dates as YYYY-MM-DD) and are formatted here through the shared
 * helpers — hours in the project-overview HH:MM convention so every
 * cell is spot-checkable, all in the shared determinism treatment
 * (tabular-nums, via the table tokens).
 */
export function TableBlock({ table }: { table: AgentTable }) {
  return (
    <div className="my-1">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        {table.title}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {table.columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    TABLE_HEAD,
                    "whitespace-nowrap px-3",
                    col.kind === "minutes" && "text-right",
                  )}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {table.columns.map((col, colIndex) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      "px-3 py-2",
                      cellClass(col, colIndex),
                    )}
                  >
                    {formatCell(col, row[col.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {table.totals && (
            <TableFooter className="bg-transparent">
              <TableRow className="hover:bg-transparent">
                {table.columns.map((col, colIndex) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      "px-3 py-2",
                      colIndex === 0 ? CELL_PRIMARY : cn(CELL_KEY, "text-sm"),
                      col.kind === "minutes" && "text-right",
                    )}
                  >
                    {formatCell(col, table.totals?.[col.key] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  )
}

function cellClass(col: AgentTableColumn, colIndex: number): string {
  if (col.kind === "minutes") return cn(CELL_SECONDARY, "text-right")
  if (col.kind === "date") return cn(CELL_SECONDARY, "whitespace-nowrap")
  return colIndex === 0 ? CELL_PRIMARY : CELL_SECONDARY
}

function formatCell(
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
