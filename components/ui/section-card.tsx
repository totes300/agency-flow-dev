import { cn } from "@/lib/utils"

/**
 * Thin border wrapper for a logical section (Budget table, Time Log month,
 * future Invoice list). Intentionally NOT shadcn Card — no CardHeader/Content
 * structure, the content defines its own rhythm.
 */
export function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border", className)}>
      {children}
    </div>
  )
}
