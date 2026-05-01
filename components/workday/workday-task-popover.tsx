"use client"

import { useMemo } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { getCategoryColor } from "@/convex/lib/constants"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import type { WorkdayBox } from "@/convex/workday"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 80

function buildHHMMFormatter(timezone: string | undefined): (ms: number) => string {
  // Intl handles the IANA tz; falling back to local for the brief window before
  // orgSettings loads keeps render stable instead of flashing dashes.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timezone ? { timeZone: timezone } : {}),
  })
  return (ms) => fmt.format(new Date(ms))
}

export function WorkdayTaskPopover({
  box,
  onOpenTask,
  children,
}: {
  box: WorkdayBox
  onOpenTask: () => void
  children: React.ReactNode
}) {
  const c = box.categoryColor ? getCategoryColor(box.categoryColor) : null
  const tint = c?.dot ?? "var(--color-muted-foreground)"
  const meta = [box.projectName, box.categoryName].filter(Boolean).join(" · ")

  // Convex dedupes this subscription with the page's own load — no extra round-trip.
  const { isAuthenticated } = useConvexAuth()
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const formatHHMM = useMemo(
    () => buildHHMMFormatter(orgSettings?.timezone),
    [orgSettings?.timezone],
  )

  return (
    <HoverCard openDelay={HOVER_OPEN_DELAY_MS} closeDelay={HOVER_CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        side="right"
        sideOffset={6}
        className="w-[360px] p-0"
      >
        <div className="flex items-start gap-2 px-3.5 pb-2.5 pt-3">
          <span
            aria-hidden
            className="mt-[5px] size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tint }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold leading-tight tracking-[-0.005em] text-foreground">
              {box.taskTitle}
            </div>
            {meta && (
              <div className="mt-0.5 truncate text-[11.5px] leading-[1.3] text-muted-foreground">
                {meta}
              </div>
            )}
          </div>
        </div>

        <ul className="border-t border-border py-1">
          {box.entries.map((e) => {
            const start = formatHHMM(e.startedAt)
            const end = formatHHMM(e.startedAt + e.durationMinutes * 60_000)
            return (
              <li key={e._id}>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onOpenTask()
                  }}
                  className={cn(
                    "grid w-full items-center gap-3 px-3.5 py-1.5 text-left text-[12px]",
                    "transition-colors hover:bg-muted/60",
                  )}
                  style={{ gridTemplateColumns: "auto auto 1fr auto" }}
                >
                  <span className="font-mono tabular-nums text-foreground">
                    {start}–{end}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatDuration(e.durationMinutes)}
                  </span>
                  <span className="truncate text-foreground/80">
                    {e.note ?? ""}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      e.isBillable
                        ? "bg-primary"
                        : "bg-transparent ring-1 ring-muted-foreground/40",
                    )}
                    title={e.isBillable ? "Billable" : "Non-billable"}
                  />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3.5 py-2 text-[12px]">
          <span className="text-muted-foreground">Total today</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatDuration(box.totalMinutes)}
          </span>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
