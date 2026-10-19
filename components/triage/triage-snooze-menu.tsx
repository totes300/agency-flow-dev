"use client"

import { Calendar } from "@/components/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDateToYMD } from "@/lib/format"

export type TriageSnoozeChoice =
  | { preset: "tomorrow" }
  | { preset: "next_monday" }
  | { preset: "date"; date: string }

/**
 * D27's three choices — Tomorrow 9:00 · Next Monday 9:00 · Pick a date —
 * computed in the org timezone by the server (`agentItems.snoozeItem`). The
 * inbox's snooze menu pattern (`components/inbox/snooze-menu.tsx`); the
 * trigger is the caller's quiet button, the menu opens from `H` too.
 */
export function TriageSnoozeMenu({
  open,
  onOpenChange,
  onSnooze,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSnooze: (choice: TriageSnoozeChoice) => void
  /** The trigger button. */
  children: React.ReactNode
}) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onSnooze({ preset: "tomorrow" })}>Tomorrow 9:00</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSnooze({ preset: "next_monday" })}>Next Monday 9:00</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Pick a date…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="p-0">
            <Calendar
              mode="single"
              disabled={{ before: tomorrow }}
              onSelect={(date) => {
                if (!date) return
                onOpenChange(false)
                onSnooze({ preset: "date", date: formatDateToYMD(date) })
              }}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
