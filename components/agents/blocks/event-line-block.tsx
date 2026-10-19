import { CheckIcon } from "lucide-react"

/**
 * `event` block (email-triage B8a; PRD §7.1 "event line"): "✓ one
 * sentence" — what code just did ("Created PRG-132 · Frances notified").
 * The sentence is written by server code (`convex/agentEvents.ts`), never by
 * the model.
 */
export function EventLineBlock({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
      <span className="min-w-0">{text}</span>
    </div>
  )
}
