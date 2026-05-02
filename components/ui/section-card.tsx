import { cn } from "@/lib/utils"

type Tone = "default" | "destructive"

const TONE_BORDER: Record<Tone, string> = {
  default: "border-border",
  destructive: "border-red-200 dark:border-red-900/50",
}

/**
 * Thin border wrapper for a logical section (Budget table, Time Log month,
 * Inbox Overdue, Inbox To-generate). Intentionally NOT shadcn Card — no
 * CardHeader/Content structure, the content defines its own rhythm.
 */
export function SectionCard({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode
  className?: string
  tone?: Tone
}) {
  return (
    <div
      data-slot="section-card"
      data-tone={tone}
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        TONE_BORDER[tone],
        className,
      )}
    >
      {children}
    </div>
  )
}
