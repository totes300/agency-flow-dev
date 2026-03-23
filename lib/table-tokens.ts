/**
 * Shared design tokens for tabular data displays.
 *
 * Plain class strings consumed via cn(). Establishes a unified visual language
 * across data tables (shadcn Table) and grouped lists (flex-based Collapsible).
 *
 * Applied as consumer-side overrides — shadcn table.tsx defaults are untouched.
 * The hierarchy levels define scanning priority: what the eye reads first.
 */

// ─── Visual hierarchy ───────────────────────────────────────────────────────────

/** Level 1 — Section entry point. Card/accordion title. */
export const SECTION_TITLE = "text-base font-semibold tracking-tight"

/** Level 2 — The primary number. Actual hours, duration, total amount. */
export const CELL_KEY = "font-semibold font-mono tabular-nums"

/** Level 2b — Currency/amount values (slightly smaller key metric). */
export const CELL_AMOUNT = "text-sm font-semibold font-mono tabular-nums"

/** Level 2c — Destructive number. Over-budget, negative profit, overtime. */
export const CELL_DANGER = "text-sm font-semibold font-mono tabular-nums text-destructive"

/** Level 3 — Row identifier. Category name, task name. */
export const CELL_PRIMARY = "text-sm font-medium"

/** Level 4 — Context. Estimated hours, remaining, date, entry count. */
export const CELL_SECONDARY = "text-sm font-mono tabular-nums text-muted-foreground"

/** Level 5 — Column header. Structural, quiet. */
export const TABLE_HEAD = "px-5 py-2.5 h-auto text-xs font-normal text-muted-foreground"
export const TABLE_HEAD_ROW = "border-y border-border hover:bg-transparent"

/** Level 6 — De-emphasized. Not-started categories, disabled rows. */
export const ROW_MUTED = "opacity-50"

// ─── Layout ─────────────────────────────────────────────────────────────────────

/** Standard cell padding for data tables and grouped lists. */
export const TABLE_CELL = "px-5 py-3"

/** Standard row treatment — border, hover highlight. */
export const TABLE_ROW = "border-b border-border/50 hover:bg-muted/50 transition-colors"

/** Footer/total row — top border, no background. */
export const TABLE_FOOTER = "border-t border-border"

// ─── Progress bars ──────────────────────────────────────────────────────────────

export const PROGRESS_TRACK = "h-[6px] rounded-sm bg-muted"
export const PROGRESS_FILL = "h-full rounded-sm bg-foreground transition-[width] duration-300"
export const PROGRESS_FILL_MUTED = "h-full rounded-sm bg-muted-foreground/20 transition-[width] duration-300"
