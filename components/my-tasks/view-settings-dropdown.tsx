"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { SettingsIcon } from "lucide-react"

const STATUS_TYPE_OPTIONS = [
  { key: "in_progress", label: "In Progress" },
  { key: "backlog", label: "To Do (Backlog)" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
] as const

/** Default: submitted is the only enabled type (today is always shown). */
const DEFAULT_VISIBLE: string[] = []

export function ViewSettingsDropdown({
  todayVisibleStatuses,
}: {
  todayVisibleStatuses: string[] | undefined
}) {
  const updateSettings = useMutation(api.users.updateMyTasksSettings)
  const current = todayVisibleStatuses ?? DEFAULT_VISIBLE
  const isNonDefault = current.length > 0

  function toggle(key: string) {
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key]
    updateSettings({ todayVisibleStatuses: next })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <SettingsIcon className="size-4" />
          {isNonDefault && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Show groups:
        </p>
        <div className="flex flex-col gap-2">
          {STATUS_TYPE_OPTIONS.map((opt) => (
            <Label
              key={opt.key}
              className="flex items-center gap-2 text-sm font-normal cursor-pointer"
            >
              <Checkbox
                checked={current.includes(opt.key)}
                onCheckedChange={() => toggle(opt.key)}
              />
              {opt.label}
            </Label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
