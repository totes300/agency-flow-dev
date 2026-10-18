"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { toast } from "sonner"
import { LinkIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { ChevronLeftNavIcon } from "@/components/icons/nav-icons"
import { PropertyMenu } from "@/components/task-view/property-menus"
import { TASK_VIEW_PANEL_CLASS } from "@/components/task-view/task-view-skeleton"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useBreadcrumbTitle } from "@/lib/hooks/use-breadcrumb-title"
import { formatDateToYMD } from "@/lib/format"
import { buildDetailUrl, taskPagePath } from "@/lib/task-detail"
import { toastError } from "@/lib/toast-helpers"
import { TaskDetailBody } from "@/components/task-detail/task-detail"
import { TaskProperties } from "@/components/task-detail/task-properties"
import { TaskActionsMenu, TaskStepper } from "@/components/task-detail/task-detail-actions"
import { useSubtaskCellContext } from "@/components/task-detail/task-detail-drawer"
import { navPosition, readDetailNavList } from "@/components/task-detail/detail-nav"
import { useTaskDetailController, useTaskDetailKeys } from "@/components/task-detail/use-task-detail"

const noopSubscribe = () => () => {}

/**
 * The full task page at `/tasks/[identifier]` (docs/prd-tasks-refactor.md
 * §6.1, U9): the Linear issue layout — the shared body in a reading column,
 * the property panel as a right sidebar. Resolves old identifiers through
 * `getByIdentifier` (aliases) and rewrites the URL to the current one. J/K
 * step through the list the task was opened from (`detail-nav`), T plans it
 * for today (D9), Y starts/stops its timer, Esc goes back to that list.
 */
export function TaskDetailPage({ identifier }: { identifier: string }) {
  const router = useRouter()
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() ?? false
  const [today] = useState(() => formatDateToYMD(new Date()))
  const task = useQuery(api.tasks.queries.getByIdentifier, isAuthenticated ? { identifier, today } : "skip")
  const controller = useTaskDetailController(task, { isAdmin })
  const subtaskCtx = useSubtaskCellContext(controller, isAdmin)

  // An alias or another casing → the canonical URL (keeps ?comment=).
  const canonical = task?.identifier ?? null
  useEffect(() => {
    if (canonical && canonical !== identifier) {
      router.replace(`${taskPagePath(canonical)}${window.location.search}`)
    }
  }, [canonical, identifier, router])

  useBreadcrumbTitle(task?.identifier ?? (task === null ? "Not found" : null))

  // The list the page was opened from (client-only; null on the server render).
  const nav = useSyncExternalStore(noopSubscribe, readDetailNavList, () => null)
  const position = nav && task ? navPosition(nav.entries, task._id) : null
  const back = nav?.from ?? { label: "Tasks", href: "/tasks" }

  const step = useCallback(
    (direction: "next" | "prev") => {
      const entry = direction === "next" ? position?.next : position?.prev
      if (!entry) return
      router.replace(entry.identifier ? taskPagePath(entry.identifier) : `/tasks${buildDetailUrl(new URLSearchParams(), entry.id)}`)
    },
    [position, router],
  )
  const openTask = useCallback(
    (taskId: Id<"tasks">) => {
      const identifierOf = (id: Id<"tasks">) =>
        controller.subtaskRows?.find((r) => r.task._id === id)?.task.identifier ??
        (task?.parent?._id === id ? task.parent.identifier : null)
      const target = identifierOf(taskId)
      router.push(target ? taskPagePath(target) : `/tasks${buildDetailUrl(new URLSearchParams(), taskId)}`)
    },
    [controller.subtaskRows, router, task],
  )

  useTaskDetailKeys({
    enabled: !!task,
    onStep: step,
    onToday: controller.sun.toggle,
    onTimer: controller.toggleTimer,
  })

  // Esc → back to the list (unless a menu/dialog owns the key, or the user is typing).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return
      const target = e.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return
      if (document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open']")) return
      router.push(back.href)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [back.href, router])

  if (task === null) {
    return (
      <div className={TASK_VIEW_PANEL_CLASS} data-full-bleed>
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>Task not found</EmptyTitle>
            <EmptyDescription>
              {identifier.toUpperCase()} doesn&apos;t exist, was deleted, or you don&apos;t have access to it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" asChild>
              <Link href={back.href}>Back to {back.label}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const row = controller.row
  if (!task || !row) return <TaskDetailPageSkeleton />

  async function copyLink() {
    if (!task?.identifier) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${taskPagePath(task.identifier)}`)
      toast.success("Link copied")
    } catch {
      toastError(new Error("Clipboard access denied"), "Failed to copy link")
    }
  }

  return (
    <div className={TASK_VIEW_PANEL_CLASS} data-full-bleed>
      <ErrorBoundary>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Button variant="ghost" size="sm" className="-ml-1 gap-1 text-muted-foreground" asChild>
            <Link href={back.href}>
              <ChevronLeftNavIcon />
              {back.label}
            </Link>
          </Button>
          {row.client || row.project ? (
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {row.client ? <span className="truncate">{row.client.name}</span> : null}
              {row.client && row.project ? <span className="text-muted-foreground/40">/</span> : null}
              {row.project ? <span className="truncate font-medium text-foreground/70">{row.project.name}</span> : null}
            </div>
          ) : null}
          {task.parent ? (
            <button
              type="button"
              onClick={() => openTask(task.parent!._id)}
              className="max-w-[220px] truncate text-xs text-primary/80 hover:text-primary hover:underline"
            >
              Subtask of: {task.parent.title}
            </button>
          ) : null}
          <span className="flex-1" />
          <TaskStepper index={position?.index ?? null} total={position?.total ?? 0} onStep={step} />
          <div className="group/row shrink-0">
            <InlineTimeCell
              taskId={task._id}
              totalMinutes={task.trackedMinutes}
              isDone={row.isClosed}
              isBillable={task.billable}
              variant="header"
            />
          </div>
          <div className="mx-0.5 h-4 w-px bg-border/50" />
          <Button variant="ghost" size="icon-xs" onClick={() => void copyLink()} aria-label="Copy link" title="Copy link">
            <LinkIcon className="size-4" />
          </Button>
          <TaskActionsMenu
            taskId={task._id}
            identifier={task.identifier}
            isAdmin={isAdmin}
            canDelete={task.permissions.canDelete}
            onGone={() => router.push(back.href)}
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <TaskDetailBody
            task={task}
            subtaskRows={controller.subtaskRows}
            subtaskCtx={subtaskCtx}
            isAdmin={isAdmin}
            variant="page"
            onOpenTask={openTask}
          />
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border/60 lg:block">
            <TaskProperties
              task={task}
              row={row}
              memberById={controller.memberById}
              isAdmin={isAdmin}
              layout="sidebar"
              sun={controller.sun}
              openMenu={controller.openMenu}
            />
          </aside>
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
      </ErrorBoundary>
    </div>
  )
}

/** Route `loading.tsx` and first paint: top bar, reading column, property sidebar. */
export function TaskDetailPageSkeleton() {
  return (
    <div className={TASK_VIEW_PANEL_CLASS} data-full-bleed aria-busy="true">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-[856px] flex-col gap-5 px-12 pt-10">
          <Skeleton className="h-7 w-2/3" />
          <div className="flex gap-4 border-b border-border/40 pb-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 w-10" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="hidden w-[300px] shrink-0 flex-col gap-3 border-l border-border/60 p-4 lg:flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
