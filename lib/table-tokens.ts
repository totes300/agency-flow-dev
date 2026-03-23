/**
 * Shared design tokens for the v5 Stripe/Ramp table aesthetic.
 *
 * These are plain class strings consumed via cn(). They establish a unified
 * visual language across Budget tables (shadcn Table) and Time Log grouped
 * lists (flex-based Collapsible). The hierarchy levels correspond to the
 * scanning behavior defined in the design system spec.
 */

// ─── Szint 1 — Section title (entry point, the eye goes here first) ────────
export const SECTION_TITLE = "text-base font-semibold tracking-tight"

// ─── Szint 2 — Key metric (the number that matters) ────────────────────────
export const CELL_KEY = "font-semibold font-mono tabular-nums"

// ─── Szint 3 — Primary label (what are we looking at) ──────────────────────
export const CELL_PRIMARY = "text-sm font-medium"

// ─── Szint 4 — Supporting data (context, secondary numbers) ────────────────
export const CELL_SECONDARY = "text-sm font-mono tabular-nums text-muted-foreground"

// ─── Szint 5 — Column header (structure, quiet) ────────────────────────────
export const V5_HEAD = "px-5 py-2.5 text-xs font-normal text-muted-foreground"
export const V5_HEAD_ROW = "border-y border-border hover:bg-transparent"

// ─── Szint 6 — Muted (peripheral, de-emphasized) ───────────────────────────
export const ROW_MUTED = "text-muted-foreground/60"

// ─── Layout ─────────────────────────────────────────────────────────────────
export const V5_CELL = "px-5 py-3"
export const V5_ROW = "border-b border-border/50 hover:bg-muted/50 transition-colors"
export const V5_FOOTER = "border-t border-border"

// ─── Progress bars ──────────────────────────────────────────────────────────
export const PROGRESS_TRACK = "h-[6px] rounded-sm bg-muted"
export const PROGRESS_FILL = "h-full rounded-sm bg-foreground transition-[width] duration-300"
export const PROGRESS_FILL_MUTED = "h-full rounded-sm bg-muted-foreground/20 transition-[width] duration-300"
