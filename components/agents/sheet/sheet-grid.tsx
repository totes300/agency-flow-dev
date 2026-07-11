"use client"

import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ChevronsUpDownIcon,
  FlagIcon,
} from "lucide-react"
import {
  categoryShares,
  countFlaggedRows,
  grandTotalColumnKey,
  inlinePreviewColumns,
  INLINE_PREVIEW_MAX_ROWS,
  isFlaggedRow,
  sortTableRows,
  type SheetSortDir,
} from "@/lib/agents/sheet"
import type {
  AgentTable,
  AgentTableColumn,
  AgentTableRowValues,
} from "@/lib/agents/table"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import {
  deterministicCellText,
  ProseCellContent,
} from "@/components/agents/sheet/sheet-cell"
import { formatMinutes } from "@/lib/format"
import { useAgentCanvas } from "@/lib/hooks/use-agent-canvas"
import { cn } from "@/lib/utils"

/**
 * SheetGrid — the spreadsheet-grade renderer for agent tables (design locked
 * 2026-07-11, v2 mockup). One shared component, two variants:
 *
 *   - `canvas`: the full read-only sheet — gridlines, row-number gutter (no
 *     A/B/C letters), frozen first column with a scroll-conditional shadow,
 *     sticky header + sticky totals footer with category share bars,
 *     read-only sorting, and click-to-expand prose rows.
 *   - `inline`: the compact in-chat preview — column subset, first N rows,
 *     an explicit "+N more rows" affordance (never a fade), and a footer
 *     with the grand total, flag count, and "Open full sheet".
 *
 * Pure render layer: every deterministic cell formats through the same
 * helpers `agentTableToCsv` uses, so grid and export match cell-for-cell.
 */
export function SheetGrid({
  table,
  variant,
  artifactId = null,
}: {
  table: AgentTable
  variant: "inline" | "canvas"
  /** Stored artifact behind this table — enables "Open full sheet". */
  artifactId?: string | null
}) {
  if (variant === "inline") {
    return <InlineSheet table={table} artifactId={artifactId} />
  }
  return <CanvasSheet table={table} />
}

// ─── Canvas: the full sheet ─────────────────────────────────────────────────

/** Gutter width; the frozen column's `left` offset must match. */
const GUTTER = "w-[46px] min-w-[46px]"
const FRZ_LEFT = "left-[46px]"
const FRZ_WIDTH = "min-w-[186px] max-w-[186px]"
/** Frozen-pane shadow — applied only once the grid is actually scrolled. */
const FRZ_SHADOW = "shadow-[6px_0_8px_-8px_rgba(0,0,0,0.25)]"
/** Inner gridline vs the structural (header/footer/frozen-edge) line. */
const LINE = "border-border/50"

