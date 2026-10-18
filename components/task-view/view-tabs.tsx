"use client"

import { useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { GlobeNavIcon, LockNavIcon, NewViewIcon } from "@/components/icons/nav-icons"
import { cn } from "@/lib/utils"
import type { ViewOption } from "@/components/task-view/view-state"

const TAB_DRAG_SENSORS = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
]

export type ViewTabActions = {
  onSelect: (key: string) => void
  onNew: () => void
  onRename: (view: ViewOption) => void
  onDuplicate: (view: ViewOption) => void
  onDelete: (view: ViewOption) => void
  /** Moves a saved view right after `afterKey` inside its group (null = first). */
  onMove: (view: ViewOption, afterKey: string | null) => void
  onResetDefault: (view: ViewOption) => void
}

/**
 * Pill view tabs (U1/U5) — the only pills in the toolbar. System views
 * first, then workspace views (globe), then the caller's personal views
 * (lock). Clicking the active tab opens its menu (rename, duplicate, move,
 * delete); saved views the caller may edit can also be dragged within their
 * group. The modified dot lives on the Display button, not here.
 */
export function ViewTabs({
  views,
  activeKey,
  isAdmin,
  customizedDefaults,
  actions,
}: {
  views: readonly ViewOption[]
  activeKey: string
  isAdmin: boolean
  customizedDefaults: readonly string[]
  actions: ViewTabActions
}) {
  const groups: Record<ViewOption["scope"], ViewOption[]> = { system: [], workspace: [], personal: [] }
  for (const view of views) groups[view.scope].push(view)

  return (
    <div role="tablist" aria-label="Views" className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <DragDropProvider
        sensors={TAB_DRAG_SENSORS}
        onDragEnd={(event) => {
          if (event.canceled) return
          const { source } = event.operation
          if (!isSortable(source)) return
          const { initialIndex, index, initialGroup, group } = source
          if (initialGroup !== group || initialIndex === index) return
          const list = groups[group as ViewOption["scope"]]
          const moved = list[initialIndex]
          if (!moved) return
          const rest = list.filter((v) => v.key !== moved.key)
          actions.onMove(moved, index === 0 ? null : rest[index - 1]?.key ?? null)
        }}
      >
        {(["system", "workspace", "personal"] as const).flatMap((scope) =>
          groups[scope].map((view, index) => (
            <ViewTab
              key={view.key}
              view={view}
              index={index}
              active={view.key === activeKey}
              isAdmin={isAdmin}
              customized={customizedDefaults.includes(view.key)}
              actions={actions}
            />
          )),
        )}
      </DragDropProvider>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label="New view"
        title="New view"
        onClick={actions.onNew}
      >
        <NewViewIcon />
      </Button>
    </div>
  )
}

function ViewTab({
  view,
  index,
  active,
  isAdmin,
  customized,
  actions,
}: {
  view: ViewOption
  index: number
  active: boolean
  isAdmin: boolean
  customized: boolean
  actions: ViewTabActions
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const draggable = view.scope !== "system" && view.canEdit
  const { ref, isDragging } = useSortable({
    id: view.key,
    index,
    group: view.scope,
    type: view.scope,
    accept: view.scope,
    disabled: !draggable,
  })

  return (
    // A plan view (My Tasks Today) has nothing to rename, duplicate or delete: no menu.
    <DropdownMenu open={menuOpen} onOpenChange={(open) => setMenuOpen(open && active && !view.plan)}>
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          role="tab"
          aria-selected={active}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            active
              ? "bg-foreground/[0.07] font-medium text-foreground"
              : "bg-background text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted/60 hover:text-foreground",
            isDragging && "opacity-60",
          )}
          onPointerDown={(e) => {
            // Inactive tabs select on click; only the active tab opens its menu.
            if (!active) e.preventDefault()
          }}
          onClick={() => { if (!active) actions.onSelect(view.key) }}
          onKeyDown={(e) => {
            if (!active && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault()
              actions.onSelect(view.key)
            }
          }}
        >
          {view.scope === "workspace" ? (
            <GlobeNavIcon size={13} className="text-muted-foreground" aria-label="Workspace view" />
          ) : view.scope === "personal" ? (
            <LockNavIcon size={13} className="text-muted-foreground" aria-label="Personal view" />
          ) : null}
          {view.name}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {view.canEdit ? <DropdownMenuItem onSelect={() => actions.onRename(view)}>Rename…</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => actions.onDuplicate(view)}>Duplicate as new view…</DropdownMenuItem>
        {view.scope === "system" && isAdmin && customized ? (
          <DropdownMenuItem onSelect={() => actions.onResetDefault(view)}>Restore original default</DropdownMenuItem>
        ) : null}
        {view.canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(view)}>
              Delete view
            </DropdownMenuItem>
          </>
        ) : null}
        {view.scope === "workspace" && !view.canEdit ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Workspace view · admins edit it</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
