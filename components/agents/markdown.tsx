"use client"

import type { ComponentProps, CSSProperties } from "react"
import { Streamdown } from "streamdown"
import {
  SHEET_FRAME,
  SHEET_TABLE,
  SHEET_TD,
  SHEET_TH,
} from "@/components/agents/sheet/sheet-tokens"
import { DETERMINISTIC_VALUE_CLASS } from "@/lib/agents/blocks"
import { cn } from "@/lib/utils"

/**
 * AgentMarkdown — the agent stream's prose renderer. GFM via Streamdown,
 * which is streaming-safe: half-finished constructs (an unclosed table row,
 * a dangling `**`) render cleanly mid-stream instead of flashing raw syntax.
 *
 * Tables the model writes get the SAME visual language as the deterministic
 * SheetGrid (shared sheet tokens), so every table in chat reads as one
 * system. The difference between the two channels stays semantic — tool
 * tables carry totals, canvas and CSV export; prose tables don't — never
 * visual. Right-aligned GFM columns (`---:`) get the determinism figure
 * treatment (tabular-nums) so numeric columns line up like the sheet's.
 *
 * Streamdown's own hover controls (copy/download/fullscreen) are disabled:
 * chat affordances are ours, and floating buttons read as noise here.
 */

type MarkdownComponents = NonNullable<
  ComponentProps<typeof Streamdown>["components"]
>

/** GFM column alignment arrives as an inline style on th/td. */
function alignClass(style: CSSProperties | undefined): string | false {
  return (
    style?.textAlign === "right" &&
    cn("text-right", DETERMINISTIC_VALUE_CLASS)
  )
}

const components: MarkdownComponents = {
  // ── Tables: the sheet design language (locked 2026-07-11) ────────────────
  table: ({ children }) => (
    <div className={cn("my-2", SHEET_FRAME)}>
      <div className="overflow-x-auto">
        <table
          className={cn(
            SHEET_TABLE,
            // the card frame already closes the grid at the bottom
            "[&_tbody_tr:last-child>td]:border-b-0",
          )}
        >
          {children}
        </table>
      </div>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className={cn(SHEET_TH, alignClass(style))}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className={cn(SHEET_TD, alignClass(style))}>
      {children}
    </td>
  ),

  // ── Headings: scaled to chat, not to a document ───────────────────────────
  h1: ({ children }) => (
    <h1 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-0.5 mt-2 text-sm font-medium first:mt-0">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-0.5 mt-2 text-sm font-medium text-muted-foreground first:mt-0">
      {children}
    </h6>
  ),
}

export function AgentMarkdown({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      controls={false}
      components={components}
      className="space-y-2 text-sm leading-relaxed text-foreground"
    >
      {text}
    </Streamdown>
  )
}
