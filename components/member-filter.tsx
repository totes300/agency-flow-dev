"use client"

import { useMemo, useState } from "react"
import { ChevronDownIcon, UsersIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export type Member = {
  _id: Id<"users">
  name: string
  imageUrl: string | undefined
  role: "admin" | "member"
}

/**
 * Multi-select people filter (searchable popover). Shared by Workday and
 * Planner — empty selection means "all members", never a blank grid.
 */
export function MemberFilter({
  members,
  selectedIds,
  onChange,
}: {
  members: Member[]
  selectedIds: Id<"users">[]
  onChange: (ids: Id<"users">[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedSet = useMemo(
    () => new Set(selectedIds.map((id) => id.toString())),
    [selectedIds],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.name.toLowerCase().includes(q))
  }, [members, search])

  const label = useMemo(() => {
    if (selectedIds.length === 0) return "All members"
    if (selectedIds.length === 1) {
      const single = members.find(
        (m) => m._id.toString() === selectedIds[0].toString(),
      )
      return single?.name ?? "1 member"
    }
    return `${selectedIds.length} of ${members.length} members`
  }, [members, selectedIds])

  function toggle(id: Id<"users">) {
    const key = id.toString()
    const next = selectedSet.has(key)
      ? selectedIds.filter((x) => x.toString() !== key)
      : [...selectedIds, id]
    onChange(next)
  }

  function selectAll() {
    onChange(members.map((m) => m._id))
  }

  function clear() {
    // Empty selection is treated as "all members" — never a literal blank grid.
    onChange([])
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 gap-1.5 px-2.5 text-[13px] font-medium"
        >
          <UsersIcon className="size-3.5 text-muted-foreground" />
          {label}
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-0">
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="h-8 text-[13px]"
            autoFocus
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              No matches
            </div>
          ) : (
            filtered.map((m) => {
              const checked = selectedSet.has(m._id.toString())
              return (
                <div
                  key={m._id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={checked}
                  onClick={() => toggle(m._id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      toggle(m._id)
                    }
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left outline-none",
                    "transition-colors hover:bg-muted/60 focus-visible:bg-muted/60",
                  )}
                >
                  <Checkbox checked={checked} className="pointer-events-none" />
                  <UserAvatar
                    name={m.name}
                    imageUrl={m.imageUrl}
                    size="sm"
                    className="size-[22px]"
                  />
                  <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-foreground">
                      {m.name}
                    </span>
                    <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                      {m.role}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-2 py-1.5 text-[12px]">
          <button
            type="button"
            onClick={selectAll}
            className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded px-1.5 py-1 text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
