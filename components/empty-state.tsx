import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60">
        <Icon className="size-7 text-muted-foreground/60" />
      </div>
      <div className="max-w-sm text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
