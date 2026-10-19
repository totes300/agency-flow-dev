"use client"

import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDateToYMD } from "@/lib/format"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useLastDefined } from "@/lib/hooks/use-last-defined"
import { useOptionalQuery } from "@/lib/hooks/use-optional-query"
import { parseTaskRef } from "@/lib/task-detail"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { visibleColumnKeys, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import {
  MY_WORK_EMPTY,
  MY_WORK_SPEC,
  buildMyWorkBoard,
  myWorkMoveFor,
  type MyWorkColumnKey,
} from "@/components/task-view/my-work-model"
import { PropertyMenu, type PropertyMenuKind, type PropertyMenuRequest } from "@/components/task-view/property-menus"
import { buildRowModels, indexRefs } from "@/components/task-view/row-model"
import { sunStateFor, type SunViewer } from "@/components/task-view/sun"
import { TaskBoard } from "@/components/task-view/task-board"
import { useTaskActions } from "@/components/task-view/use-task-actions"
import { useTaskOpener } from "@/components/task-view/use-task-opener"
import { useTodayActions } from "@/components/task-view/use-today-actions"
import { buildTodaySections } from "@/components/my-tasks/today-model"

/** Card properties: the preset's columns without the ID and the long list-only cells (as the task view's board). */
const BOARD_KEYS: readonly ColumnKey[] = visibleColumnKeys(MY_WORK_SPEC).filter(
  (k) => k !== "id" && k !== "created" && k !== "activity",
)

/**
 * The dashboard "My work" board (§11.8): the `MY_WORK_SPEC` board preset on
 * the task-view engine — `listView` (my started + completed tasks) plus my
 * Today plan (`tasks.today.listToday`), the shared `TaskBoard` / board card,
 * property menus, the sun and the shared detail (drawer or full page per the
 * user's setting). Columns and drop rules: `my-work-model.ts`.
 */
export function MyWorkBoard() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() ?? false
  const searchParams = useSearchParams()
  const [today] = useState(() => formatDateToYMD(new Date()))
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

  const refs = useQuery(api.workspaceRefs.get, isAuthenticated ? {} : "skip")
  const index = useMemo(() => (refs ? indexRefs(refs) : null), [refs])
  const list = useLastDefined(
    useQuery(api.tasks.queries.listView, isAuthenticated ? { surface: "myTasks", spec: MY_WORK_SPEC, today } : "skip"),
  )
  // Optional like on My Tasks: without the Today plan the board still shows In progress and Done.
  const { data: plan, error: planError } = useOptionalQuery(
    api.tasks.today.listToday,
    isAuthenticated ? { today, timezone } : "skip",
  )
  const { data: planned } = useOptionalQuery(api.tasks.today.plannedToday, isAuthenticated ? { today } : "skip")

  const board = useMemo(() => {
    if (!index || !list) return null
    const listRows = buildRowModels(list.rows, list.perUser, index)
    const todayRows = plan ? buildTodaySections(plan, index).today : []
    return buildMyWorkBoard({ listRows, todayRows, statuses: index.refs.statuses, today })
  }, [index, list, plan, today])

  const rowById = useMemo(
    () => new Map((board?.columns ?? []).flatMap((c) => c.rows.map((r) => [r.task._id, r] as const))),
    [board],
  )
  const orderedIds = useMemo(() => [...rowById.keys()], [rowById])
  const identifierOf = useCallback((taskId: string) => rowById.get(taskId as Id<"tasks">)?.task.identifier ?? null, [rowById])
  const { open } = useTaskOpener({ identifierOf, orderedIds, fromLabel: "Dashboard" })

  // The open task (highlighted on its card).
  const taskRef = parseTaskRef(searchParams)
  const openId = useMemo(() => {
    if (!taskRef) return null
    if (taskRef.kind === "id") return taskRef.id
    const wanted = taskRef.identifier.toUpperCase()
    return [...rowById.values()].find((r) => r.task.identifier?.toUpperCase() === wanted)?.task._id ?? null
  }, [rowById, taskRef])

  // ─── Property menus, the sun, drops ─────────────────────────────────────────
  const actions = useTaskActions()
  const [menu, setMenu] = useState<PropertyMenuRequest | null>(null)
  const menuTasks = useMemo(() => (menu ? menu.taskIds.flatMap((id) => rowById.get(id)?.task ?? []) : []), [menu, rowById])
  const memberById = useMemo(() => index?.memberById ?? new Map(), [index])
  const todayActions = useTodayActions({ today, me: refs?.me ?? null, memberById })
  const viewer: SunViewer | null = useMemo(() => (refs ? { me: refs.me, isAdmin } : null), [isAdmin, refs])
  const todayIds = board?.todayIds
  const cellContext: CellContext = useMemo(
    () => ({
      today,
      memberById,
      canEditBilling: isAdmin,
      openMenu: (kind: PropertyMenuKind, taskId: Id<"tasks">, anchor: HTMLElement) =>
        setMenu((current) =>
          current && current.anchor === anchor && current.kind === kind ? null : { kind, taskIds: [taskId], anchor },
        ),
      sun: viewer
        ? {
            // The Today column already says "today": its cards don't repeat the chip.
            stateFor: (row) => (todayIds?.has(row.task._id) ? { kind: "hidden" } : sunStateFor(row, viewer, planned, memberById)),
            toggle: (row, state) => void todayActions.toggleSun(row.task._id, state),
          }
        : undefined,
    }),
    [isAdmin, memberById, planned, today, todayActions, todayIds, viewer],
  )

  const statuses = index?.refs.statuses
  const moveCard = useCallback(
    async (taskId: Id<"tasks">, fromKey: string, toKey: string) => {
      const row = rowById.get(taskId)
      if (!row || !statuses) return
      const move = myWorkMoveFor(row, fromKey, toKey, statuses)
      if (!move) return
      if (move.kind === "status") return void actions.setStatus([row.task], move.statusId)
      // Back to not-started first: closed tasks can't be planned, and In progress wins over Today.
      if (move.resetStatusId) await actions.setStatus([row.task], move.resetStatusId)
      await todayActions.planMyDay([taskId], () => "Planned for today")
    },
    [actions, rowById, statuses, todayActions],
  )

  const dividers = board?.dividers
  return (
    <>
      {board ? (
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TaskBoard
            columns={board.columns}
            keys={BOARD_KEYS}
            ctx={cellContext}
            draggable
            fill
            focusedId={null}
            openId={openId}
            onOpen={open}
            onMove={(taskId, fromKey, toKey) => void moveCard(taskId, fromKey, toKey)}
            onCreateInColumn={() => undefined}
            dividerFor={(column, row) => (column.key === "done" ? (dividers?.get(row.task._id) ?? null) : null)}
            emptyFor={(column) =>
              column.key === "today" && planError
                ? "Today's plan couldn't load."
                : MY_WORK_EMPTY[column.key as MyWorkColumnKey]
            }
          />
        </div>
      ) : (
        <MyWorkBoardSkeleton />
      )}

      {index ? (
        <PropertyMenu request={menu} tasks={menuTasks} index={index} actions={actions} onClose={() => setMenu(null)} />
      ) : null}
      <TaskDetailDrawer taskIds={orderedIds} isAdmin={isAdmin} identifierOf={identifierOf} />
    </>
  )
}

function MyWorkBoardSkeleton() {
  return (
    <div className="flex gap-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex min-h-60 w-[17rem] shrink-0 flex-col gap-2 rounded-2xl bg-muted p-2 md:w-auto md:flex-1">
          <Skeleton className="m-2 h-4 w-28" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ))}
    </div>
  )
}
