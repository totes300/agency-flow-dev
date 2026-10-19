import type { TaskViewSpec } from "@/convex/tasks/model"

/**
 * Column registry metadata and the U3 visibility rules
 * (docs/prd-tasks-refactor.md §6.3, U2, U3). Pure: `columns.tsx` adds the
 * cell renderers on top. Header and every row share one CSS grid template
 * built from the visible columns, so each property sits on one vertical line.
 */

export type ColumnKey = TaskViewSpec["visibleProperties"][number]
export type OrderBy = TaskViewSpec["orderBy"]

export type ColumnMeta = {
  key: ColumnKey
  /** CSS grid track. */
  track: string
  /** Minimum width of the track in px (for the table min-width). */
  minWidth: number
  /** Header label ("" = icon column without a label). */
  header: string
  /** Clicking the header orders by this. */
  sortBy?: OrderBy
}

/** Registry in display order (prototype v4 widths). */
export const COLUMNS: readonly ColumnMeta[] = [
  { key: "priority", track: "22px", minWidth: 22, header: "", sortBy: "priority" },
  { key: "id", track: "60px", minWidth: 60, header: "ID" },
  { key: "statusIcon", track: "18px", minWidth: 18, header: "" },
  { key: "title", track: "minmax(250px,1fr)", minWidth: 250, header: "Task", sortBy: "title" },
  { key: "status", track: "120px", minWidth: 120, header: "Status" },
  { key: "category", track: "112px", minWidth: 112, header: "Category" },
  { key: "labels", track: "160px", minWidth: 160, header: "Labels" },
  { key: "client", track: "140px", minWidth: 140, header: "Client" },
  { key: "assignee", track: "96px", minWidth: 96, header: "Assignee" },
  { key: "due", track: "76px", minWidth: 76, header: "Due date", sortBy: "dueDate" },
  { key: "estimate", track: "60px", minWidth: 60, header: "Estimate" },
  { key: "time", track: "76px", minWidth: 76, header: "Time" },
  { key: "created", track: "64px", minWidth: 64, header: "Created", sortBy: "createdAt" },
  { key: "activity", track: "200px", minWidth: 200, header: "Last activity", sortBy: "lastActivityAt" },
]

const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))

export function columnMeta(key: ColumnKey): ColumnMeta {
  const meta = COLUMN_BY_KEY.get(key)
  if (!meta) throw new Error(`Unknown column "${key}"`)
  return meta
}

/** Gap between tracks and the row's horizontal padding (checkbox slot on the left). */
export const COLUMN_GAP_PX = 12
export const ROW_PADDING_LEFT_PX = 40
export const ROW_PADDING_RIGHT_PX = 12

/**
 * The column a grouping already shows in its group header, so rows must not
 * repeat it (U3). Grouped by status is special-cased: the status moves to an
 * icon before the title instead of disappearing.
 */
const COLUMN_SHOWN_BY_GROUP: Partial<Record<TaskViewSpec["groupBy"], ColumnKey>> = {
  priority: "priority",
  assignee: "assignee",
  project: "client",
  client: "client",
  workCategory: "category",
  label: "labels",
}

/**
 * The visible columns, in registry order (U2/U3):
 * - Title is always shown.
 * - A column is shown when its property is in `visibleProperties`, unless the
 *   list is grouped by that property (by project/client → no Client column,
 *   by assignee → no Assignee column, …).
 * - Grouped by status with Status visible → the status renders as an icon
 *   column (`statusIcon`) right before the title instead of the Status column.
 * - `statusIcon` is derived only; listing it in `visibleProperties` has no effect.
 */
/**
 * A view inside one project (the project Tasks tab, §6.1): every row has the
 * same project and client, so the Client column, project/client grouping and
 * project/client filters would only repeat the context (U3).
 */
export type ViewContext = { projectScoped?: boolean }

export const PROJECT_CONTEXT_HIDDEN_GROUPS: ReadonlySet<TaskViewSpec["groupBy"]> = new Set(["project", "client"])
export const PROJECT_CONTEXT_HIDDEN_COLUMNS: ReadonlySet<ColumnKey> = new Set(["client"])

export function visibleColumnKeys(
  spec: Pick<TaskViewSpec, "visibleProperties" | "groupBy">,
  context: ViewContext = {},
): ColumnKey[] {
  const visible = new Set<ColumnKey>(spec.visibleProperties)
  const hiddenByGroup = COLUMN_SHOWN_BY_GROUP[spec.groupBy]
  const statusAsIcon = spec.groupBy === "status" && visible.has("status")

  return COLUMNS.map((c) => c.key).filter((key) => {
    if (key === "title") return true
    if (key === "statusIcon") return statusAsIcon
    if (key === "status") return visible.has("status") && !statusAsIcon
    if (context.projectScoped && PROJECT_CONTEXT_HIDDEN_COLUMNS.has(key)) return false
    return visible.has(key) && key !== hiddenByGroup
  })
}

export function gridTemplateFor(keys: readonly ColumnKey[]): string {
  return keys.map((k) => columnMeta(k).track).join(" ")
}

/** Sum of track minimums + gaps + row padding; the table scrolls horizontally only below this. */
export function tableMinWidthFor(keys: readonly ColumnKey[]): number {
  const tracks = keys.reduce((sum, k) => sum + columnMeta(k).minWidth, 0)
  const gaps = Math.max(0, keys.length - 1) * COLUMN_GAP_PX
  return tracks + gaps + ROW_PADDING_LEFT_PX + ROW_PADDING_RIGHT_PX
}
