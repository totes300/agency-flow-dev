"use client"

import { createContext, useEffect, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

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

export type TimerContextValue = {
  timerState: TimerState
  elapsedMs: number
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
}

export const TimerContext = createContext<TimerContextValue | null>(null)

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth()
  const serverState = useQuery(api.timer.getState, isAuthenticated ? {} : "skip")

  const startMutation = useMutation(api.timer.start)
  const stopMutation = useMutation(api.timer.stop)
  const pauseMutation = useMutation(api.timer.pause)
  const resumeMutation = useMutation(api.timer.resume)
  const discardMutation = useMutation(api.timer.discard)
  const commitMutation = useMutation(api.timer.commitEntry)

  // Live elapsed computed client-side
  const [elapsedMs, setElapsedMs] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const timerState: TimerState = serverState ?? null

  // Update elapsed every second when running
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (timerState?.status === "running" && timerState.startedAt) {
      const tick = () => {
        const now = Date.now()
        const currentSegment = Math.max(0, now - timerState.startedAt!)
        setElapsedMs(timerState.accumulatedMs + currentSegment)
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
    } else if (timerState?.status === "paused") {
      setElapsedMs(timerState.accumulatedMs)
    } else {
      setElapsedMs(0)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [timerState?.status, timerState?.startedAt, timerState?.accumulatedMs])

  const value: TimerContextValue = {
    timerState,
    elapsedMs,

    startTimer: async (taskId) => {
      await startMutation({ taskId })
    },

    stopTimer: async () => {
      const result = await stopMutation()
      return result as StopResult
    },

    pauseTimer: async () => {
      await pauseMutation()
    },

    resumeTimer: async () => {
      await resumeMutation()
    },

    discardTimer: async () => {
      await discardMutation()
    },

    commitEntry: async (args) => {
      return await commitMutation(args)
    },

    isRunningOn: (taskId) => {
      return timerState?.taskId === taskId && timerState?.status === "running"
    },
  }

  return (
    <TimerContext.Provider value={value}>
      {children}
    </TimerContext.Provider>
  )
}
