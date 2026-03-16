import { cn } from "@/lib/utils"

export function CycleDots({
  current,
  total,
  className,
}: {
  current: number // 1-indexed position
  total: number
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Month ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            i < current ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
      ))}
    </span>
  )
}
