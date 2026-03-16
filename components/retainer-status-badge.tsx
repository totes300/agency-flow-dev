import { cn } from "@/lib/utils"

export function RetainerStatusBadge({
  status,
  className,
}: {
  status: "active" | "inactive" | string
  className?: string
}) {
  const isActive = status === "active"
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs font-medium",
      isActive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      className
    )}>
      <span className={cn(
        "size-1.5 rounded-full",
        isActive ? "bg-emerald-500 dark:bg-emerald-400" : "bg-muted-foreground/50"
      )} />
      {isActive ? "Active" : "Inactive"}
    </span>
  )
}
