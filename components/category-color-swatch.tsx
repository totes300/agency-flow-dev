import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

export function CategoryColorSwatch({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const c = getCategoryColor(color)
  return (
    <span
      className={cn("inline-block size-[18px] shrink-0 rounded-sm", className)}
      style={{
        backgroundColor: c.bg,
        boxShadow: `inset 0 0 0 1px ${c.ring}`,
      }}
    />
  )
}
