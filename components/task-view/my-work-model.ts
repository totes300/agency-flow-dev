import type { Id } from "@/convex/_generated/dataModel"
import { ME_FILTER_VALUE, SYSTEM_VIEWS, type TaskCategory, type TaskViewSpec } from "@/convex/tasks/model"
import { addDaysToDateString } from "@/convex/lib/todayPlan"
import { formatDateToYMD } from "@/lib/format"
import { sortRows, type StatusRef, type TaskGroup, type TaskRowModel } from "@/components/task-view/row-model"

/**
 * The dashboard "My work" board (docs/prd-tasks-refactor.md §11.8, slice 7a):
 * a task-view board preset over the caller's tasks, rebuilt from the owner's
 * prototype. Pure, so the column and drop rules are unit-tested.
 *
 *   In progress — the caller's tasks in the `started` category. Wins over
 *                 Today: a started task planned for today stays here and
 *                 carries the "☀ Today" chip instead of showing twice.
 *   Today       — the caller's Today plan (`tasks.today.listToday`) in the
 *                 hand-made order, minus anything started or closed.
 *   Done this week — the caller's tasks completed (category `completed`, by
 *                 `completedAt`, §11.3: canceled does not count) since Monday,
 *                 newest first, with a day divider per completion day.
 *
 * Rows come from `listView` with `MY_WORK_SPEC` (assigned to me, started +
 * completed; closed rows newest-closed first, capped like every view) plus the
 * Today plan's rows.
 */

/** The preset's view spec: the Assigned system view as a board, scoped to started + completed work. */
export const MY_WORK_SPEC: TaskViewSpec = {
  ...SYSTEM_VIEWS.myTasks.assigned.spec,
  filters: [
    { property: "assignee", operator: "is", values: [ME_FILTER_VALUE] },
    { property: "statusCategory", operator: "is", values: ["started", "completed"] },
  ],
  layout: "board",
  orderBy: "priority",
}

export type MyWorkColumnKey = "inProgress" | "today" | "done"

export const MY_WORK_EMPTY: Record<MyWorkColumnKey, string> = {
  inProgress: "Nothing started yet. Drag a card here to start it.",
  today: "Nothing left on today's plan. Add tasks from My Tasks or the Planner.",
  done: "Nothing finished yet this week.",
}

/** The org's default status of a category (D3: one default per category). */
export function defaultStatusOf(statuses: readonly StatusRef[], category: TaskCategory): StatusRef | null {
  const live = statuses.filter((s) => s.category === category && !s.archived)
  return live.find((s) => s.isDefault) ?? live[0] ?? null
}

/** Monday of the ISO week containing `ymd` (YYYY-MM-DD). */
export function weekStartOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDaysToDateString(ymd, dow === 0 ? -6 : 1 - dow)
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })

/** "Today", "Yesterday" or the weekday — the Done column's day dividers. */
export function doneDayLabel(day: string, today: string): string {
  if (day === today) return "Today"
  if (day === addDaysToDateString(today, -1)) return "Yesterday"
  const [y, m, d] = day.split("-").map(Number)
  return WEEKDAY.format(new Date(Date.UTC(y, m - 1, d)))
}

/** The calendar day (client clock) a task was completed on. */
function completedDay(row: TaskRowModel): string | null {
  return row.task.completedAt === null ? null : formatDateToYMD(new Date(row.task.completedAt))
}

export type MyWorkBoardModel = {
  columns: TaskGroup[]
  /** The Done column's day divider before a card (first card of each day). */
  dividers: ReadonlyMap<Id<"tasks">, string>
  /** Tasks in the Today column (their cards don't repeat the sun chip). */
  todayIds: ReadonlySet<Id<"tasks">>
}

export function buildMyWorkBoard({
  listRows,
  todayRows,
  statuses,
  today,
}: {
  /** `listView` rows for `MY_WORK_SPEC` (the caller's started + completed tasks). */
  listRows: readonly TaskRowModel[]
  /** The caller's Today plan rows, in plan order. */
  todayRows: readonly TaskRowModel[]
  statuses: readonly StatusRef[]
  /** The client's calendar day (YYYY-MM-DD). */
  today: string
}): MyWorkBoardModel {
  const started = new Map<Id<"tasks">, TaskRowModel>()
  for (const row of [...listRows, ...todayRows]) {
    if (row.category === "started" && !row.task.parentTaskId) started.set(row.task._id, row)
  }
  const planned = todayRows.filter((r) => r.category !== "started" && !r.isClosed && !r.task.parentTaskId)

  const weekStart = weekStartOf(today)
  const done = listRows
    .filter((r) => r.category === "completed" && !r.task.parentTaskId && (completedDay(r) ?? "") >= weekStart)
    .sort((a, b) => (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0))
  const dividers = new Map<Id<"tasks">, string>()
  let lastDay: string | null = null
  for (const row of done) {
    const day = completedDay(row)
    if (day && day !== lastDay) dividers.set(row.task._id, doneDayLabel(day, today))
    lastDay = day
  }

  const startedStatus = defaultStatusOf(statuses, "started")
  const doneStatus = defaultStatusOf(statuses, "completed")
  const columns: TaskGroup[] = [
    {
      key: "inProgress" satisfies MyWorkColumnKey,
      label: "In progress",
      header: startedStatus ? { kind: "status", status: startedStatus } : { kind: "none" },
      rows: sortRows([...started.values()], MY_WORK_SPEC.orderBy),
    },
    { key: "today" satisfies MyWorkColumnKey, label: "Today", header: { kind: "today" }, rows: planned },
    {
      key: "done" satisfies MyWorkColumnKey,
      label: "Done this week",
      header: doneStatus ? { kind: "status", status: doneStatus } : { kind: "none" },
      rows: done,
    },
  ]
  return { columns, dividers, todayIds: new Set(planned.map((r) => r.task._id)) }
}

/**
 * What a drop means (the owner's prototype, on D3 categories):
 *   → In progress  start it (the org's default `started` status)
 *   → Today        plan it for the caller's day; a started or finished task is
 *                  first moved back to the default `unstarted` status (In
 *                  progress wins over Today, and closed tasks can't be planned)
 *   → Done         complete it (the default `completed` status)
 * Null when nothing changes (same column, or already there).
 */
export type MyWorkMove =
  | { kind: "status"; statusId: Id<"statuses"> }
  | { kind: "plan"; resetStatusId: Id<"statuses"> | null }

export function myWorkMoveFor(
  row: Pick<TaskRowModel, "category" | "isClosed">,
  fromKey: string,
  toKey: string,
  statuses: readonly StatusRef[],
): MyWorkMove | null {
  if (fromKey === toKey) return null
  switch (toKey as MyWorkColumnKey) {
    case "inProgress": {
      if (row.category === "started") return null
      const status = defaultStatusOf(statuses, "started")
      return status ? { kind: "status", statusId: status._id } : null
    }
    case "done": {
      if (row.category === "completed") return null
      const status = defaultStatusOf(statuses, "completed")
      return status ? { kind: "status", statusId: status._id } : null
    }
    case "today": {
      if (row.category !== "started" && !row.isClosed) return { kind: "plan", resetStatusId: null }
      const status = defaultStatusOf(statuses, "unstarted")
      return status ? { kind: "plan", resetStatusId: status._id } : null
    }
    default:
      return null
  }
}
