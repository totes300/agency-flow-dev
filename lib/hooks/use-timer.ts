import { useContext } from "react"
import {
  TimerActionsContext,
  TimerTickContext,
  type TimerActionsValue,
  type TimerTickValue,
} from "@/components/timer-provider"

/** Full timer hook — subscribes to both actions AND tick (re-renders every second when running) */
export function useTimer(): TimerActionsValue & TimerTickValue {
  const actions = useContext(TimerActionsContext)
  const tick = useContext(TimerTickContext)
  if (!actions || !tick) {
    throw new Error("useTimer must be used within a TimerProvider")
  }
  return { ...actions, ...tick }
}

/** Actions-only hook — does NOT re-render every second. Use for components that only need
 *  to call start/stop/pause or read timerState but don't display the live elapsed time. */
export function useTimerActions(): TimerActionsValue {
  const actions = useContext(TimerActionsContext)
  if (!actions) {
    throw new Error("useTimerActions must be used within a TimerProvider")
  }
  return actions
}

/** Tick-only hook — re-renders every second. Use for components that display
 *  the live timer countdown but don't need to call mutations. */
export function useTimerTick(): TimerTickValue {
  const tick = useContext(TimerTickContext)
  if (!tick) {
    throw new Error("useTimerTick must be used within a TimerProvider")
  }
  return tick
}
