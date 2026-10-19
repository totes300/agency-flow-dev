"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronsRightIcon, FullscreenIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { PropertyMenu } from "@/components/task-view/property-menus"
import type { CellContext } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"
import { taskPagePath } from "@/lib/task-detail"
import { cn } from "@/lib/utils"
import { TaskDetailBody } from "@/components/task-detail/task-detail"
import { TaskProperties } from "@/components/task-detail/task-properties"
import { TaskActionsMenu, TaskStepper, useTaskDetailMode } from "@/components/task-detail/task-detail-actions"
import { navLabelFor, setDetailNavList } from "@/components/task-detail/detail-nav"
import { useDrawerTask } from "@/components/task-detail/use-drawer-task"
import { setOpenTaskId } from "@/components/task-detail/open-task-store"
import { DrawerShell } from "@/components/task-detail/drawer-shell"
import { ProposalDrawer, type ProposalDrawerProps } from "@/components/task-detail/proposal-drawer"
import {
  useTaskDetailController,
  useTaskDetailKeys,
  type TaskDetailController,
  type TaskDetailDTO,
} from "@/components/task-detail/use-task-detail"

/**
 * The task drawer (docs/prd-tasks-refactor.md §6.2, U9): the current drawer
 * shell — 54vw, header, content, collapsible 240px property column — with
 * only the U9 deltas: the identifier in the breadcrumb, J/K stepping through
 * the list it was opened from ("3 / 12" + up/down), Priority / Labels / Start
 * date / Today in the property column, sub-tasks on the shared row, the
 * "N new since your last visit" divider, no Email tab. T and Y work inside
 * it. Opened by `?task=<identifier>` (or an old `?detail=<id>` link) on any
 * route; `?draft=<proposalId>` / `?change=<proposalId>` open the same drawer
 * on a proposal (`ProposalDrawer`, email-triage B7).
 *
 * `taskIds` is the list in screen order; `identifierOf` lets J/K write
 * `?task=` directly (without it the URL is canonicalised after the step).
 */
export function TaskDetailDrawer({
  taskIds,
  isAdmin,
  identifierOf,
  proposalFooter,
  planGaps,
}: {
  taskIds: string[]
  isAdmin: boolean
  identifierOf?: (taskId: string) => string | null
  /** The footer of a `?draft=` / `?change=` drawer (default: Approve / Discard). */
  proposalFooter?: ProposalDrawerProps["footer"]
  /** Ledger gaps of a plan task ("Not covered: …"), from the page that knows them. */
  planGaps?: ProposalDrawerProps["planGaps"]
}) {
  const { mode, ready } = useTaskDetailMode()
  const route = useDrawerTask({ taskIds, identifierOf, mode, modeReady: ready })
  const { isOpen, task, close } = route
  const controller = useTaskDetailController(isOpen ? task : null, { isAdmin })
  const router = useRouter()

  // Publish the open task for surfaces that highlight its rows.
  const openId = isOpen ? (task?._id ?? null) : null
  useEffect(() => {
    setOpenTaskId(openId)
    return () => setOpenTaskId(null)
  }, [openId])

  // Properties panel — visible by default on wide screens
  const [showProperties, setShowProperties] = useState(true)

  // Auto-collapse properties below 1440px
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)")
    // Syncs with the media query (an external system); runs once per mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowProperties(mq.matches)
    function handleChange(e: MediaQueryListEvent) {
      setShowProperties(e.matches)
    }
    mq.addEventListener("change", handleChange)
    return () => mq.removeEventListener("change", handleChange)
  }, [])

  useTaskDetailKeys({
    enabled: isOpen && !!task,
    onStep: route.step,
    onToday: controller.sun.toggle,
    onTimer: controller.toggleTimer,
  })

  const openFullPage = () => {
    if (!task?.identifier) return
    const params = new URLSearchParams(window.location.search)
    params.delete("task")
    params.delete("detail")
    params.delete("comment")
    const query = params.toString()
    setDetailNavList({
      from: { label: navLabelFor(window.location.pathname), href: `${window.location.pathname}${query ? `?${query}` : ""}` },
      entries: taskIds.map((id) => ({ id: id as Id<"tasks">, identifier: identifierOf?.(id) ?? null })),
    })
    router.push(taskPagePath(task.identifier))
  }

  return (
    <>
      <DrawerShell isOpen={isOpen} label="Task detail" onClose={close}>
        <DrawerHeader
          task={task ?? null}
          isAdmin={isAdmin}
          onClose={close}
          onOpenTask={(id) => route.navigateTo(id)}
          onOpenFullPage={openFullPage}
          onToggleProperties={() => setShowProperties((p) => !p)}
          showProperties={showProperties}
          stepper={<TaskStepper index={route.index} total={route.total} onStep={route.step} />}
          row={controller.row}
        />

        <div className="flex flex-1 overflow-hidden">
          {task && controller.row ? (
            // Phones: the properties toggle swaps the content for the property column.
            <div className={cn("flex min-w-0 flex-1", showProperties && "max-md:hidden")}>
              <DrawerContent task={task} controller={controller} isAdmin={isAdmin} onOpenTask={(id) => route.navigateTo(id)} />
            </div>
          ) : route.notFound ? (
            <div className="flex-1 p-6 text-sm text-muted-foreground">
              This task doesn&apos;t exist or you don&apos;t have access to it.
            </div>
          ) : (
            <div className="flex-1 p-6">
              <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          )}

          {task && controller.row && showProperties ? (
            <div className="w-[240px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border/70 max-md:w-full max-md:border-l-0">
              <TaskProperties
                task={task}
                row={controller.row}
                memberById={controller.memberById}
                isAdmin={isAdmin}
                layout="stack"
                sun={controller.sun}
                openMenu={controller.openMenu}
              />
            </div>
          ) : null}
        </div>

        {controller.index ? (
          <PropertyMenu
            request={controller.menu}
            tasks={controller.menuTasks}
            index={controller.index}
            actions={controller.actions}
            onClose={controller.closeMenu}
          />
        ) : null}
      </DrawerShell>
      {/* `?draft=` / `?change=` (email-triage B7): the same drawer on a proposal. */}
      <ProposalDrawer footer={proposalFooter} planGaps={planGaps} />
    </>
  )
}

