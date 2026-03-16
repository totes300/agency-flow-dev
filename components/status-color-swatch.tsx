import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import type { StatusColorName } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

export function StatusColorSwatch({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const cfg = STATUS_COLOR_CONFIG[color as StatusColorName]
  return (
    <span
      className={cn("inline-block size-[18px] shrink-0 rounded", className)}
      style={{ backgroundColor: cfg?.swatch ?? STATUS_COLOR_CONFIG.gray.swatch }}
    />
  )
}
