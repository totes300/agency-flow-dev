"use client"

import React from "react"
import { useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import { formatDuration, formatMinutesDisplay } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TimeLogPopover } from "@/components/tasks/time-log-popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PlayIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

/** Convert minutes to HH:MM display */
function minutesToDisplay(minutes: number): string {
  return formatMinutesDisplay(minutes)
}

export function InlineTimeCell({
  taskId,
  totalMinutes,
  isDone,
  isBillable = true,
  variant = "inline",
  align = "start",
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isDone: boolean
  isBillable?: boolean
  variant?: "inline" | "sidebar"
  align?: "start" | "end"
}) {
  const { timerState, isRunningOn } = useTimerActions()
  const isRunning = isRunningOn(taskId)

  if (isDone) {
    return (
      <div className={cn("flex items-center gap-[5px] opacity-35", variant === "sidebar" && "gap-2 opacity-60", align === "end" && "justify-end")}>
        {totalMinutes > 0 && (
          <span className={cn("text-xs text-muted-foreground", variant === "sidebar" && "text-sm font-medium text-foreground/70")}>
            {minutesToDisplay(totalMinutes)}
          </span>
        )}
      </div>
    )
  }

  if (isRunning) {
    return <RunningTimeCell variant={variant} align={align} />
  }

  return (
    <IdleTimeCell
      taskId={taskId}
      totalMinutes={totalMinutes}
      isBillable={isBillable}
      isTimerOnAnotherTask={timerState !== null}
      variant={variant}
      align={align}
    />
  )
}

/**
 * Timer circle — one single circle shape.
 * Idle: gray stroke, play icon.
 * Running: muted red stroke + bright red arc orbiting on it, stop icon.
 */
const TimerCircle = React.forwardRef<
  HTMLButtonElement,
  {
    size: number
    running: boolean
    children: React.ReactNode
    onClick: (e: React.MouseEvent) => void
    className?: string
    label: string
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function TimerCircle({ size, running, children, onClick, className, label, ...rest }, ref) {
  const sw = size >= 28 ? 1.5 : 1.25
  const r = (size - sw) / 2
  const circumference = 2 * Math.PI * r
  const arcLen = circumference * 0.28
  const gapLen = circumference - arcLen

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn("relative flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-label={label}
      {...rest}
    >
      <svg
        className="absolute inset-0"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Base circle — gray idle, muted red running */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={cn(
            "transition-[stroke] duration-300",
            running ? "stroke-red-500/20" : "stroke-border",
          )}
          strokeWidth={sw}
        />
        {/* Bright red arc — same circle, same radius, rotates via group */}
        {running && (
          <g className="origin-center animate-[timer-spin_2.8s_linear_infinite]" style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              className="stroke-red-500"
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={`${arcLen} ${gapLen}`}
            />
          </g>
        )}
      </svg>
      {/* Icon content */}
      <span className="relative z-[1] flex items-center justify-center">
        {children}
      </span>
    </button>
  )
})

/** Only this component subscribes to the tick context (re-renders every second) */
function RunningTimeCell({ variant = "inline", align = "start" }: { variant?: "inline" | "sidebar"; align?: "start" | "end" }) {
  const { stopTimer } = useTimerActions()
  const { formattedTime } = useTimerTick()

  async function handleStopClick(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await stopTimer()
    } catch (err) {
      toastError(err, "Failed to stop timer")
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-[5px]",
        variant === "sidebar" && "gap-2",
        align === "end" && "justify-end",
      )}
    >
      {variant === "sidebar" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <TimerCircle size={30} running onClick={handleStopClick} label="Stop timer">
              <span className="block size-2.5 rounded-[2px] bg-red-500" />
            </TimerCircle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <TimerCircle size={16} running onClick={handleStopClick} label="Stop timer">
              <span className="block size-[7px] rounded-[1.5px] bg-red-500" />
            </TimerCircle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
      )}
      <span
        className={cn(
          "text-xs font-semibold text-red-500",
          variant === "sidebar" && "px-0 text-[13px] font-semibold text-red-500",
        )}
      >
        {formattedTime}
      </span>
    </div>
  )
}

/** Idle cell — uses actions-only, never re-renders from tick */
function IdleTimeCell({
  taskId,
  totalMinutes,
  isBillable,
  isTimerOnAnotherTask,
  variant = "inline",
  align = "start",
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isBillable: boolean
  isTimerOnAnotherTask: boolean
  variant?: "inline" | "sidebar"
  align?: "start" | "end"
}) {
  const { startTimer, stopTimer, setPendingStopResult } = useTimerActions()
  const hasTime = totalMinutes > 0

  async function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()

    if (isTimerOnAnotherTask) {
      try {
        const result = await stopTimer()
        if (result && result.roundedMinutes > 0) {
          // Store result so floating widget can show commit form
          setPendingStopResult(result)
          toast.info(`Timer stopped on "${result.taskName}" — ${formatDuration(result.roundedMinutes)}`, {
            description: "Review and save in the floating widget",
          })
        }
      } catch (err) {
        toastError(err, "Failed to stop previous timer")
        return
      }
    }

    try {
      await startTimer(taskId)
    } catch (err) {
      toastError(err, "Failed to start timer")
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-[5px]",
        variant === "sidebar" && "gap-2",
        align === "end" && "justify-end",
      )}
    >
      {variant === "sidebar" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <TimerCircle size={30} running={false} onClick={handlePlayClick} label="Start timer">
              <PlayIcon className="ml-0.5 size-3.5 fill-current text-emerald-600" strokeWidth={2.2} />
            </TimerCircle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handlePlayClick}
              className="flex size-4 shrink-0 items-center justify-center opacity-40 transition-opacity duration-150 hover:opacity-70"
              aria-label="Start timer"
            >
              <PlayIcon className="size-3.5 fill-current" strokeWidth={2.2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      )}
      <TimeLogPopover taskId={taskId} isBillable={isBillable}>
        {variant === "sidebar" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "h-7 cursor-pointer rounded-md px-0 text-[13px] font-medium text-foreground transition-colors duration-150 hover:text-foreground/80",
                  hasTime
                    ? "text-muted-foreground hover:text-foreground"
                    : "font-sans text-muted-foreground/50 group-hover/row:text-muted-foreground",
                  !hasTime && "text-foreground/55",
                )}
              >
                {hasTime ? minutesToDisplay(totalMinutes) : "Add time"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>Log time</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "cursor-pointer text-[13px] transition-colors duration-150",
                  hasTime
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/40 group-hover/row:text-muted-foreground/60",
                )}
              >
                {hasTime ? minutesToDisplay(totalMinutes) : ""}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>Log time</TooltipContent>
          </Tooltip>
        )}
      </TimeLogPopover>
    </div>
  )
}
