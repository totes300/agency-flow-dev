"use client"

import { useRouter } from "next/navigation"
import { useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import { buildTaskDeepLink } from "@/lib/task-detail"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { TimerNavIcon } from "@/components/icons/nav-icons"
import { useStopTimer } from "@/components/task-view/use-toggle-task-timer"

/**
 * The running timer in the sidebar (U4, §11.10): a quiet row under Inbox with
 * the task title and the live `HH:MM:SS`, next to the floating widget. Click
 * opens the task (the same deep link as an inbox row); the round stop control
 * on the right stops it like the row's time cell does (the entry is saved and
 * handed to the floating widget). Paused timers show the frozen time, muted.
 * On the collapsed icon rail only the timer icon remains (tooltip: title).
 */
export function SidebarTimer() {
  const router = useRouter()
  const { timerState } = useTimerActions()
  const stop = useStopTimer()
  if (!timerState) return null

  const running = timerState.status === "running"
  const where = [timerState.clientName, timerState.projectName].filter(Boolean).join(" › ")
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={running ? timerState.taskName : `${timerState.taskName} (paused)`}
          title={where ? `${where} › ${timerState.taskName}` : timerState.taskName}
          className="pr-8"
          onClick={() => router.push(buildTaskDeepLink(timerState.taskId))}
        >
          <TimerNavIcon className={running ? "text-destructive" : "text-muted-foreground"} />
          <span className="min-w-0 flex-1 truncate">{timerState.taskName}</span>
          <SidebarTimerTime running={running} />
        </SidebarMenuButton>
        <SidebarMenuAction
          aria-label="Stop timer"
          title="Stop timer"
          className="top-2 right-1.5 size-4 rounded-full bg-muted-foreground/15 text-destructive hover:bg-destructive/15 hover:text-destructive"
          onClick={() => void stop().catch((err) => toastError(err, "Failed to stop timer"))}
        >
          <span className="block size-1.5 rounded-[1.5px] bg-current" />
        </SidebarMenuAction>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** The live time — the only part that re-renders every second. */
function SidebarTimerTime({ running }: { running: boolean }) {
  const { formattedTime } = useTimerTick()
  return (
    <span className={cn("shrink-0 text-xs tabular-nums", running ? "text-destructive" : "text-muted-foreground")}>
      {formattedTime}
    </span>
  )
}
