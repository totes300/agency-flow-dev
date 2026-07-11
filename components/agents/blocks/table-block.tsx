"use client"

import { FlagIcon } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  classifyProseCell,
  type AgentTable,
  type AgentTableColumn,
  type AgentTableRowValues,
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
export function TableBlock({
  table,
  showTitle = true,
}: {
  table: AgentTable
  /** Hidden in the canvas, where the panel header already shows the name. */
  showTitle?: boolean
}) {
  return (
    <div className="my-1">
      {showTitle && (
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          {table.title}
        </div>
      )}
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
                      "px-3 py-2 align-top",
                      cellClass(col, colIndex),
                    )}
                  >
                    {col.kind === "prose" ? (
                      <ProseCell value={row[col.key]} />
                    ) : (
                      formatCell(col, row[col.key])
                    )}
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
      {table.note && (
        <div className="mt-1.5 text-xs text-muted-foreground">{table.note}</div>
      )}
    </div>
  )
}

/**
 * AI-written cell (slice 05). Standard prose styling — NO tabular-nums — so
 * the model's Requested/Delivered columns read as prose next to the
 * deterministic tabular figures (the determinism visual split). Flagged /
 * unavailable states render muted, never as invented text.
 */
function ProseCell({ value }: { value: AgentTableRowValues[string] }) {
  const { text, tone } = classifyProseCell(value)
  if (tone === "flagged") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
        <FlagIcon className="size-3 shrink-0" strokeWidth={1.5} />
        {text}
      </span>
    )
  }
  if (tone === "unavailable") {
    return <span className="text-xs italic text-muted-foreground/70">{text}</span>
  }
  return (
    <span className="text-sm leading-relaxed text-foreground">{text}</span>
  )
}

function cellClass(col: AgentTableColumn, colIndex: number): string {
  if (col.kind === "minutes") return cn(CELL_SECONDARY, "text-right")
  if (col.kind === "date") return cn(CELL_SECONDARY, "whitespace-nowrap")
  // Prose columns wrap and take a comfortable reading width; text-sm plain.
  if (col.kind === "prose") return "min-w-[14rem] max-w-[22rem] whitespace-normal"
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
