"use client"

import React from "react"
import { useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import { formatDuration, formatMinutesDisplay } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TimeLogPopover } from "@/components/tasks/time-log-popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PlayIcon, PauseIcon } from "lucide-react"
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
  variant?: "inline" | "sidebar" | "header"
  align?: "start" | "end"
}) {
  const { timerState, isRunningOn } = useTimerActions()
  const isRunning = isRunningOn(taskId)

  if (isDone) {
    return (
      <div className={cn("flex items-center gap-[5px] opacity-35", variant === "sidebar" && "gap-1.5 opacity-60", variant === "header" && "gap-1 opacity-60", align === "end" && "justify-end")}>
        {totalMinutes > 0 && (
          <span className={cn("text-xs text-muted-foreground", variant === "sidebar" && "text-[13px] font-semibold tabular-nums text-foreground/70", variant === "header" && "text-xs tabular-nums text-muted-foreground")}>
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
function RunningTimeCell({ variant = "inline", align = "start" }: { variant?: "inline" | "sidebar" | "header"; align?: "start" | "end" }) {
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

  if (variant === "header") {
    return (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStopClick}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-red-500 transition-colors hover:bg-accent dark:text-red-400"
              aria-label="Stop timer"
            >
              <PauseIcon className="size-3.5" strokeWidth={0} fill="currentColor" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
        <span className="text-xs tabular-nums text-red-500 dark:text-red-400">
          {formattedTime}
        </span>
      </div>
    )
  }

  const circleSize = variant === "sidebar" ? 30 : 16
  const stopSize = variant === "sidebar" ? "size-2.5" : "size-[7px]"

  return (
    <div
      className={cn(
        "flex items-center",
        variant === "inline" ? "gap-1.5" : "gap-1.5",
        align === "end" && "justify-end",
      )}
    >
      {variant === "inline" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStopClick}
              className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted-foreground/15 text-red-500 transition-all duration-150 hover:bg-red-500/15"
              aria-label="Stop timer"
            >
              <span className="block size-[7px] rounded-[1.5px] bg-current" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <TimerCircle size={circleSize} running onClick={handleStopClick} label="Stop timer">
              <span className={cn("block rounded-[2px] bg-red-500", stopSize)} />
            </TimerCircle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
      )}
      <span
        className={cn(
          "tabular-nums",
          variant === "inline" ? "text-xs font-semibold text-red-500 dark:text-red-400" : "text-[13px] font-semibold tracking-[0.01em] text-red-500",
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
  variant?: "inline" | "sidebar" | "header"
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

  const circleSize = variant === "sidebar" ? 30 : 16
  const playIconSize = variant === "inline" ? "size-3.5" : "size-3.5"
  const useCircle = variant === "sidebar"

  return (
    <div
      className={cn(
        "flex items-center",
        variant === "inline" ? "gap-1.5" : variant === "header" ? "gap-1" : "gap-1.5",
        align === "end" && "justify-end",
      )}
    >
      {variant === "header" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handlePlayClick}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Start timer"
            >
              <PlayIcon className="ml-px size-3.5" strokeWidth={0} fill="currentColor" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      ) : useCircle ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <TimerCircle size={circleSize} running={false} onClick={handlePlayClick} label="Start timer">
              <PlayIcon className={cn("ml-0.5 fill-current text-emerald-600", playIconSize)} strokeWidth={2.2} />
            </TimerCircle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handlePlayClick}
              className="flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted-foreground/15 text-muted-foreground/70 transition-all duration-150 hover:bg-muted-foreground/25 hover:text-muted-foreground"
              aria-label="Start timer"
            >
              <PlayIcon className="ml-[1px] size-2.5" strokeWidth={0} fill="currentColor" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      )}
      <TimeLogPopover
        taskId={taskId}
        isBillable={isBillable}
        align="end"
        tooltipLabel="Log time"
        tooltipSide={variant === "header" ? "bottom" : "top"}
      >
        {variant === "header" ? (
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "cursor-pointer text-xs tabular-nums transition-colors duration-150",
              hasTime
                ? "text-muted-foreground hover:text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            )}
          >
            {hasTime ? minutesToDisplay(totalMinutes) : "00:00"}
          </button>
        ) : variant === "sidebar" ? (
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
        ) : (
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "cursor-pointer text-xs font-medium tabular-nums transition-colors duration-150",
              hasTime
                ? "text-muted-foreground hover:text-foreground"
                : "text-muted-foreground/60 group-hover/row:text-muted-foreground/80",
            )}
          >
            {hasTime ? minutesToDisplay(totalMinutes) : "00:00"}
          </button>
        )}
      </TimeLogPopover>
    </div>
  )
}
