"use client"

import { ClockIcon, SearchIcon, XIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ViewSettingsDropdown } from "./view-settings-dropdown"
import { useState } from "react"

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export function MyTasksHeader({
  todayMinutes,
  todayVisibleStatuses,
  search,
  onSearchChange,
}: {
  todayMinutes: number
  todayVisibleStatuses: string[] | undefined
  search: string
  onSearchChange: (value: string) => void
}) {
  const [showSearch, setShowSearch] = useState(false)

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">My tasks</h1>
        {showSearch && (
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search tasks..."
              className="h-8 w-48 pl-7 pr-7 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => { onSearchChange(""); setShowSearch(false) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!showSearch && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setShowSearch(true)}
          >
            <SearchIcon className="size-4" />
          </Button>
        )}
        <ViewSettingsDropdown todayVisibleStatuses={todayVisibleStatuses} />
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClockIcon className="size-3.5" />
          <span>{formatMinutes(todayMinutes)}</span>
        </div>
      </div>
    </div>
  )
}