function CanvasSheet({ table }: { table: AgentTable }) {
  const [sort, setSort] = useState<{ key: string; dir: SheetSortDir } | null>(
    null,
  )
  const [expanded, setExpanded] = useState<Set<AgentTableRowValues>>(
    () => new Set(),
  )
  const [scrolledX, setScrolledX] = useState(false)

  const rows = useMemo(
    () => (sort ? sortTableRows(table, sort.key, sort.dir) : table.rows),
    [table, sort],
  )
  const shares = useMemo(
    () => new Map(categoryShares(table).map((s) => [s.key, s.share])),
    [table],
  )
  const totalKey = grandTotalColumnKey(table)
  const proseKeys = table.columns
    .filter((c) => c.kind === "prose")
    .map((c) => c.key)
  const expandable = proseKeys.length > 0

  function toggleSort(col: AgentTableColumn) {
    setSort((prev) =>
      prev?.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: "asc" },
    )
  }

  function toggleRow(row: AgentTableRowValues) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setScrolledX(e.currentTarget.scrollLeft > 2)}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {/* row-number gutter header (no A/B/C letters — read-only) */}
              <th
                className={cn(
                  "sticky left-0 top-0 z-40 h-[38px] border-b border-r bg-muted",
                  LINE,
                  "border-b-border",
                  GUTTER,
                )}
              />
              {table.columns.map((col, i) => {
                const sortable = col.kind !== "prose"
                const active = sort?.key === col.key
                const frozen = i === 0
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      active
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "sticky top-0 z-20 h-[38px] whitespace-nowrap border-b border-r bg-muted p-0 text-left align-middle",
                      LINE,
                      "border-b-border",
                      frozen &&
                        cn(
                          "left-0 z-30 border-r-border",
                          FRZ_LEFT,
                          FRZ_WIDTH,
                          scrolledX && FRZ_SHADOW,
                        ),
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn(
                          "group/h flex h-full w-full items-center gap-1 px-3 text-xs font-medium text-muted-foreground",
                          col.kind === "minutes" && "justify-end",
                        )}
                      >
                        {col.label}
                        {active ? (
                          sort.dir === "asc" ? (
                            <ArrowUpIcon className="size-3 shrink-0 text-foreground" />
                          ) : (
                            <ArrowDownIcon className="size-3 shrink-0 text-foreground" />
                          )
                        ) : (
                          <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover/h:opacity-100 group-focus-visible/h:opacity-100" />
                        )}
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "flex h-full items-center px-3 text-xs font-medium text-muted-foreground",
                          col.kind === "minutes" && "justify-end",
                        )}
                      >
                        {col.label}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const isExpanded = expanded.has(row)
              const flagged = isFlaggedRow(row, proseKeys)
              return (
                <tr
                  key={rowIndex}
                  className={cn(
                    "group/row",
                    expandable &&
                      "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    isExpanded && "[&>td]:py-2.5 [&>td]:align-top",
                  )}
                  {...(expandable
                    ? {
                        tabIndex: 0,
                        "aria-expanded": isExpanded,
                        onClick: () => toggleRow(row),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key !== "Enter" && e.key !== " ") return
                          e.preventDefault()
                          toggleRow(row)
                        },
                      }
                    : {})}
                >
                  {/* gutter: row number + amber edge-mark on flagged rows */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 h-10 border-b border-r bg-muted px-2 text-right align-middle text-[11px] text-muted-foreground/70",
                      LINE,
                      DETERMINISTIC_VALUE_CLASS,
                      GUTTER,
                      flagged &&
                        "shadow-[inset_3px_0_0_var(--color-amber-600)] dark:shadow-[inset_3px_0_0_var(--color-amber-500)]",
                    )}
                  >
                    {rowIndex + 1}
                  </td>
                  {table.columns.map((col, i) => (
                    <CanvasCell
                      key={col.key}
                      col={col}
                      value={row[col.key]}
                      frozen={i === 0}
                      scrolledX={scrolledX}
                      isTotalColumn={col.key === totalKey}
                      isExpanded={isExpanded}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>
          {table.totals && (
            <tfoot>
              <tr>
                <td
                  className={cn(
                    "sticky bottom-0 left-0 z-40 h-[46px] border-r border-t bg-muted",
                    LINE,
                    "border-t-border",
                    GUTTER,
                  )}
                />
                {table.columns.map((col, i) => {
                  const share = shares.get(col.key)
                  const text = deterministicCellText(
                    col,
                    col.kind === "prose" ? null : table.totals?.[col.key],
                  )
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "sticky bottom-0 z-20 h-[46px] whitespace-nowrap border-r border-t bg-muted px-3 align-middle text-[13px] font-semibold",
                        LINE,
                        "border-t-border",
                        DETERMINISTIC_VALUE_CLASS,
                        col.kind === "minutes" && "text-right",
                        i === 0 &&
                          cn(
                            "left-0 z-30 border-r-border",
                            FRZ_LEFT,
                            FRZ_WIDTH,
                            scrolledX && FRZ_SHADOW,
                          ),
                      )}
                    >
                      {share !== undefined ? (
                        // the one aesthetic risk: a 2px data-ink share bar
                        <div className="flex flex-col items-end gap-1">
                          <span>{text}</span>
                          <span className="h-0.5 w-14 overflow-hidden rounded-full bg-border">
                            <span
                              className="block h-full rounded-full bg-foreground/25"
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </span>
                        </div>
                      ) : (
                        text
                      )}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.note && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          {table.note}
        </div>
      )}
    </div>
  )
}

function CanvasCell({
  col,
  value,
  frozen,
  scrolledX,
  isTotalColumn,
  isExpanded,
}: {
  col: AgentTableColumn
  value: AgentTableRowValues[string] | undefined
  frozen: boolean
  scrolledX: boolean
  isTotalColumn: boolean
  isExpanded: boolean
}) {
  const base = cn(
    "h-10 border-b border-r bg-background px-3 align-middle transition-colors group-hover/row:bg-muted",
    LINE,
  )
  if (frozen) {
    const text = deterministicCellText(col, value)
    return (
      <td
        className={cn(
          base,
          "sticky z-10 border-r-border font-medium",
          FRZ_LEFT,
          FRZ_WIDTH,
          scrolledX && FRZ_SHADOW,
        )}
      >
        <div
          title={text}
          className={cn("truncate", isExpanded && "whitespace-normal")}
        >
          {text}
        </div>
      </td>
    )
  }
  if (col.kind === "prose") {
    return (
      <td
        className={cn(
          base,
          "min-w-[240px] max-w-[310px] whitespace-normal py-2 align-top",
        )}
      >
        <ProseCellContent value={value} clamp={isExpanded ? "none" : 2} />
      </td>
    )
  }
  if (col.kind === "minutes") {
    const text = deterministicCellText(col, value)
    return (
      <td
        className={cn(
          base,
          "text-right",
          DETERMINISTIC_VALUE_CLASS,
          isTotalColumn && "font-semibold",
        )}
      >
        {/* empty ≠ zero: a faint dash keeps the column rhythm */}
        {text || <span className="text-muted-foreground/40">–</span>}
      </td>
    )
  }
  if (col.kind === "date") {
    return (
      <td
        className={cn(
          base,
          "whitespace-nowrap text-muted-foreground",
          DETERMINISTIC_VALUE_CLASS,
        )}
      >
        {deterministicCellText(col, value)}
      </td>
    )
  }
  return (
    <td className={cn(base, "whitespace-nowrap text-muted-foreground")}>
      {deterministicCellText(col, value)}
    </td>
  )
}

// ─── Inline: the compact in-chat preview ────────────────────────────────────

function InlineSheet({
  table,
  artifactId,
}: {
  table: AgentTable
  artifactId: string | null
}) {
  const { openArtifact } = useAgentCanvas()
  const cols = inlinePreviewColumns(table)
  const rows = table.rows.slice(0, INLINE_PREVIEW_MAX_ROWS)
  const hidden = table.rows.length - rows.length
  const flagged = countFlaggedRows(table)
  const totalKey = grandTotalColumnKey(table)
  const totalValue =
    totalKey !== null && typeof table.totals?.[totalKey] === "number"
      ? (table.totals[totalKey] as number)
      : null
  const showFooter = totalValue !== null || flagged > 0 || artifactId !== null

  return (
    <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="px-3 pb-1.5 pt-2 text-xs text-muted-foreground">
        {table.title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {cols.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap border-b border-r bg-muted/50 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground last:border-r-0",
                    LINE,
                    col.kind === "minutes" && "text-right",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {cols.map((col, i) => (
                  <InlineCell
                    key={col.key}
                    col={col}
                    value={row[col.key]}
                    isFirst={i === 0}
                  />
                ))}
              </tr>
            ))}
            {hidden > 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  className={cn("border-b p-0", LINE)}
                >
                  {artifactId ? (
                    <button
                      type="button"
                      onClick={() => openArtifact(artifactId)}
                      className="block w-full px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      + {hidden} more row{hidden === 1 ? "" : "s"} — open the
                      full sheet to see everything
                    </button>
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      + {hidden} more row{hidden === 1 ? "" : "s"}
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {table.note && (
        <div
          className={cn("border-t px-3 py-1.5 text-xs text-muted-foreground", LINE)}
        >
          {table.note}
        </div>
      )}
      {showFooter && (
        <div className="flex items-center justify-between px-3 py-2">
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs text-muted-foreground",
              DETERMINISTIC_VALUE_CLASS,
            )}
          >
            {totalValue !== null && (
              <>
                <span className="font-semibold text-foreground">
                  {formatMinutes(totalValue)}
                </span>
                <span>total</span>
              </>
            )}
            {totalValue !== null && flagged > 0 && (
              <span className="text-muted-foreground/50">·</span>
            )}
            {flagged > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                <FlagIcon className="size-3" strokeWidth={1.5} />
                {flagged} flagged
              </span>
            )}
          </span>
          {artifactId && (
            <button
              type="button"
              onClick={() => openArtifact(artifactId)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open full sheet
              <ArrowUpRightIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function InlineCell({
  col,
  value,
  isFirst,
}: {
  col: AgentTableColumn
  value: AgentTableRowValues[string] | undefined
  isFirst: boolean
}) {
  const base = cn(
    "border-b border-r px-2.5 py-1.5 align-top last:border-r-0",
    LINE,
  )
  if (col.kind === "prose") {
    return (
      <td className={cn(base, "max-w-[280px]")}>
        <ProseCellContent value={value} clamp={1} />
      </td>
    )
  }
  if (col.kind === "minutes") {
    const text = deterministicCellText(col, value)
    return (
      <td className={cn(base, "text-right", DETERMINISTIC_VALUE_CLASS)}>
        {text || <span className="text-muted-foreground/40">–</span>}
      </td>
    )
  }
  return (
    <td
      className={cn(
        base,
        "whitespace-nowrap",
        isFirst ? "font-medium" : "text-muted-foreground",
        col.kind === "date" && DETERMINISTIC_VALUE_CLASS,
      )}
    >
      {deterministicCellText(col, value)}
    </td>
  )
}
