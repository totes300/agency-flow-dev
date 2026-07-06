"use client"

import { useMemo } from "react"
import { SearchIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskPanelItem } from "@/convex/planner"
import type { PlannerDragEngine, PlannerPanelTask } from "@/lib/hooks/use-planner-drag"
import { usePlannerPanelFilters } from "@/lib/hooks/use-planner-panel-filters"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import {
  anyPanelFilterActive,
  defaultSpanDays,
  isUnscheduledTask,
  passesPanelFilters,
} from "@/lib/planner"
import { PlannerPanelFilters } from "./planner-panel-filters"
import { PlannerQuickAdd } from "./planner-quick-add"
import { PlannerTaskCard } from "./planner-task-card"

/** Toolbar-badge helper: the to-plan inbox size (shared lib definition). */
export function isUnscheduled(t: TaskPanelItem): boolean {
  return isUnscheduledTask(t)
}

function toPanelTask(t: TaskPanelItem): PlannerPanelTask {
  return {
    taskId: t._id,
    title: t.title,
    projectName: t.projectName,
    clientName: t.clientName,
    categoryColor: t.categoryColor,
    statusType: t.statusType,
    spanDays: defaultSpanDays(t.estimate, t.plannedDays),
  }
}

/**
 * The right-hand Tasks panel (mockup `side`): the to-plan inbox. One
 * unified Notion-style filter system — the scheduling state (Unscheduled /
 * Planned) is a regular filter property, pre-applied as `Schedule:
 * Unscheduled` on a clean URL (owner ruling: no separate tabs). Search +
 * filters narrow ONLY this list, never the timeline. Admins drag cards
 * onto the board to schedule; members browse read-only.
 */
export function PlannerTaskPanel({
  tasks,
  isAdmin,
  engine,
  onOpenTask,
  todayYmd,
  composerNonce = 0,
  onCloseComposer,
}: {
  tasks: TaskPanelItem[] | undefined
  isAdmin: boolean
  engine: PlannerDragEngine
  onOpenTask: (taskId: Id<"tasks">) => void
  /** Org-timezone today — anchors the Due filter's overdue/7-day windows. */
  todayYmd: string
  /** Quick-add composer at the top of the list ("+ New task", admin only):
   *  0 = closed; each increment (re)mounts the composer so a repeated
   *  toolbar click refocuses the title input. */
  composerNonce?: number
  onCloseComposer?: () => void
}) {
  const [search, setSearch] = useUrlDebouncedParam("q")
  const { filters, setFilters, clearFilters } = usePlannerPanelFilters()

  const visible = useMemo(() => {
    if (!tasks) return undefined
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (!passesPanelFilters(t, filters, todayYmd)) return false
      if (!q) return true
      return [t.title, t.projectName ?? "", t.clientName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    })
  }, [tasks, search, filters, todayYmd])

  const draggedTaskId = engine.panelDrag?.task.taskId ?? null

  return (
    <aside className="flex min-h-0 w-full flex-none flex-col border-t border-border bg-card md:w-[288px] md:border-l md:border-t-0">
      <div className="flex items-baseline gap-2 px-3.5 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-foreground">Tasks</span>
        <span className="text-[11.5px] text-muted-foreground">
          {isAdmin ? "drag onto the board to schedule" : "read-only"}
        </span>
      </div>

      <div className="px-3.5 pb-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks, projects, clients…"
            className="w-full rounded-lg border border-border bg-muted py-1.5 pl-8 pr-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      <PlannerPanelFilters
        tasks={tasks ?? []}
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        todayYmd={todayYmd}
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 bg-[color-mix(in_srgb,var(--foreground)_1.5%,var(--card))] px-3 pb-3 pt-2.5 max-md:max-h-[300px]">
        {composerNonce > 0 && isAdmin && onCloseComposer ? (
          <PlannerQuickAdd key={composerNonce} onClose={onCloseComposer} />
        ) : null}
        {visible === undefined ? (
          <PanelSkeleton />
        ) : visible.length === 0 ? (
          <PanelEmpty
            inboxView={filters.schedule === "unscheduled"}
            narrowed={
              search.trim().length > 0 ||
              anyPanelFilterActive({ ...filters, schedule: "all" })
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((t) => (
              <li key={t._id}>
                <PlannerTaskCard
                  title={t.title}
                  clientName={t.clientName}
                  categoryColor={t.categoryColor}
                  isDone={t.statusType === "done"}
                  showPlannedMark={t.segmentCount > 0}
                  draggable={isAdmin}
                  lifted={draggedTaskId === t._id}
                  onPointerDown={
                    isAdmin ? engine.onCardPointerDown(toPanelTask(t)) : undefined
                  }
                  onClick={() => {
                    if (engine.consumeClickSuppression()) return
                    onOpenTask(t._id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

// Content-aware skeleton: card-shaped rows matching the real list.
function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-[10px] border border-border bg-card px-[11px] py-[9px]"
        >
          <div className="mt-[4.5px] size-2 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PanelEmpty({
  inboxView,
  narrowed,
}: {
  /** The Schedule filter is on its default "Unscheduled" (inbox) value. */
  inboxView: boolean
  /** Search text or a non-schedule filter is narrowing the list. */
  narrowed: boolean
}) {
  const message = narrowed
    ? "No tasks match."
    : inboxView
      ? "Everything is planned — nothing waiting to be scheduled."
      : "No active tasks yet."
  return (
    <p className="px-2 py-3.5 text-[12.5px] italic text-muted-foreground">
      {message}
    </p>
  )
}