function DrawerContent({
  task,
  controller,
  isAdmin,
  onOpenTask,
}: {
  task: TaskDetailDTO
  controller: TaskDetailController
  isAdmin: boolean
  onOpenTask: (taskId: Id<"tasks">) => void
}) {
  const ctx = useSubtaskCellContext(controller, isAdmin)
  return (
    <TaskDetailBody
      task={task}
      subtaskRows={controller.subtaskRows}
      subtaskCtx={ctx}
      isAdmin={isAdmin}
      variant="drawer"
      onOpenTask={onOpenTask}
    />
  )
}

/** Cell context for the sub-task rows (the detail's own property menu). */
export function useSubtaskCellContext(controller: TaskDetailController, isAdmin: boolean): CellContext {
  const { today, memberById, openMenu } = controller
  return useMemo(
    () => ({ today, memberById, openMenu, canEditBilling: isAdmin }),
    [today, memberById, openMenu, isAdmin],
  )
}

/**
 * The drawer header (unchanged layout): close · breadcrumb (sub-task parent,
 * client / project, + the identifier) · J/K stepper · timer · open as full
 * page · properties toggle · actions menu.
 */
function DrawerHeader({
  task,
  isAdmin,
  onClose,
  onOpenTask,
  onOpenFullPage,
  onToggleProperties,
  showProperties,
  stepper,
  row,
}: {
  task: TaskDetailDTO | null
  row: TaskRowModel | null
  isAdmin: boolean
  onClose: () => void
  onOpenTask: (taskId: Id<"tasks">) => void
  onOpenFullPage: () => void
  onToggleProperties: () => void
  showProperties: boolean
  stepper: React.ReactNode
}) {
  const isClosed = row?.isClosed ?? false
  return (
    <div className="flex shrink-0 items-center border-b border-border/70 px-2.5 h-11">
      <div className="flex items-center gap-1.5 min-w-0">
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close drawer (Esc)">
          <ChevronsRightIcon className="size-4" />
        </Button>

        <div className="h-4 w-px bg-border/50" />

        {task ? <DrawerBreadcrumb task={task} row={row} onOpenTask={onOpenTask} /> : null}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        {stepper}

        {task ? (
          <div className="group/row shrink-0">
            <InlineTimeCell
              taskId={task._id}
              totalMinutes={task.trackedMinutes}
              isDone={isClosed}
              isBillable={task.billable}
              variant="header"
            />
          </div>
        ) : null}

        <div className="h-4 w-px bg-border/50 mx-0.5" />

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onOpenFullPage}
          disabled={!task?.identifier}
          aria-label="Open as full page"
          title="Open as full page"
        >
          <FullscreenIcon className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleProperties}
          aria-label={showProperties ? "Hide properties" : "Show properties"}
        >
          {showProperties ? <PanelRightCloseIcon className="size-4" /> : <PanelRightOpenIcon className="size-4" />}
        </Button>

        {task ? (
          <TaskActionsMenu
            taskId={task._id}
            identifier={task.identifier}
            isAdmin={isAdmin}
            canDelete={task.permissions.canDelete}
            onGone={onClose}
          />
        ) : null}
      </div>
    </div>
  )
}

/** "Subtask of: Parent / Client / Project · ARLO-21" — client and project names from workspaceRefs. */
function DrawerBreadcrumb({
  task,
  row,
  onOpenTask,
}: {
  task: TaskDetailDTO
  row: TaskRowModel | null
  onOpenTask: (taskId: Id<"tasks">) => void
}) {
  const crumbs = { clientName: row?.client?.name ?? null, projectName: row?.project?.name ?? null }
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {task.parent ? (
        <>
          <button
            type="button"
            onClick={() => onOpenTask(task.parent!._id)}
            className="max-w-[180px] truncate text-primary/80 hover:text-primary hover:underline"
          >
            Subtask of: {task.parent.title}
          </button>
          <span className="text-muted-foreground/40">/</span>
        </>
      ) : null}
      {crumbs.clientName ? (
        <>
          <span className="truncate">{crumbs.clientName}</span>
          <span className="text-muted-foreground/40">/</span>
        </>
      ) : null}
      {crumbs.projectName ? <span className="truncate font-medium text-foreground/70">{crumbs.projectName}</span> : null}
      {task.identifier ? (
        <span className="ml-1 shrink-0 whitespace-nowrap tabular-nums">
          {task.parent || crumbs.clientName || crumbs.projectName ? "· " : ""}
          {task.identifier}
        </span>
      ) : null}
    </div>
  )
}
