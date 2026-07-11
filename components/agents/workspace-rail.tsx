import { WorkspaceSwitch } from "@/components/workspace-switch"
import { AgentsRailEmptyState } from "@/components/agents/agents-rail-empty-state"
import { ThreadsRailEmptyState } from "@/components/agents/threads-rail-empty-state"

function RailSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground/70">
      {children}
    </div>
  )
}

/**
 * Workspace left rail — the primary navigation of the Agents workspace:
 * workspace switch on top, pinned Agents section, then Recent threads.
 * Slice 00 ships the structure with empty states; data arrives in 01+.
 */
export function WorkspaceRail() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="p-2">
        <WorkspaceSwitch />
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4">
        <section>
          <RailSectionLabel>Agents</RailSectionLabel>
          <AgentsRailEmptyState />
        </section>
        <section>
          <RailSectionLabel>Recent threads</RailSectionLabel>
          <ThreadsRailEmptyState />
        </section>
      </div>
    </aside>
  )
}
