"use client"

import { useCallback, useMemo, useState } from "react"
import { useMutation } from "convex/react"
import { DragDropProvider } from "@dnd-kit/react"
import { move } from "@dnd-kit/helpers"
import { ArchiveIcon, Trash2Icon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { RowActionMenu } from "@/components/row-action-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog"
import { toastArchiveSuccess, toastError } from "@/lib/toast-helpers"
import { columnMeta, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import { LIST_DRAG_SENSORS, TaskGrid } from "@/components/task-view/task-table"
import { SortableTaskRow } from "@/components/task-view/task-row"
import { InlineAddRow } from "@/components/task-view/inline-add-row"
import type { TaskRowModel } from "@/components/task-view/row-model"
import type { TaskDetailDTO } from "@/components/task-detail/use-task-detail"

/**
 * Sub-tasks columns: the status as an icon before the title (Linear), then
 * photos-only assignees, due date and the timer; the page adds priority.
 * Compact tracks so the list fits the drawer's content column.
 */
const SUBTASK_TRACKS: Partial<Record<ColumnKey, string>> = {
  title: "minmax(0,1fr)",
  assignee: "44px",
  due: "72px",
  time: "76px",
}

function subtaskColumns(variant: "drawer" | "page"): ColumnKey[] {
  return variant === "page"
    ? ["priority", "statusIcon", "title", "assignee", "due", "time"]
    : ["statusIcon", "title", "assignee", "due", "time"]
}

const noop = () => {}

/**
 * The task detail's sub-task section (U9): the shared `TaskRow` (compact) for
 * every sub-task — status, assignee and due date edit through the detail's
 * `PropertyMenu`, the timer cell starts/stops — drag to reorder
 * (`tasks.reorderSubtasks`), an always-visible row menu (archive, delete for
 * admins) and the inline add row at the end (`tasks.createSubtask`, title
 * only; the parent's assignees and category carry over as before).
 */
export function TaskSubtasks({
  parent,
  rows,
  ctx,
  variant,
  isAdmin,
  onOpen,
}: {
  parent: TaskDetailDTO
  rows: TaskRowModel[] | undefined
  ctx: CellContext
  variant: "drawer" | "page"
  isAdmin: boolean
  onOpen: (taskId: Id<"tasks">) => void
}) {
  const reorderSubtasks = useMutation(api.tasks.reorderSubtasks)
  const createSubtask = useMutation(api.tasks.createSubtask)
  const archiveTask = useMutation(api.tasks.archive)
  const [deleteTargetId, setDeleteTargetId] = useState<Id<"tasks"> | null>(null)

  const columns = useMemo(() => subtaskColumns(variant), [variant])
  const template = useMemo(() => columns.map((k) => SUBTASK_TRACKS[k] ?? columnMeta(k).track).join(" "), [columns])
  const titleColumn = columns.indexOf("title") + 1

  const handleArchive = useCallback(
    async (taskId: Id<"tasks">) => {
      try {
        const result = await archiveTask({ id: taskId })
        // Silent on plain success (row action), loud when a running timer was rescued or lost.
        if (result.autoSavedTimers.length > 0 || result.timerSaveFailures.length > 0) {
          toastArchiveSuccess(result, "Subtask archived")
        }
      } catch (err) {
        toastError(err, "Failed to archive subtask")
      }
    },
    [archiveTask],
  )

  const rowCtx: CellContext = useMemo(
    () => ({
      ...ctx,
      compactAssignee: true,
      titleActions: (row) => (
        <RowActionMenu>
          <DropdownMenuItem onClick={() => void handleArchive(row.task._id)}>
            <ArchiveIcon className="size-4" />
            Archive
          </DropdownMenuItem>
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTargetId(row.task._id)}
              >
                <Trash2Icon className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </RowActionMenu>
      ),
    }),
    [ctx, handleArchive, isAdmin],
  )

  const handleDragEnd = useCallback(
    // dnd-kit's drag-end event type is not exported in a usable form here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      if (!rows) return
      const items = rows.map((r) => ({ id: r.task._id }))
      const orderedIds = (move(items, event) as typeof items).map((i) => i.id)
      if (orderedIds.every((id, i) => id === items[i].id)) return
      reorderSubtasks({ parentTaskId: parent._id, orderedIds }).catch((err) => toastError(err, "Failed to reorder"))
    },
    [parent._id, reorderSubtasks, rows],
  )

  const handleCreate = useCallback(
    (title: string) => {
      createSubtask({
        parentTaskId: parent._id,
        title,
        assigneeIds: parent.assigneeIds,
        workCategoryId: parent.workCategoryId ?? undefined,
      }).catch((err) => toastError(err, "Failed to create subtask"))
    },
    [createSubtask, parent._id, parent.assigneeIds, parent.workCategoryId],
  )

  if (!rows) return null
  const done = parent.subtaskDoneCount
  const total = rows.length
  const percent = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-muted-foreground">Subtasks</span>
        {total > 0 ? (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.min(done, total)}/{total} done
            </span>
            <div className="h-1 w-10 overflow-hidden rounded-full bg-border/60">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${percent}%` }} />
            </div>
          </>
        ) : null}
      </div>

      <TaskGrid columns={columns} template={template}>
        {total > 0 ? (
          <div className="border-t border-border/60">
            <DragDropProvider sensors={LIST_DRAG_SENSORS} onDragEnd={handleDragEnd}>
              {rows.map((row, i) => (
                <SortableTaskRow
                  key={row.task._id}
                  sortableId={row.task._id}
                  index={i}
                  row={row}
                  columns={columns}
                  ctx={rowCtx}
                  isSelected={false}
                  hasSelection={false}
                  isFocused={false}
                  isOpen={false}
                  onToggleSelect={noop}
                  onOpen={onOpen}
                  compact
                />
              ))}
            </DragDropProvider>
          </div>
        ) : null}
        <InlineAddRow
          compact
          titleColumn={titleColumn}
          groupLabel={parent.title}
          onCreate={handleCreate}
          placeholder="Subtask name…"
          addLabel="Add subtask"
        />
      </TaskGrid>

      <DeleteTaskDialog
        taskId={deleteTargetId}
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
        entityLabel="subtask"
      />
    </div>
  )
}
