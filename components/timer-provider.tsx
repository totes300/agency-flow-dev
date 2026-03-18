"use client"

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatTimerDisplay } from "@/lib/duration"

export type TimerState = {
  taskId: Id<"tasks">
  taskName: string
  projectName: string | null
  clientName: string | null
  startedAt: number | null
  accumulatedMs: number
  status: "running" | "paused"
  isBillable: boolean
} | null

export type StopResult = {
  taskId: Id<"tasks">
  elapsedMs: number
  roundedMinutes: number
  taskName: string
  projectName: string | null
  clientName: string | null
  isBillable: boolean
  isStale: boolean
  rateSnapshot: Record<string, number | undefined>
}

// Stable context — actions + state that changes rarely
export type TimerActionsValue = {
  timerState: TimerState
  startTimer: (taskId: Id<"tasks">) => Promise<void>
  stopTimer: () => Promise<StopResult | null>
  pauseTimer: () => Promise<void>
  resumeTimer: () => Promise<void>
  discardTimer: () => Promise<void>
  commitEntry: (args: {
    taskId: Id<"tasks">
    durationMinutes: number
    note?: string
    isBillable: boolean
    date?: string
  }) => Promise<Id<"timeEntries">>
  isRunningOn: (taskId: Id<"tasks">) => boolean
  pendingStopResult: StopResult | null
  setPendingStopResult: (result: StopResult | null) => void
}

// Tick context — changes every second when timer is running
export type TimerTickValue = {
  elapsedMs: number
  formattedTime: string
}

export const TimerActionsContext = createContext<TimerActionsValue | null>(null)
export const TimerTickContext = createContext<TimerTickValue | null>(null)

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth()
  const serverState = useQuery(api.timer.getState, isAuthenticated ? {} : "skip")

  const startMutation = useMutation(api.timer.start)
  const stopMutation = useMutation(api.timer.stop)
  const pauseMutation = useMutation(api.timer.pause)
  const resumeMutation = useMutation(api.timer.resume)
  const discardMutation = useMutation(api.timer.discard)
  const commitMutation = useMutation(api.timer.commitEntry)

  const [runningMs, setRunningMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Pending stop result from task-switch (so widget can show commit form)
  const [pendingStopResult, setPendingStopResult] = useState<StopResult | null>(null)

  const timerState: TimerState = serverState ?? null

  const isRunning = timerState?.status === "running" && timerState.startedAt != null
  const startedAt = timerState?.startedAt ?? null
  const accumulatedMs = timerState?.accumulatedMs ?? 0

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (isRunning && startedAt != null) {
      const tick = () => {
        const currentSegment = Math.max(0, Date.now() - startedAt)
        setRunningMs(accumulatedMs + currentSegment)
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning, startedAt, accumulatedMs])

  const elapsedMs = isRunning
    ? runningMs
    : timerState?.status === "paused"
      ? timerState.accumulatedMs
      : 0

  // Stable callbacks
  const startTimer = useCallback(async (taskId: Id<"tasks">) => {
    await startMutation({ taskId })
  }, [startMutation])

  const stopTimer = useCallback(async () => {
    const result = await stopMutation()
    return result as StopResult
  }, [stopMutation])

  const pauseTimer = useCallback(async () => {
    await pauseMutation()
  }, [pauseMutation])

  const resumeTimer = useCallback(async () => {
    await resumeMutation()
  }, [resumeMutation])

  const discardTimer = useCallback(async () => {
    await discardMutation()
  }, [discardMutation])

  const commitEntry = useCallback(async (args: {
    taskId: Id<"tasks">
    durationMinutes: number
    note?: string
    isBillable: boolean
    date?: string
  }) => {
    return await commitMutation(args)
  }, [commitMutation])

  const isRunningOn = useCallback((taskId: Id<"tasks">) => {
    return timerState?.taskId === taskId && timerState?.status === "running"
  }, [timerState?.taskId, timerState?.status])

  // Actions context — only changes when timerState changes (not every second)
  const actionsValue = useMemo<TimerActionsValue>(() => ({
    timerState,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    discardTimer,
    commitEntry,
    isRunningOn,
    pendingStopResult,
    setPendingStopResult,
  }), [timerState, startTimer, stopTimer, pauseTimer, resumeTimer, discardTimer, commitEntry, isRunningOn, pendingStopResult])

  // Tick context — changes every second when running
  const tickValue = useMemo<TimerTickValue>(() => ({
    elapsedMs,
    formattedTime: formatTimerDisplay(elapsedMs),
  }), [elapsedMs])

  return (
    <TimerActionsContext.Provider value={actionsValue}>
      <TimerTickContext.Provider value={tickValue}>
        {children}
      </TimerTickContext.Provider>
    </TimerActionsContext.Provider>
  )
}
