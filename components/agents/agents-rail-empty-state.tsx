import { BotIcon, PlusIcon } from "lucide-react"

/**
 * Rail-scale empty state for the Agents section (quiet, in-place). Admins get
 * a "+ New agent" affordance that routes into the builder (slice 09); members
 * just see the explanatory line.
 */
export function AgentsRailEmptyState({
  onCreate,
}: {
  onCreate?: () => void
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md px-2 py-2">
      <div className="flex items-start gap-2">
        <BotIcon className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/40" />
        <div className="min-w-0">
          <p className="text-sm text-sidebar-foreground/70">No agents yet</p>
          <p className="text-xs text-sidebar-foreground/50">
            {onCreate
              ? "Create one to get started."
              : "Agents your admin creates will appear here."}
          </p>
        </div>
      </div>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent"
        >
          <PlusIcon className="size-3.5" />
          New agent
        </button>
      )}
    </div>
  )
}
