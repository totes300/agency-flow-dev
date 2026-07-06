"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"
import { PlannerCreateForm } from "./planner-create-form"

/**
 * The panel's quick-add composer (mockup `qadd`): sits at the top of the
 * Tasks list. Enter creates an UNSCHEDULED task through the canonical
 * tasks.create mutation (same path as /tasks inline-add — server resolves
 * default status, sort key, creator) and keeps the composer open + focused
 * for rapid capture; the new card appears at the top of the newest-first
 * list. Escape closes. A failed create restores the typed title + toasts.
 */
export function PlannerQuickAdd({ onClose }: { onClose: () => void }) {
  const createTask = useMutation(api.tasks.create)

  return (
    <div className="mb-2 flex flex-col gap-1.5 rounded-[10px] border border-dashed border-[color-mix(in_srgb,var(--primary)_50%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_4%,transparent)] px-[11px] py-[9px]">
      <PlannerCreateForm
        submitLabel="Add task"
        clearTitleOnSubmit
        onCancel={onClose}
        onSubmit={async (title, projectId: Id<"projects"> | null) => {
          try {
            await createTask({
              title,
              ...(projectId ? { projectId } : {}),
            })
          } catch (err) {
            toastError(err, "Failed to create task")
            throw err
          }
        }}
      />
    </div>
  )
}
