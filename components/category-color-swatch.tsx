import { CATEGORY_COLORS } from "@/convex/lib/constants"
import type { CategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

export function CategoryColorSwatch({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const c = CATEGORY_COLORS[color as CategoryColor] ?? CATEGORY_COLORS.default
  return (
    <span
      className={cn("inline-block size-[18px] shrink-0 rounded-sm", className)}
      style={{ backgroundColor: c.bg }}
    />
  )
}
