"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { ClockIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { computeSnoozePresets, type SnoozePreset } from "@/lib/inbox-snooze"
import { useOrgTimezone } from "@/lib/hooks/use-org-timezone"
import { toastError } from "@/lib/toast-helpers"
import { InboxActionButton } from "@/components/inbox/notification-row-actions"

export function SnoozeMenu({ ids }: { ids: Id<"notifications">[] }) {
  const { timezone, isReady } = useOrgTimezone()
  const snooze = useMutation(api.notifications.snooze)
  // Presets are anchored to the moment the menu OPENS (event handler, not
  // render — keeps render pure and the "+3h" honest).
  const [presets, setPresets] = useState<SnoozePreset[]>([])

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setPresets(computeSnoozePresets(timezone, Date.now()))
      }}
    >
      <DropdownMenuTrigger asChild>
        <InboxActionButton label="Snooze" disabled={!isReady}>
          <ClockIcon className="size-3.5" />
        </InboxActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {presets.map((preset) => (
          <DropdownMenuItem
            key={preset.key}
            onClick={() =>
              void snooze({ ids, until: preset.until }).catch((err) =>
                toastError(err, "Failed to snooze notification"),
              )
            }
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
