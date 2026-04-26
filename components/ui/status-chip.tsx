import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Outlined status chip — the state counterpart to `ColoredPillBadge`.
 *
 * Badge hierarchy across the app:
 *
 *   ColoredPillBadge  → filled tinted pill + dot      (category / taxonomy)
 *   StatusChip        → outlined rounded-rect + tint  (state)
 *
 * Fill-vs-outline is what tells the eye "type of thing" vs "state a thing is
 * in" without the two reading as siblings. Shares the `rounded-[5px]` radius
 * with `ColoredPillBadge` so they sit as visual siblings of one shape family,
 * differentiated only by fill treatment.
 */

const statusChipVariants = cva(
  "inline-flex h-[22px] items-center gap-[5px] rounded-[5px] border px-2 py-[3px] text-xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral:
          "border-border bg-muted text-muted-foreground",
        blue:
          "border-blue-200 bg-blue-500/15 text-blue-700 dark:border-blue-900 dark:bg-blue-500/25 dark:text-blue-300",
        red:
          "border-red-200 bg-red-500/15 text-red-700 dark:border-red-800 dark:bg-red-500/25 dark:text-red-300",
        green:
          "border-green-200 bg-green-500/15 text-green-700 dark:border-green-800 dark:bg-green-500/25 dark:text-green-300",
        amber:
          "border-amber-200 bg-amber-500/15 text-amber-700 dark:border-amber-800 dark:bg-amber-500/25 dark:text-amber-300",
        // `void` reads as historical/cancelled without red-flagging.
        // Dashed border + line-through says "record kept, do not act".
        void:
          "border-dashed border-border bg-transparent text-muted-foreground [text-decoration:line-through] decoration-muted-foreground/60",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

export type StatusChipTone =
  NonNullable<VariantProps<typeof statusChipVariants>["tone"]>

export interface StatusChipProps
  extends Omit<React.ComponentProps<"span">, "children">,
    VariantProps<typeof statusChipVariants> {
  /** Short sentence-case label, e.g. "Invoiced", "Non-billable". */
  label: React.ReactNode
  /** Optional leading glyph (e.g. BanIcon for Non-billable). */
  leading?: React.ReactNode
}

export function StatusChip({
  tone,
  label,
  leading,
  className,
  ...rest
}: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      className={cn(statusChipVariants({ tone }), className)}
      {...rest}
    >
      {leading}
      {label}
    </span>
  )
}
