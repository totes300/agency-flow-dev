import { MessageSquareIcon } from "lucide-react"

/** Rail-scale empty state for the Recent threads section (quiet, in-place). */
export function ThreadsRailEmptyState() {
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-2">
      <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/40" />
      <p className="text-sm text-sidebar-foreground/70">
        No threads yet — pick an agent to start.
      </p>
    </div>
  )
}
