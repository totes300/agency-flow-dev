import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"

export function StatusColorSwatch({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const cfg = getStatusColor(color)
  return (
    <span
      className={cn("inline-block size-[18px] shrink-0 rounded", className)}
      style={{ backgroundColor: cfg.swatch }}
    />
  )
}
