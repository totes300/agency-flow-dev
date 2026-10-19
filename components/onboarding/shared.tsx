import type { StatusColorName, CategoryColor } from "@/convex/lib/constants"
import { TASK_CATEGORIES, type TaskCategory, type WorkflowRole } from "@/convex/tasks/model"

// Re-export shared dot components for backward compatibility
export { StatusDot } from "@/components/status-dot"
export { CategoryDot } from "@/components/category-dot"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type StatusDraft = {
  id: string
  name: string
  color: StatusColorName
  category: TaskCategory
  /** From the seed (Admin review / Client review / Stuck); editable later in Settings. */
  workflowRole?: WorkflowRole
}

export type CategoryDraft = {
  id: string
  name: string
  color: CategoryColor
  defaultBillRate: string
}

// ─── Validation ─────────────────────────────────────────────────────────────────

/** Every category keeps at least one status (§4.1), and every status has a name. */
export function validateStatuses(statuses: StatusDraft[]): boolean {
  return (
    statuses.every((s) => s.name.trim()) &&
    TASK_CATEGORIES.every((c) => statuses.some((s) => s.category === c))
  )
}

export function validateCategories(categories: CategoryDraft[]): boolean {
  return categories.length > 0 && categories.every((c) => c.name.trim())
}
