import { BotIcon } from "lucide-react"

/** Rail-scale empty state for the Agents section (quiet, in-place). */
export function AgentsRailEmptyState() {
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-2">
      <BotIcon className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/40" />
      <div className="min-w-0">
        <p className="text-sm text-sidebar-foreground/70">No agents yet</p>
        <p className="text-xs text-sidebar-foreground/50">
          Agents your admin creates will appear here.
        </p>
      </div>
    </div>
  )
}
