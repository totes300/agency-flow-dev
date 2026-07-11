import { AlertCircleIcon } from "lucide-react"

/** `error` block — human message + actionable hint. Quiet row, no card. */
export function ErrorBlock({
  message,
  hint,
}: {
  message: string
  hint: string | null
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="leading-relaxed text-destructive">{message}</p>
        {hint && (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  )
}
