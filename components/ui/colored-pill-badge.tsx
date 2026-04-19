import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Single source of truth for status-style pill badges across the app.
 *
 * Consumers (`StatusBadge`, `InvoiceStatusBadge`, `BillingStatusBadge`, etc.)
 * choose a semantic `tone` — never a raw hex — and an optional leading dot
 * to match the Linear-style hierarchy:
 *
 *   status = pill + SVG dot
 *   category = tinted pill + dot + muted text
 *   domain tag (non-status) = plain text, no pill
 *
 * Tints are expressed against Tailwind's color palette with a `/15` opacity
 * background to match the 13% `color-mix` used historically. Dark-mode
 * variants shift both the fill (`/25`) and the foreground (-300 shade) so
 * contrast holds at AA against both light and dark surfaces.
 */
const pillVariants = cva(
  "inline-flex w-fit items-center gap-[5px] rounded-[5px] text-xs font-normal leading-[18px]",
  {
    variants: {
      tone: {
        neutral:
          "bg-muted/60 text-muted-foreground dark:bg-muted/40",
        blue:
          "bg-blue-500/15 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300",
        green:
          "bg-green-500/15 text-green-700 dark:bg-green-500/25 dark:text-green-300",
        red:
          "bg-red-500/15 text-red-700 dark:bg-red-500/25 dark:text-red-300",
        amber:
          "bg-amber-500/15 text-amber-800 dark:bg-amber-500/25 dark:text-amber-300",
      },
      // Asymmetric padding when a leading dot is present (less left padding
      // so the dot sits tight to the edge). Symmetric padding otherwise.
      withDot: {
        true: "py-[3px] pl-[6px] pr-[9px]",
        false: "px-2 py-[3px]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      withDot: false,
    },
  },
)

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-muted-foreground/60",
      blue: "bg-blue-500",
      green: "bg-green-500",
      red: "bg-red-500",
      amber: "bg-amber-500",
    },
  },
  defaultVariants: { tone: "neutral" },
})

export type ColoredPillTone =
  NonNullable<VariantProps<typeof pillVariants>["tone"]>

export interface ColoredPillBadgeProps
  extends Omit<React.ComponentProps<"span">, "children">,
    VariantProps<typeof pillVariants> {
  /** Label text. Kept as a dedicated prop to encourage short, consistent copy. */
  label: React.ReactNode
  /** Replaces the default dot with a custom leading element (e.g. an SVG icon). */
  leading?: React.ReactNode
  /** Render a filled dot before the label. Ignored if `leading` is provided. */
  showDot?: boolean
}

export function ColoredPillBadge({
  tone,
  label,
  leading,
  showDot,
  className,
  ...rest
}: ColoredPillBadgeProps) {
  const hasLeading = Boolean(leading) || Boolean(showDot)
  return (
    <span
      data-slot="colored-pill-badge"
      className={cn(pillVariants({ tone, withDot: hasLeading }), className)}
      {...rest}
    >
      {leading ?? (showDot ? <span className={dotVariants({ tone })} /> : null)}
      {label}
    </span>
  )
}
