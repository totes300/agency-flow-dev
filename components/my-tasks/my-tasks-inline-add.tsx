"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { CompletionCheckbox } from "./completion-checkbox"
import { InlineAddButton } from "@/components/inline-add-button"
import { useInlineAdd } from "@/lib/hooks/use-inline-add"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

export function MyTasksInlineAdd({
  statusId,
  currentUserId,
}: {
  statusId?: Id<"statuses">
  currentUserId: Id<"users">
}) {
  const createTask = useMutation(api.tasks.create)

  const { active, title, setTitle, inputRef, activate, handleKeyDown, handleBlur } =
    useInlineAdd(async (trimmed) => {
      try {
        await createTask({
          title: trimmed,
          statusId,
          assigneeIds: [currentUserId],
          billable: true,
        })
      } catch (err) {
        toastError(err, "Failed to create task")
      }
    })

  const addButton = (
    <li className="mt-1 flex w-full list-none items-start pt-1">
      <div className="w-6 shrink-0" />
      <InlineAddButton onClick={activate} />
    </li>
  )

  if (!active) return addButton

  return (
    <>
      {/* New task input row — matches real task row structure */}
      <li className="flex w-full list-none items-start rounded-lg bg-muted/30">
        <div className="w-6 shrink-0" />
        <div className="w-full min-w-0 px-3 py-2.5">
          <div className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-x-2.5">
            <div className="pointer-events-none shrink-0 opacity-60">
              <CompletionCheckbox
                isSubmitted={false}
                onComplete={() => {}}
              />
            </div>
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder="Task name..."
              aria-label="New task title"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      </li>

      {addButton}
    </>
  )
}
