import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"

export type DefaultAssignee = {
  workCategoryId: Id<"workCategories">
  userId: Id<"users">
}

/**
 * Shared hook for reading and updating per-category default assignees on a project.
 *
 * Returns two helpers:
 * - `assigneeForCategory(catId)` — derives the current assignee from server state
 * - `handleAssigneeChange(catId, userId)` — persists the change immediately via Convex
 */
export function useDefaultAssignees(
  projectId: Id<"projects">,
  defaultAssignees: DefaultAssignee[],
) {
  const updateProject = useMutation(api.projects.update)

  function assigneeForCategory(catId: string): string {
    return (
      defaultAssignees.find((da) => da.workCategoryId === catId)
        ?.userId.toString() ?? ""
    )
  }

  function handleAssigneeChange(catId: string, userId: string) {
    const filtered = defaultAssignees.filter(
      (da) => da.workCategoryId.toString() !== catId,
    )
    const updated: DefaultAssignee[] = userId
      ? [
          ...filtered,
          {
            workCategoryId: catId as Id<"workCategories">,
            userId: userId as Id<"users">,
          },
        ]
      : filtered
    void updateProject({ id: projectId, defaultAssignees: updated }).catch(
      (err) => toastError(err, "Failed to update assignee"),
    )
  }

  return { assigneeForCategory, handleAssigneeChange }
}
