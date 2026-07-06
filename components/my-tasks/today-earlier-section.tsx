"use client"

import { HistoryIcon } from "lucide-react"
import { MyTasksGroup } from "./my-tasks-group"
import { MyTaskRow } from "./my-task-row"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { Id } from "@/convex/_generated/dataModel"

export type EarlierTask = TaskWithJoins & { plannedEndDate?: string }

/** Whole-day difference between two YYYY-MM-DD strings (UTC string math). */
function ageLabel(endDate: string | undefined, todayStr: string): string | undefined {
  if (!endDate) return undefined
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const days = Math.round((utc(todayStr) - utc(endDate)) / 86_400_000)
  return days <= 0 ? undefined : `${days}d`
}

/**
 * "Earlier" — a distinct section BELOW the Today group (above the status
 * groups) for planned-but-unfinished leftovers from the last 14 days. Full
 * task cards (same as everywhere), demoted via dimming so today's plan stays
 * primary. Each row shows how stale it is and a sun = "move to today" (which
 * creates a fresh one-day segment; the old plan stays as history). Never
 * auto-carried — the whole point is to move or let go.
 */
export function TodayEarlierSection({
  tasks,
  todayStr,
  timeMap,
  activityMap,
  detailId,
  onOpenDetail,
  onComplete,
  defaultStatusId,
}: {
  tasks: EarlierTask[]
  todayStr: string
  timeMap?: Record<string, number>
  activityMap?: Record<string, ActivityIndicator>
  detailId: string | null
  onOpenDetail?: (taskId: string) => void
  onComplete?: (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => void
  defaultStatusId?: Id<"statuses">
}) {
  if (tasks.length === 0) return null

  return (
    <MyTasksGroup
      groupKey="earlier"
      label="Earlier"
      count={tasks.length}
      statusType="backlog"
      statusColor="gray"
      icon={<HistoryIcon className="size-4 text-muted-foreground/50" />}
      hint="move or let go"
    >
      {tasks.map((task) => (
        <li
          key={task._id}
          className="flex w-full list-none items-start rounded-lg transition-colors hover:bg-muted/70"
        >
          <span className="size-6 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <MyTaskRow
              task={task}
              totalMinutes={timeMap?.[task._id]}
              activity={activityMap?.[task._id]}
              isEarlierRow
              earlierAgeLabel={ageLabel(task.plannedEndDate, todayStr)}
              onOpenDetail={onOpenDetail}
              onComplete={onComplete}
              defaultStatusId={defaultStatusId}
              isDetailOpen={detailId === task._id}
            />
          </div>
        </li>
      ))}
    </MyTasksGroup>
  )
}
