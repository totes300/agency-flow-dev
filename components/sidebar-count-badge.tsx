import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one and only sidebar count badge — a soft-red tinted pill with a bold
 * number, sitting INLINE right after the row's label (not floating at the
 * row's right edge). Used identically for every sidebar count (Inbox unread,
 * My Tasks, Invoices) so the sidebar speaks a single visual language.
 *
 * Muted on purpose: a low-saturation red that whispers "needs a look" without
 * the three-loud-beacons effect of a saturated fill at the far right. Because
 * it flows after the label it's clipped away on the collapsed icon rail (the
 * button hides everything past the icon) — no special handling needed.
 *
 * Renders nothing when `count <= 0` — absence is the clean state. Extra props
 * (e.g. the ref/handlers a Tooltip trigger injects via `asChild`) forward to
 * the pill.
 */
export function SidebarCountBadge({
  count,
  isCapped = false,
  cap = 99,
  className,
  ...props
}: {
  count: number
  /** Server already truncated the count — render `${cap}+`. */
  isCapped?: boolean
  cap?: number
} & React.ComponentProps<"span">) {
  if (count <= 0) return null
  const display = isCapped || count > cap ? `${cap}+` : String(count)
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums",
        "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
        className,
      )}
      {...props}
    >
      {display}
    </span>
  )
}
