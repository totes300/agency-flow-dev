/**
 * Shared visual tokens of the agent sheet design (locked 2026-07-11) — the
 * single source of the "spreadsheet-grade" table look in the agent stream.
 * Consumed by BOTH renderers that draw tables in chat:
 *
 *   - `SheetGrid` — deterministic `table@1` blocks produced by tools
 *   - `AgentMarkdown` — GFM tables the model writes in its prose
 *
 * so a table reads as one visual system regardless of which channel produced
 * it. The difference between the two stays semantic (tool tables carry
 * totals, canvas and CSV export), never visual. Class strings only — no
 * React, no logic.
 */

/** Inner gridline; structural rules (header/footer/frozen) use plain border. */
export const SHEET_LINE = "border-border/50"

/** Outer frame of an in-chat table card. */
export const SHEET_FRAME =
  "overflow-hidden rounded-lg border bg-background shadow-sm"

/** `<table>` element of the compact in-chat grid. */
export const SHEET_TABLE = "w-full border-separate border-spacing-0 text-xs"

/** Header cell of the compact in-chat grid (gridline color included). */
export const SHEET_TH =
  "whitespace-nowrap border-b border-r border-border/50 bg-muted/50 px-2.5 py-1.5 text-left align-middle text-[11px] font-medium text-muted-foreground last:border-r-0"

/** Body cell of the compact in-chat grid (gridline color included). */
export const SHEET_TD =
  "border-b border-r border-border/50 px-2.5 py-1.5 align-top last:border-r-0"
