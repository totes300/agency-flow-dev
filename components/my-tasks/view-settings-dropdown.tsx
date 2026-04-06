"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { toastError } from "@/lib/toast-helpers"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { StatusIcon } from "@/components/status-icon"
import { getStatusColor } from "@/lib/status-colors"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { SettingsIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

export function ViewSettingsDropdown({
  visibleStatusIds,
  orgDefaultStatusIds,
}: {
  visibleStatusIds: string[]
  orgDefaultStatusIds?: string[]
}) {
  const { statuses } = useTaskReferenceData()
  const updateSettings = useMutation(api.users.updateMyTasksSettings)

  // statuses from reference data are already filtered to active only
  const activeStatuses = statuses ?? []
  const visibleSet = new Set(visibleStatusIds)

  // Detect if user has customized (differs from org default)
  const orgDefault = orgDefaultStatusIds ?? []
  const isCustomized = visibleStatusIds.length > 0 && (
    visibleStatusIds.length !== orgDefault.length ||
    visibleStatusIds.some((id) => !orgDefault.includes(id))
  )

  function toggle(statusId: string) {
    const next = visibleSet.has(statusId)
      ? visibleStatusIds.filter((id) => id !== statusId)
      : [...visibleStatusIds, statusId]
    updateSettings({ todayVisibleStatuses: next.length > 0 ? next : undefined })
      .catch((err: unknown) => toastError(err, "Failed to save filter"))
  }

  function resetToDefault() {
    updateSettings({ todayVisibleStatuses: undefined })
      .catch((err: unknown) => toastError(err, "Failed to reset"))
  }

  // Show blue dot when user has customized settings
  const showDot = isCustomized

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <SettingsIcon className="size-4" />
          {showDot && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Show groups:
        </p>
        <div className="flex flex-col gap-2">
          {activeStatuses.map((status) => (
            <Label
              key={status._id}
              className="flex items-center gap-2 text-sm font-normal cursor-pointer"
            >
              <Checkbox
                checked={visibleSet.has(status._id as string)}
                onCheckedChange={() => toggle(status._id as string)}
              />
              <StatusIcon
                type={status.type}
                color={getStatusColor(status.color).dot}
                size={14}
              />
              {status.name}
            </Label>
          ))}
        </div>

        {isCustomized && (
          <button
            type="button"
            className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={resetToDefault}
          >
            Reset to default
          </button>
        )}

        <p className="mt-3 text-[11px] text-muted-foreground/60 leading-tight">
          Completed today is always shown.
        </p>
      </PopoverContent>
    </Popover>
  )
}
