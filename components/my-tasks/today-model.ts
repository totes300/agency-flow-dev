import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { addDaysToDateString } from "@/convex/lib/todayPlan"
import { buildRowModels, type RefIndex, type TaskRowDTO, type TaskRowModel } from "@/components/task-view/row-model"

/**
 * My Tasks Today (docs/prd-tasks-refactor.md U8, §5.6): the client model of
 * `tasks.today.listToday` — three sections over the shared row model — plus
 * the picker's Suggested rule. Pure, so it is unit-tested.
 */

export type TodayListResult = FunctionReturnType<typeof api.tasks.today.listToday>

export type TodaySections = {
  /** Planned on an earlier day, not finished, nothing planned today; newest plan first. */
  carried: { row: TaskRowModel; plannedOn: string }[]
  /** Today's plan in the user's order. */
  today: TaskRowModel[]
  /** Completed today, most recent first. */
  done: TaskRowModel[]
}

export const EMPTY_SECTIONS: TodaySections = { carried: [], today: [], done: [] }

export function buildTodaySections(result: TodayListResult, index: RefIndex): TodaySections {
  const rows = buildRowModels(result.rows, result.perUser, index)
  const byId = new Map(rows.map((r) => [r.task._id, r]))
  return {
    carried: result.carried.flatMap((e) => {
      const row = byId.get(e.taskId)
      return row ? [{ row, plannedOn: e.plannedOn }] : []
    }),
    today: result.today.flatMap((e) => byId.get(e.taskId) ?? []),
    done: result.doneToday.flatMap((id) => byId.get(id) ?? []),
  }
}

/** Visible rows in screen order (collapsed sections skipped) — J/K, selection, the drawer's stepping. */
export function todayOrderedIds(
  sections: TodaySections,
  collapsed: { carried: boolean; done: boolean },
): Id<"tasks">[] {
  return [
    ...(collapsed.carried ? [] : sections.carried.map((c) => c.row.task._id)),
    ...sections.today.map((r) => r.task._id),
    ...(collapsed.done ? [] : sections.done.map((r) => r.task._id)),
  ]
}

/** The Today list's ids after dragging the row at `from` to `to` (null when nothing moves). */
export function moveInOrder<T>(ids: readonly T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return null
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

/** "yesterday", "Thu" (this past week) or "Oct 9" — when a carried task was last planned. */
export function plannedOnLabel(plannedOn: string, today: string): string {
  if (plannedOn === addDaysToDateString(today, -1)) return "yesterday"
  const [y, m, d] = plannedOn.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return plannedOn >= addDaysToDateString(today, -6) ? WEEKDAY.format(date) : SHORT_DATE.format(date)
}

/** "Saturday, October 18" for the Today header. */
export function todayHeading(today: string): string {
  const [y, m, d] = today.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

/** Due within this many days counts as "due soon" in the picker. */
export const DUE_SOON_DAYS = 3

/**
 * The "Add tasks to today" picker's groups (prototype v4): Suggested = due
 * soon (or overdue), started, or carried over; then everything else. Tasks
 * already in today are left out.
 */
export function pickerGroups(
  candidates: readonly TaskRowDTO[],
  input: { today: string; todayIds: ReadonlySet<Id<"tasks">>; carriedIds: ReadonlySet<Id<"tasks">> },
): { suggested: TaskRowDTO[]; rest: TaskRowDTO[] } {
  const dueSoon = addDaysToDateString(input.today, DUE_SOON_DAYS)
  const suggested: TaskRowDTO[] = []
  const rest: TaskRowDTO[] = []
  for (const task of candidates) {
    if (input.todayIds.has(task._id)) continue
    const isSuggested =
      (task.dueDate !== null && task.dueDate <= dueSoon) ||
      task.statusCategory === "started" ||
      input.carriedIds.has(task._id)
    ;(isSuggested ? suggested : rest).push(task)
  }
  return { suggested, rest }
}
