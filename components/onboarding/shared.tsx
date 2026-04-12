import type { StatusColorName, CategoryColor } from "@/convex/lib/constants"

// Re-export shared dot components for backward compatibility
export { StatusDot } from "@/components/status-dot"
export { CategoryDot } from "@/components/category-dot"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type StatusDraft = {
  id: string
  name: string
  color: StatusColorName
  type: import("@/convex/lib/constants").StatusType
}

export type CategoryDraft = {
  id: string
  name: string
  color: CategoryColor
  defaultBillRate: string
}

// ─── Validation ─────────────────────────────────────────────────────────────────

export function validateStatuses(statuses: StatusDraft[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s.name.trim())
}

export function validateCategories(categories: CategoryDraft[]): boolean {
  return categories.length > 0 && categories.every((c) => c.name.trim())
}
